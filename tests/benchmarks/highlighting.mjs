globalThis.browser = { i18n: { getMessage: () => '' } };
const { HighlightEngine, activeHighlightWords } = await import('../../dist/content/HighlightEngine.js');

const workloads = {
    small: { entries: 1_000, rows: 250, hitsPerRow: 1, hitEvery: 5, styles: 1, samples: 5 },
    'sparse-with-updates': { entries: 10_000, rows: 2_500, hitsPerRow: 1, hitEvery: 5, styles: 1, samples: 5, update: true },
    mixed: { entries: 10_000, rows: 2_500, hitsPerRow: 1, hitEvery: 5, styles: 1, samples: 3, mixed: true },
    dense: { entries: 10_000, rows: 2_500, hitsPerRow: 4, hitEvery: 1, styles: 64, samples: 5, inline: true },
    stress: { entries: 50_000, rows: 10_000, hitsPerRow: 1, hitEvery: 5, styles: 1, samples: 1 },
    'large-list': { entries: 150_000, rows: 2_500, hitsPerRow: 1, hitEvery: 5, styles: 1, samples: 5, update: true },
    'large-list-dense': { entries: 150_000, rows: 2_500, hitsPerRow: 4, hitEvery: 1, styles: 64, samples: 5, inline: true },
};

const filler = ['invoice', 'queue', 'opened', 'contact', 'account', 'ticket', 'review', 'service'];
function entryText(index, workload) {
    const id = `case-${index.toString(36).padStart(5, '0')}`;
    return workload.mixed && index % 3 !== 2 ? id : `${id} queue`;
}
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

function createRow(index, workload, hits) {
    const paragraph = document.createElement('p');
    const segments = [];
    let hitWords = 0;
    for (let hit = 0; hit < hits; hit++) {
        const phrase = entryText((index * 17 + hit) % workload.entries, workload);
        segments.push(phrase);
        hitWords += phrase.includes(' ') ? 2 : 1;
    }
    for (let word = hitWords; word < 20; word++) {
        segments.push(filler[word % filler.length]);
    }
    if (workload.inline) {
        for (const segment of segments) {
            const span = document.createElement('span');
            span.textContent = segment;
            paragraph.append(span, ' ');
        }
    } else {
        paragraph.textContent = segments.join(' ');
    }
    return paragraph;
}

function countRanges() {
    let count = 0;
    for (const highlight of CSS.highlights.values()) count += highlight.size;
    return count;
}

async function measure(expected, run, previousCount = 0) {
    await nextTask();
    const start = performance.now();
    run();
    const returned = performance.now();
    let first = null;
    let complete;
    while (true) {
        const count = countRanges();
        const elapsed = performance.now() - start;
        if (first === null && (previousCount === 0 ? count > 0 : count === expected)) first = elapsed;
        if (count === expected) {
            complete = elapsed;
            break;
        }
        if (count > Math.max(expected, previousCount)) throw new Error(`Expected ${expected} ranges, found ${count}`);
        await frame();
    }
    await frame();
    await frame();
    const end = performance.now();
    return { start, end, returned: returned - start, first, complete, secondFrame: end - start };
}

async function benchmark(workload) {
    const words = Array.from({ length: workload.entries }, (_, index) => ({
        wordStr: entryText(index, workload),
        active: true,
        background: `#ff${(index % workload.styles).toString(16).padStart(2, '0')}00`,
        foreground: '#000',
    }));
    const lists = [{ id: 1, name: 'Benchmark', active: true, background: '#ff0', foreground: '#000', words }];
    const content = document.createElement('main');
    let expected = 0;
    for (let row = 0; row < workload.rows; row++) {
        const hits = row % workload.hitEvery === 0 ? workload.hitsPerRow : 0;
        content.append(createRow(row, workload, hits));
        expected += hits;
    }
    document.body.replaceChildren(content);

    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let textNodes = 0;
    let pageCharacters = 0;
    while (walker.nextNode()) {
        textNodes++;
        pageCharacters += walker.currentNode.length;
    }

    const supportsLongTasks = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const longTasks = [];
    const observer = supportsLongTasks ? new PerformanceObserver(list => longTasks.push(...list.getEntries())) : null;
    observer?.observe({ type: 'longtask' });

    let engine;
    let activeWords;
    const highlight = () => engine.highlight(activeWords ??= activeHighlightWords(lists), false, true);
    engine = new HighlightEngine(highlight);
    const passes = [];
    const updates = [];
    await frame();
    await frame();
    try {
        for (let sample = 0; sample < workload.samples; sample++) {
            if (sample > 0) engine.clearHighlights();
            passes.push(await measure(expected, highlight));
            if (workload.update) {
                const row = createRow(sample, workload, 1);
                updates.push(await measure(expected + 1, () => content.append(row), expected));
                await measure(expected, () => row.remove(), expected + 1);
            }
        }
    } finally {
        engine.destroy();
        longTasks.push(...(observer?.takeRecords() ?? []));
        observer?.disconnect();
    }

    function summarize({ start, end, ...timings }) {
        const durations = longTasks.filter(task => task.startTime < end && task.startTime + task.duration > start)
            .map(task => task.duration);
        return { ...timings, longestTask: supportsLongTasks ? Math.max(0, ...durations) : null };
    }

    return {
        entries: workload.entries,
        phraseCharacters: words.reduce((total, word) => total + word.wordStr.length, 0),
        pageWords: workload.rows * 20,
        pageCharacters,
        textNodes,
        styles: workload.styles,
        ranges: expected,
        passes: passes.map(summarize),
        updates: updates.map(summarize),
    };
}

try {
    const name = new URLSearchParams(location.search).get('workload');
    const report = await benchmark(workloads[name]);
    await fetch('/report', { method: 'POST', body: JSON.stringify({ report }) });
} catch (error) {
    await fetch('/report', { method: 'POST', body: JSON.stringify({ error: error.stack ?? error.message }) });
}

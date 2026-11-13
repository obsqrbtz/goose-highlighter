import { CONSTANTS } from '../dist/types.js';

globalThis.browser = { i18n: { getMessage: () => '' } };
const { HighlightEngine, activeHighlightWords } = await import('../dist/content/HighlightEngine.js');
const { ImportService } = await import('../dist/services/ImportService.js');

const results = [];
const colors = { background: '#ff0', foreground: '#000' };

function entry(wordStr, active = true) {
    return { wordStr, active, background: '', foreground: '' };
}

function list(words, overrides = {}) {
    return { id: 1, name: 'Test list', active: true, ...colors, words: words.map(word =>
        typeof word === 'string' ? entry(word) : word), ...overrides };
}

function expect(actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

async function check(name, html, run) {
    document.body.innerHTML = html;
    const engine = new HighlightEngine(() => highlight());
    let activeWords;
    let options;

    function highlight(words, settings = {}) {
        if (words) {
            activeWords = activeHighlightWords(settings.lists ?? [list(words)]);
            options = settings;
        }
        engine.highlight(activeWords, options.matchCase ?? false, options.matchWhole ?? false);
    }

    try {
        await run(highlight, engine);
        results.push({ name, error: null });
    } catch (error) {
        results.push({ name, error: error.message });
    } finally {
        engine.destroy();
        document.querySelector('#goose-highlighter-styles')?.remove();
    }
}

function ranges() {
    return [...CSS.highlights.values()].flatMap(highlight => [...highlight]);
}

function rangeText(range) {
    const live = new Range();
    live.setStart(range.startContainer, range.startOffset);
    live.setEnd(range.endContainer, range.endOffset);
    return live.toString();
}

function expectRanges(...texts) {
    expect(ranges().map(rangeText), texts);
}

function count(engine, text) {
    return engine.getPageHighlights([{ text, ...colors }])[0]?.count ?? 0;
}

function waitForUpdate() {
    return new Promise(resolve => setTimeout(resolve, CONSTANTS.DEBOUNCE_DELAY * 2));
}

const badge = '.goose-highlighter-textarea-badge';

if (location.search === '?empty-entry') {
    await check('invalid stored empty entry', '<p>alpha</p>', highlight => {
        highlight(['', 'alpha']);
        expectRanges('alpha');
    });
} else {
    await check('literal punctuation and regex metacharacters',
        '<p>Read | beta · gamma (v2.0) [x+y]? Read / beta · gamma (v2.0) [x+y]?</p>', highlight => {
            const phrase = 'Read | beta · gamma (v2.0) [x+y]?';
            highlight([phrase]);
            expectRanges(phrase);
        });

    await check('case sensitivity and repeated matches', '<p>Alpha ALPHA alpha</p>', (highlight, engine) => {
        highlight(['alpha']);
        expectRanges('Alpha', 'ALPHA', 'alpha');
        expect(count(engine, 'alpha'), 3);
        highlight(['alpha'], { matchCase: true });
        expectRanges('alpha');
        expect(count(engine, 'alpha'), 1);
    });

    await check('inactive entries and lists', '<p>alpha beta gamma</p>', highlight => {
        highlight([], { lists: [list(['alpha', entry('beta', false)]), list(['gamma'], { active: false })] });
        expectRanges('alpha');
    });

    await check('malformed stored entries do not prevent valid matches', '<p>alpha</p>', highlight => {
        highlight(['alpha', entry(7), { active: true }, null]);
        expectRanges('alpha');
    });

    await check('crosses links and emphasis without replacing the link',
        '<p>Read the <a href="#notes">release <em>notes</em></a> today.</p>', (highlight, engine) => {
            const phrase = 'Read the release notes today';
            const link = document.querySelector('a');
            const original = document.body.innerHTML;
            highlight([phrase]);
            expectRanges(phrase);
            expect(count(engine, phrase), 1);
            expect(document.body.innerHTML, original);
            expect(document.querySelector('a') === link, true);
            const [range] = ranges();
            expect(range.startContainer === link.parentElement.firstChild, true);
            expect(range.endContainer === link.nextSibling, true);
            expect(range.endOffset, ' today'.length);
        });

    await check('preserves whitespace-only inline separators',
        '<p><b>release</b> <em>notes</em></p>', highlight => {
            highlight(['release notes']);
            expectRanges('release notes');
        });

    await check('crosses adjacent text nodes without adding spaces', '<p>release</p>', highlight => {
        document.querySelector('p').firstChild.splitText(3);
        highlight(['release']);
        expectRanges('release');
    });

    await check('matches normal spaces against nonbreaking spaces and collapsed DOM whitespace',
        '<p>before Read&nbsp;|  beta\n\t·&nbsp;gamma! after</p>', highlight => {
            highlight(['Read | beta · gamma!']);
            expectRanges('Read\u00a0|  beta\n\t·\u00a0gamma!');
        });

    await check('matches pasted nonbreaking spaces against ordinary page spaces',
        '<p>beta gamma</p>', highlight => {
            highlight(['beta\u00a0gamma']);
            expectRanges('beta gamma');
        });

    await check('literal entity spellings stay literal', '<p>beta&nbsp;gamma</p><p>beta&amp;nbsp;gamma</p>', highlight => {
        highlight(['beta&nbsp;gamma']);
        expectRanges('beta&nbsp;gamma');
    });

    await check('does not cross paragraphs, table cells, list items, or explicit line breaks',
        '<p>alpha </p><p>beta</p><table><tr><td>alpha </td><td>beta</td></tr></table>' +
        '<ul><li>alpha </li><li>beta</li></ul><p>alpha <br>beta</p>', highlight => {
            highlight(['alpha beta']);
            expectRanges();
        });

    await check('preserves meaningful repeated spaces in preformatted text',
        '<pre>alpha  beta</pre><p>alpha beta</p>', highlight => {
            highlight(['alpha beta']);
            expectRanges('alpha beta');
            highlight(['alpha beta', 'alpha  beta']);
            // Registry insertion order is retained when an existing layer is reused.
            expect(ranges().map(rangeText).sort(), ['alpha  beta', 'alpha beta']);
        });

    await check('highlight colors inherit through nested text and resolve CSS variables locally',
        '<p style="--local-highlight: #00ff00"><em>alpha</em> <span>beta</span></p>', highlight => {
            highlight([
                { ...entry('alpha'), background: '#ff0000', foreground: '#0000ff' },
                { ...entry('beta'), background: 'var(--local-highlight)' },
            ]);
            for (const [name, layer] of CSS.highlights) {
                const [range] = layer;
                const style = getComputedStyle(range.startContainer.parentElement, `::highlight(${name})`);
                expect(style.backgroundColor, rangeText(range) === 'alpha' ? 'rgb(255, 0, 0)' : 'rgb(0, 255, 0)');
                expect(style.color, rangeText(range) === 'alpha' ? 'rgb(0, 0, 255)' : 'rgb(0, 0, 0)');
            }
            expectRanges('alpha', 'beta');
        });

    await check('excludes hidden and non-content text',
        '<p>alpha</p><p hidden><b>alpha</b></p><script type="text/plain">alpha</script>' +
        '<style>/* alpha */</style><template><p>alpha</p></template>', highlight => {
            highlight(['alpha']);
            expectRanges('alpha');
        });

    await check('overlapping matches keep their ranges and shorter matches paint on top',
        '<p>beta <em>gamma</em> delta</p>', (highlight, engine) => {
            const words = ['beta', 'gamma', 'beta gamma', 'gamma delta'];
            for (const order of [words, [...words].reverse()]) {
                const lists = [list(order.map((word, i) => ({
                    ...entry(word), background: ['red', 'green', 'blue', 'yellow'][i],
                })))];
                highlight([], { matchWhole: true, lists });
                expect(ranges().map(rangeText).sort(), [...words].sort());
                for (const word of words) expect(count(engine, word), 1);
                const priorities = new Map([...CSS.highlights.values()].flatMap(layer =>
                    [...layer].map(range => [rangeText(range), layer.priority])));
                expect(priorities.get('beta') > priorities.get('beta gamma'), true);
                expect(priorities.get('gamma') > priorities.get('beta gamma'), true);
                expect(priorities.get('gamma') > priorities.get('gamma delta'), true);
            }
        });

    await check('whole-word matching checks letters across inline nodes',
        '<p>al<span>pha</span> alpha<span>s</span> alpha</p>', highlight => {
            highlight(['alpha'], { matchWhole: true });
            expectRanges('alpha', 'alpha');
            expect(ranges()[0].startContainer !== ranges()[0].endContainer, true);
        });

    await check('whole-word matching treats numbers, underscores, and combining marks as continuations',
        '<p>alpha2 alpha_beta alpha\u0338 alpha!</p>', highlight => {
            highlight(['alpha'], { matchWhole: true });
            expectRanges('alpha');
            const [match] = ranges();
            expect(match.startOffset, match.startContainer.data.lastIndexOf('alpha'));
        });

    await check('punctuation at the edge can serve as its own word boundary',
        '<p>x#beta #betamax #beta2</p>', highlight => {
            highlight(['#beta'], { matchWhole: true });
            expectRanges('#beta');
            expect(ranges()[0].startOffset, 1);
        });

    await check('normalizes composed and decomposed accents and preserves original offsets',
        '<p>😀 cafe\u0301 and café!</p>', (highlight, engine) => {
            highlight(['café']);
            expectRanges('cafe\u0301', 'café');
            expect(count(engine, 'café'), 2);
            const [range] = ranges();
            expect([range.startOffset, range.endOffset], [3, 8]);
        });

    await check('keeps case-insensitive Greek sigma matches in the page count',
        '<p>Σ σ ς</p>', (highlight, engine) => {
            highlight(['σ']);
            expectRanges('Σ', 'σ', 'ς');
            expect(count(engine, 'σ'), 3);
        });

    await check('updates inserted and removed content', '<p>alpha</p>', async (highlight, engine) => {
        highlight(['alpha']);
        const extra = document.createElement('p');
        extra.textContent = 'alpha';
        document.body.append(extra);
        await waitForUpdate();
        expect(count(engine, 'alpha'), 2);
        extra.remove();
        await waitForUpdate();
        expect(count(engine, 'alpha'), 1);
    });

    await check('updates in-place text edits and removes stale matches',
        '<p>alpha</p><p>beta</p>', async (highlight, engine) => {
            highlight(['alpha']);
            const [oldText, newText] = [...document.querySelectorAll('p')].map(p => p.firstChild);
            oldText.data = 'gamma';
            newText.data = 'alpha alpha';
            await waitForUpdate();
            expectRanges('alpha', 'alpha');
            expect(count(engine, 'alpha'), 2);
        });

    await check('updates visibility changes in both directions',
        '<p>alpha</p>', async highlight => {
            const paragraph = document.querySelector('p');
            highlight(['alpha']);
            expectRanges('alpha');
            paragraph.hidden = true;
            await waitForUpdate();
            expectRanges();
            paragraph.hidden = false;
            await waitForUpdate();
            expectRanges('alpha');
        });

    await check('reused runs agree with a full scan after inline edits and distant style changes',
        '<style>body:has(.hide) #remote { display: none }</style>' +
        '<p id="edited">alpha <em>beta</em></p><p id="remote">alpha beta</p><p>alpha beta</p>',
        async (highlight, engine) => {
            const words = ['alpha', 'alpha beta', 'beta'];
            highlight(words, { matchWhole: true });
            const edited = document.querySelector('#edited');
            const unchanged = ranges().find(range => range.startContainer === document.body.lastElementChild.firstChild);
            edited.querySelector('em').firstChild.splitText(2);
            edited.classList.add('hide');
            await waitForUpdate();
            expect(ranges().includes(unchanged), true);
            expect(ranges().some(range => range.startContainer.parentElement.id === 'remote'), false);

            const nodes = [...document.querySelectorAll('p')].flatMap(p => {
                const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
                const text = [];
                while (walker.nextNode()) text.push(walker.currentNode);
                return text;
            });
            const offsets = range => [
                nodes.indexOf(range.startContainer), range.startOffset,
                nodes.indexOf(range.endContainer), range.endOffset,
            ];
            const snapshot = () => {
                const layers = [...CSS.highlights].filter(([name]) => name !== 'gh-flash')
                    .map(([name, layer]) => [name, layer.priority, [...layer].map(offsets)
                        .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3])]);
                engine.scrollToHighlight('alpha beta', 1);
                return [layers, words.map(word => count(engine, word)), offsets([...CSS.highlights.get('gh-flash')][0])];
            };
            const reused = snapshot();
            engine.clearHighlights();
            highlight();
            await engine.waitForScan();
            expect(snapshot(), reused);
        });

    await check('keeps painted highlights until a batched rescan finishes',
        '<p>alpha</p><p>beta</p>', async (highlight, engine) => {
            highlight(['alpha', 'beta']);
            await engine.waitForScan();
            const previousLayers = [...CSS.highlights];
            const previousStyles = document.querySelector('#goose-highlighter-styles').textContent;
            const betaRange = ranges().find(range => rangeText(range) === 'beta');
            document.querySelector('p').textContent = 'gamma';
            const originalNow = performance.now;
            let clock = originalNow.call(performance);
            // Force the engine to yield so the browser could paint between batches.
            performance.now = () => clock += 10;
            try {
                highlight(['gamma', 'beta'], { lists: [list(['gamma', 'beta'], { background: '#0f0' })] });
                expect(previousLayers.every(([name, layer]) => CSS.highlights.get(name) === layer), true);
                expect(ranges().includes(betaRange), true);
                expect(count(engine, 'beta'), 1);
                expect(document.querySelector('#goose-highlighter-styles').textContent, previousStyles);
            } finally {
                performance.now = originalNow;
            }
            await engine.waitForScan();
            expectRanges('gamma', 'beta');
            expect(count(engine, 'alpha'), 0);
            expect(count(engine, 'gamma'), 1);
            expect(document.querySelector('#goose-highlighter-styles').textContent.includes('#0f0'), true);
            highlight(['beta']);
            await engine.waitForScan();
            expectRanges('beta');
            expect(CSS.highlights.size, 1);
            engine.clearHighlights();
            expectRanges();
        });

    await check('clearing a yielded scan cannot republish its pending highlights',
        '<p>alpha</p><p>beta</p>', async (highlight, engine) => {
            highlight(['alpha']);
            await engine.waitForScan();
            const originalNow = performance.now;
            let clock = originalNow.call(performance);
            performance.now = () => clock += 10;
            try {
                highlight(['beta']);
                engine.clearHighlights();
            } finally {
                performance.now = originalNow;
            }
            await waitForUpdate();
            expectRanges();
            expect(count(engine, 'alpha'), 0);
            expect(count(engine, 'beta'), 0);
        });

    await check('scroll-driven updates preserve unchanged highlight layers and ranges',
        '<p>alpha</p><p>beta</p><div id="feed"></div>', async (highlight, engine) => {
            highlight(['alpha', 'beta']);
            await engine.waitForScan();
            const originalLayers = [...CSS.highlights];
            const originalRanges = ranges();
            const registry = CSS.highlights;
            const originalSet = registry.set;
            const originalDelete = registry.delete;
            let registryChanges = 0;
            registry.set = function (...args) { registryChanges++; return originalSet.apply(this, args); };
            registry.delete = function (...args) { registryChanges++; return originalDelete.apply(this, args); };
            const onScroll = () => document.body.classList.toggle('scrolled');
            window.addEventListener('scroll', onScroll);
            try {
                for (let i = 0; i < 3; i++) {
                    window.dispatchEvent(new Event('scroll'));
                    const item = document.createElement('p');
                    item.textContent = 'unrelated lazy-loaded item';
                    document.querySelector('#feed').append(item);
                    await waitForUpdate();
                    await engine.waitForScan();
                    expect(originalLayers.every(([name, layer]) => registry.get(name) === layer), true);
                    expect(originalRanges.every(range => ranges().includes(range)), true);
                }
                expect(registryChanges, 0);
                document.querySelector('p').textContent = 'alpha alpha';
                highlight();
                await engine.waitForScan();
                expect(count(engine, 'alpha'), 2);
                expect(ranges().includes(originalRanges[1]), true);
                expect(originalLayers.every(([name, layer]) => registry.get(name) === layer), true);
                expect(registryChanges, 0);
                document.querySelector('p').remove();
                highlight();
                await engine.waitForScan();
                expectRanges('beta');
                expect(registryChanges, 1);
            } finally {
                window.removeEventListener('scroll', onScroll);
                document.body.classList.remove('scrolled');
                registry.set = originalSet;
                registry.delete = originalDelete;
            }
        });

    await check('a 100k-word feed keeps product highlights when loading nodes change mid-scan',
        '<div id="feed"><p id="loading">loading</p><p>alpha</p></div>', async (highlight, engine) => {
            highlight(['alpha', 'beta', ...Array.from({ length: 99_998 }, (_, i) => `catalogue-entry-${i}`)]);
            await engine.waitForScan();
            const originalNow = performance.now;
            const originalYield = window.scheduler.yield;
            let clock = originalNow.call(performance);
            const batches = [];
            performance.now = () => clock += 10;
            window.scheduler.yield = () => new Promise(resolve => batches.push(resolve));
            try {
                highlight();
                // Pause after the traversal has read the loading paragraph,
                // then remove it as an infinite feed does between scan tasks.
                for (let i = 0; i < 2; i++) {
                    expect(batches.length, 1);
                    batches.shift()();
                    await Promise.resolve();
                }
                document.querySelector('#loading').remove();
                const product = document.createElement('p');
                product.textContent = 'beta';
                document.querySelector('#feed').append(product);
            } finally {
                performance.now = originalNow;
                window.scheduler.yield = originalYield;
                batches.shift()?.();
            }
            await engine.waitForScan();
            expectRanges('alpha');
            expect(count(engine, 'alpha'), 1);
            await waitForUpdate();
            await engine.waitForScan();
            expectRanges('alpha', 'beta');
        });

    await check('recycling a product card keeps its highlights before a rescan',
        '<div id="pool" style="will-change:transform;transform:translateY(0)"><article>alpha beta</article></div><div id="parking"></div>',
        async (highlight, engine) => {
            highlight(['alpha', 'beta']);
            await engine.waitForScan();
            const originalRanges = ranges();
            const card = document.querySelector('article');
            const pool = document.querySelector('#pool');
            document.querySelector('#parking').append(card);
            pool.append(card);
            await Promise.resolve();
            expect(ranges().every(range => !range.collapsed), true);
            expectRanges('alpha', 'beta');
            // Frameworks can also rewrite a Text node with its existing value.
            const unchangedText = card.firstChild.data;
            card.firstChild.data = unchangedText;
            await Promise.resolve();
            expectRanges('alpha', 'beta');
            await waitForUpdate();
            await engine.waitForScan();
            expect(originalRanges.every(range => ranges().includes(range)), true);
            engine.scrollToHighlight('beta', 0);
            expect(rangeText([...CSS.highlights.get('gh-flash')][0]), 'beta');
        });

    await check('keeps relevant mutations across observer deliveries', '<p>beta</p>', async highlight => {
        highlight(['alpha']);
        const paragraph = document.createElement('p');
        paragraph.textContent = 'alpha';
        document.body.append(paragraph);
        await Promise.resolve();
        document.body.append(document.createComment('unrelated'));
        await waitForUpdate();
        expectRanges('alpha');
    });

    await check('clears ranges and counts when the active list is emptied',
        '<p>alpha</p>', (highlight, engine) => {
            highlight(['alpha']);
            expectRanges('alpha');
            highlight([]);
            expectRanges();
            expect(count(engine, 'alpha'), 0);
        });

    await check('text field popup marks every badge occurrence', '<div><textarea>alpha alpha alpha</textarea></div>', highlight => {
        highlight(['alpha']);
        const indicator = document.querySelector(badge);
        expect(indicator?.textContent, '3');
        indicator.click();
        expect([...document.querySelectorAll('.gh-popup-pre mark')].map(mark => mark.textContent),
            ['alpha', 'alpha', 'alpha']);
    });

    await check('text field preview survives page rescans and still closes explicitly',
        '<div><textarea>alpha alpha</textarea></div><p>beta</p>', async (highlight, engine) => {
            highlight(['alpha']);
            document.querySelector(badge).click();
            const popup = document.querySelector('.goose-highlighter-textarea-popup');
            const paragraph = document.querySelector('p');
            paragraph.textContent = 'alpha';
            await waitForUpdate();
            await engine.waitForScan();
            expect(count(engine, 'alpha'), 3);
            expect(popup.isConnected, true);
            expect(popup.querySelector('.gh-popup-pre').textContent, 'alpha alpha');

            document.querySelector('textarea').classList.add('validated');
            await waitForUpdate();
            await engine.waitForScan();
            expect(popup.isConnected, true);
            popup.querySelector('.gh-popup-close').click();
            expect(popup.isConnected, false);

            document.querySelector(badge).click();
            engine.clearHighlights();
            expect(document.querySelector('.goose-highlighter-textarea-popup'), null);
        });

    await check('a badge inside a modal dialog opens a visible interactive preview',
        '<form method="dialog"><dialog><label>Editable dialog text<textarea>alpha alpha beta — release notes</textarea></label></dialog></form>',
        (highlight, engine) => {
            const dialog = document.querySelector('dialog');
            dialog.showModal();
            try {
                highlight(['alpha', 'beta', 'release notes']);
                document.querySelector(badge).click();
                const popup = document.querySelector('.goose-highlighter-textarea-popup');
                expect(popup?.querySelector('.gh-popup-pre').textContent, 'alpha alpha beta — release notes');
                const close = popup.querySelector('.gh-popup-close');
                close.focus();
                expect(document.activeElement === close, true);
                const rect = close.getBoundingClientRect();
                expect(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === close, true);
                close.click();
                expect(popup.isConnected, false);
                expect(dialog.open, true);
                document.querySelector(badge).click();
                engine.clearHighlights();
                expect(document.querySelector('.goose-highlighter-textarea-popup'), null);
            } finally {
                dialog.close();
            }
        });

    await check('text field occurrences are counted and navigable', '<div><textarea>alpha alpha</textarea></div>', (highlight, engine) => {
        highlight(['alpha']);
        expect(count(engine, 'alpha'), 2);
        engine.scrollToHighlight('alpha', 1);
        const field = document.querySelector('textarea');
        expect([field.selectionStart, field.selectionEnd], [6, 11]);
    });

    await check('overlapping field matches are counted without duplicating preview text',
        '<div><textarea>before beta gamma delta after</textarea></div>', (highlight, engine) => {
            const words = ['beta gamma', 'gamma', 'gamma delta'];
            highlight(words);
            for (const word of words) expect(count(engine, word), 1);
            const indicator = document.querySelector(badge);
            expect(indicator?.textContent, '3');
            indicator.click();
            expect(document.querySelector('.gh-popup-pre').textContent, 'before beta gamma delta after');
            expect(document.querySelector('.gh-popup-pre mark').textContent, 'beta gamma delta');
            engine.scrollToHighlight('gamma', 0);
            const field = document.querySelector('textarea');
            expect(field.value.slice(field.selectionStart, field.selectionEnd), 'gamma');
        });

    await check('default text inputs and explicit text inputs both get badges',
        '<div><input value="alpha"></div><div><input type="text" value="alpha"></div>', highlight => {
            highlight(['alpha']);
            expect([...document.querySelectorAll(badge)].map(element => element.textContent), ['1', '1']);
        });

    await check('field input refreshes the badge without changing the field value', '<div><input type="text"></div>', highlight => {
        highlight(['alpha']);
        const field = document.querySelector('input');
        field.value = 'alpha alpha';
        field.dispatchEvent(new Event('input'));
        expect(document.querySelector(badge)?.textContent, '2');
        expect(field.value, 'alpha alpha');
        field.value = 'beta';
        field.dispatchEvent(new Event('input'));
        expect(document.querySelector(badge), null);
    });

    await check('stopping highlighting removes field listeners', '<div><input type="text"></div>', (highlight, engine) => {
        highlight(['alpha']);
        engine.clearHighlights();
        const field = document.querySelector('input');
        field.value = 'alpha';
        field.dispatchEvent(new Event('input'));
        expect(document.querySelector(badge) === null, true);
    });

    await check('list and settings import reject empty and malformed word entries', '', () => {
        const payload = JSON.stringify({ lists: [list(['alpha', '', '  ', { active: true }, { wordStr: 7, active: true }])] });
        for (const imported of [ImportService.extractLists(payload), ImportService.extractSettings(payload).lists]) {
            const words = imported.flatMap(item => item.words).map(word => word.wordStr);
            expect(words, ['alpha']);
        }
    });

    await check('maps combined whitespace and accents split across inline nodes',
        '<p>😀  Cafe<span>\u0301&nbsp;</span>  notes!</p>', highlight => {
            highlight(['café notes']);
            expectRanges('Cafe\u0301\u00a0  notes');
            const [range] = ranges();
            expect([range.startOffset, range.endOffset], [4, 7]);
        });

    await check('popup opens page highlights before loading wordlists and keeps list views current', '', async () => {
        const html = await fetch('/popup/popup.html').then(response => response.text());
        document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
        const previousBrowser = { ...globalThis.browser };
        let completeListRead;
        let onStorageChange;
        let listReads = 0;
        let pageRequests = 0;
        const storedList = list(['alpha'], { name: 'Stored list' });
        Object.assign(globalThis.browser, {
            storage: {
                local: {
                    get: async defaults => {
                        if (typeof defaults === 'string') return { [defaults]: '{"activeTab":"page-highlights"}' };
                        if (!Object.hasOwn(defaults, 'lists')) return defaults;
                        listReads++;
                        return await new Promise(resolve => { completeListRead = resolve; });
                    },
                    set: async () => {},
                },
                onChanged: { addListener(listener) { onStorageChange = listener; } },
            },
            tabs: {
                query: async () => [{ id: 1, url: 'https://example.com' }],
                sendMessage: async () => {
                    pageRequests++;
                    return { highlights: [], lists: [] };
                },
            },
            runtime: { getPlatformInfo: async () => ({ os: 'linux' }), sendMessage: async () => {} },
        });
        const { PopupController } = await import('../dist/popup/PopupController.js');
        const controller = new PopupController();
        const open = tab => document.querySelector(`[data-tab="${tab}"]`).click();
        try {
            await controller.initialize();
            expect([listReads, pageRequests], [0, 1]);
            open('lists');
            open('words');
            expect(listReads, 1);
            expect(document.querySelector('[data-tab-content="words"]').inert, true);
            onStorageChange({ lists: { newValue: [storedList] } }, 'local');
            completeListRead({ lists: [list(['stale'])] });
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(document.getElementById('wordCount').textContent, '1');
            expect(document.getElementById('wordList').textContent.includes('alpha'), true);
            expect(document.querySelector('[data-tab-content="words"]').inert, false);
            onStorageChange({ globalHighlightEnabled: { newValue: false } }, 'local');
            expect(document.getElementById('globalHighlightToggle').checked, false);
            open('lists');
            expect(document.getElementById('currentListName').textContent, 'Stored list');
            expect(listReads, 1);
        } finally {
            controller.captureScrollAndSave();
            Object.assign(globalThis.browser, previousBrowser);
        }
    });

    await check('quick entry keeps a usable input beside Add in both themes', '', async () => {
        const html = await fetch('/popup/popup.html').then(response => response.text());
        document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = '/popup/popup.css';
        await new Promise((resolve, reject) => {
            stylesheet.onload = resolve;
            stylesheet.onerror = reject;
            document.head.append(stylesheet);
        });
        const panel = document.querySelector('[data-tab-content="words"]');
        document.querySelectorAll('.tab-content').forEach(item => item.classList.remove('active'));
        panel.classList.add('active');
        panel.removeAttribute('aria-busy');
        panel.inert = false;
        try {
            for (const theme of ['dark', 'light']) {
                document.documentElement.className = theme;
                for (const label of ['Add', 'Добавить', 'Hinzufügen']) {
                    document.getElementById('addWordsBtn').textContent = label;
                    const input = document.getElementById('quickWord').getBoundingClientRect();
                    const button = document.getElementById('addWordsBtn').getBoundingClientRect();
                    const row = document.getElementById('quickWordForm').getBoundingClientRect();
                    expect(input.width > 180, true);
                    expect(button.width < 140, true);
                    expect(input.right <= button.left && button.right <= row.right + 1, true);
                    expect([input.height, button.height], [32, 32]);
                }
            }
        } finally {
            stylesheet.remove();
            document.documentElement.className = '';
        }
    });

    await check('word entry reviews multiline paste, restores drafts and retries failed saves', '', async () => {
        const html = await fetch('/popup/popup.html').then(response => response.text());
        const resetDOM = () => {
            document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
            document.querySelector('[data-tab-content="words"]').inert = false;
        };
        resetDOM();
        const previousBrowser = { ...globalThis.browser };
        const lists = [list(['alpha'])];
        let failSave = false;
        let writes = 0;
        Object.assign(globalThis.browser, {
            storage: { local: { set: async () => {
                writes++;
                if (failSave) throw new Error('Storage full');
            } } },
            tabs: { query: (_options, callback) => callback([]) },
        });
        const { WordEntryManager } = await import('../dist/popup/managers/WordEntryManager.js');
        const create = () => {
            const manager = new WordEntryManager(lists, () => 0, () => {});
            manager.setupEventListeners();
            manager.render();
            return manager;
        };
        const paste = (element, text) => {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', text);
            element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        };
        const settle = () => new Promise(resolve => setTimeout(resolve, 0));
        try {
            localStorage.removeItem('goose-word-entry-draft');
            localStorage.removeItem('goose-word-entry-draft-quick');
            create();
            const quick = document.getElementById('quickWord');
            quick.value = 'single phrase';
            document.getElementById('quickWordForm').dispatchEvent(new Event('submit', { cancelable: true }));
            await settle();
            expect(lists[0].words.map(word => word.wordStr), ['alpha', 'single phrase']);
            expect([quick.value, document.activeElement.id], ['', 'quickWord']);
            paste(quick, 'alpha\r\n beta gamma \r\nbeta gamma\r\n\r\ndelta');
            expect(document.getElementById('bulkWordEditor').hidden, false);
            expect(document.getElementById('saveBulkWords').textContent, 'Add 2 entries');
            const inputs = () => [...document.querySelectorAll('#bulkWordRows input')];
            expect(inputs().map(input => input.value), ['alpha', ' beta gamma ', 'beta gamma', '', 'delta']);
            inputs().at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            expect(inputs().length, 6);
            expect(document.activeElement, inputs().at(-1));
            inputs().at(-1).value = 'epsilon';
            inputs().at(-1).dispatchEvent(new Event('input', { bubbles: true }));
            resetDOM();
            create();
            expect(inputs().at(-1).value, 'epsilon');
            expect(document.getElementById('bulkDestination').textContent, 'Adding to: Test list');
            expect(document.getElementById('saveBulkWords').textContent, 'Add 3 entries');
            failSave = true;
            document.getElementById('saveBulkWords').click();
            await settle();
            expect(lists[0].words.length, 2);
            expect(document.getElementById('bulkWordEditor').hidden, false);
            expect(document.getElementById('wordEntryStatus').textContent.includes('Could not save'), true);
            expect(JSON.parse(localStorage.getItem('goose-word-entry-draft')).rows.at(-1), 'epsilon');
            failSave = false;
            document.getElementById('saveBulkWords').click();
            await settle();
            expect(lists[0].words.map(word => word.wordStr), ['alpha', 'single phrase', 'beta gamma', 'delta', 'epsilon']);
            expect(document.getElementById('bulkWordEditor').hidden, true);
            expect(localStorage.getItem('goose-word-entry-draft'), null);
            expect(writes, 3);
            document.getElementById('addMultipleBtn').click();
            expect(inputs().map(input => input.value), ['']);
            expect(document.getElementById('saveBulkWords').disabled, true);
            document.getElementById('cancelBulkWords').click();
            expect(document.getElementById('bulkWordEditor').hidden, true);
        } finally {
            localStorage.removeItem('goose-word-entry-draft');
            localStorage.removeItem('goose-word-entry-draft-quick');
            Object.assign(globalThis.browser, previousBrowser);
        }
    });

    await check('the injected bundle matches phrases and refreshes its wordlist snapshot',
        '<p>Read the <a href="#notes">release notes</a>&nbsp;today.</p><div><textarea>release notes</textarea></div>', async () => {
            const phrase = 'Read the release notes today';
            let lists = [list([phrase])];
            let onMessage;
            globalThis.browser.storage = { local: { get: async defaults => ({ ...defaults, lists }) } };
            globalThis.browser.runtime = { onMessage: { addListener(listener) { onMessage = listener; } } };
            const script = document.createElement('script');
            script.src = new URL('../dist/content-standalone.js', import.meta.url).href;
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = () => reject(new Error('Could not load the content bundle'));
                document.head.appendChild(script);
            });
            expectRanges('Read the release notes\u00a0today');
            lists = [list(['release notes'])];
            onMessage({ type: 'WORD_LIST_UPDATED' });
            await waitForUpdate();
            expectRanges('release notes');
            expect(document.querySelector(badge).textContent, '1');
            const response = await new Promise(resolve => onMessage({ type: 'GET_PAGE_HIGHLIGHTS' }, {}, resolve));
            expect(response.highlights.map(({ word, count }) => [word, count]), [['release notes', 2]]);
            expect(response.lists, [{ id: 1, name: 'Test list', background: '#ff0' }]);
        });
}

const report = document.createElement('pre');
report.id = 'test-results';
report.textContent = btoa(Array.from(new TextEncoder().encode(JSON.stringify(results)), byte => String.fromCharCode(byte)).join(''));
document.body.replaceChildren(report);

import { CONSTANTS } from '../dist/types.js';

globalThis.browser = { i18n: { getMessage: () => '' } };
const { HighlightEngine } = await import('../dist/content/HighlightEngine.js');
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
    let lists;
    let options;

    function highlight(words, settings = {}) {
        if (words) {
            lists = settings.lists ?? [list(words)];
            options = settings;
        }
        engine.highlight(lists, options.matchCase ?? false, options.matchWhole ?? false);
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

function expectRanges(...texts) {
    expect(ranges().map(range => range.toString()), texts);
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
                expect(ranges().map(range => range.toString()).sort(), [...words].sort());
                for (const word of words) expect(count(engine, word), 1);
                const priorities = new Map([...CSS.highlights.values()].flatMap(layer =>
                    [...layer].map(range => [range.toString(), layer.priority])));
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

    await check('the injected content bundle uses the same matcher',
        '<p>Read the <a href="#notes">release notes</a>&nbsp;today.</p>', async () => {
            const phrase = 'Read the release notes today';
            globalThis.browser.storage = { local: { get: async defaults => ({ ...defaults, lists: [list([phrase])] }) } };
            globalThis.browser.runtime = { onMessage: { addListener() {} } };
            const script = document.createElement('script');
            script.src = new URL('../dist/content-standalone.js', import.meta.url).href;
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = () => reject(new Error('Could not load the content bundle'));
                document.head.appendChild(script);
            });
            expectRanges('Read the release notes\u00a0today');
        });
}

const report = document.createElement('pre');
report.id = 'test-results';
report.textContent = btoa(Array.from(new TextEncoder().encode(JSON.stringify(results)), byte => String.fromCharCode(byte)).join(''));
document.body.replaceChildren(report);

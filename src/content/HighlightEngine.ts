import { browserAPI } from '../utils/browser.js';
import { HighlightList, ActiveWord, CONSTANTS, BadgePosition, HighlightInfo, isValidHighlightWord } from '../types.js';
import { PhraseMatcher, phraseKey, projectText, PhraseEntry } from './PhraseMatcher.js';
import { isHighlighterUi, rangeFor, TextRun, textRuns } from './TextRuns.js';

type TextField = HTMLTextAreaElement | HTMLInputElement;

interface FieldMatch {
  key: string;
  start: number;
  end: number;
}

interface FieldState {
  onInput: () => void;
  matches: FieldMatch[];
  badge?: HTMLElement;
}

interface RunMatch {
  key: string;
  layer: string;
  length: number;
  start: number;
  end: number;
  range?: StaticRange;
}

interface CachedRun {
  text: string;
  offset: number;
  collapse: boolean;
  matches: RunMatch[];
}

export interface ScanTimings {
  preparation: number;
  active: number;
  registration: number;
}

const hexColor = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

function supportsHighlightInheritance(): boolean {
  if (typeof Highlight === 'undefined' || !matchMedia('(forced-colors: none)').matches) return false;
  const probe = document.createElement('style');
  const selector = '::highlight(gh-inheritance-probe)';
  probe.textContent = `:root${selector} { background-color: rgb(1, 2, 3); }`;
  document.head.appendChild(probe);
  try {
    return getComputedStyle(document.body, selector).backgroundColor === 'rgb(1, 2, 3)';
  } finally {
    probe.remove();
  }
}

export function activeHighlightWords(lists: HighlightList[]): ActiveWord[] {
  const activeWords: ActiveWord[] = [];
  for (const list of lists) {
    if (!list?.active || !Array.isArray(list.words)) continue;
    for (const word of list.words) {
      if (!isValidHighlightWord(word) || !word.active) continue;
      activeWords.push({
        text: word.wordStr,
        background: word.background || list.background || '#ff0',
        foreground: word.foreground || list.foreground || '#000',
        listId: list.id,
        listName: list.name || 'Default',
      });
    }
  }
  return activeWords;
}

export class HighlightEngine {
  private badgePosition: BadgePosition = { horizontal: 'right', vertical: 'top', placement: 'border' };
  private styleElement?: HTMLStyleElement;
  private stylesheet = '';
  private highlights = new Map<string, Highlight>();
  private highlightsByWord = new Map<string, StaticRange[]>();
  private fields = new Map<TextField, FieldState>();
  private popup?: HTMLElement;
  private observer: MutationObserver;
  private scanVersion = 0;
  private scanDone?: Promise<void>;
  private finishScan?: () => void;
  private updateTimer?: number;
  private flashTimer?: number;
  private isDestroyed = false;
  private words: ActiveWord[] = [];
  private matchCase = false;
  private matchWhole = false;
  private matcher?: PhraseMatcher;
  private preservedMatcher?: PhraseMatcher;
  private inheritsHighlightColors?: boolean;
  private cachedRuns = new WeakMap<Text, CachedRun>();

  constructor(private onUpdate: () => void, private onScanMeasured?: (timings: ScanTimings) => void) {
    this.observer = new MutationObserver(mutations => {
      const changed = mutations.some(mutation => {
        if (isHighlighterUi(mutation.target)) return false;
        if (mutation.type !== 'childList') return true;
        return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
          (node instanceof Text || node instanceof Element) && !isHighlighterUi(node));
      });
      if (!changed) return;
      clearTimeout(this.updateTimer);
      const timer = window.setTimeout(() => {
        // Let an in-flight scan finish before rescanning changes made during it.
        void this.waitForScan().then(() => {
          if (this.updateTimer !== timer) return;
          this.updateTimer = undefined;
          this.onUpdate();
        });
      }, CONSTANTS.DEBOUNCE_DELAY);
      this.updateTimer = timer;
    });
  }

  setBadgePosition(position: BadgePosition): void {
    this.badgePosition = position;
  }

  private *updateMatcher(words: ActiveWord[], matchCase: boolean, matchWhole: boolean): Generator<void> {
    if (this.matcher && this.matchCase === matchCase && this.matchWhole === matchWhole &&
      (this.words === words || (this.words.length === words.length && words.every((word, i) =>
        word.text === this.words[i].text && word.background === this.words[i].background &&
        word.foreground === this.words[i].foreground)))) return;

    const inheritColors = this.inheritsHighlightColors ??= supportsHighlightInheritance();
    const rules: string[] = [];
    const inheritedRules: string[] = [];
    const styles = new Map<string, { id: number; colors: string; fixed: boolean }>();
    const layers = new Set<string>();
    const entries = new Map<string, PhraseEntry>();
    let preserved: Map<string, PhraseEntry> | undefined;
    let processed = 0;
    for (const word of words) {
      if (++processed % 256 === 0) yield;
      const key = phraseKey(word.text, matchCase);
      const collapsed = key.replace(/[ \t\r\n\f]+/g, ' ');
      if (!collapsed) continue;
      const styleKey = `${word.background}|${word.foreground}`;
      let style = styles.get(styleKey);
      if (!style) {
        const background = CSS.supports('color', word.background) ? word.background : '#ff0';
        const foreground = CSS.supports('color', word.foreground) ? word.foreground : '#000';
        style = {
          id: styles.size,
          colors: `background-color: ${background}; color: ${foreground};`,
          fixed: inheritColors && hexColor.test(background) && hexColor.test(foreground),
        };
        styles.set(styleKey, style);
      }
      for (const length of [collapsed.length, key.length]) {
        const layer = `gh-${style.id}-${length}`;
        if (layers.has(layer)) continue;
        layers.add(layer);
        (style.fixed ? inheritedRules : rules).push(`::highlight(${layer}) { ${style.colors} }`);
      }
      const entry = { key, style: style.id };
      if (!preserved && collapsed !== key) {
        preserved = new Map();
        let copied = 0;
        for (const [existingKey, existingEntry] of entries) {
          preserved.set(existingKey, existingEntry);
          if (++copied % 256 === 0) yield;
        }
      }
      entries.set(collapsed, entry);
      preserved?.set(key, entry);
    }
    const matcher = new PhraseMatcher(matchWhole);
    yield* matcher.build(entries);
    let preservedMatcher;
    if (preserved) {
      preservedMatcher = new PhraseMatcher(matchWhole);
      yield* preservedMatcher.build(preserved);
    }

    if (!this.styleElement) {
      this.styleElement = document.createElement('style');
      this.styleElement.id = 'goose-highlighter-styles';
      document.head.appendChild(this.styleElement);
    }
    (inheritColors ? inheritedRules : rules).push('::highlight(gh-flash) { background-color: rgba(255, 165, 0, 0.8); }');
    // Share fixed colors through highlight inheritance. Context-dependent colors
    // and forced-color adjustments still need to resolve on each element.
    if (inheritedRules.length) {
      rules.push(
        `@media (forced-colors: none) {\n${inheritedRules.map(rule => `:root${rule}`).join('\n')}\n}`,
        `@media (forced-colors: active) {\n${inheritedRules.join('\n')}\n}`,
      );
    }
    this.stylesheet = rules.join('\n');
    this.words = words;
    this.matchCase = matchCase;
    this.matchWhole = matchWhole;
    this.matcher = matcher;
    this.preservedMatcher = preservedMatcher;
    this.cachedRuns = new WeakMap();
  }

  private getMatcher(collapse: boolean): PhraseMatcher {
    return (collapse ? undefined : this.preservedMatcher) ?? this.matcher!;
  }

  highlight(words: ActiveWord[], matchCase: boolean, matchWhole: boolean): void {
    if (this.isDestroyed) return;
    if (words.length === 0) {
      this.clearHighlights();
      return;
    }
    this.resetHighlights(true);
    const version = this.scanVersion;
    const timings = this.onScanMeasured ? { preparation: 0, active: 0, registration: 0 } : undefined;
    const work = this.scan(words, matchCase, matchWhole, timings);
    const scheduler = (window as Window & { scheduler?: { yield(): Promise<void> } }).scheduler;
    this.scanDone = new Promise(resolve => { this.finishScan = resolve; });

    this.startObserving();
    const runBatch = () => {
      if (version !== this.scanVersion) return;
      const start = performance.now();
      const deadline = start + 8;
      try {
        while (!work.next().done) {
          if (performance.now() < deadline) continue;
          if (timings) timings.active += performance.now() - start;
          if (scheduler?.yield) void scheduler.yield().then(runBatch);
          else window.setTimeout(runBatch, 0);
          return;
        }
        if (timings) {
          timings.active += performance.now() - start;
          this.onScanMeasured?.(timings);
        }
        this.completeScan();
      } catch (error) {
        console.error('Goose Highlighter scan failed:', error);
        this.clearHighlights();
        this.startObserving();
      }
    };
    runBatch();
  }

  private *scan(words: ActiveWord[], matchCase: boolean, matchWhole: boolean, timings?: ScanTimings): Generator<void> {
    const start = timings ? performance.now() : 0;
    yield* this.updateMatcher(words, matchCase, matchWhole);
    if (timings) timings.preparation = performance.now() - start;
    this.highlightFields();

    if (typeof Highlight === 'undefined' || !CSS.highlights) return;
    const highlights = new Map<string, Highlight>();
    const highlightsByWord = new Map<string, StaticRange[]>();
    const nextRuns = new WeakMap<Text, CachedRun>();
    let rendered = 0;
    for (const run of textRuns(document.body)) {
      if (run) {
        // Re-read the DOM and styles, since a local edit can affect distant CSS
        // selectors. Reuse matching work only when the resulting run agrees.
        const { node, offset } = run.parts[0];
        const previous = this.cachedRuns.get(node);
        const unchanged = previous?.text === run.text && previous.offset === offset && previous.collapse === run.collapse;
        const cached = unchanged ? previous : { text: run.text, offset, collapse: run.collapse, matches: [] };
        const matches = unchanged ? cached.matches : this.matchRun(run, matchCase, cached.matches);
        for (const match of matches) {
          if (!match) {
            yield;
            continue;
          }
          const registrationStart = timings ? performance.now() : 0;
          const range = rangeFor(run, match.start, match.end, match.range);
          match.range = range;
          if (range) this.registerRange(match, range, highlights, highlightsByWord);
          if (timings) timings.registration += performance.now() - registrationStart;
          if (++rendered % 128 === 0) yield;
        }
        nextRuns.set(node, cached);
      }
      yield;
    }
    const registrationStart = timings ? performance.now() : 0;
    if (this.styleElement && this.styleElement.textContent !== this.stylesheet) {
      this.styleElement.textContent = this.stylesheet;
    }
    for (const [layer, next] of highlights) {
      const current = this.highlights.get(layer);
      if (!current) {
        CSS.highlights.set(layer, next);
        continue;
      }
      for (const range of current) {
        if (!next.has(range)) current.delete(range);
      }
      for (const range of next) {
        if (!current.has(range)) current.add(range);
      }
      highlights.set(layer, current);
    }
    for (const layer of this.highlights.keys()) {
      if (!highlights.has(layer)) CSS.highlights.delete(layer);
    }
    this.highlights = highlights;
    this.highlightsByWord = highlightsByWord;
    if (timings) timings.registration += performance.now() - registrationStart;
    this.cachedRuns = nextRuns;
  }

  private *matchRun(run: TextRun, matchCase: boolean, matches: RunMatch[]): Generator<RunMatch | undefined> {
    const projected = projectText(run.text, matchCase, run.collapse);
    for (const match of this.getMatcher(run.collapse).scan(projected.text)) {
      if (!match) {
        yield;
        continue;
      }
      const length = match.end - match.start;
      const result = {
        key: match.key, layer: `gh-${match.style}-${length}`, length,
        start: projected.offset(match.start), end: projected.offset(match.end, true),
      };
      matches.push(result);
      yield result;
    }
  }

  private registerRange(match: RunMatch, range: StaticRange, highlights: Map<string, Highlight>, highlightsByWord: Map<string, StaticRange[]>): void {
    let highlight = highlights.get(match.layer);
    if (!highlight) {
      highlight = new Highlight();
      // Shorter matches paint over longer ones. The flash keeps priority zero.
      highlight.priority = -match.length;
      highlights.set(match.layer, highlight);
    }
    highlight.add(range);
    const ranges = highlightsByWord.get(match.key) ?? [];
    if (ranges.length === 0) highlightsByWord.set(match.key, ranges);
    ranges.push(range);
  }

  private updateField(input: TextField, field: FieldState): void {
    const text = input.value;
    const projected = projectText(text, this.matchCase, false);
    field.matches = Array.from(this.getMatcher(false).find(projected.text), match => ({
      key: match.key,
      start: projected.offset(match.start),
      end: projected.offset(match.end, true),
    })).sort((a, b) => a.start - b.start);
    field.badge?.remove();
    field.badge = undefined;
    if (!field.matches.length || !input.parentElement) return;

    const parent = input.parentElement;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const badge = document.createElement('div');
    badge.className = 'goose-highlighter-textarea-badge';
    badge.textContent = String(field.matches.length);
    parent.appendChild(badge);
    this.positionBadge(badge, input);
    badge.addEventListener('click', () => this.showFieldMatches(text, field.matches));
    field.badge = badge;
  }

  private showFieldMatches(text: string, matches: FieldMatch[]): void {
    this.popup?.remove();
    const popup = document.createElement('div');
    popup.className = 'goose-highlighter-textarea-popup';
    const titlebar = document.createElement('div');
    titlebar.className = 'gh-popup-titlebar';
    const close = document.createElement('button');
    close.className = 'gh-popup-close';
    close.title = browserAPI.i18n.getMessage('close') || 'Close';
    close.textContent = '×';
    close.addEventListener('click', () => popup.remove());
    titlebar.appendChild(close);
    const pre = document.createElement('pre');
    pre.className = 'gh-popup-pre';
    let previousEnd = 0;
    let mark: HTMLElement | undefined;
    for (const match of matches) {
      // The preview uses one color, so merge overlapping coverage without repeating text.
      if (!mark || match.start >= previousEnd) {
        pre.append(text.slice(previousEnd, match.start));
        mark = document.createElement('mark');
        pre.appendChild(mark);
      }
      mark.append(text.slice(Math.max(previousEnd, match.start), match.end));
      previousEnd = Math.max(previousEnd, match.end);
    }
    pre.append(text.slice(previousEnd));
    popup.append(titlebar, pre);
    document.body.appendChild(popup);
    this.popup = popup;
  }

  private positionBadge(badge: HTMLElement, input: HTMLTextAreaElement | HTMLInputElement): void {
    const gap = 8;
    const w = badge.offsetWidth || 16;
    const h = badge.offsetHeight || 16;
    const { horizontal, vertical, placement } = this.badgePosition;

    const il = input.offsetLeft;
    const it = input.offsetTop;
    const ir = il + input.offsetWidth;
    const ib = it + input.offsetHeight;

    let left: number;
    if (horizontal === 'left') {
      left = placement === 'inside' ? il + gap : placement === 'outside' ? il - w - gap : il - w / 2;
    } else {
      left = placement === 'inside' ? ir - w - gap : placement === 'outside' ? ir + gap : ir - w / 2;
    }

    let top: number;
    if (vertical === 'top') {
      top = placement === 'inside' ? it + gap : placement === 'outside' ? it - h - gap : it - h / 2;
    } else if (vertical === 'bottom') {
      top = placement === 'inside' ? ib - h - gap : placement === 'outside' ? ib + gap : ib - h / 2;
    } else {
      // 'center' — vertically centered on the field; placement only affects horizontal
      top = it + (input.offsetHeight - h) / 2;
    }

    badge.style.setProperty('left', `${left}px`, 'important');
    badge.style.setProperty('top', `${top}px`, 'important');
    badge.style.removeProperty('transform');
  }


  private highlightFields(): void {
    const fields = document.querySelectorAll<TextField>('textarea, input');
    if (fields.length === 0) return;
    if (!document.getElementById('gh-textarea-badge-style')) {
      const style = document.createElement('style');
      style.id = 'gh-textarea-badge-style';
      style.textContent = `
        :root {
          --gh-badge-accent: #ec9c23;
          --gh-badge-text: #000;
          --gh-badge-border: #2d2d2d;
          --gh-popup-bg: #161616;
          --gh-popup-border: #ec9c23;
          --gh-popup-radius: 10px;
          --gh-popup-shadow: 0 4px 12px rgba(0,0,0,0.4);
        }
        .goose-highlighter-textarea-badge {
          position: absolute !important;
          background: var(--gh-badge-accent);
          color: var(--gh-badge-text);
          font-family: inherit;
          font-weight: bold;
          font-size: 11px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          cursor: pointer;
          z-index: 10000;
          padding: 0 6px;
          height: 16px;
          min-width: 16px;
          box-sizing: border-box;
          border-radius: 4px;
          border: 1px solid var(--gh-badge-border);
          transition: box-shadow 0.2s, background 0.2s;
        }
        .goose-highlighter-textarea-badge:hover {
          box-shadow: 0 4px 12px rgba(236,156,35,0.25);
          background: #ffb84d;
        }
        .goose-highlighter-textarea-popup {
          position: fixed;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          background: var(--gh-popup-bg);
          border: 2px solid var(--gh-popup-border);
          border-radius: var(--gh-popup-radius);
          box-shadow: var(--gh-popup-shadow);
          padding: 0 0 20px 0;
          z-index: 10001;
          max-width: 420px;
          max-height: 70vh;
          overflow: auto;
          color: #e8e8e8;
          font-family: 'Inter', 'Segoe UI', sans-serif;
        }
        .gh-popup-titlebar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          background: #191919;
          border-top-left-radius: var(--gh-popup-radius);
          border-top-right-radius: var(--gh-popup-radius);
          height: 32px;
          padding: 0 8px 0 0;
          border-bottom: 1px solid #222;
          position: relative;
        }
        .gh-popup-close {
          background: none;
          color: #e8e8e8;
          border: none;
          font-size: 22px;
          font-weight: bold;
          cursor: pointer;
          padding: 0 6px;
          border-radius: 4px;
          transition: background 0.2s, color 0.2s;
          z-index: 10002;
          line-height: 1;
        }
        .gh-popup-close:hover {
          background: #ec9c23;
          color: #222;
        }
        .goose-highlighter-textarea-popup::-webkit-scrollbar {
          width: 10px;
          background: #222;
          border-radius: 8px;
        }
        .goose-highlighter-textarea-popup::-webkit-scrollbar-thumb {
          background: var(--gh-badge-accent);
          border-radius: 8px;
          border: 2px solid #222;
        }
        .goose-highlighter-textarea-popup::-webkit-scrollbar-thumb:hover {
          background: #ffb84d;
        }
        .goose-highlighter-textarea-popup {
          scrollbar-width: thin;
          scrollbar-color: var(--gh-badge-accent) #222;
        }
        .gh-popup-pre {
          background: #222;
          border-radius: 7px;
          padding: 10px 12px;
          border: 1px solid #333;
          color: #e8e8e8;
          font-size: 15px;
          font-family: inherit;
          margin: 16px 16px 0 16px;
          white-space: pre-wrap;
          word-break: break-word;
          overflow-wrap: break-word;
        }
        .gh-popup-pre mark {
          background: none;
          color: #ec9c23;
          font-weight: bold;
          border-radius: 0;
          padding: 0;
        }
      `;
      document.head.appendChild(style);
    }
    for (const input of fields) {
      if (input instanceof HTMLInputElement && !['text', 'search', 'email', 'url'].includes(input.type)) continue;
      const field: FieldState = { matches: [], onInput: () => this.updateField(input, field) };
      this.fields.set(input, field);
      input.addEventListener('input', field.onInput);
      this.updateField(input, field);
    }
  }

  private getFieldMatches(key: string): Array<{ input: TextField } & FieldMatch> {
    const matches: Array<{ input: TextField } & FieldMatch> = [];
    for (const [input, field] of this.fields) {
      for (const match of field.matches) {
        if (match.key === key) matches.push({ input, ...match });
      }
    }
    return matches;
  }

  clearHighlights(): void {
    this.cachedRuns = new WeakMap();
    this.resetHighlights();
    this.popup?.remove();
    this.popup = undefined;
  }

  private resetHighlights(preservePaint = false): void {
    this.stopObserving();
    this.scanVersion++;
    this.completeScan();
    if (!preservePaint) {
      clearTimeout(this.flashTimer);
      if (CSS.highlights) {
        for (const layer of this.highlights.keys()) CSS.highlights.delete(layer);
        CSS.highlights.delete('gh-flash');
      }
      this.highlights.clear();
      this.highlightsByWord.clear();
    }
    for (const [input, field] of this.fields) {
      input.removeEventListener('input', field.onInput);
      field.badge?.remove();
    }
    this.fields.clear();
  }

  private completeScan(): void {
    this.finishScan?.();
    this.finishScan = undefined;
    this.scanDone = undefined;
  }

  async waitForScan(): Promise<void> {
    while (this.scanDone) await this.scanDone;
  }

  getPageHighlights(activeWords: ActiveWord[]): HighlightInfo[] {
    const seen = new Map<string, HighlightInfo & { listNames: string[] }>();
    const fieldCounts = new Map<string, number>();
    for (const field of this.fields.values()) {
      for (const match of field.matches) fieldCounts.set(match.key, (fieldCounts.get(match.key) ?? 0) + 1);
    }

    for (const activeWord of activeWords) {
      const lookup = phraseKey(activeWord.text, this.matchCase);
      const ranges = this.highlightsByWord.get(lookup);
      const totalCount = (ranges?.length ?? 0) + (fieldCounts.get(lookup) ?? 0);

      if (totalCount > 0) {
        const listName = activeWord.listName || 'Default';
        const listId = activeWord.listId;

        if (seen.has(lookup)) {
          const existing = seen.get(lookup)!;
          if (listName && !existing.listNames.includes(listName)) {
            existing.listNames.push(listName);
          }
        } else {
          seen.set(lookup, {
            word: activeWord.text,
            count: totalCount,
            background: activeWord.background,
            foreground: activeWord.foreground,
            listId,
            listName,
            listNames: [listName]
          });
        }
      }
    }

    return Array.from(seen.values());
  }

  scrollToHighlight(word: string, index: number): void {
    const lookup = phraseKey(word, this.matchCase);
    const ranges = this.highlightsByWord.get(lookup) || [];
    const textareaMatches = this.getFieldMatches(lookup);

    const totalMatches = ranges.length + textareaMatches.length;
    if (totalMatches === 0) return;

    const targetIndex = Math.min(index, totalMatches - 1);

    try {
      if (targetIndex >= ranges.length) {
        const textareaIndex = targetIndex - ranges.length;
        const textareaMatch = textareaMatches[textareaIndex];
        this.scrollToTextareaMatch(textareaMatch.input, textareaMatch.start, textareaMatch.end);
        return;
      }

      const target = ranges[targetIndex];
      if (!target || !target.startContainer.isConnected || !target.endContainer.isConnected) return;
      const range = new Range();
      range.setStart(target.startContainer, target.startOffset);
      range.setEnd(target.endContainer, target.endOffset);
      if (range.collapsed) return;

      // First, scroll any scrollable containers
      const element = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer as Element;

      if (element) {
        this.scrollIntoViewInContainers(element);
      }

      // Then scroll the main window
      const rect = range.getBoundingClientRect();
      const absoluteTop = window.pageYOffset + rect.top;
      const middle = absoluteTop - (window.innerHeight / 2) + (rect.height / 2);

      window.scrollTo({
        top: middle,
        behavior: 'smooth'
      });

      const flashHighlight = new Highlight(target);
      CSS.highlights.set('gh-flash', flashHighlight);
      clearTimeout(this.flashTimer);
      this.flashTimer = window.setTimeout(() => CSS.highlights.delete('gh-flash'), 600);
    } catch (e) {
      console.error('Error scrolling to highlight:', e);
    }
  }

  private scrollToTextareaMatch(input: HTMLTextAreaElement | HTMLInputElement, position: number, end: number): void {
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (input.tagName === 'TEXTAREA') {
      const textarea = input as HTMLTextAreaElement;
      const text = textarea.value;
      const beforeText = text.substring(0, position);
      const lines = beforeText.split('\n');
      const lineNumber = lines.length - 1;

      const computedStyle = window.getComputedStyle(textarea);
      const lineHeight = parseFloat(computedStyle.lineHeight) || parseFloat(computedStyle.fontSize) * 1.2;

      const targetScrollTop = lineNumber * lineHeight - (textarea.clientHeight / 2);
      textarea.scrollTop = Math.max(0, targetScrollTop);
    }

    input.focus();
    if (input.selectionStart !== null) input.setSelectionRange(position, end);

  }

  private scrollIntoViewInContainers(element: Element): void {
    let current: Element | null = element;

    while (current && current !== document.body) {
      const parent: HTMLElement | null = current.parentElement;
      if (!parent) break;

      const parentStyle = window.getComputedStyle(parent);
      const isScrollable = (
        (parentStyle.overflow === 'auto' || parentStyle.overflow === 'scroll' ||
          parentStyle.overflowY === 'auto' || parentStyle.overflowY === 'scroll' ||
          parentStyle.overflowX === 'auto' || parentStyle.overflowX === 'scroll') &&
        (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth)
      );

      if (isScrollable) {
        const parentRect = parent.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        if (elementRect.top < parentRect.top) {
          parent.scrollTop -= (parentRect.top - elementRect.top) + 20;
        } else if (elementRect.bottom > parentRect.bottom) {
          parent.scrollTop += (elementRect.bottom - parentRect.bottom) + 20;
        }

        if (elementRect.left < parentRect.left) {
          parent.scrollLeft -= (parentRect.left - elementRect.left) + 20;
        } else if (elementRect.right > parentRect.right) {
          parent.scrollLeft += (elementRect.right - parentRect.right) + 20;
        }
      }

      current = parent;
    }
  }

  stopObserving(): void {
    this.observer.disconnect();
    clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
  }

  private startObserving(): void {
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open', 'type', 'value'],
    });
  }

  destroy(): void {
    this.isDestroyed = true;
    this.clearHighlights();
    this.styleElement?.remove();
  }
}

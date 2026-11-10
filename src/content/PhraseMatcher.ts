import { DOMUtils } from '../utils/DOMUtils.js';

interface TextEdit {
  start: number;
  end: number;
  originalStart: number;
  originalEnd: number;
}

interface TextProjection {
  text: string;
  offset(index: number, end?: boolean): number;
}

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : undefined;
const unicodeFold = new Map<string, string>();

function foldCharacter(character: string): string {
  if (character <= 'Z') return character.toLowerCase();
  let folded = unicodeFold.get(character);
  if (folded === undefined) {
    // Use the same simple case equivalences as a Unicode /iu regexp, without
    // introducing expansions (such as dotted I becoming two characters).
    const lower = character.toLowerCase();
    const candidate = lower.toUpperCase().toLowerCase();
    folded = lower.length === character.length ? lower : character;
    if (candidate.length === character.length && new RegExp(DOMUtils.escapeRegex(character), 'iu').test(candidate)) {
      folded = candidate;
    }
    unicodeFold.set(character, folded);
  }
  return folded;
}

function projectOffset(edits: TextEdit[], index: number, end: boolean): number {
  let low = 0;
  let high = edits.length;
  const character = end ? index - 1 : index;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (edits[middle].start <= character) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return index;
  const edit = edits[low - 1];
  if (character < edit.end) return end ? edit.originalEnd : edit.originalStart;
  return index + edit.originalEnd - edit.end;
}

export function projectText(source: string, matchCase: boolean, collapse: boolean): TextProjection {
  const canonical = graphemes ? source.normalize('NFC') : source;
  const accents: TextEdit[] = [];
  if (graphemes && canonical !== source) {
    let start = 0;
    for (const { segment, index } of graphemes.segment(source)) {
      const normalized = segment.normalize('NFC');
      const end = start + normalized.length;
      if (normalized !== segment) {
        accents.push({ start, end, originalStart: index, originalEnd: index + segment.length });
      }
      start = end;
    }
  }

  const spaces: TextEdit[] = [];
  let removed = 0;
  let text = canonical.replace(collapse ? /[ \t\r\n\f\u00a0\u202f]+/g : /[\u00a0\u202f]/g, (space: string, index: number) => {
    if (space.length > 1) {
      const start = index - removed;
      spaces.push({ start, end: start + 1, originalStart: index, originalEnd: index + space.length });
      removed += space.length - 1;
    }
    return ' ';
  });
  if (!matchCase) text = foldCase(text);
  return {
    text,
    offset(index, end = false) {
      return projectOffset(accents, projectOffset(spaces, index, end), end);
    },
  };
}

function foldCase(text: string): string {
  return /[\u0080-\u{10ffff}]/u.test(text) ? text.replace(/[A-Z]|[\u0080-\u{10ffff}]/gu, foldCharacter) : text.toLowerCase();
}

export function phraseKey(text: string, matchCase: boolean): string {
  const canonical = (graphemes ? text.normalize('NFC') : text).replace(/[\u00a0\u202f]/g, ' ').trim();
  return matchCase ? canonical : foldCase(canonical);
}

export interface PhraseEntry {
  key: string;
  style: number;
}

interface PhraseMatch extends PhraseEntry {
  start: number;
  end: number;
}

interface TrieState {
  firstCharacter?: string;
  firstChild?: TrieState;
  children?: Map<string, TrieState>;
  failure?: TrieState;
  suffix?: TrieState;
  entry?: PhraseEntry;
  length: number;
  leftBoundary?: boolean;
  rightBoundary?: boolean;
}

function transition(state: TrieState, character: string): TrieState | undefined {
  return character === state.firstCharacter ? state.firstChild : state.children?.get(character);
}

const wordCharacter = /[\p{L}\p{M}\p{N}\p{Pc}]/uy;

function isWordAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  const current = text.charCodeAt(index);
  const previous = text.charCodeAt(index - 1);
  if (current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) index--;
  wordCharacter.lastIndex = index;
  return wordCharacter.test(text);
}

export class PhraseMatcher {
  private readonly root: TrieState = { length: 0 };

  constructor(private readonly matchWhole: boolean) {}

  *build(entries: Map<string, PhraseEntry>): Generator<void> {
    let processed = 0;
    for (const [phrase, entry] of entries) {
      let state = this.root;
      for (let i = 0; i < phrase.length; i++) {
        const character = phrase[i];
        let next = transition(state, character);
        if (!next) {
          next = { length: i + 1 };
          if (state.firstChild) {
            (state.children ??= new Map()).set(character, next);
          } else {
            state.firstCharacter = character;
            state.firstChild = next;
          }
        }
        state = next;
      }
      state.entry = entry;
      if (this.matchWhole) {
        state.leftBoundary = isWordAt(phrase, 0);
        state.rightBoundary = isWordAt(phrase, phrase.length - 1);
      }
      if (++processed % 256 === 0) yield;
    }
    // Aho–Corasick failure links let a scan reuse shared prefixes and suffixes.
    const queue = [this.root];
    let linked = 0;
    const linkChild = (state: TrieState, character: string, child: TrieState) => {
      let fallback = state.failure;
      while (fallback && fallback !== this.root && !transition(fallback, character)) fallback = fallback.failure;
      child.failure = (fallback && transition(fallback, character)) ?? this.root;
      child.suffix = child.failure.entry ? child.failure : child.failure.suffix;
      if (child.firstChild) queue.push(child);
    };
    for (let i = 0; i < queue.length; i++) {
      const state = queue[i];
      if (state.firstChild) {
        linkChild(state, state.firstCharacter!, state.firstChild);
        if (++linked % 256 === 0) yield;
      }
      if (!state.children) continue;
      for (const [character, child] of state.children) {
        linkChild(state, character, child);
        if (++linked % 256 === 0) yield;
      }
    }
  }

  *find(text: string): Iterable<PhraseMatch> {
    for (const match of this.scan(text)) {
      if (match) yield match;
    }
  }

  *scan(text: string): Generator<PhraseMatch | undefined> {
    let state = this.root;
    for (let i = 0; i < text.length; i++) {
      if (i > 0 && i % 2048 === 0) yield;
      const character = text[i];
      let next = transition(state, character);
      while (!next && state !== this.root) {
        state = state.failure!;
        next = transition(state, character);
      }
      state = next ?? this.root;
      const end = i + 1;
      for (let hit = state.entry ? state : state.suffix; hit; hit = hit.suffix) {
        const start = end - hit.length;
        if (this.matchWhole && (
          (hit.leftBoundary && isWordAt(text, start - 1)) ||
          (hit.rightBoundary && isWordAt(text, end))
        )) continue;
        yield { ...hit.entry!, start, end };
      }
    }
  }
}

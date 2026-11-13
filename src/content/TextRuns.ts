interface TextPart {
  node: Text;
  offset: number;
  start: number;
  end: number;
}

export interface TextRun {
  text: string;
  parts: TextPart[];
  collapse: boolean;
}

interface TextContext {
  visible: boolean;
  whitespace: 'collapse' | 'preserve' | 'preserve-breaks';
  boundary: boolean;
}

const ignoredElements = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const replacedElements = new Set(['BR', 'HR', 'IFRAME', 'TEXTAREA', 'INPUT', 'SELECT', 'IMG', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED']);

function textContext(style: CSSStyleDeclaration): TextContext {
  const collapse = style.getPropertyValue('white-space-collapse');
  const whitespace = collapse === 'preserve-breaks' || style.whiteSpace === 'pre-line' ? 'preserve-breaks' :
    collapse === 'preserve' || collapse === 'break-spaces' || /^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace) ?
      'preserve' : 'collapse';
  return {
    visible: style.visibility === 'visible',
    whitespace,
    boundary: style.display !== 'inline' && style.display !== 'contents',
  };
}

export function isHighlighterUi(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest('.goose-highlighter-textarea-badge, .goose-highlighter-textarea-popup'));
}

export function* textRuns(root: HTMLElement): Generator<TextRun | undefined> {
  const rootStyle = getComputedStyle(root);
  if (rootStyle.display === 'none' || rootStyle.getPropertyValue('content-visibility') === 'hidden') return;
  let context = textContext(rootStyle);
  const ancestors: { element: Element; context: TextContext; separates: boolean; siblings: ChildNode[]; index: number }[] = [];
  let chunks: string[] = [];
  let parts: TextPart[] = [];
  let length = 0;
  let visited = 0;

  function flush(): TextRun | undefined {
    if (parts.length === 0) return;
    const run = { text: chunks.join(''), parts, collapse: context.whitespace !== 'preserve' };
    chunks = [];
    parts = [];
    length = 0;
    return run;
  }

  function append(node: Text, text: string, offset: number): void {
    if (!text) return;
    chunks.push(text);
    parts.push({ node, offset, start: length, end: length + text.length });
    length += text.length;
  }

  let siblings = Array.from(root.childNodes);
  let index = 0;
  let node: ChildNode | undefined = siblings[index];
  while (node) {
    // Large groups of inline elements can have no natural yield point.
    if (++visited % 256 === 0) yield;
    const attached = node.isConnected && node.parentNode === (ancestors.at(-1)?.element ?? root);
    if (attached && node instanceof Text && context.visible) {
      if (context.whitespace === 'preserve-breaks') {
        let offset = 0;
        for (const line of node.data.split(/(?<=\n)/)) {
          const lineBreak = line.endsWith('\n');
          append(node, lineBreak ? line.slice(0, -1) : line, offset);
          if (lineBreak) yield flush();
          offset += line.length;
        }
      } else {
        append(node, node.data, 0);
      }
    } else if (attached && node instanceof Element && !ignoredElements.has(node.tagName) &&
      !node.classList.contains('goose-highlighter-textarea-badge') &&
      !node.classList.contains('goose-highlighter-textarea-popup')) {
      const style = getComputedStyle(node);
      if (style.display !== 'none' && style.getPropertyValue('content-visibility') !== 'hidden') {
        if (replacedElements.has(node.tagName)) {
          yield flush();
        } else {
          const nextContext = textContext(style);
          const separates = nextContext.boundary || nextContext.whitespace !== context.whitespace ||
            nextContext.visible !== context.visible;
          if (separates) yield flush();
          if (node.firstChild) {
            ancestors.push({ element: node, context, separates, siblings, index });
            context = nextContext;
            siblings = Array.from(node.childNodes);
            index = 0;
            node = siblings[index];
            continue;
          }
        }
      }
    }

    index++;
    while (index >= siblings.length && ancestors.length > 0) {
      const parent = ancestors.pop()!;
      if (parent.separates) yield flush();
      context = parent.context;
      siblings = parent.siblings;
      index = parent.index + 1;
    }
    node = siblings[index];
  }
  yield flush();
}

function findPart(parts: TextPart[], offset: number): TextPart {
  let low = 0;
  let high = parts.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (parts[middle].end <= offset) low = middle + 1;
    else high = middle;
  }
  return parts[low];
}

export function rangeFor(run: TextRun, start: number, end: number, existing?: StaticRange): StaticRange | undefined {
  const first = findPart(run.parts, start);
  const last = findPart(run.parts, end - 1);
  const startOffset = first.offset + start - first.start;
  const endOffset = last.offset + end - last.start;
  // A run can span multiple scan batches, with page edits between them.
  if (!first.node.isConnected || !last.node.isConnected ||
      startOffset > first.node.length || endOffset > last.node.length) return;
  if (existing?.startContainer === first.node && !existing.collapsed && existing.startOffset === startOffset &&
      existing.endContainer === last.node && existing.endOffset === endOffset) return existing;
  const range = new StaticRange({ startContainer: first.node, startOffset, endContainer: last.node, endOffset });
  return range.collapsed ? undefined : range;
}

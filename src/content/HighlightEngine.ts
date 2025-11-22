import { HighlightList, ActiveWord, CONSTANTS } from '../types.js';
import { DOMUtils } from '../utils/DOMUtils.js';


export class HighlightEngine {
    private _textareaMatchInfo: Array<{ input: HTMLTextAreaElement | HTMLInputElement; count: number; text: string }> = [];
  private styleSheet: CSSStyleSheet | null = null;
  private highlights = new Map<string, Highlight>();
  private highlightsByWord = new Map<string, Range[]>();
  private textareaMatchesByWord = new Map<string, Array<{ input: HTMLTextAreaElement | HTMLInputElement; position: number }>>();
  private observer: MutationObserver;
  private isHighlighting = false;
  private currentMatchCase = false;

  constructor(private onUpdate: () => void) {
    this.observer = new MutationObserver(DOMUtils.debounce((mutations: MutationRecord[]) => {
      if (this.isHighlighting) return;
      const hasContentChanges = mutations.some((mutation: MutationRecord) => {
        if (mutation.type !== 'childList') return false;
        const allNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
        return allNodes.some(node => {
          if (node.nodeType === Node.TEXT_NODE) return true;
          if (node instanceof Element) return true;
          return false;
        });
      });
      if (hasContentChanges) {
        this.onUpdate();
      }
    }, CONSTANTS.DEBOUNCE_DELAY));
  }

  private initializeStyleSheet(): void {
    if (!this.styleSheet) {
      const style = document.createElement('style');
      style.id = 'goose-highlighter-styles';
      document.head.appendChild(style);
      this.styleSheet = style.sheet!;
    }
  }

  private updateHighlightStyles(activeWords: ActiveWord[]): void {
    this.initializeStyleSheet();

    while (this.styleSheet!.cssRules.length > 0) {
      this.styleSheet!.deleteRule(0);
    }

    const uniqueStyles = new Map<string, number>();
    let styleIndex = 0;

    for (const word of activeWords) {
      const styleKey = `${word.background}-${word.foreground}`;
      if (!uniqueStyles.has(styleKey)) {
        uniqueStyles.set(styleKey, styleIndex);
        const rule = `::highlight(gh-${styleIndex}) { background-color: ${word.background}; color: ${word.foreground}; }`;
        this.styleSheet!.insertRule(rule, this.styleSheet!.cssRules.length);
        styleIndex++;
      }
    }
  }

  clearHighlights(): void {
    this.observer.disconnect();
    this.clearHighlightsInternal();
  }


  private getTextNodes(): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node: Text) => {
          if (node.parentNode && ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'TEXTAREA', 'INPUT'].includes(node.parentNode.nodeName)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.nodeValue?.trim()) {
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }
    return textNodes;
  }

  private extractActiveWords(lists: HighlightList[]): ActiveWord[] {
    const activeWords: ActiveWord[] = [];
    for (const list of lists) {
      if (!list.active) continue;
      for (const word of list.words) {
        if (!word.active) continue;
        activeWords.push({
          text: word.wordStr,
          background: word.background || list.background,
          foreground: word.foreground || list.foreground
        });
      }
    }
    return activeWords;
  }

  highlight(lists: HighlightList[], matchCase: boolean, matchWhole: boolean): void {
    if (this.isHighlighting) return;
    this.isHighlighting = true;

    this.currentMatchCase = matchCase;

    this.observer.disconnect();
    this.clearHighlightsInternal();

    const activeWords = this.extractActiveWords(lists);
    if (activeWords.length === 0) {
      this.startObserving();
      this.isHighlighting = false;
      return;
    }

    this.updateHighlightStyles(activeWords);

    const styleMap = new Map<string, number>();
    const uniqueStyles = new Map<string, number>();
    let styleIndex = 0;

    for (const word of activeWords) {
      const styleKey = `${word.background}-${word.foreground}`;
      if (!uniqueStyles.has(styleKey)) {
        uniqueStyles.set(styleKey, styleIndex++);
      }
      const lookup = matchCase ? word.text : word.text.toLowerCase();
      styleMap.set(lookup, uniqueStyles.get(styleKey)!);
    }

    const flags = matchCase ? 'gu' : 'giu';
    let wordsPattern = Array.from(styleMap.keys()).map(DOMUtils.escapeRegex).join('|');

    if (matchWhole) {
      wordsPattern = `(?:(?<!\\p{L})|^)(${wordsPattern})(?:(?!\\p{L})|$)`;
    }

    try {
      const pattern = new RegExp(`(${wordsPattern})`, flags);
      const textNodes = this.getTextNodes();

      const rangesByStyle = new Map<number, Range[]>();
      this.highlightsByWord.clear();
      this.textareaMatchesByWord.clear();

      for (const node of textNodes) {
        if (!node.nodeValue) continue;

        const text = node.nodeValue;
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(text)) !== null) {
          const lookup = matchCase ? match[0] : match[0].toLowerCase();
          const styleIdx = styleMap.get(lookup);

          if (styleIdx !== undefined) {
            const range = new Range();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);

            if (!rangesByStyle.has(styleIdx)) {
              rangesByStyle.set(styleIdx, []);
            }
            rangesByStyle.get(styleIdx)!.push(range);

            if (!this.highlightsByWord.has(lookup)) {
              this.highlightsByWord.set(lookup, []);
            }
            this.highlightsByWord.get(lookup)!.push(range);
          }
        }
      }

      for (const [styleIdx, ranges] of rangesByStyle) {
        const highlight = new Highlight(...ranges);
        const highlightName = `gh-${styleIdx}`;
        this.highlights.set(highlightName, highlight);
        CSS.highlights.set(highlightName, highlight);
      }

      this.highlightTextareas(pattern, styleMap, activeWords);
    } catch (e) {
      console.error('Regex error:', e);
    }

    this.startObserving();
    this.isHighlighting = false;
  }

  private highlightTextareas(pattern: RegExp, styleMap: Map<string, number>, activeWords: ActiveWord[]): void {
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
          left: 4px !important;
          top: 4px !important;
          background: var(--gh-badge-accent);
          color: var(--gh-badge-text);
          font-family: inherit;
          font-weight: bold;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          cursor: pointer;
          z-index: 10000;
          padding: 0 10px;
          height: 22px;
          min-width: 22px;
          border-radius: 12px;
          border: 2px solid var(--gh-badge-border);
          transition: box-shadow 0.2s, background 0.2s;
        }
        .goose-highlighter-textarea-badge[data-round="true"] {
          border-radius: 50%;
          padding: 0;
          min-width: 22px;
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
        // Helper to escape HTML
        function escapeHtml(text: string): string {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

    function renderHighlighted(text: string): string {
      let html = '';
      let lastIndex = 0;
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        html += escapeHtml(text.substring(lastIndex, match.index));
        html += `<mark>${escapeHtml(match[0])}</mark>`;
        lastIndex = match.index + match[0].length;
      }
      html += escapeHtml(text.substring(lastIndex));
      return html;
    }
    const textareas = document.querySelectorAll('textarea, input[type="text"], input[type="search"], input[type="email"], input[type="url"]');
    this._textareaMatchInfo = [];
    document.querySelectorAll('.goose-highlighter-textarea-badge').forEach(badge => badge.remove());
    for (const element of Array.from(textareas)) {
      const input = element as HTMLTextAreaElement | HTMLInputElement;
      const text = input.value;
      if (!text) continue;
      let matchCount = 0;
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        matchCount++;
      }
      if (matchCount > 0) {
        this._textareaMatchInfo.push({ input, count: matchCount, text });
        const badge = document.createElement('div');
        badge.className = 'goose-highlighter-textarea-badge';
        badge.textContent = matchCount.toString();
        badge.setAttribute('data-round', matchCount > 9 ? 'false' : 'true');
        badge.style.position = 'absolute';
        badge.style.left = '4px';
        badge.style.top = '4px';
        badge.style.zIndex = '10000';
        const parent = input.parentElement;
        if (parent && window.getComputedStyle(parent).position === 'static') {
          parent.style.position = 'relative';
        }
        parent?.appendChild(badge);

        badge.addEventListener('click', () => {
          document.querySelectorAll('.goose-highlighter-textarea-popup').forEach(p => p.remove());
          const popup = document.createElement('div');
          popup.className = 'goose-highlighter-textarea-popup';
          popup.innerHTML = `
            <div class="gh-popup-titlebar">
              <button class="gh-popup-close" title="Close">&times;</button>
            </div>
            <pre class="gh-popup-pre">${renderHighlighted(text)}</pre>
          `;
          document.body.appendChild(popup);
          const closeBtn = popup.querySelector('.gh-popup-close');
          closeBtn?.addEventListener('click', () => popup.remove());
        });
      }
        const updateBadge = () => {
          const text = input.value;
          let matchCount = 0;
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            matchCount++;
          }
          const oldBadge = input.parentElement?.querySelector('.goose-highlighter-textarea-badge');
          if (oldBadge) oldBadge.remove();
          if (matchCount > 0) {
            const badge = document.createElement('div');
            badge.className = 'goose-highlighter-textarea-badge';
            badge.textContent = matchCount.toString();
            badge.setAttribute('data-round', matchCount > 9 ? 'false' : 'true');
            badge.style.position = 'absolute';
            badge.style.left = '4px';
            badge.style.top = '4px';
            badge.style.zIndex = '10000';
            const parent = input.parentElement;
            if (parent && window.getComputedStyle(parent).position === 'static') {
              parent.style.position = 'relative';
            }
            parent?.appendChild(badge);
            badge.addEventListener('click', () => {
              document.querySelectorAll('.goose-highlighter-textarea-popup').forEach(p => p.remove());
              const popup = document.createElement('div');
              popup.className = 'goose-highlighter-textarea-popup';
              popup.innerHTML = `
                <div class="gh-popup-titlebar">
                  <button class="gh-popup-close" title="Close">&times;</button>
                </div>
                <pre class="gh-popup-pre">${renderHighlighted(text)}</pre>
              `;
              document.body.appendChild(popup);
              const closeBtn = popup.querySelector('.gh-popup-close');
              closeBtn?.addEventListener('click', () => popup.remove());
            });
          }
        };
        updateBadge();
        input.removeEventListener('input', updateBadge);
        input.addEventListener('input', updateBadge);
    }
  }


  private clearHighlightsInternal(): void {
    for (const name of this.highlights.keys()) {
      CSS.highlights.delete(name);
    }
    this.highlights.clear();
    this.highlightsByWord.clear();
    this.textareaMatchesByWord.clear();
    if (this.styleSheet && this.styleSheet.cssRules.length > 0) {
      while (this.styleSheet.cssRules.length > 0) {
        this.styleSheet.deleteRule(0);
      }
    }
  }

  getPageHighlights(activeWords: ActiveWord[]): Array<{ word: string; count: number; background: string; foreground: string }> {
    const seen = new Map<string, { word: string; count: number; background: string; foreground: string }>();

    for (const activeWord of activeWords) {
      const lookup = this.currentMatchCase ? activeWord.text : activeWord.text.toLowerCase();
      const ranges = this.highlightsByWord.get(lookup);
      const textareaMatches = this.textareaMatchesByWord.get(lookup);

      const totalCount = (ranges?.length || 0) + (textareaMatches?.length || 0);

      if (totalCount > 0 && !seen.has(lookup)) {
        seen.set(lookup, {
          word: activeWord.text,
          count: totalCount,
          background: activeWord.background,
          foreground: activeWord.foreground
        });
      }
    }

    return Array.from(seen.values());
  }

  scrollToHighlight(word: string, index: number): void {
    const lookup = this.currentMatchCase ? word : word.toLowerCase();
    const ranges = this.highlightsByWord.get(lookup) || [];
    const textareaMatches = this.textareaMatchesByWord.get(lookup) || [];

    const totalMatches = ranges.length + textareaMatches.length;
    if (totalMatches === 0) return;

    const targetIndex = Math.min(index, totalMatches - 1);

    try {
      if (targetIndex >= ranges.length) {
        const textareaIndex = targetIndex - ranges.length;
        const textareaMatch = textareaMatches[textareaIndex];
        this.scrollToTextareaMatch(textareaMatch.input, textareaMatch.position, word.length);
        return;
      }

      const range = ranges[targetIndex];
      if (!range) return;

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

      const flashHighlight = new Highlight(range);
      CSS.highlights.set('gh-flash', flashHighlight);

      if (this.styleSheet) {
        const flashRule = '::highlight(gh-flash) { background-color: rgba(255, 165, 0, 0.8); box-shadow: 0 0 10px 3px rgba(255, 165, 0, 0.8); }';
        const ruleIndex = this.styleSheet.insertRule(flashRule, this.styleSheet.cssRules.length);

        setTimeout(() => {
          CSS.highlights.delete('gh-flash');
          if (this.styleSheet && ruleIndex < this.styleSheet.cssRules.length) {
            this.styleSheet.deleteRule(ruleIndex);
          }
        }, 600);
      }
    } catch (e) {
      console.error('Error scrolling to highlight:', e);
    }
  }

  private scrollToTextareaMatch(input: HTMLTextAreaElement | HTMLInputElement, position: number, wordLength: number): void {
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
    input.setSelectionRange(position, position + wordLength);

  }

  private getTextPosition(overlay: HTMLElement, targetMark: HTMLElement): number {
    let position = 0;
    const walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);

    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node === targetMark) {
        return position;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        position += node.textContent?.length || 0;
      }
    }

    return position;
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
  }

  private startObserving(): void {
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });
  }

  destroy(): void {
    this.observer.disconnect();
    this.clearHighlights();
  }
}
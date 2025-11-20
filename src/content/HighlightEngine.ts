import { HighlightList, ActiveWord, CONSTANTS } from '../types.js';
import { DOMUtils } from '../utils/DOMUtils.js';

export class HighlightEngine {
  private styleSheet: CSSStyleSheet | null = null;
  private highlights = new Map<string, Highlight>();
  private highlightsByWord = new Map<string, Range[]>();
  private textareaMatchesByWord = new Map<string, Array<{ input: HTMLTextAreaElement | HTMLInputElement; position: number }>>();
  private observer: MutationObserver;
  private isHighlighting = false;
  private currentMatchCase = false;
  private textareaOverlays = new Map<HTMLTextAreaElement | HTMLInputElement, HTMLElement>();
  private resizeObserver: ResizeObserver;

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

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const input = entry.target as HTMLTextAreaElement | HTMLInputElement;
        const overlay = this.textareaOverlays.get(input);
        if (overlay) {
          this.updateOverlayPosition(input, overlay);
        }
      }
    });
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
    this.clearTextareaOverlays();
  }

  private clearTextareaOverlays(): void {
    for (const [input, overlay] of this.textareaOverlays.entries()) {
      this.resizeObserver.unobserve(input);
      overlay.remove();
    }
    this.textareaOverlays.clear();
  }

  private updateOverlayPosition(input: HTMLTextAreaElement | HTMLInputElement, overlay: HTMLElement): void {
    const rect = input.getBoundingClientRect();
    overlay.style.width = `${input.clientWidth}px`;
    overlay.style.height = `${input.clientHeight}px`;
    overlay.style.top = `${rect.top + window.scrollY}px`;
    overlay.style.left = `${rect.left + window.scrollX}px`;
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
    this.clearTextareaOverlays();

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
    const textareas = document.querySelectorAll('textarea, input[type="text"], input[type="search"], input[type="email"], input[type="url"]');

    for (const element of Array.from(textareas)) {
      const input = element as HTMLTextAreaElement | HTMLInputElement;
      const text = input.value;

      if (!text) continue;

      const matches: Array<{ start: number; end: number; background: string; foreground: string }> = [];
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const lookup = this.currentMatchCase ? match[0] : match[0].toLowerCase();
        const styleIdx = styleMap.get(lookup);

        if (styleIdx !== undefined) {
          const activeWord = activeWords.find(w =>
            (this.currentMatchCase ? w.text : w.text.toLowerCase()) === lookup
          );
          if (activeWord) {
            matches.push({
              start: match.index,
              end: match.index + match[0].length,
              background: activeWord.background,
              foreground: activeWord.foreground
            });

            // Track textarea matches for navigation
            if (!this.textareaMatchesByWord.has(lookup)) {
              this.textareaMatchesByWord.set(lookup, []);
            }
            this.textareaMatchesByWord.get(lookup)!.push({
              input,
              position: match.index
            });
          }
        }
      }

      if (matches.length > 0) {
        this.createTextareaOverlay(input, text, matches);
      }
    }
  }

  private createTextareaOverlay(input: HTMLTextAreaElement | HTMLInputElement, text: string, matches: Array<{ start: number; end: number; background: string; foreground: string }>): void {
    const overlay = document.createElement('div');
    overlay.className = 'goose-highlighter-textarea-overlay';

    const computedStyle = window.getComputedStyle(input);
    const styles = [
      'font-family', 'font-size', 'font-weight', 'font-style',
      'line-height', 'letter-spacing', 'word-spacing',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
      'white-space', 'word-wrap', 'overflow-wrap'
    ];

    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'none';
    overlay.style.color = 'transparent';
    overlay.style.overflow = 'hidden';
    overlay.style.whiteSpace = input.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre';
    overlay.style.overflowWrap = 'break-word';

    for (const prop of styles) {
      overlay.style.setProperty(prop, computedStyle.getPropertyValue(prop));
    }

    this.updateOverlayPosition(input, overlay);

    let html = '';
    let lastIndex = 0;

    for (const match of matches) {
      html += this.escapeHtml(text.substring(lastIndex, match.start));
      html += `<mark style="background-color: ${match.background}; color: ${match.foreground}; padding: 0; margin: 0;">${this.escapeHtml(text.substring(match.start, match.end))}</mark>`;
      lastIndex = match.end;
    }
    html += this.escapeHtml(text.substring(lastIndex));

    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    this.textareaOverlays.set(input, overlay);

    this.resizeObserver.observe(input);

    const updateOverlay = () => {
      this.resizeObserver.unobserve(input);
      overlay.remove();
      this.textareaOverlays.delete(input);
    };

    input.addEventListener('input', updateOverlay, { once: true });
    input.addEventListener('scroll', () => {
      overlay.scrollTop = input.scrollTop;
      overlay.scrollLeft = input.scrollLeft;
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

    const overlay = this.textareaOverlays.get(input);
    if (overlay) {
      const marks = overlay.querySelectorAll('mark');
      for (const mark of Array.from(marks)) {
        const markElement = mark as HTMLElement;
        const markText = markElement.textContent || '';
        const markStart = this.getTextPosition(overlay, markElement);

        if (markStart === position) {
          const originalBackground = markElement.style.backgroundColor;
          markElement.style.backgroundColor = 'rgba(255, 165, 0, 0.8)';
          markElement.style.boxShadow = '0 0 10px 3px rgba(255, 165, 0, 0.8)';

          setTimeout(() => {
            markElement.style.backgroundColor = originalBackground;
            markElement.style.boxShadow = '';
          }, 600);
          break;
        }
      }
    }
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
    this.resizeObserver.disconnect();
    this.clearHighlights();
    this.clearTextareaOverlays();
  }
}
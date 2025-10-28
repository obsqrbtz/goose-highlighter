import { HighlightList, ActiveWord } from '../types.js';
import { DOMUtils } from '../utils/DOMUtils.js';

export class HighlightEngine {
  private styleSheet: CSSStyleSheet | null = null;
  private wordStyleMap = new Map<string, string>();
  private observer: MutationObserver;
  private isHighlighting = false;

  constructor(private onUpdate: () => void) {
    this.observer = new MutationObserver(DOMUtils.debounce((mutations: MutationRecord[]) => {
      if (this.isHighlighting) return;

      const hasContentChanges = mutations.some((mutation: MutationRecord) => {
        if (mutation.type !== 'childList') return false;

        if (mutation.target instanceof Element && mutation.target.hasAttribute('data-gh')) {
          return false;
        }

        const allNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
        return allNodes.some(node => {
          if (node.nodeType === Node.TEXT_NODE) return true;
          if (node instanceof Element && !node.hasAttribute('data-gh')) return true;
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

  private updateWordStyles(activeWords: ActiveWord[]): void {
    this.initializeStyleSheet();

    while (this.styleSheet!.cssRules.length > 0) {
      this.styleSheet!.deleteRule(0);
    }

    this.wordStyleMap.clear();
    const uniqueStyles = new Map<string, string>();

    for (const word of activeWords) {
      const styleKey = `${word.background}-${word.foreground}`;
      if (!uniqueStyles.has(styleKey)) {
        const className = `highlighted-word-${uniqueStyles.size}`;
        uniqueStyles.set(styleKey, className);

        const rule = `.${className} { background: ${word.background}; color: ${word.foreground}; padding: 0 2px; }`;
        this.styleSheet!.insertRule(rule, this.styleSheet!.cssRules.length);
      }

      const lookup = word.text;
      this.wordStyleMap.set(lookup, uniqueStyles.get(styleKey)!);
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
          if (node.parentNode && (node.parentNode as Element).hasAttribute('data-gh')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.parentNode && ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(node.parentNode.nodeName)) {
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

    this.observer.disconnect();

    this.clearHighlightsInternal();

    const activeWords = this.extractActiveWords(lists);
    if (activeWords.length === 0) {
      this.startObserving();
      this.isHighlighting = false;
      return;
    }

    this.updateWordStyles(activeWords);

    const wordMap = new Map<string, ActiveWord>();
    for (const word of activeWords) {
      const key = matchCase ? word.text : word.text.toLowerCase();
      wordMap.set(key, word);
    }

    const flags = matchCase ? 'gu' : 'giu';
    let wordsPattern = Array.from(wordMap.keys()).map(DOMUtils.escapeRegex).join('|');

    if (matchWhole) {
      wordsPattern = `(?:(?<!\\p{L})|^)(${wordsPattern})(?:(?!\\p{L})|$)`;
    }

    try {
      const pattern = new RegExp(`(${wordsPattern})`, flags);
      const textNodes = this.getTextNodes();

      for (const node of textNodes) {
        if (!node.nodeValue || !pattern.test(node.nodeValue)) continue;

        const span = document.createElement('span');
        span.innerHTML = node.nodeValue.replace(pattern, (match) => {
          const lookup = matchCase ? match : match.toLowerCase();
          const className = this.wordStyleMap.get(lookup) || 'highlighted-word-0';
          return `<span data-gh class="${className}">${match}</span>`;
        });

        node.parentNode?.replaceChild(span, node);
      }
    } catch (e) {
      console.error('Regex error:', e);
    }

    this.startObserving();
    this.isHighlighting = false;
  }

  private clearHighlightsInternal(): void {
    const highlightedElements = document.querySelectorAll('[data-gh]');
    highlightedElements.forEach(element => {
      const parent = element.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(element.textContent || ''), element);
        parent.normalize();
      }
    });

    if (this.styleSheet && this.styleSheet.cssRules.length > 0) {
      while (this.styleSheet.cssRules.length > 0) {
        this.styleSheet.deleteRule(0);
      }
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
import { HighlightList, ActiveWord, CONSTANTS } from '../types.js';
import { DOMUtils } from '../utils/DOMUtils.js';

export class HighlightEngine {
  private styleSheet: CSSStyleSheet | null = null;
  private highlights = new Map<string, Highlight>();
  private highlightsByWord = new Map<string, Range[]>();
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
    } catch (e) {
      console.error('Regex error:', e);
    }

    this.startObserving();
    this.isHighlighting = false;
  }

  private clearHighlightsInternal(): void {
    for (const name of this.highlights.keys()) {
      CSS.highlights.delete(name);
    }
    this.highlights.clear();
    this.highlightsByWord.clear();

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
      
      if (ranges && ranges.length > 0 && !seen.has(lookup)) {
        seen.set(lookup, {
          word: activeWord.text,
          count: ranges.length,
          background: activeWord.background,
          foreground: activeWord.foreground
        });
      }
    }
    
    return Array.from(seen.values());
  }

  scrollToHighlight(word: string, index: number): void {
    const lookup = this.currentMatchCase ? word : word.toLowerCase();
    const ranges = this.highlightsByWord.get(lookup);
    
    if (!ranges || ranges.length === 0) return;
    
    const targetIndex = Math.min(index, ranges.length - 1);
    const range = ranges[targetIndex];
    
    if (!range) return;

    try {
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
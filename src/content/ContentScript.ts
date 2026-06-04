import { HighlightList, MessageData, ExceptionsMode, ActiveWord } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { MessageService } from '../services/MessageService.js';
import { HighlightEngine } from './HighlightEngine.js';

export class ContentScript {
  private lists: HighlightList[] = [];
  private isGlobalHighlightEnabled = true;
  private exceptionsList: string[] = [];
  private exceptionsWhiteList: string[] = [];
  private exceptionsMode: ExceptionsMode = 'blacklist';
  private shouldSkipDueToExceptions = false;
  private matchCase = false;
  private matchWhole = false;
  private highlightEngine: HighlightEngine;
  private isProcessing = false;

  constructor() {
    this.highlightEngine = new HighlightEngine(() => this.processHighlights());
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await this.loadSettings();
      this.setupMessageListener();
      this.processHighlights();
    } catch (error) {
      console.error('ContentScript initialization error:', error);
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      const data = await StorageService.get([
        'lists',
        'globalHighlightEnabled',
        'matchCaseEnabled',
        'matchWholeEnabled',
        'exceptionsList',
        'exceptionsWhiteList',
        'exceptionsMode'
      ]);

      this.lists = data.lists || [];
      this.isGlobalHighlightEnabled = data.globalHighlightEnabled ?? true;
      this.matchCase = data.matchCaseEnabled ?? false;
      this.matchWhole = data.matchWholeEnabled ?? false;
      this.exceptionsList = data.exceptionsList || [];
      this.exceptionsWhiteList = data.exceptionsWhiteList || [];
      this.exceptionsMode = data.exceptionsMode === 'whitelist' ? 'whitelist' : 'blacklist';
      this.shouldSkipDueToExceptions = this.computeShouldSkipDueToExceptions();
    } catch (error) {
      console.error('ContentScript.loadSettings error:', error);
      // Use defaults on error
      this.lists = [];
      this.isGlobalHighlightEnabled = true;
      this.matchCase = false;
      this.matchWhole = false;
      this.exceptionsList = [];
      this.exceptionsWhiteList = [];
      this.exceptionsMode = 'blacklist';
      this.shouldSkipDueToExceptions = false;
    }
  }

  private getCurrentExceptionsList(): string[] {
    return this.exceptionsMode === 'whitelist' ? this.exceptionsWhiteList : this.exceptionsList;
  }

  private computeShouldSkipDueToExceptions(): boolean {
    const currentHostname = window.location.hostname;
    const list = this.getCurrentExceptionsList();
    const isInList = list.includes(currentHostname);
    if (this.exceptionsMode === 'blacklist') {
      return isInList;
    }
    return !isInList;
  }

  private setupMessageListener(): void {
    MessageService.onMessage((message: MessageData, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      switch (message.type) {
        case 'WORD_LIST_UPDATED':
          void this.handleWordListUpdate();
          return false;
        case 'GLOBAL_TOGGLE_UPDATED':
          this.handleGlobalToggleUpdate(message.enabled!);
          return false;
        case 'MATCH_OPTIONS_UPDATED':
          this.handleMatchOptionsUpdate(message.matchCase!, message.matchWhole!);
          return false;
        case 'EXCEPTIONS_LIST_UPDATED':
          void this.handleExceptionsUpdate();
          return false;
        case 'GET_PAGE_HIGHLIGHTS':
          this.handleGetPageHighlights(sendResponse);
          return true;
        case 'SCROLL_TO_HIGHLIGHT':
          this.handleScrollToHighlight(message.word!, message.index!);
          return false;
      }
      return false;
    });
  }


  private async handleWordListUpdate(): Promise<void> {
    try {
      const data = await StorageService.get(['lists']);
      this.lists = data.lists || [];
      this.processHighlights();
    } catch (error) {
      console.error('ContentScript.handleWordListUpdate error:', error);
    }
  }

  private handleGlobalToggleUpdate(enabled: boolean): void {
    this.isGlobalHighlightEnabled = enabled;
    this.processHighlights();
  }

  private handleMatchOptionsUpdate(matchCase: boolean, matchWhole: boolean): void {
    this.matchCase = matchCase;
    this.matchWhole = matchWhole;
    this.processHighlights();
  }

  private async handleExceptionsUpdate(): Promise<void> {
    try {
      const data = await StorageService.get(['exceptionsList', 'exceptionsWhiteList', 'exceptionsMode']);
      this.exceptionsList = data.exceptionsList || [];
      this.exceptionsWhiteList = data.exceptionsWhiteList || [];
      this.exceptionsMode = data.exceptionsMode === 'whitelist' ? 'whitelist' : 'blacklist';
      this.shouldSkipDueToExceptions = this.computeShouldSkipDueToExceptions();
      this.processHighlights();
    } catch (error) {
      console.error('ContentScript.handleExceptionsUpdate error:', error);
    }
  }

  private processHighlights(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      if (!this.isGlobalHighlightEnabled || this.shouldSkipDueToExceptions) {
        this.highlightEngine.clearHighlights();
        this.highlightEngine.stopObserving();
        return;
      }

      this.highlightEngine.highlight(this.lists, this.matchCase, this.matchWhole);
    } finally {
      this.isProcessing = false;
    }
  }

  private handleGetPageHighlights(sendResponse: (response: unknown) => void): void {
    const activeWords: ActiveWord[] = [];
    
    for (const list of this.lists) {
      if (!list.active) continue;
      for (const word of list.words) {
        if (!word.active) continue;
        activeWords.push({
          text: word.wordStr,
          background: word.background || list.background,
          foreground: word.foreground || list.foreground,
          listId: list.id,
          listName: list.name || 'Default'
        });
      }
    }

    const highlights = this.highlightEngine.getPageHighlights(activeWords);
    sendResponse({ highlights, lists: this.lists.filter(l => l.active) });
  }

  private handleScrollToHighlight(word: string, index: number): void {
    this.highlightEngine.scrollToHighlight(word, index);
  }
}
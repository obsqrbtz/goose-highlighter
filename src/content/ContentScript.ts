import { ActiveWord, HighlightList, MessageData, ExceptionsMode, BadgePosition, DEFAULT_STORAGE } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { MessageService } from '../services/MessageService.js';
import { HighlightEngine, activeHighlightWords } from './HighlightEngine.js';

export class ContentScript {
  private lists: HighlightList[] = [];
  private activeWords?: ActiveWord[];
  private isGlobalHighlightEnabled = true;
  private exceptionsList: string[] = [];
  private exceptionsWhiteList: string[] = [];
  private exceptionsMode: ExceptionsMode = 'blacklist';
  private shouldSkipDueToExceptions = false;
  private matchCase = false;
  private matchWhole = false;
  private badgePosition: BadgePosition = DEFAULT_STORAGE.badgePosition;
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
        'exceptionsMode',
        'badgePosition'
      ]);

      this.lists = data.lists || [];
      this.isGlobalHighlightEnabled = data.globalHighlightEnabled ?? true;
      this.matchCase = data.matchCaseEnabled ?? false;
      this.matchWhole = data.matchWholeEnabled ?? false;
      this.badgePosition = data.badgePosition ?? DEFAULT_STORAGE.badgePosition;
      this.exceptionsList = data.exceptionsList || [];
      this.exceptionsWhiteList = data.exceptionsWhiteList || [];
      this.exceptionsMode = data.exceptionsMode === 'whitelist' ? 'whitelist' : 'blacklist';
      this.shouldSkipDueToExceptions = this.computeShouldSkipDueToExceptions();
      this.highlightEngine.setBadgePosition(this.badgePosition);
    } catch (error) {
      console.error('ContentScript.loadSettings error:', error);
      // Use defaults on error
      this.lists = [];
      this.isGlobalHighlightEnabled = true;
      this.matchCase = false;
      this.matchWhole = false;
      this.badgePosition = DEFAULT_STORAGE.badgePosition;
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
        case 'BADGE_POSITION_UPDATED':
          this.handleBadgePositionUpdate(message.badgePosition!);
          return false;
        case 'EXCEPTIONS_LIST_UPDATED':
          void this.handleExceptionsUpdate();
          return false;
        case 'GET_PAGE_HIGHLIGHTS':
          void this.handleGetPageHighlights(sendResponse);
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
      this.activeWords = undefined;
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

  private handleBadgePositionUpdate(badgePosition: BadgePosition): void {
    this.badgePosition = badgePosition;
    this.highlightEngine.setBadgePosition(badgePosition);
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

      this.highlightEngine.highlight(this.getActiveWords(), this.matchCase, this.matchWhole);
    } finally {
      this.isProcessing = false;
    }
  }

  private getActiveWords(): ActiveWord[] {
    return this.activeWords ??= activeHighlightWords(this.lists);
  }

  private async handleGetPageHighlights(sendResponse: (response: unknown) => void): Promise<void> {
    await this.highlightEngine.waitForScan();
    const highlights = this.highlightEngine.getPageHighlights(this.getActiveWords());
    const lists = this.lists.filter(list => list?.active).map(({ id, name, background }) => ({ id, name, background }));
    sendResponse({ highlights, lists });
  }

  private handleScrollToHighlight(word: string, index: number): void {
    this.highlightEngine.scrollToHighlight(word, index);
  }
}

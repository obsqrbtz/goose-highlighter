import { HighlightList, MessageData } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { MessageService } from '../services/MessageService.js';
import { HighlightEngine } from './HighlightEngine.js';

export class ContentScript {
  private lists: HighlightList[] = [];
  private isGlobalHighlightEnabled = true;
  private exceptionsList: string[] = [];
  private isCurrentSiteException = false;
  private matchCase = false;
  private matchWhole = false;
  private highlightEngine: HighlightEngine;
  private isProcessing = false;

  constructor() {
    this.highlightEngine = new HighlightEngine(() => this.processHighlights());
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.loadSettings();
    this.setupMessageListener();
    this.processHighlights();
  }

  private async loadSettings(): Promise<void> {
    const data = await StorageService.get([
      'lists', 
      'globalHighlightEnabled', 
      'matchCaseEnabled', 
      'matchWholeEnabled', 
      'exceptionsList'
    ]);

    this.lists = data.lists || [];
    this.isGlobalHighlightEnabled = data.globalHighlightEnabled ?? true;
    this.matchCase = data.matchCaseEnabled ?? false;
    this.matchWhole = data.matchWholeEnabled ?? false;
    this.exceptionsList = data.exceptionsList || [];
    this.isCurrentSiteException = this.checkCurrentSiteException();
  }

  private checkCurrentSiteException(): boolean {
    const currentHostname = window.location.hostname;
    return this.exceptionsList.includes(currentHostname);
  }

  private setupMessageListener(): void {
    MessageService.onMessage((message: MessageData) => {
      switch (message.type) {
        case 'WORD_LIST_UPDATED':
          this.handleWordListUpdate();
          break;
        case 'GLOBAL_TOGGLE_UPDATED':
          this.handleGlobalToggleUpdate(message.enabled!);
          break;
        case 'MATCH_OPTIONS_UPDATED':
          this.handleMatchOptionsUpdate(message.matchCase!, message.matchWhole!);
          break;
        case 'EXCEPTIONS_LIST_UPDATED':
          this.handleExceptionsUpdate();
          break;
      }
    });
  }


  private async handleWordListUpdate(): Promise<void> {
    const data = await StorageService.get(['lists']);
    this.lists = data.lists || [];
    this.processHighlights();
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
    const data = await StorageService.get(['exceptionsList']);
    this.exceptionsList = data.exceptionsList || [];
    this.isCurrentSiteException = this.checkCurrentSiteException();
    this.processHighlights();
  }

  private processHighlights(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      if (!this.isGlobalHighlightEnabled || this.isCurrentSiteException) {
        this.highlightEngine.clearHighlights();
        this.highlightEngine.stopObserving();
        return;
      }

      this.highlightEngine.highlight(this.lists, this.matchCase, this.matchWhole);
    } finally {
      this.isProcessing = false;
    }
  }
}
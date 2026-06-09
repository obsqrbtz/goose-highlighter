import { browserAPI } from '../../utils/browser.js';
export class PopupStateManager {
  private static readonly POPUP_STATE_KEY = 'goose-popup-ui-state';
  private static readonly SCROLL_SELECTORS: Record<string, string> = {
    lists: '.tab-inner',
    words: '.word-list-container',
    'page-highlights': '.page-highlights-list',
    exceptions: '.exceptions-list'
  };

  private scrollPositions: Record<string, number> = {};
  private periodicSaveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private getState: () => PopupState,
    private setState: (state: Partial<PopupState>) => void
  ) {}

  async load(): Promise<void> {
    try {
      const result = await browserAPI.storage.local.get(PopupStateManager.POPUP_STATE_KEY);
      const raw = result[PopupStateManager.POPUP_STATE_KEY];
      if (raw === undefined || typeof raw !== 'string') return;
      
      const state = JSON.parse(raw) as Partial<PopupState & { scrollPositions?: Record<string, number> }>;
      
      if (typeof state.activeTab === 'string' && state.activeTab !== 'options') {
        this.setState({ activeTab: state.activeTab });
      }
      if (typeof state.currentListIndex === 'number' && state.currentListIndex >= 0) {
        this.setState({ currentListIndex: state.currentListIndex });
      }
      if (typeof state.wordSearchQuery === 'string') {
        this.setState({ wordSearchQuery: state.wordSearchQuery });
      }
      if (typeof state.currentPage === 'number' && state.currentPage >= 1) {
        this.setState({ currentPage: state.currentPage });
      }
      if (state.scrollPositions && typeof state.scrollPositions === 'object') {
        this.scrollPositions = { ...state.scrollPositions };
      }
      if (typeof state.pageHighlightsGroupByList === 'boolean') {
        this.setState({ pageHighlightsGroupByList: state.pageHighlightsGroupByList });
      }
      if (Array.isArray(state.pageHighlightsListFilter)) {
        this.setState({ pageHighlightsListFilter: new Set(state.pageHighlightsListFilter) });
      }
    } catch {
      // keep defaults
    }
  }

  save(): void {
    const state = this.getState();
    const payload = {
      activeTab: state.activeTab,
      currentListIndex: state.currentListIndex,
      wordSearchQuery: state.wordSearchQuery,
      currentPage: state.currentPage,
      scrollPositions: this.scrollPositions,
      pageHighlightsGroupByList: state.pageHighlightsGroupByList,
      pageHighlightsListFilter: Array.from(state.pageHighlightsListFilter)
    };
    browserAPI.storage.local.set({ [PopupStateManager.POPUP_STATE_KEY]: JSON.stringify(payload) }).catch(() => {});
  }

  startPeriodicSave(): void {
    this.periodicSaveInterval = setInterval(() => {
      const state = this.getState();
      const scrollEl = this.getScrollContainer(state.activeTab);
      if (scrollEl) this.scrollPositions[state.activeTab] = scrollEl.scrollTop;
      this.save();
    }, 800);
  }

  captureScrollAndSave(): void {
    if (this.periodicSaveInterval) {
      clearInterval(this.periodicSaveInterval);
      this.periodicSaveInterval = null;
    }
    const state = this.getState();
    const scrollEl = this.getScrollContainer(state.activeTab);
    if (scrollEl) this.scrollPositions[state.activeTab] = scrollEl.scrollTop;
    
    const payload = {
      activeTab: state.activeTab,
      currentListIndex: state.currentListIndex,
      wordSearchQuery: state.wordSearchQuery,
      currentPage: state.currentPage,
      scrollPositions: this.scrollPositions,
      pageHighlightsGroupByList: state.pageHighlightsGroupByList,
      pageHighlightsListFilter: Array.from(state.pageHighlightsListFilter)
    };
    browserAPI.runtime.sendMessage({ type: 'SAVE_POPUP_STATE', payload }).catch(() => {});
  }

  setupScrollListeners(): void {
    const tabNames = ['lists', 'words', 'page-highlights', 'exceptions'];
    tabNames.forEach(tabName => {
      const el = this.getScrollContainer(tabName);
      if (el) {
        el.addEventListener('scroll', () => {
          this.scrollPositions[tabName] = el.scrollTop;
          this.save();
        }, { passive: true });
      }
    });
  }

  restoreScrollPositions(): void {
    const state = this.getState();
    const el = this.getScrollContainer(state.activeTab);
    if (el) {
      const saved = this.scrollPositions[state.activeTab];
      if (typeof saved === 'number' && saved >= 0) {
        el.scrollTop = saved;
      }
    }
  }

  getScrollContainer(tabName: string): HTMLElement | null {
    const sel = PopupStateManager.SCROLL_SELECTORS[tabName];
    if (!sel) return null;
    const content = document.querySelector(`.tab-content[data-tab-content="${tabName}"]`);
    return content?.querySelector(sel) ?? null;
  }
}

export interface PopupState {
  activeTab: string;
  currentListIndex: number;
  wordSearchQuery: string;
  currentPage: number;
  pageHighlightsGroupByList: boolean;
  pageHighlightsListFilter: Set<number>;
}

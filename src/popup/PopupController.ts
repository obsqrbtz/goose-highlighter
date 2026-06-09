import { browserAPI } from '../utils/browser.js';
import { HighlightList } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { MessageService } from '../services/MessageService.js';
import { PopupStateManager, PopupState } from './managers/PopupStateManager.js';
import { PopupRenderer } from './managers/PopupRenderer.js';
import { ListManager } from './managers/ListManager.js';
import { WordManager } from './managers/WordManager.js';
import { PageHighlightsManager } from './managers/PageHighlightsManager.js';
import { ExceptionsManager } from './managers/ExceptionsManager.js';
import { ImportExportManager } from './managers/ImportExportManager.js';

export class PopupController {
  // Core data
  private lists: HighlightList[] = [];
  private globalHighlightEnabled = true;
  private matchCaseEnabled = false;
  private matchWholeEnabled = false;
  private currentTabHost = '';

  // UI state
  private state: PopupState = {
    activeTab: 'lists',
    currentListIndex: 0,
    wordSearchQuery: '',
    currentPage: 1,
    pageHighlightsGroupByList: false,
    pageHighlightsListFilter: new Set<number>()
  };

  // Managers
  private stateManager!: PopupStateManager;
  private listManager!: ListManager;
  private wordManager!: WordManager;
  private pageHighlightsManager!: PageHighlightsManager;
  private exceptionsManager!: ExceptionsManager;
  private importExportManager!: ImportExportManager;

  async initialize(): Promise<void> {
    try {
      await this.loadData();
      await this.getCurrentTab();
      
      this.initializeManagers();
      
      await this.stateManager.load();
      
      PopupRenderer.translateTitles();
      this.setupEventListeners();
      this.render();
      this.restoreWordSearchInput();
      
      requestAnimationFrame(() => {
        requestAnimationFrame(() => this.stateManager.restoreScrollPositions());
      });
      
      PopupRenderer.hideLoadingOverlay();
      this.stateManager.startPeriodicSave();
    } catch (error) {
      console.error('PopupController.initialize error:', error);
      PopupRenderer.hideLoadingOverlay();
      // Show error state to user
      document.body.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #f44336;">
          <h3>Error loading extension</h3>
          <p>Please try refreshing the popup.</p>
        </div>
      `;
    }
  }

  private initializeManagers(): void {
    this.stateManager = new PopupStateManager(
      () => this.state,
      (updates) => { Object.assign(this.state, updates); }
    );

    this.listManager = new ListManager(
      this.lists,
      () => this.state.currentListIndex,
      (index) => {
        this.state.currentListIndex = index;
        this.state.currentPage = 1;
        this.wordManager.clearSelection();
        this.stateManager.save();
      },
      () => this.render()
    );

    this.wordManager = new WordManager(
      this.lists,
      () => this.state.currentListIndex,
      () => this.state.wordSearchQuery,
      () => this.state.currentPage,
      (page) => {
        this.state.currentPage = page;
        this.stateManager.save();
      },
      () => {
        this.listManager.render();
        this.wordManager.render();
      }
    );

    this.pageHighlightsManager = new PageHighlightsManager(
      () => this.state.pageHighlightsGroupByList,
      (value) => { this.state.pageHighlightsGroupByList = value; },
      () => this.state.pageHighlightsListFilter,
      (value) => { this.state.pageHighlightsListFilter = value; },
      () => this.stateManager.save()
    );

    this.exceptionsManager = new ExceptionsManager(
      [],
      [],
      'blacklist',
      this.currentTabHost,
      () => this.exceptionsManager.render()
    );

    this.importExportManager = new ImportExportManager(
      this.lists,
      () => this.state.currentListIndex,
      (index) => { this.state.currentListIndex = index; },
      () => this.exceptionsManager.getExceptionsList(),
      () => this.exceptionsManager.getExceptionsWhiteList(),
      () => this.exceptionsManager.getExceptionsMode(),
      (_list) => { /* handled by exceptionsManager */ },
      (_list) => { /* handled by exceptionsManager */ },
      (_mode) => { /* handled by exceptionsManager */ },
      () => this.render()
    );
  }

  private async loadData(): Promise<void> {
    try {
      const data = await StorageService.get();
      this.lists = data.lists || [];
      this.globalHighlightEnabled = data.globalHighlightEnabled ?? true;
      this.matchCaseEnabled = data.matchCaseEnabled ?? false;
      this.matchWholeEnabled = data.matchWholeEnabled ?? false;

      if (this.lists.length === 0) {
        this.lists.push({
          id: Date.now(),
          name: browserAPI.i18n.getMessage('default_list_name') || 'Default List',
          background: '#ffff00',
          foreground: '#000000',
          active: true,
          words: []
        });
      }
    } catch (error) {
      console.error('PopupController.loadData error:', error);
      // Use defaults on error
      this.lists = [{
        id: Date.now(),
        name: browserAPI.i18n.getMessage('default_list_name') || 'Default List',
        background: '#ffff00',
        foreground: '#000000',
        active: true,
        words: []
      }];
      this.globalHighlightEnabled = true;
      this.matchCaseEnabled = false;
      this.matchWholeEnabled = false;
    }
  }

  private async getCurrentTab(): Promise<void> {
    try {
      const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const url = new URL(tab.url);
        this.currentTabHost = url.hostname;
      }
    } catch (e) {
      console.warn('PopupController.getCurrentTab - Could not get current tab:', e);
    }
  }

  private setupEventListeners(): void {
    this.setupTabs();
    this.stateManager.setupScrollListeners();
    this.setupSettingsOverlay();
    this.listManager.setupEventListeners();
    this.wordManager.setupEventListeners();
    this.setupSettings();
    this.pageHighlightsManager.setupEventListeners();
    this.exceptionsManager.setupEventListeners();
    this.importExportManager.setupEventListeners();
    this.setupTheme();
    this.setupStorageSync();
  }

  private setupTabs(): void {
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', () => {
        const tabName = (button as HTMLElement).getAttribute('data-tab');
        if (tabName) this.switchTab(tabName);
      });
    });

    this.switchTab(this.state.activeTab);
  }

  private switchTab(tabName: string): void {
    const isUserSwitch = tabName !== this.state.activeTab;
    if (isUserSwitch) {
      const scrollEl = this.stateManager.getScrollContainer(this.state.activeTab);
      if (scrollEl) {
        // Scroll position is captured by stateManager
      }
      this.state.activeTab = tabName;
      this.stateManager.save();
    }

    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.getAttribute('data-tab-content') === tabName);
    });

    if (tabName === 'page-highlights') {
      this.pageHighlightsManager.load();
    }
    requestAnimationFrame(() => this.stateManager.restoreScrollPositions());
  }

  private setupSettingsOverlay(): void {
    const overlay = document.getElementById('settingsOverlay');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeBtn = document.getElementById('settingsCloseBtn');

    settingsBtn?.addEventListener('click', () => {
      overlay?.classList.add('open');
    });

    closeBtn?.addEventListener('click', () => {
      overlay?.classList.remove('open');
    });

    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
      }
    });
  }

  private setupSettings(): void {
    const globalToggle = document.getElementById('globalHighlightToggle') as HTMLInputElement;
    const matchCase = document.getElementById('matchCase') as HTMLInputElement;
    const matchWhole = document.getElementById('matchWhole') as HTMLInputElement;

    globalToggle?.addEventListener('change', async () => {
      try {
        this.globalHighlightEnabled = globalToggle.checked;
        await StorageService.update('globalHighlightEnabled', this.globalHighlightEnabled);
        MessageService.sendToAllTabs({
          type: 'GLOBAL_TOGGLE_UPDATED',
          enabled: this.globalHighlightEnabled
        });
      } catch (error) {
        console.error('Error updating global highlight toggle:', error);
      }
    });

    matchCase?.addEventListener('change', async () => {
      try {
        this.matchCaseEnabled = matchCase.checked;
        await StorageService.update('matchCaseEnabled', this.matchCaseEnabled);
        MessageService.sendToAllTabs({
          type: 'MATCH_OPTIONS_UPDATED',
          matchCase: this.matchCaseEnabled,
          matchWhole: this.matchWholeEnabled
        });
      } catch (error) {
        console.error('Error updating match case:', error);
      }
    });

    matchWhole?.addEventListener('change', async () => {
      try {
        this.matchWholeEnabled = matchWhole.checked;
        await StorageService.update('matchWholeEnabled', this.matchWholeEnabled);
        MessageService.sendToAllTabs({
          type: 'MATCH_OPTIONS_UPDATED',
          matchCase: this.matchCaseEnabled,
          matchWhole: this.matchWholeEnabled
        });
      } catch (error) {
        console.error('Error updating match whole:', error);
      }
    });
  }

  private setupTheme(): void {
    const themeToggle = document.getElementById('themeToggle') as HTMLInputElement;
    
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      if (themeToggle) themeToggle.checked = false;
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      if (themeToggle) themeToggle.checked = true;
    }

    themeToggle?.addEventListener('change', () => {
      if (themeToggle.checked) {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        localStorage.setItem('theme', 'light');
      }
    });
  }

  private setupStorageSync(): void {
    browserAPI.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.lists || changes.globalHighlightEnabled || changes.matchCaseEnabled || 
          changes.matchWholeEnabled || changes.exceptionsList || changes.exceptionsWhiteList || 
          changes.exceptionsMode) {
        void this.reloadFromStorage();
      }
    });
  }

  private async reloadFromStorage(): Promise<void> {
    try {
      await this.loadData();
      this.state.currentListIndex = Math.min(this.state.currentListIndex, this.lists.length - 1);
      this.render();
    } catch (error) {
      console.error('PopupController.reloadFromStorage error:', error);
    }
  }

  private restoreWordSearchInput(): void {
    const wordSearch = document.getElementById('wordSearch') as HTMLInputElement;
    if (wordSearch) {
      wordSearch.value = this.state.wordSearchQuery;
    }
  }

  private render(): void {
    this.listManager.render();
    this.wordManager.render();
    this.exceptionsManager.render();
    this.updateFormValues();
  }

  private updateFormValues(): void {
    (document.getElementById('globalHighlightToggle') as HTMLInputElement).checked = this.globalHighlightEnabled;
    (document.getElementById('matchCase') as HTMLInputElement).checked = this.matchCaseEnabled;
    (document.getElementById('matchWhole') as HTMLInputElement).checked = this.matchWholeEnabled;
    const groupCheckbox = document.getElementById('pageHighlightsGroupByList') as HTMLInputElement;
    if (groupCheckbox) groupCheckbox.checked = this.state.pageHighlightsGroupByList;
  }

  captureScrollAndSave(): void {
    this.stateManager.captureScrollAndSave();
  }
}

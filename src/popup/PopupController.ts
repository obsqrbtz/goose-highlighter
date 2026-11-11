import { browserAPI } from '../utils/browser.js';
import { HighlightList, BadgePosition, BadgeHorizontal, BadgeVertical, BadgePlacement, DEFAULT_STORAGE, StorageData } from '../types.js';
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
  private readonly lists: HighlightList[] = [];
  private listsLoaded = false;
  private listsLoading?: Promise<void>;
  private globalHighlightEnabled = true;
  private matchCaseEnabled = false;
  private matchWholeEnabled = false;
  private badgePosition: BadgePosition = { ...DEFAULT_STORAGE.badgePosition };
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
      const settings = StorageService.get([
        'globalHighlightEnabled', 'matchCaseEnabled', 'matchWholeEnabled', 'badgePosition',
        'exceptionsList', 'exceptionsWhiteList', 'exceptionsMode'
      ]);
      const currentTab = this.getCurrentTab();
      this.initializeManagers();
      const [data] = await Promise.all([settings, currentTab, this.stateManager.load()]);
      this.applySettings(data);
      this.exceptionsManager.setCurrentTabHost(this.currentTabHost);
      
      PopupRenderer.translateTitles();
      this.setupEventListeners();
      this.exceptionsManager.render();
      this.updateFormValues();
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
      (query) => {
        this.state.wordSearchQuery = query;
        this.stateManager.save();
      },
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
      (list) => this.exceptionsManager.setSettings({ exceptionsList: list }),
      (list) => this.exceptionsManager.setSettings({ exceptionsWhiteList: list }),
      (mode) => this.exceptionsManager.setSettings({ exceptionsMode: mode }),
      () => this.ensureLists(),
      () => this.render()
    );
  }

  private ensureLists(): Promise<void> {
    if (this.listsLoaded) return Promise.resolve();
    return this.listsLoading ??= StorageService.get(['lists']).then(({ lists }) => {
      // A storage change received during the read is newer than the snapshot.
      if (!this.listsLoaded) this.applyLists(lists);
    }).finally(() => {
      this.listsLoading = undefined;
    });
  }

  private applyLists(lists: HighlightList[]): void {
    this.lists.length = 0;
    for (const list of lists ?? []) this.lists.push(list);
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
    this.state.currentListIndex = Math.min(this.state.currentListIndex, this.lists.length - 1);
    this.listsLoaded = true;
    document.querySelectorAll<HTMLElement>('.tab-content[aria-busy]').forEach(panel => {
      panel.removeAttribute('aria-busy');
      panel.inert = false;
    });
    this.renderListTab();
  }

  private applySettings(data: Partial<StorageData>): void {
    this.globalHighlightEnabled = data.globalHighlightEnabled ?? this.globalHighlightEnabled;
    this.matchCaseEnabled = data.matchCaseEnabled ?? this.matchCaseEnabled;
    this.matchWholeEnabled = data.matchWholeEnabled ?? this.matchWholeEnabled;
    this.badgePosition = data.badgePosition ?? this.badgePosition;
    this.exceptionsManager.setSettings(data);
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
      void this.pageHighlightsManager.load();
    } else if (tabName === 'lists' || tabName === 'words') {
      if (this.listsLoaded) this.renderListTab();
      else void this.ensureLists().then(() => this.stateManager.restoreScrollPositions());
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
        this.updatePowerLabel();
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

    const badgeHorizontal = document.getElementById('badgePositionHorizontal') as HTMLSelectElement;
    const badgeVertical = document.getElementById('badgePositionVertical') as HTMLSelectElement;
    const badgePlacement = document.getElementById('badgePositionPlacement') as HTMLSelectElement;

    const saveBadgePosition = async () => {
      try {
        this.badgePosition = {
          horizontal: badgeHorizontal.value as BadgeHorizontal,
          vertical: badgeVertical.value as BadgeVertical,
          placement: badgePlacement.value as BadgePlacement
        };
        await StorageService.update('badgePosition', this.badgePosition);
        MessageService.sendToAllTabs({
          type: 'BADGE_POSITION_UPDATED',
          badgePosition: this.badgePosition
        });
      } catch (error) {
        console.error('Error updating badge position:', error);
      }
    };

    badgeHorizontal?.addEventListener('change', saveBadgePosition);
    badgeVertical?.addEventListener('change', saveBadgePosition);
    badgePlacement?.addEventListener('change', saveBadgePosition);
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
      if (changes.lists && (this.listsLoaded || this.listsLoading)) {
        this.applyLists(changes.lists.newValue as HighlightList[] ?? []);
      }
      const settings: Partial<StorageData> = {};
      const keys = [
        'globalHighlightEnabled', 'matchCaseEnabled', 'matchWholeEnabled', 'badgePosition',
        'exceptionsList', 'exceptionsWhiteList', 'exceptionsMode'
      ] as const;
      for (const key of keys) {
        const change = changes[key];
        if (change) Object.assign(settings, { [key]: change.newValue ?? DEFAULT_STORAGE[key] });
      }
      if (Object.keys(settings).length > 0) {
        this.applySettings(settings);
        this.exceptionsManager.render();
        this.updateFormValues();
      }
    });
  }

  private restoreWordSearchInput(): void {
    const wordSearch = document.getElementById('wordSearch') as HTMLInputElement;
    if (wordSearch) {
      wordSearch.value = this.state.wordSearchQuery;
    }
  }

  private render(): void {
    this.renderListTab();
    this.exceptionsManager.render();
    this.updateFormValues();
  }

  private renderListTab(): void {
    if (!this.listsLoaded) return;
    if (this.state.activeTab === 'lists') this.listManager.render();
    if (this.state.activeTab === 'words') this.wordManager.render();
  }

  private updatePowerLabel(): void {
    const key = this.globalHighlightEnabled ? 'turn_highlighting_off' : 'turn_highlighting_on';
    const label = browserAPI.i18n.getMessage(key) || (this.globalHighlightEnabled ? 'Turn highlighting off' : 'Turn highlighting on');
    document.getElementById('globalHighlightToggle')?.setAttribute('aria-label', label);
    document.querySelector('.header-power-toggle')?.setAttribute('aria-label', label);
    const tooltip = document.querySelector('.power-tooltip');
    if (tooltip) tooltip.textContent = label;
  }

  private updateFormValues(): void {
    this.updatePowerLabel();
    (document.getElementById('globalHighlightToggle') as HTMLInputElement).checked = this.globalHighlightEnabled;
    (document.getElementById('matchCase') as HTMLInputElement).checked = this.matchCaseEnabled;
    (document.getElementById('matchWhole') as HTMLInputElement).checked = this.matchWholeEnabled;
    const badgeHorizontal = document.getElementById('badgePositionHorizontal') as HTMLSelectElement | null;
    const badgeVertical = document.getElementById('badgePositionVertical') as HTMLSelectElement | null;
    const badgePlacement = document.getElementById('badgePositionPlacement') as HTMLSelectElement | null;
    if (badgeHorizontal) badgeHorizontal.value = this.badgePosition.horizontal;
    if (badgeVertical) badgeVertical.value = this.badgePosition.vertical;
    if (badgePlacement) badgePlacement.value = this.badgePosition.placement;
    const groupSelect = document.getElementById('pageHighlightsGroupByList') as HTMLSelectElement;
    if (groupSelect) groupSelect.value = this.state.pageHighlightsGroupByList ? 'list' : 'none';
  }

  captureScrollAndSave(): void {
    this.stateManager.captureScrollAndSave();
  }
}

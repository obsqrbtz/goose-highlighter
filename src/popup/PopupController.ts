import { HighlightList, HighlightWord, HighlightInfo, ExportData, ExceptionsMode } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { MessageService } from '../services/MessageService.js';
import { DOMUtils } from '../utils/DOMUtils.js';

export class PopupController {
  private lists: HighlightList[] = [];
  private currentListIndex = 0;
  private selectedCheckboxes = new Set<number>();
  private globalHighlightEnabled = true;
  private wordSearchQuery = '';
  private currentPage = 1;
  private pageSize = 100;
  private totalWords = 0;
  private matchCaseEnabled = false;
  private matchWholeEnabled = false;
  private exceptionsList: string[] = [];
  private exceptionsWhiteList: string[] = [];
  private exceptionsMode: ExceptionsMode = 'blacklist';

  private getCurrentExceptionsList(): string[] {
    return this.exceptionsMode === 'whitelist' ? this.exceptionsWhiteList : this.exceptionsList;
  }

  private currentTabHost = '';
  private activeTab = 'lists';
  private pageHighlights: Array<{ word: string; count: number; background: string; foreground: string; listId?: number; listName?: string; listNames: string[] }> = [];
  private pageHighlightsActiveLists: Array<{ id: number; name: string; background: string }> = [];
  private pageHighlightsGroupByList = false;
  private pageHighlightsListFilter = new Set<number>();
  private pageHighlightsCollapsedGroups = new Set<string>();
  private highlightIndices = new Map<string, number>();
  private wordMenuOpenForIndex: number | null = null;
  private wordMenuCopyOnly = false;
  private wordMenuCloseListener: (() => void) | null = null;
  private periodicSaveInterval: ReturnType<typeof setInterval> | null = null;

  async initialize(): Promise<void> {
    await this.loadData();
    await this.loadPopupState();
    await this.getCurrentTab();
    this.translateTitles();
    this.setupEventListeners();
    this.render();
    this.restoreWordSearchInput();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.restoreScrollPositions());
    });
    this.hideLoadingOverlay();
    this.startPeriodicSave();
  }

  private hideLoadingOverlay(): void {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      setTimeout(() => overlay.remove(), 200);
    }
  }

  private async loadData(): Promise<void> {
    const data = await StorageService.get();
    this.lists = data.lists || [];
    this.globalHighlightEnabled = data.globalHighlightEnabled ?? true;
    this.matchCaseEnabled = data.matchCaseEnabled ?? false;
    this.matchWholeEnabled = data.matchWholeEnabled ?? false;
    this.exceptionsList = data.exceptionsList || [];
    this.exceptionsWhiteList = data.exceptionsWhiteList || [];
    this.exceptionsMode = data.exceptionsMode === 'whitelist' ? 'whitelist' : 'blacklist';

    if (this.lists.length === 0) {
      this.lists.push({
        id: Date.now(),
        name: chrome.i18n.getMessage('default_list_name') || 'Default List',
        background: '#ffff00',
        foreground: '#000000',
        active: true,
        words: []
      });
    }
  }

  private async getCurrentTab(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const url = new URL(tab.url);
        this.currentTabHost = url.hostname;
      }
    } catch (e) {
      console.warn('Could not get current tab:', e);
    }
  }

  private static readonly POPUP_STATE_KEY = 'goose-popup-ui-state';
  private scrollPositions: Record<string, number> = {};

  private async loadPopupState(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(PopupController.POPUP_STATE_KEY);
      const raw = result[PopupController.POPUP_STATE_KEY];
      if (raw === undefined || typeof raw !== 'string') return;
      const state = JSON.parse(raw) as {
        activeTab?: string;
        currentListIndex?: number;
        wordSearchQuery?: string;
        currentPage?: number;
        scrollPositions?: Record<string, number>;
        pageHighlightsGroupByList?: boolean;
        pageHighlightsListFilter?: number[];
      };
      if (typeof state.activeTab === 'string' && state.activeTab !== 'options') {
        this.activeTab = state.activeTab;
      }
      if (typeof state.currentListIndex === 'number' && state.currentListIndex >= 0) {
        this.currentListIndex = Math.min(state.currentListIndex, Math.max(0, this.lists.length - 1));
      }
      if (typeof state.wordSearchQuery === 'string') {
        this.wordSearchQuery = state.wordSearchQuery;
      }
      if (typeof state.currentPage === 'number' && state.currentPage >= 1) {
        this.currentPage = state.currentPage;
      }
      if (state.scrollPositions && typeof state.scrollPositions === 'object') {
        this.scrollPositions = { ...state.scrollPositions };
      }
      if (typeof state.pageHighlightsGroupByList === 'boolean') {
        this.pageHighlightsGroupByList = state.pageHighlightsGroupByList;
      }
      if (Array.isArray(state.pageHighlightsListFilter)) {
        this.pageHighlightsListFilter = new Set(state.pageHighlightsListFilter);
      }
    } catch {
      // keep defaults
    }
  }

  private getPopupStatePayload(): { activeTab: string; currentListIndex: number; wordSearchQuery: string; currentPage: number; scrollPositions: Record<string, number>; pageHighlightsGroupByList: boolean; pageHighlightsListFilter: number[] } {
    return {
      activeTab: this.activeTab,
      currentListIndex: this.currentListIndex,
      wordSearchQuery: this.wordSearchQuery,
      currentPage: this.currentPage,
      scrollPositions: this.scrollPositions,
      pageHighlightsGroupByList: this.pageHighlightsGroupByList,
      pageHighlightsListFilter: Array.from(this.pageHighlightsListFilter)
    };
  }

  private savePopupState(): void {
    chrome.storage.local.set({ [PopupController.POPUP_STATE_KEY]: JSON.stringify(this.getPopupStatePayload()) }).catch(() => {});
  }

  private startPeriodicSave(): void {
    this.periodicSaveInterval = setInterval(() => {
      const scrollEl = this.getScrollContainer(this.activeTab);
      if (scrollEl) this.scrollPositions[this.activeTab] = scrollEl.scrollTop;
      this.savePopupState();
    }, 800);
  }

  captureScrollAndSave(): void {
    if (this.periodicSaveInterval) {
      clearInterval(this.periodicSaveInterval);
      this.periodicSaveInterval = null;
    }
    const scrollEl = this.getScrollContainer(this.activeTab);
    if (scrollEl) this.scrollPositions[this.activeTab] = scrollEl.scrollTop;
    chrome.runtime.sendMessage({ type: 'SAVE_POPUP_STATE', payload: this.getPopupStatePayload() }).catch(() => {});
  }

  private restoreWordSearchInput(): void {
    const wordSearch = document.getElementById('wordSearch') as HTMLInputElement;
    if (wordSearch) {
      wordSearch.value = this.wordSearchQuery;
    }
  }

  private static readonly SCROLL_SELECTORS: Record<string, string> = {
    lists: '.tab-inner',
    words: '.word-list-container',
    'page-highlights': '.page-highlights-list',
    exceptions: '.exceptions-list'
  };

  private getScrollContainer(tabName: string): HTMLElement | null {
    const sel = PopupController.SCROLL_SELECTORS[tabName];
    if (!sel) return null;
    const content = document.querySelector(`.tab-content[data-tab-content="${tabName}"]`);
    return content?.querySelector(sel) ?? null;
  }

  private setupScrollListeners(): void {
    const tabNames = ['lists', 'words', 'page-highlights', 'exceptions'];
    tabNames.forEach(tabName => {
      const el = this.getScrollContainer(tabName);
      if (el) {
        el.addEventListener('scroll', () => {
          this.scrollPositions[tabName] = el.scrollTop;
          this.savePopupState();
        }, { passive: true });
      }
    });
  }

  private restoreScrollPositions(): void {
    const el = this.getScrollContainer(this.activeTab);
    if (el) {
      const saved = this.scrollPositions[this.activeTab];
      if (typeof saved === 'number' && saved >= 0) {
        el.scrollTop = saved;
      }
    }
  }

  private translateTitles(): void {
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
      const key = element.getAttribute('data-i18n-title');
      if (key) {
        const translation = chrome.i18n.getMessage(key);
        if (translation) {
          element.setAttribute('title', translation);
        }
      }
    });
  }

  private switchTab(tabName: string): void {
    const isUserSwitch = tabName !== this.activeTab;
    if (isUserSwitch) {
      const scrollEl = this.getScrollContainer(this.activeTab);
      if (scrollEl) {
        this.scrollPositions[this.activeTab] = scrollEl.scrollTop;
      }
      this.activeTab = tabName;
      this.savePopupState();
    }

    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.getAttribute('data-tab-content') === tabName);
    });

    if (tabName === 'page-highlights') {
      this.loadPageHighlights();
    }
    requestAnimationFrame(() => this.restoreScrollPositions());
  }

  private setupEventListeners(): void {
    this.setupTabs();
    this.setupScrollListeners();
    this.setupSettingsOverlay();
    this.setupSettingsExportImport();
    this.setupListManagement();
    this.setupWordManagement();
    this.setupSettings();
    this.setupPageHighlights();
    this.setupExceptions();
    this.setupImportExport();
    this.setupTheme();
    this.setupStorageSync();
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

  private setupSettingsExportImport(): void {
    const importSettingsInput = document.getElementById('importSettingsInput') as HTMLInputElement;

    document.getElementById('exportSettingsBtn')?.addEventListener('click', () => {
      const data: ExportData = {
        lists: this.lists,
        exceptionsList: [...this.exceptionsList],
        exceptionsWhiteList: [...this.exceptionsWhiteList],
        exceptionsMode: this.exceptionsMode
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'goose-highlighter-settings.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('importSettingsBtn')?.addEventListener('click', () => {
      importSettingsInput?.click();
    });

    importSettingsInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const raw = event.target?.result as string;
          const data = JSON.parse(raw) as unknown;

          if (!data || typeof data !== 'object') {
            alert(chrome.i18n.getMessage('invalid_import_format') || 'Invalid file format. Please select a valid export file.');
            importSettingsInput.value = '';
            return;
          }

          const obj = data as Record<string, unknown>;
          let listsApplied = false;
          let exceptionsApplied = false;

          if (Array.isArray(obj.lists) && obj.lists.length > 0) {
            const baseId = Date.now();
            const validLists = obj.lists
              .filter((item: unknown) => this.isValidList(item))
              .map((item: HighlightList, i: number) => ({ ...item, id: baseId + i }));
            if (validLists.length > 0) {
              this.lists = validLists;
              this.currentListIndex = Math.min(this.currentListIndex, this.lists.length - 1);
              listsApplied = true;
            }
          }

          if (Array.isArray(obj.exceptionsList)) {
            this.exceptionsList = obj.exceptionsList.filter((d): d is string => typeof d === 'string');
            exceptionsApplied = true;
          }
          if (Array.isArray(obj.exceptionsWhiteList)) {
            this.exceptionsWhiteList = obj.exceptionsWhiteList.filter((d): d is string => typeof d === 'string');
            exceptionsApplied = true;
          }
          if (obj.exceptionsMode === 'whitelist' || obj.exceptionsMode === 'blacklist') {
            this.exceptionsMode = obj.exceptionsMode;
            exceptionsApplied = true;
          }

          if (!listsApplied && !exceptionsApplied) {
            alert(chrome.i18n.getMessage('invalid_import_format') || 'Invalid file format. Please select a valid export file.');
            importSettingsInput.value = '';
            return;
          }

          if (listsApplied && this.lists.length === 0) {
            this.lists.push({
              id: Date.now(),
              name: chrome.i18n.getMessage('default_list_name') || 'Default List',
              background: '#ffff00',
              foreground: '#000000',
              active: true,
              words: []
            });
          }

          await this.save();
          MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
          MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
          this.render();
          importSettingsInput.value = '';
        } catch (err) {
          alert((chrome.i18n.getMessage('invalid_json_error') || 'Invalid JSON file') + ': ' + (err as Error).message);
          importSettingsInput.value = '';
        }
      };
      reader.readAsText(file);
    });
  }

  private setupTabs(): void {
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', () => {
        const tabName = (button as HTMLElement).getAttribute('data-tab');
        if (tabName) this.switchTab(tabName);
      });
    });

    this.switchTab(this.activeTab);
  }

  private setupListManagement(): void {
    const dropdownBtn = document.getElementById('listDropdownBtn');
    const dropdownMenu = document.getElementById('listDropdownMenu');

    // Toggle dropdown
    dropdownBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu?.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      dropdownMenu?.classList.remove('open');
    });

    // Apply button for list settings
    document.getElementById('applyListSettingsBtn')?.addEventListener('click', () => {
      this.applyListSettings();
    });

    // Rename list
    document.getElementById('renameListBtn')?.addEventListener('click', () => {
      const newName = prompt(chrome.i18n.getMessage('enter_list_name') || 'Enter list name:', this.lists[this.currentListIndex].name);
      if (newName && newName.trim()) {
        this.lists[this.currentListIndex].name = newName.trim();
        this.save();
      }
    });

    // New list
    document.getElementById('newListBtn')?.addEventListener('click', () => {
      this.lists.push({
        id: Date.now(),
        name: chrome.i18n.getMessage('new_list_name') || 'New List',
        background: '#22c55e',
        foreground: '#000000',
        active: true,
        words: []
      });
      this.currentListIndex = this.lists.length - 1;
      this.savePopupState();
      this.save();
    });

    // Delete list
    document.getElementById('deleteListBtn')?.addEventListener('click', () => {
      if (this.lists.length <= 1) {
        alert(chrome.i18n.getMessage('cannot_delete_last_list') || 'Cannot delete the last list');
        return;
      }
      if (confirm(chrome.i18n.getMessage('confirm_delete_list') || 'Delete this list?')) {
        this.lists.splice(this.currentListIndex, 1);
        this.currentListIndex = Math.max(0, this.currentListIndex - 1);
        this.savePopupState();
        this.save();
      }
    });

    // Color picker text inputs sync
    const listBg = document.getElementById('listBg') as HTMLInputElement;
    const listBgText = document.getElementById('listBgText') as HTMLInputElement;
    const listFg = document.getElementById('listFg') as HTMLInputElement;
    const listFgText = document.getElementById('listFgText') as HTMLInputElement;

    listBg?.addEventListener('input', () => {
      if (listBgText) listBgText.value = listBg.value;
      this.updatePreview();
    });

    listBgText?.addEventListener('input', () => {
      if (listBg && /^#[0-9A-F]{6}$/i.test(listBgText.value)) {
        listBg.value = listBgText.value;
        this.updatePreview();
      }
    });

    listFg?.addEventListener('input', () => {
      if (listFgText) listFgText.value = listFg.value;
      this.updatePreview();
    });

    listFgText?.addEventListener('input', () => {
      if (listFg && /^#[0-9A-F]{6}$/i.test(listFgText.value)) {
        listFg.value = listFgText.value;
        this.updatePreview();
      }
    });
  }

  private setupWordManagement(): void {
    const bulkPaste = document.getElementById('bulkPaste') as HTMLTextAreaElement;
    const wordList = document.getElementById('wordList') as HTMLDivElement;
    const wordSearch = document.getElementById('wordSearch') as HTMLInputElement;

    document.getElementById('addWordsBtn')?.addEventListener('click', () => {
      const words = bulkPaste.value.split(/\n+/).map(w => w.trim()).filter(Boolean);
      const list = this.lists[this.currentListIndex];
      for (const w of words) {
        list.words.push({
          wordStr: w,
          background: '',
          foreground: '',
          active: true
        });
      }
      bulkPaste.value = '';
      this.save();
    });

    this.setupWordListEvents(wordList);

    wordSearch.addEventListener('input', (e) => {
      this.wordSearchQuery = (e.target as HTMLInputElement).value;
      this.currentPage = 1;
      this.savePopupState();
      this.renderWords();
    });
  }

  private setupWordListEvents(wordList: HTMLDivElement): void {
    wordList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const list = this.lists[this.currentListIndex];
      if (!list) return;

      // Handle 3-dot menu button click
      const menuBtn = target.closest('.word-item-menu-btn') as HTMLElement | null;
      if (menuBtn) {
        e.stopPropagation();
        const index = Number(menuBtn.dataset.index);
        if (!Number.isNaN(index)) {
          this.openWordItemMenu(index, menuBtn);
        }
        return;
      }

      // Handle edit button click
      const editBtn = target.closest('.word-item-icon-btn.edit-word-btn') as HTMLElement | null;
      if (editBtn) {
        e.stopPropagation();
        const index = Number(editBtn.dataset.index);
        if (!Number.isNaN(index)) {
          this.startEditingWord(index);
        }
        return;
      }

      // Don't select if clicking on color inputs or edit input
      if (target.tagName === 'INPUT') {
        if ((target as HTMLInputElement).type === 'color') {
          e.stopPropagation();
          return;
        }
        if (target.classList.contains('word-item-edit-input')) {
          e.stopPropagation();
          return;
        }
      }

      // Don't select if clicking inside word-actions area
      if (target.closest('.word-item-actions') && !target.classList.contains('word-item')) {
        return;
      }

      // Don't select if clicking on eye toggle
      if (target.closest('.word-item-eye-toggle')) {
        return;
      }

      // Handle word item selection
      const wordItem = target.closest('.word-item') as HTMLElement | null;
      if (!wordItem) return;

      const index = Number(wordItem.dataset.index);
      if (Number.isNaN(index)) return;

      const mouseEvent = e as MouseEvent;
      this.toggleWordSelection(index, mouseEvent.ctrlKey || mouseEvent.metaKey);
    });

    wordList.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const list = this.lists[this.currentListIndex];

      // Handle eye toggle (active/disabled)
      if (target.classList.contains('word-item-eye-input')) {
        const wordItem = target.closest('.word-item') as HTMLElement;
        if (wordItem) {
          const index = Number(wordItem.dataset.index);
          if (!Number.isNaN(index)) {
            const word = list.words[index];
            if (word) {
              word.active = target.checked;
              this.save();
            }
          }
        }
        return;
      }

      const index = +(target.dataset.bgEdit ?? target.dataset.fgEdit ?? -1);
      if (index === -1) return;

      const word = this.lists[this.currentListIndex].words[index];
      if (target.dataset.bgEdit != null) word.background = target.value;
      if (target.dataset.fgEdit != null) word.foreground = target.value;

      this.save();
    });

    wordList.addEventListener('keydown', (e) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains('word-item-edit-input')) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        target.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.renderWords();
      }
    });

    wordList.addEventListener('blur', (e) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains('word-item-edit-input')) return;

      const list = this.lists[this.currentListIndex];
      if (!list) return;

      const index = Number(target.dataset.wordEdit ?? -1);
      if (Number.isNaN(index) || index < 0) return;

      const word = list.words[index];
      if (!word) return;

      const newValue = target.value.trim();
      if (newValue && newValue !== word.wordStr) {
        word.wordStr = newValue;
        this.save();
      } else {
        this.renderWords();
      }
    }, true);

    let scrolling = false;
    wordList.addEventListener('scroll', () => {
      if (scrolling) return;
      scrolling = true;
      requestAnimationFrame(() => {
        this.renderWords();
        scrolling = false;
      });
    });
  }

  private toggleWordSelection(index: number, multiSelect: boolean): void {
    if (multiSelect) {
      // Ctrl/Cmd + click for multi-select
      if (this.selectedCheckboxes.has(index)) {
        this.selectedCheckboxes.delete(index);
      } else {
        this.selectedCheckboxes.add(index);
      }
    } else {
      // Regular click - clear all and select only this one
      this.selectedCheckboxes.clear();
      this.selectedCheckboxes.add(index);
    }
    this.renderWords();
  }

  private startEditingWord(index: number): void {
    const wordItem = document.querySelector(`.word-item[data-index="${index}"]`);
    if (!wordItem) return;

    const textSpan = wordItem.querySelector('.word-item-text') as HTMLElement;
    const input = wordItem.querySelector('.word-item-edit-input') as HTMLInputElement;
    if (!textSpan || !input) return;

    textSpan.style.display = 'none';
    input.style.display = 'block';
    input.focus();
    input.select();
  }

  /** Effective selection for menu actions: multiple selected ? those indices : [wordIndex]. */
  private getEffectiveSelectionForMenu(wordIndex: number): number[] {
    if (this.selectedCheckboxes.size > 1 && this.selectedCheckboxes.has(wordIndex)) {
      return Array.from(this.selectedCheckboxes);
    }
    return [wordIndex];
  }

  private openWordItemMenu(wordIndex: number, buttonEl: HTMLElement): void {
    const dropdown = document.getElementById('wordItemMenuDropdown');
    if (!dropdown) return;

    this.closeWordItemMenu();

    const effectiveIndices = this.getEffectiveSelectionForMenu(wordIndex);
    const isMultiple = effectiveIndices.length > 1;

    const rect = buttonEl.getBoundingClientRect();
    const padding = 8;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.right = '';

    const moveLabel = isMultiple
      ? (chrome.i18n.getMessage('move_selected') || 'Move selected')
      : (chrome.i18n.getMessage('move_to_list') || 'Move to list');
    const copyLabel = isMultiple
      ? (chrome.i18n.getMessage('copy_selected') || 'Copy selected')
      : (chrome.i18n.getMessage('copy_to_list') || 'Copy to list');
    const enableSelectedLabel = chrome.i18n.getMessage('enable_selected') || 'Enable selected';
    const disableSelectedLabel = chrome.i18n.getMessage('disable_selected') || 'Disable selected';
    const deleteLabel = isMultiple
      ? (chrome.i18n.getMessage('delete_selected') || 'Delete selected')
      : (chrome.i18n.getMessage('delete_selected') || 'Delete');

    const enableDisableItems = isMultiple
      ? `
      <button type="button" class="word-item-menu-item" data-action="enable">
        <i class="fa-solid fa-eye"></i>
        <span>${DOMUtils.escapeHtml(enableSelectedLabel)}</span>
      </button>
      <button type="button" class="word-item-menu-item" data-action="disable">
        <i class="fa-solid fa-eye-slash"></i>
        <span>${DOMUtils.escapeHtml(disableSelectedLabel)}</span>
      </button>
      `
      : '';

    dropdown.innerHTML = `
      <button type="button" class="word-item-menu-item" data-action="move">
        <i class="fa-solid fa-arrow-right"></i>
        <span>${DOMUtils.escapeHtml(moveLabel)}</span>
      </button>
      <button type="button" class="word-item-menu-item" data-action="copy">
        <i class="fa-solid fa-copy"></i>
        <span>${DOMUtils.escapeHtml(copyLabel)}</span>
      </button>
      ${enableDisableItems}
      <button type="button" class="word-item-menu-item danger" data-action="delete">
        <i class="fa-solid fa-trash"></i>
        <span>${DOMUtils.escapeHtml(deleteLabel)}</span>
      </button>
    `;

    dropdown.querySelectorAll('.word-item-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (item as HTMLElement).dataset.action;
        if (action === 'move') {
          this.showWordMenuListPickerForIndices(effectiveIndices, false);
        } else if (action === 'copy') {
          this.showWordMenuListPickerForIndices(effectiveIndices, true);
        } else if (action === 'enable') {
          this.setSelectedWordsActive(effectiveIndices, true);
          this.closeWordItemMenu();
          this.save();
          this.renderWords();
        } else if (action === 'disable') {
          this.setSelectedWordsActive(effectiveIndices, false);
          this.closeWordItemMenu();
          this.save();
          this.renderWords();
        } else if (action === 'delete') {
          if (confirm(chrome.i18n.getMessage('confirm_delete_words') || 'Delete selected words?')) {
            this.deleteWordsByIndices(effectiveIndices);
            this.selectedCheckboxes.clear();
            this.closeWordItemMenu();
            this.save();
            this.renderWords();
          }
        }
      });
    });

    this.wordMenuOpenForIndex = wordIndex;
    this.wordMenuCopyOnly = false;
    dropdown.classList.add('open');
    dropdown.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
      const dr = dropdown.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (dr.right > vw - padding) {
        dropdown.style.left = `${vw - dr.width - padding}px`;
      }
      if (dr.left < padding) {
        dropdown.style.left = `${padding}px`;
      }
      if (dr.bottom > vh - padding) {
        dropdown.style.top = `${vh - dr.height - padding}px`;
      }
      if (dr.top < padding) {
        dropdown.style.top = `${padding}px`;
      }
    });

    const closeHandler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdown.contains(target) || buttonEl.contains(target)) return;
      this.closeWordItemMenu();
      document.removeEventListener('click', closeHandler);
      this.wordMenuCloseListener = null;
    };
    this.wordMenuCloseListener = () => {
      document.removeEventListener('click', closeHandler);
      this.wordMenuCloseListener = null;
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  private showWordMenuListPickerForIndices(indices: number[], copyOnly: boolean): void {
    const dropdown = document.getElementById('wordItemMenuDropdown');
    if (!dropdown || this.wordMenuOpenForIndex === null) return;

    this.wordMenuCopyOnly = copyOnly;
    const otherLists = this.lists
      .map((list, index) => ({ list, index }))
      .filter(({ index }) => index !== this.currentListIndex);

    if (otherLists.length === 0) {
      const noOtherLabel = chrome.i18n.getMessage('no_other_lists') || 'No other lists';
      dropdown.innerHTML = `
        <div class="word-item-menu-item disabled">
          <span>${DOMUtils.escapeHtml(noOtherLabel)}</span>
        </div>
      `;
      return;
    }

    dropdown.innerHTML = otherLists.map(({ list, index }) => `
      <button type="button" class="word-item-menu-item" data-target-index="${index}">
        <span class="list-color-indicator" style="background-color: ${DOMUtils.escapeHtml(list.background)}"></span>
        <span>${DOMUtils.escapeHtml(list.name)}</span>
      </button>
    `).join('');

    dropdown.querySelectorAll('.word-item-menu-item[data-target-index]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetIndex = Number((item as HTMLElement).dataset.targetIndex);
        if (Number.isNaN(targetIndex)) return;
        if (this.wordMenuCopyOnly) {
          this.copyWordsToOtherList(indices, targetIndex);
        } else {
          this.moveWordsToOtherList(indices, targetIndex);
        }
        this.closeWordItemMenu();
        this.save();
        this.renderWords();
        this.renderLists();
      });
    });
  }

  private setSelectedWordsActive(indices: number[], active: boolean): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;
    indices.forEach(index => {
      const word = list.words[index];
      if (word) word.active = active;
    });
  }

  private deleteWordsByIndices(indices: number[]): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;
    const toDelete = new Set(indices);
    this.lists[this.currentListIndex].words = list.words.filter((_, i) => !toDelete.has(i));
  }

  private moveWordsToOtherList(indices: number[], targetListIndex: number): void {
    const list = this.lists[this.currentListIndex];
    const targetList = this.lists[targetListIndex];
    if (!list || !targetList) return;
    const sorted = [...indices].sort((a, b) => b - a);
    const wordsToMove = sorted.map(i => list.words[i]).filter(Boolean);
    sorted.forEach(i => list.words.splice(i, 1));
    targetList.words.push(...wordsToMove);
  }

  private copyWordsToOtherList(indices: number[], targetListIndex: number): void {
    const list = this.lists[this.currentListIndex];
    const targetList = this.lists[targetListIndex];
    if (!list || !targetList) return;
    indices.forEach(index => {
      const word = list.words[index];
      if (word) targetList.words.push({ ...word });
    });
  }

  private closeWordItemMenu(): void {
    const dropdown = document.getElementById('wordItemMenuDropdown');
    if (dropdown) {
      dropdown.classList.remove('open');
      dropdown.setAttribute('aria-hidden', 'true');
      dropdown.innerHTML = '';
    }
    this.wordMenuOpenForIndex = null;
    if (this.wordMenuCloseListener) {
      this.wordMenuCloseListener();
    }
  }

  private setupSettings(): void {
    const globalToggle = document.getElementById('globalHighlightToggle') as HTMLInputElement;
    const matchCase = document.getElementById('matchCase') as HTMLInputElement;
    const matchWhole = document.getElementById('matchWhole') as HTMLInputElement;

    globalToggle?.addEventListener('change', async () => {
      this.globalHighlightEnabled = globalToggle.checked;
      await StorageService.update('globalHighlightEnabled', this.globalHighlightEnabled);
      MessageService.sendToAllTabs({
        type: 'GLOBAL_TOGGLE_UPDATED',
        enabled: this.globalHighlightEnabled
      });
    });

    matchCase?.addEventListener('change', async () => {
      this.matchCaseEnabled = matchCase.checked;
      await StorageService.update('matchCaseEnabled', this.matchCaseEnabled);
      MessageService.sendToAllTabs({
        type: 'MATCH_OPTIONS_UPDATED',
        matchCase: this.matchCaseEnabled,
        matchWhole: this.matchWholeEnabled
      });
    });

    matchWhole?.addEventListener('change', async () => {
      this.matchWholeEnabled = matchWhole.checked;
      await StorageService.update('matchWholeEnabled', this.matchWholeEnabled);
      MessageService.sendToAllTabs({
        type: 'MATCH_OPTIONS_UPDATED',
        matchCase: this.matchCaseEnabled,
        matchWhole: this.matchWholeEnabled
      });
    });
  }

  private setupPageHighlights(): void {
    document.getElementById('pageHighlightsList')?.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      const groupHeader = target.closest('.page-highlights-group-header');
      if (groupHeader) {
        const section = groupHeader.closest('.page-highlights-group-section');
        const groupKey = section?.getAttribute('data-group');
        if (groupKey) {
          if (this.pageHighlightsCollapsedGroups.has(groupKey)) {
            this.pageHighlightsCollapsedGroups.delete(groupKey);
          } else {
            this.pageHighlightsCollapsedGroups.add(groupKey);
          }
          this.renderPageHighlights();
          return;
        }
      }

      const item = target.closest('.page-highlight-item') as HTMLElement;
      if (!item) return;

      const word = item.dataset.word;
      if (!word) return;

      const button = target.closest('button');

      if (button?.classList.contains('highlight-prev')) {
        e.stopPropagation();
        await this.navigateHighlight(word, -1);
      } else if (button?.classList.contains('highlight-next')) {
        e.stopPropagation();
        await this.navigateHighlight(word, 1);
      } else if (!button) {
        const currentIndex = this.highlightIndices.get(word) || 0;
        await this.jumpToHighlight(word, currentIndex);
      }
    });

    document.getElementById('pageHighlightsGroupByList')?.addEventListener('change', (e) => {
      this.pageHighlightsGroupByList = (e.target as HTMLInputElement).checked;
      this.savePopupState();
      this.renderPageHighlights();
    });
  }

  private async loadPageHighlights(): Promise<void> {
    try {
      const response = await MessageService.sendToActiveTab({ type: 'GET_PAGE_HIGHLIGHTS' });

      if (response && response.highlights) {
        this.pageHighlights = response.highlights.map((h: { word: string; count: number; background: string; foreground: string; listId?: number; listName?: string; listNames?: string[] }) => ({
          ...h,
          listNames: h.listNames || (h.listName ? [h.listName] : [])
        }));
        this.pageHighlightsActiveLists = response.lists || [];
        const listIdsOnPage = this.getListIdsWithMatchesOnPage();
        if (listIdsOnPage.size > 0) {
          this.pageHighlightsListFilter = new Set(listIdsOnPage);
        }
        this.highlightIndices.clear();
        this.pageHighlights.forEach(h => this.highlightIndices.set(h.word, 0));
        this.renderPageHighlights();
        this.renderPageHighlightsFilters();
      }
    } catch (e) {
      console.error('Error loading page highlights:', e);
      this.pageHighlights = [];
      this.pageHighlightsActiveLists = [];
      this.renderPageHighlights();
      this.renderPageHighlightsFilters();
    }
  }

  private async jumpToHighlight(word: string, index: number): Promise<void> {
    this.highlightIndices.set(word, index);
    await MessageService.sendToActiveTab({
      type: 'SCROLL_TO_HIGHLIGHT',
      word,
      index
    });
    this.renderPageHighlights();
  }

  private async navigateHighlight(word: string, direction: number): Promise<void> {
    const highlight = this.pageHighlights.find(h => h.word === word);
    if (!highlight) return;

    const currentIndex = this.highlightIndices.get(word) || 0;
    let newIndex = currentIndex + direction;

    if (newIndex < 0) newIndex = highlight.count - 1;
    if (newIndex >= highlight.count) newIndex = 0;

    await this.jumpToHighlight(word, newIndex);
  }

  private passesListFilter(h: { listId?: number; listNames: string[] }): boolean {
    if (this.pageHighlightsListFilter.size === 0) return true;
    if (this.pageHighlightsListFilter.has(-1)) return false;
    const wordListIds = new Set<number>();
    if (h.listId !== undefined) wordListIds.add(h.listId);
    for (const name of h.listNames) {
      const list = this.pageHighlightsActiveLists.find(l => l.name === name);
      if (list) wordListIds.add(list.id);
    }
    return [...wordListIds].some(id => this.pageHighlightsListFilter.has(id));
  }

  private renderPageHighlightsItem(highlight: { word: string; count: number; background: string; foreground: string; listNames: string[] }): string {
    const currentIndex = this.highlightIndices.get(highlight.word) || 0;
    return `
      <div class="page-highlight-item" data-word="${DOMUtils.escapeHtml(highlight.word)}" style="border-left-color: ${highlight.background}; --item-tint: ${highlight.background};">
        <div class="page-highlight-word">
          <span class="page-highlight-preview">
            <span class="preview-dot" style="background-color: ${highlight.background};"></span>
            ${DOMUtils.escapeHtml(highlight.word)}
          </span>
          ${highlight.count > 1 ? `<span class="page-highlight-position">${currentIndex + 1}/${highlight.count}</span>` : ''}
        </div>
        ${highlight.count > 1 ? `
          <div class="page-highlight-nav">
            <button class="highlight-prev" title="${chrome.i18n.getMessage('previous') || 'Previous'}">
              <i class="fa-solid fa-chevron-up"></i>
            </button>
            <button class="highlight-next" title="${chrome.i18n.getMessage('next') || 'Next'}">
              <i class="fa-solid fa-chevron-down"></i>
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderPageHighlights(): void {
    const container = document.getElementById('pageHighlightsList');
    const countElement = document.getElementById('totalHighlightsCount');

    if (!container || !countElement) return;

    const filtered = this.pageHighlights.filter(h => this.passesListFilter(h));
    const totalCount = filtered.reduce((sum, h) => sum + h.count, 0);
    countElement.textContent = totalCount.toString();

    if (filtered.length === 0) {
      container.innerHTML = `<div class="page-highlights-empty">${chrome.i18n.getMessage('no_highlights_on_page') || 'No highlights on this page'}</div>`;
      return;
    }

    if (this.pageHighlightsGroupByList && this.pageHighlightsActiveLists.length > 0) {
      const listIds = new Set(this.pageHighlightsActiveLists.map(l => l.id).filter(id => this.pageHighlightsListFilter.has(id) || this.pageHighlightsListFilter.size === 0));
      const groupOrder = this.pageHighlightsActiveLists.filter(l => listIds.has(l.id));
      let html = '';
      for (const list of groupOrder) {
        const items = filtered.filter(h => h.listId === list.id || (h.listNames && h.listNames.includes(list.name)));
        if (items.length === 0) continue;
        const groupKey = `list-${list.id}`;
        const collapsed = this.pageHighlightsCollapsedGroups.has(groupKey);
        const chevron = collapsed ? 'fa-chevron-right' : 'fa-chevron-down';
        html += `
          <div class="page-highlights-group-section ${collapsed ? 'collapsed' : ''}" data-group="${groupKey}">
            <div class="page-highlights-group-header">
              <i class="fa-solid ${chevron}"></i>
              <span class="group-dot" style="background-color: ${list.background};"></span>
              <span>${DOMUtils.escapeHtml(list.name)}</span>
              <span style="opacity: 0.6; margin-left: 4px;">(${items.reduce((s, i) => s + i.count, 0)})</span>
            </div>
            ${collapsed ? '' : items.map(h => this.renderPageHighlightsItem(h)).join('')}
          </div>
        `;
      }
      const ungrouped = filtered.filter(h => !groupOrder.some(l => h.listId === l.id || (h.listNames && h.listNames.includes(l.name))));
      if (ungrouped.length > 0) {
        const groupKey = 'list-other';
        const collapsed = this.pageHighlightsCollapsedGroups.has(groupKey);
        const chevron = collapsed ? 'fa-chevron-right' : 'fa-chevron-down';
        html += `
          <div class="page-highlights-group-section ${collapsed ? 'collapsed' : ''}" data-group="${groupKey}">
            <div class="page-highlights-group-header">
              <i class="fa-solid ${chevron}"></i>
              <span style="opacity: 0.6;">${chrome.i18n.getMessage('other') || 'Other'}</span>
            </div>
            ${collapsed ? '' : ungrouped.map(h => this.renderPageHighlightsItem(h)).join('')}
          </div>
        `;
      }
      container.innerHTML = html;
    } else {
      container.innerHTML = filtered.map(h => this.renderPageHighlightsItem(h)).join('');
    }

    if (this.activeTab === 'page-highlights') {
      requestAnimationFrame(() => this.restoreScrollPositions());
    }
  }

  private static readonly PAGE_HIGHLIGHTS_MANY_LISTS_THRESHOLD = 8;

  /** List IDs that have at least one highlight on the current page (from pageHighlights). */
  private getListIdsWithMatchesOnPage(): Set<number> {
    const ids = new Set<number>();
    for (const h of this.pageHighlights) {
      if (h.listId !== undefined) ids.add(h.listId);
      for (const name of h.listNames) {
        const list = this.pageHighlightsActiveLists.find(l => l.name === name);
        if (list) ids.add(list.id);
      }
    }
    return ids;
  }

  /** Lists that have at least one word found on the current page (for filter chips only). */
  private getListsWithMatchesOnPage(): Array<{ id: number; name: string; background: string }> {
    const ids = this.getListIdsWithMatchesOnPage();
    return this.pageHighlightsActiveLists.filter(l => ids.has(l.id));
  }

  private renderPageHighlightsFilters(): void {
    const container = document.getElementById('pageHighlightsListFilters');
    const actionsEl = document.getElementById('pageHighlightsFiltersActions');
    if (!container) return;
    const listsOnPage = this.getListsWithMatchesOnPage();
    if (listsOnPage.length <= 1) {
      container.innerHTML = '';
      if (actionsEl) {
        actionsEl.innerHTML = '';
        actionsEl.hidden = true;
      }
      return;
    }

    const isNone = this.pageHighlightsListFilter.size === 1 && this.pageHighlightsListFilter.has(-1);
    const allSelected = !isNone && (this.pageHighlightsListFilter.size === 0 || this.pageHighlightsListFilter.size === listsOnPage.length);
    const showQuickActions = listsOnPage.length > PopupController.PAGE_HIGHLIGHTS_MANY_LISTS_THRESHOLD;

    if (actionsEl) {
      if (showQuickActions) {
        const allLabel = chrome.i18n.getMessage('select_all') || 'Select all';
        const noneLabel = chrome.i18n.getMessage('deselect_all') || 'Deselect all';
        actionsEl.innerHTML = `
          <button type="button" class="page-highlights-filter-link" data-filter-action="all">${DOMUtils.escapeHtml(allLabel)}</button>
          <span aria-hidden="true"> · </span>
          <button type="button" class="page-highlights-filter-link" data-filter-action="none">${DOMUtils.escapeHtml(noneLabel)}</button>
        `;
        actionsEl.hidden = false;
        actionsEl.querySelectorAll('.page-highlights-filter-link').forEach(btn => {
          btn.addEventListener('click', () => {
            const action = (btn as HTMLElement).dataset.filterAction;
            if (action === 'all') {
              this.pageHighlightsListFilter = new Set();
            } else if (action === 'none') {
              this.pageHighlightsListFilter = new Set([-1]);
            }
            this.savePopupState();
            this.renderPageHighlights();
            this.renderPageHighlightsFilters();
          });
        });
      } else {
        actionsEl.innerHTML = '';
        actionsEl.hidden = true;
      }
    }

    const active = (listId: number) =>
      !isNone && (this.pageHighlightsListFilter.size === 0 || this.pageHighlightsListFilter.has(listId));

    container.innerHTML = listsOnPage.map(list => {
      const chipActive = active(list.id);
      const bg = DOMUtils.escapeHtml(list.background);
      return `
        <button type="button" class="page-highlights-filter-chip ${chipActive ? 'active' : ''}" data-list-id="${list.id}" title="${DOMUtils.escapeHtml(list.name)}" style="--list-color: ${bg};">
          <span class="filter-dot" style="background-color: ${bg};"></span>
          <span>${DOMUtils.escapeHtml(list.name)}</span>
        </button>
      `;
    }).join('');

    container.querySelectorAll('.page-highlights-filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.listId);
        const listIdsOnPage = this.getListIdsWithMatchesOnPage();
        const allSelected = this.pageHighlightsListFilter.size === 0;
        if (this.pageHighlightsListFilter.has(id)) {
          this.pageHighlightsListFilter.delete(id);
          if (this.pageHighlightsListFilter.size === 0) {
            this.pageHighlightsListFilter = new Set();
          }
        } else {
          if (allSelected) {
            this.pageHighlightsListFilter = new Set(listIdsOnPage);
            this.pageHighlightsListFilter.delete(id);
          } else {
            this.pageHighlightsListFilter.add(id);
          }
        }
        if (this.pageHighlightsListFilter.has(-1)) {
          this.pageHighlightsListFilter.delete(-1);
        }
        this.savePopupState();
        this.renderPageHighlights();
        this.renderPageHighlightsFilters();
      });
    });
  }

  private setupExceptions(): void {
    document.getElementById('exceptionsModeSelect')?.addEventListener('change', async (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.exceptionsMode = value === 'whitelist' ? 'whitelist' : 'blacklist';
      await StorageService.update('exceptionsMode', this.exceptionsMode);
      MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
      this.updateExceptionsModeLabel();
      this.updateExceptionsModeHint();
      this.renderExceptions();
      this.updateAddCurrentSiteButton();
    });

    document.getElementById('addExceptionBtn')?.addEventListener('click', () => this.addExceptionFromInput());
    document.getElementById('addCurrentSiteBtn')?.addEventListener('click', () => this.addCurrentSiteToExceptions());
    (document.getElementById('exceptionDomainInput') as HTMLInputElement)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addExceptionFromInput();
    });

    document.getElementById('clearExceptionsBtn')?.addEventListener('click', async () => {
      if (confirm(chrome.i18n.getMessage('confirm_clear_exceptions') || 'Clear all exceptions?')) {
        if (this.exceptionsMode === 'whitelist') {
          this.exceptionsWhiteList = [];
        } else {
          this.exceptionsList = [];
        }
        this.renderExceptions();
        this.updateAddCurrentSiteButton();
        await StorageService.set({
          exceptionsList: this.exceptionsList,
          exceptionsWhiteList: this.exceptionsWhiteList
        });
        MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
      }
    });

    document.getElementById('exceptionsList')?.addEventListener('click', async (e) => {
      const button = (e.target as HTMLElement).closest('.exception-remove');
      if (button) {
        const domain = (button as HTMLElement).dataset.domain!;
        if (this.exceptionsMode === 'whitelist') {
          this.exceptionsWhiteList = this.exceptionsWhiteList.filter(d => d !== domain);
        } else {
          this.exceptionsList = this.exceptionsList.filter(d => d !== domain);
        }
        this.renderExceptions();
        this.updateAddCurrentSiteButton();
        await StorageService.set({
          exceptionsList: this.exceptionsList,
          exceptionsWhiteList: this.exceptionsWhiteList
        });
        MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
      }
    });
  }

  private setupImportExport(): void {
    const importListInput = document.getElementById('importListInput') as HTMLInputElement;

    document.getElementById('exportListBtn')?.addEventListener('click', () => {
      const list = this.lists[this.currentListIndex];
      if (!list) return;
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (list.name || 'list').replace(/[^a-zA-Z0-9-_]/g, '-');
      a.download = `${safeName}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('importListBtn')?.addEventListener('click', () => {
      importListInput?.click();
    });

    importListInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          const toAdd: HighlightList[] = [];

          if (Array.isArray(data)) {
            data.forEach((item: unknown) => {
              if (this.isValidList(item)) toAdd.push(item as HighlightList);
            });
          } else if (data && typeof data === 'object') {
            if (Array.isArray(data.lists)) {
              data.lists.forEach((item: unknown) => {
                if (this.isValidList(item)) toAdd.push(item as HighlightList);
              });
            } else if (this.isValidList(data)) {
              toAdd.push(data as HighlightList);
            }
          }

          if (toAdd.length === 0) {
            alert(chrome.i18n.getMessage('invalid_import_format') || 'Invalid list format. Please select a valid list file.');
            return;
          }
          const baseId = Date.now();
          toAdd.forEach((l, i) => {
            this.lists.push({ ...l, id: baseId + i });
          });
          this.save();
          this.renderLists();
        } catch (err) {
          alert(chrome.i18n.getMessage('invalid_json_error') + ': ' + (err as Error).message);
        }
      };
      reader.readAsText(file);
      importListInput.value = '';
    });
  }

  private isValidList(obj: unknown): obj is HighlightList {
    if (!obj || typeof obj !== 'object') return false;
    const o = obj as Record<string, unknown>;
    return (
      typeof o.name === 'string' &&
      Array.isArray(o.words) &&
      (typeof o.background === 'string' || typeof o.background === 'undefined') &&
      (typeof o.foreground === 'string' || typeof o.foreground === 'undefined')
    );
  }

  private setupTheme(): void {
    const themeToggle = document.getElementById('themeToggle') as HTMLInputElement;
    
    // Load saved theme
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

    // Setup toggle listener
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

  private applyListSettings(): void {
    const listBg = document.getElementById('listBg') as HTMLInputElement;
    const listFg = document.getElementById('listFg') as HTMLInputElement;
    const listActive = document.getElementById('listActive') as HTMLInputElement;

    this.lists[this.currentListIndex].background = listBg.value;
    this.lists[this.currentListIndex].foreground = listFg.value;
    this.lists[this.currentListIndex].active = listActive.checked;

    this.save();
  }

  private updatePreview(): void {
    const listBg = document.getElementById('listBg') as HTMLInputElement;
    const listFg = document.getElementById('listFg') as HTMLInputElement;
    const preview = document.getElementById('previewHighlight') as HTMLElement;

    if (preview && listBg && listFg) {
      preview.style.backgroundColor = listBg.value;
      preview.style.color = listFg.value;
    }
  }

  private async save(): Promise<void> {
    await StorageService.set({
      lists: this.lists,
      globalHighlightEnabled: this.globalHighlightEnabled,
      matchCaseEnabled: this.matchCaseEnabled,
      matchWholeEnabled: this.matchWholeEnabled,
      exceptionsList: this.exceptionsList,
      exceptionsWhiteList: this.exceptionsWhiteList,
      exceptionsMode: this.exceptionsMode
    });

    this.renderLists();
    MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
  }

  private setupStorageSync(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.lists || changes.globalHighlightEnabled || changes.matchCaseEnabled || changes.matchWholeEnabled || changes.exceptionsList || changes.exceptionsWhiteList || changes.exceptionsMode) {
        this.reloadFromStorage();
      }
    });
  }

  private async reloadFromStorage(): Promise<void> {
    const data = await StorageService.get();
    this.lists = data.lists || [];
    this.globalHighlightEnabled = data.globalHighlightEnabled ?? true;
    this.matchCaseEnabled = data.matchCaseEnabled ?? false;
    this.matchWholeEnabled = data.matchWholeEnabled ?? false;
    this.exceptionsList = data.exceptionsList || [];
    this.exceptionsWhiteList = data.exceptionsWhiteList || [];
    this.exceptionsMode = data.exceptionsMode === 'whitelist' ? 'whitelist' : 'blacklist';

    if (this.lists.length === 0) {
      this.lists.push({
        id: Date.now(),
        name: chrome.i18n.getMessage('default_list_name') || 'Default List',
        background: '#ffff00',
        foreground: '#000000',
        active: true,
        words: []
      });
    }

    this.currentListIndex = Math.min(this.currentListIndex, this.lists.length - 1);
    this.render();
  }





  private render(): void {
    this.renderLists();
    this.renderWords();
    this.renderExceptions();
    this.updateExceptionsModeSelect();
    this.updateExceptionsModeLabel();
    this.updateExceptionsModeHint();
    this.updateAddCurrentSiteButton();
    this.updateFormValues();
  }

  private renderLists(): void {
    const currentListName = document.getElementById('currentListName');
    const currentListColor = document.getElementById('currentListColor') as HTMLElement;
    const dropdownMenu = document.getElementById('listDropdownMenu');

    const list = this.lists[this.currentListIndex];

    // Update current list display
    if (currentListName) {
      currentListName.textContent = list.name;
    }
    if (currentListColor) {
      currentListColor.style.backgroundColor = list.background;
    }

    // Update dropdown menu
    if (dropdownMenu) {
      dropdownMenu.innerHTML = this.lists.map((l, index) => `
        <div class="list-dropdown-item ${index === this.currentListIndex ? 'selected' : ''}" data-index="${index}">
          <div class="list-color-indicator" style="background-color: ${l.background}"></div>
          <span>${DOMUtils.escapeHtml(l.name)}</span>
          ${index === this.currentListIndex ? '<i class="fa-solid fa-check list-dropdown-item-check"></i>' : ''}
        </div>
      `).join('');

      // Add click handlers to dropdown items
      dropdownMenu.querySelectorAll('.list-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const index = Number((item as HTMLElement).dataset.index);
          if (!Number.isNaN(index)) {
            this.selectedCheckboxes.clear();
            this.currentListIndex = index;
            this.currentPage = 1;
            this.savePopupState();
            this.renderWords();
            this.updateListForm();
            this.renderLists();
            dropdownMenu.classList.remove('open');
          }
        });
      });
    }

    this.updateListForm();
  }

  private updateListForm(): void {
    const list = this.lists[this.currentListIndex];
    const listBg = document.getElementById('listBg') as HTMLInputElement;
    const listBgText = document.getElementById('listBgText') as HTMLInputElement;
    const listFg = document.getElementById('listFg') as HTMLInputElement;
    const listFgText = document.getElementById('listFgText') as HTMLInputElement;
    const listActive = document.getElementById('listActive') as HTMLInputElement;

    if (listBg) listBg.value = list.background;
    if (listBgText) listBgText.value = list.background;
    if (listFg) listFg.value = list.foreground;
    if (listFgText) listFgText.value = list.foreground;
    if (listActive) listActive.checked = list.active;

    this.updatePreview();
  }

  private renderWords(): void {
    this.closeWordItemMenu();
    const list = this.lists[this.currentListIndex];
    const wordList = document.getElementById('wordList') as HTMLDivElement;

    let filteredWords = list.words;
    if (this.wordSearchQuery.trim()) {
      const q = this.wordSearchQuery.trim().toLowerCase();
      filteredWords = list.words.filter(w => w.wordStr.toLowerCase().includes(q));
    }

    this.totalWords = filteredWords.length;

    if (filteredWords.length === 0) {
      wordList.innerHTML = '<div class="word-list-empty">No words found</div>';
      const wordCount = document.getElementById('wordCount');
      if (wordCount) wordCount.textContent = '0';
      this.renderPaginationControls();
      return;
    }

    const totalPages = Math.ceil(this.totalWords / this.pageSize);
    if (this.currentPage > totalPages) {
      this.currentPage = Math.max(1, totalPages);
      this.savePopupState();
    }
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = Math.min(startIndex + this.pageSize, this.totalWords);
    const paginatedWords = filteredWords.slice(startIndex, endIndex);

    wordList.innerHTML = paginatedWords.map(w => {
      const realIndex = list.words.indexOf(w);
      const isSelected = this.selectedCheckboxes.has(realIndex);
      return this.createWordItemHTML(w, realIndex, isSelected);
    }).join('');

    const wordCount = document.getElementById('wordCount');
    if (wordCount) {
      wordCount.textContent = this.totalWords.toString();
    }

    this.renderPaginationControls();
  }

  private renderPaginationControls(): void {
    const paginationContainer = document.getElementById('paginationControls');
    if (!paginationContainer) return;

    const totalPages = Math.ceil(this.totalWords / this.pageSize);

    if (totalPages <= 1) {
      paginationContainer.style.display = 'none';
      return;
    }

    const startItem = (this.currentPage - 1) * this.pageSize + 1;
    const endItem = Math.min(this.currentPage * this.pageSize, this.totalWords);

    const showingText = chrome.i18n.getMessage('showing_items')
      ?.replace('{start}', String(startItem))
      .replace('{end}', String(endItem))
      .replace('{total}', String(this.totalWords))
      || `Showing ${startItem}-${endItem} of ${this.totalWords} words`;

    const pageInfoText = chrome.i18n.getMessage('page_info')
      ?.replace('{current}', String(this.currentPage))
      .replace('{total}', String(totalPages))
      || `Page ${this.currentPage} of ${totalPages}`;

    const firstPageTitle = chrome.i18n.getMessage('first_page') || 'First page';
    const prevPageTitle = chrome.i18n.getMessage('previous_page') || 'Previous page';
    const nextPageTitle = chrome.i18n.getMessage('next_page') || 'Next page';
    const lastPageTitle = chrome.i18n.getMessage('last_page') || 'Last page';

    paginationContainer.style.display = 'flex';
    paginationContainer.innerHTML = `
      <div class="pagination-info">
        ${showingText}
      </div>
      <div class="pagination-controls">
        <button class="pagination-btn" id="firstPageBtn" ${this.currentPage === 1 ? 'disabled' : ''} title="${firstPageTitle}">
          <i class="fa-solid fa-angles-left"></i>
        </button>
        <button class="pagination-btn" id="prevPageBtn" ${this.currentPage === 1 ? 'disabled' : ''} title="${prevPageTitle}">
          <i class="fa-solid fa-angle-left"></i>
        </button>
        <div class="pagination-pages">
          <span class="page-info">${pageInfoText}</span>
        </div>
        <button class="pagination-btn" id="nextPageBtn" ${this.currentPage === totalPages ? 'disabled' : ''} title="${nextPageTitle}">
          <i class="fa-solid fa-angle-right"></i>
        </button>
        <button class="pagination-btn" id="lastPageBtn" ${this.currentPage === totalPages ? 'disabled' : ''} title="${lastPageTitle}">
          <i class="fa-solid fa-angles-right"></i>
        </button>
      </div>
    `;

    this.setupPaginationEventListeners();
  }

  private setupPaginationEventListeners(): void {
    document.getElementById('firstPageBtn')?.addEventListener('click', () => {
      this.goToPage(1);
    });

    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
      this.goToPage(this.currentPage - 1);
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
      this.goToPage(this.currentPage + 1);
    });

    document.getElementById('lastPageBtn')?.addEventListener('click', () => {
      const totalPages = Math.ceil(this.totalWords / this.pageSize);
      this.goToPage(totalPages);
    });
  }

  private goToPage(page: number): void {
    const totalPages = Math.ceil(this.totalWords / this.pageSize);
    if (page < 1 || page > totalPages) return;

    this.currentPage = page;
    this.savePopupState();
    this.renderWords();
  }

  private createWordItemHTML(word: HighlightWord, realIndex: number, isSelected: boolean): string {
    const list = this.lists[this.currentListIndex];
    const bgColor = word.background || list.background;
    const fgColor = word.foreground || list.foreground;
    const menuTitle = chrome.i18n.getMessage('word_actions') || 'Actions';

    return `
      <div class="word-item ${isSelected ? 'selected' : ''}" data-index="${realIndex}">
        <span class="word-item-text">${DOMUtils.escapeHtml(word.wordStr)}</span>
        <input type="text" class="word-item-edit-input" value="${DOMUtils.escapeHtml(word.wordStr)}" data-word-edit="${realIndex}" style="display: none;">
        <div class="word-item-actions">
          <button class="word-item-icon-btn edit-word-btn" data-index="${realIndex}" title="${chrome.i18n.getMessage('edit') || 'Edit'}">
            <i class="fa-solid fa-pen"></i>
          </button>
          <input type="color" value="${bgColor}" data-bg-edit="${realIndex}" class="word-item-color-picker" title="${chrome.i18n.getMessage('background_color_title') || 'Background color'}">
          <input type="color" value="${fgColor}" data-fg-edit="${realIndex}" class="word-item-color-picker" title="${chrome.i18n.getMessage('text_color_title') || 'Text color'}">
          <label class="word-item-eye-toggle" title="${chrome.i18n.getMessage('toggle_active') || 'Toggle active'}" aria-label="${chrome.i18n.getMessage('toggle_active') || 'Toggle active'}">
            <input type="checkbox" class="word-item-eye-input" ${word.active !== false ? 'checked' : ''} data-index="${realIndex}">
            <span class="word-item-eye-icon">
              <i class="fa-solid fa-eye eye-active"></i>
              <i class="fa-solid fa-eye-slash eye-disabled"></i>
            </span>
          </label>
          <button type="button" class="word-item-icon-btn word-item-menu-btn" data-index="${realIndex}" title="${DOMUtils.escapeHtml(menuTitle)}" aria-label="${DOMUtils.escapeHtml(menuTitle)}">
            <i class="fa-solid fa-ellipsis-v"></i>
          </button>
        </div>
      </div>
    `;
  }

  private normalizeDomain(input: string): string | null {
    const raw = input.trim().toLowerCase();
    if (!raw) return null;
    try {
      if (raw.includes('.')) {
        const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`);
        return url.hostname;
      }
      return raw;
    } catch {
      return raw;
    }
  }

  private addExceptionFromInput(): void {
    const input = document.getElementById('exceptionDomainInput') as HTMLInputElement;
    if (!input) return;

    const domain = this.normalizeDomain(input.value);
    if (!domain) return;

    const list = this.getCurrentExceptionsList();
    if (list.includes(domain)) {
      input.value = '';
      return;
    }

    if (this.exceptionsMode === 'whitelist') {
      this.exceptionsWhiteList.push(domain);
    } else {
      this.exceptionsList.push(domain);
    }
    input.value = '';
    this.renderExceptions();
    StorageService.set({
      exceptionsList: this.exceptionsList,
      exceptionsWhiteList: this.exceptionsWhiteList
    }).then(() => {
      MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
    });
  }

  private async addCurrentSiteToExceptions(): Promise<void> {
    let host = this.currentTabHost;
    if (!host) {
      await this.getCurrentTab();
      host = this.currentTabHost;
    }
    if (!host) return;
    const domain = host.toLowerCase();
    const list = this.getCurrentExceptionsList();
    if (list.includes(domain)) return;
    if (this.exceptionsMode === 'whitelist') {
      this.exceptionsWhiteList.push(domain);
    } else {
      this.exceptionsList.push(domain);
    }
    this.renderExceptions();
    await StorageService.set({
      exceptionsList: this.exceptionsList,
      exceptionsWhiteList: this.exceptionsWhiteList
    });
    MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
    this.updateAddCurrentSiteButton();
  }


  private updateExceptionsModeSelect(): void {
    const select = document.getElementById('exceptionsModeSelect') as HTMLSelectElement | null;
    if (select) select.value = this.exceptionsMode;
  }

  private updateExceptionsModeLabel(): void {
    const label = document.getElementById('exceptionsListLabel');
    if (!label) return;
    const key = this.exceptionsMode === 'whitelist' ? 'exceptions_list_whitelist' : 'exceptions_list_blacklist';
    label.textContent = chrome.i18n.getMessage(key) || (this.exceptionsMode === 'whitelist' ? 'Sites to highlight (whitelist):' : 'Sites to exclude (blacklist):');
  }

  private updateExceptionsModeHint(): void {
    const hint = document.getElementById('exceptionsModeHint');
    if (!hint) return;
    const key = this.exceptionsMode === 'whitelist' ? 'exceptions_mode_hint_whitelist' : 'exceptions_mode_hint_blacklist';
    hint.textContent = chrome.i18n.getMessage(key) || (this.exceptionsMode === 'whitelist' ? 'Only highlight on these sites.' : 'Don\'t highlight on these sites.');
  }

  private updateAddCurrentSiteButton(): void {
    const btn = document.getElementById('addCurrentSiteBtn') as HTMLButtonElement | null;
    if (!btn) return;
    const host = this.currentTabHost.toLowerCase();
    const list = this.getCurrentExceptionsList();
    const alreadyInList = host !== '' && list.includes(host);
    btn.disabled = !host || alreadyInList;
  }

  private renderExceptions(): void {
    const container = document.getElementById('exceptionsList');
    if (!container) return;

    const list = this.getCurrentExceptionsList();
    if (list.length === 0) {
      container.innerHTML = `<div class="exception-item exception-empty">${chrome.i18n.getMessage('no_exceptions') || 'No exceptions'}</div>`;
      return;
    }

    container.innerHTML = list.map(domain =>
      `<div class="exception-item">
        <span class="exception-domain-icon"><i class="fa-solid fa-at"></i></span>
        <span class="exception-domain">${DOMUtils.escapeHtml(domain)}</span>
        <button type="button" class="exception-remove" data-domain="${DOMUtils.escapeHtml(domain)}" title="${DOMUtils.escapeHtml(chrome.i18n.getMessage('remove') || 'Remove')}" aria-label="${DOMUtils.escapeHtml(chrome.i18n.getMessage('remove') || 'Remove')}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>`
    ).join('');
  }

  private updateFormValues(): void {
    (document.getElementById('globalHighlightToggle') as HTMLInputElement).checked = this.globalHighlightEnabled;
    (document.getElementById('matchCase') as HTMLInputElement).checked = this.matchCaseEnabled;
    (document.getElementById('matchWhole') as HTMLInputElement).checked = this.matchWholeEnabled;
    const groupCheckbox = document.getElementById('pageHighlightsGroupByList') as HTMLInputElement;
    if (groupCheckbox) groupCheckbox.checked = this.pageHighlightsGroupByList;
  }
}

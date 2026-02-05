import { HighlightList, HighlightWord, ExportData, HighlightInfo } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { MessageService } from '../services/MessageService.js';
import { DOMUtils } from '../utils/DOMUtils.js';

export class PopupController {
  private lists: HighlightList[] = [];
  private currentListIndex = 0;
  private selectedCheckboxes = new Set<number>();
  private globalHighlightEnabled = true;
  private wordSearchQuery = '';
  private matchCaseEnabled = false;
  private matchWholeEnabled = false;
  private exceptionsList: string[] = [];
  private currentTabHost = '';
  private activeTab = 'lists';
  private pageHighlights: Array<{ word: string; count: number; background: string; foreground: string }> = [];
  private highlightIndices = new Map<string, number>();

  async initialize(): Promise<void> {
    await this.loadData();
    await this.getCurrentTab();
    this.loadActiveTab();
    this.translateTitles();
    this.setupEventListeners();
    this.render();
    this.hideLoadingOverlay();
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

  private loadActiveTab(): void {
    const saved = localStorage.getItem('goose-highlighter-active-tab');
    if (saved) {
      this.activeTab = saved;
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

  private saveActiveTab(): void {
    localStorage.setItem('goose-highlighter-active-tab', this.activeTab);
  }

  private switchTab(tabName: string): void {
    this.activeTab = tabName;
    this.saveActiveTab();

    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.getAttribute('data-tab-content') === tabName);
    });

    if (tabName === 'page-highlights') {
      this.loadPageHighlights();
    }
  }

  private setupEventListeners(): void {
    this.setupTabs();
    this.setupListManagement();
    this.setupWordManagement();
    this.setupSettings();
    this.setupPageHighlights();
    this.setupExceptions();
    this.setupImportExport();
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

    this.switchTab(this.activeTab);
  }

  private setupListManagement(): void {
    const listSelect = document.getElementById('listSelect') as HTMLSelectElement;

    listSelect.addEventListener('change', () => {
      this.selectedCheckboxes.clear();
      this.currentListIndex = +listSelect.value;
      this.renderWords();
      this.updateListForm();
    });

    // Apply button for list settings
    document.getElementById('applyListSettingsBtn')?.addEventListener('click', () => {
      this.applyListSettings();
    });

    document.getElementById('newListBtn')?.addEventListener('click', () => {
      this.lists.push({
        id: Date.now(),
        name: chrome.i18n.getMessage('new_list_name') || 'New List',
        background: '#ffff00',
        foreground: '#000000',
        active: true,
        words: []
      });
      this.currentListIndex = this.lists.length - 1;
      this.save();
    });

    document.getElementById('deleteListBtn')?.addEventListener('click', () => {
      if (confirm(chrome.i18n.getMessage('confirm_delete_list') || 'Delete this list?')) {
        this.lists.splice(this.currentListIndex, 1);
        this.currentListIndex = Math.max(0, this.currentListIndex - 1);
        this.save();
      }
    });

    document.getElementById('manageListsBtn')?.addEventListener('click', () => {
      this.openListManagerWindow();
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
    this.setupWordSelection();

    wordSearch.addEventListener('input', (e) => {
      this.wordSearchQuery = (e.target as HTMLInputElement).value;
      this.renderWords();
    });
  }

  private setupWordListEvents(wordList: HTMLDivElement): void {
    wordList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const list = this.lists[this.currentListIndex];
      if (!list) return;

      // Handle edit button click
      const editBtn = target.closest('.icon-btn.edit-word-btn') as HTMLElement | null;
      if (editBtn) {
        e.stopPropagation();
        const index = Number(editBtn.dataset.index);
        if (!Number.isNaN(index)) {
          this.startEditingWord(index);
        }
        return;
      }

      // Handle toggle button click
      if (target.classList.contains('toggle-btn')) {
        e.stopPropagation();
        const index = Number(target.dataset.index);
        if (!Number.isNaN(index)) {
          const word = list.words[index];
          if (word) {
            word.active = !word.active;
            this.save();
          }
        }
        return;
      }

      // Don't select if clicking on color inputs or edit input
      if (target.tagName === 'INPUT') {
        if ((target as HTMLInputElement).type === 'color') {
          e.stopPropagation();
          return;
        }
        if (target.classList.contains('word-edit-input')) {
          e.stopPropagation();
          return;
        }
      }

      // Don't select if clicking inside word-actions area
      if (target.closest('.word-actions') && !target.classList.contains('word-item')) {
        return;
      }

      // Handle word item selection
      const wordItem = target.closest('.word-item') as HTMLElement | null;
      if (!wordItem) return;

      const index = Number(wordItem.dataset.index);
      if (Number.isNaN(index)) return;

      const mouseEvent = e as MouseEvent;
      // Ctrl/Cmd + click for multi-select
      if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
        if (this.selectedCheckboxes.has(index)) {
          this.selectedCheckboxes.delete(index);
        } else {
          this.selectedCheckboxes.add(index);
        }
        this.renderWords();
        return;
      }

      // Regular click - toggle selection
      if (this.selectedCheckboxes.has(index)) {
        this.selectedCheckboxes.delete(index);
      } else {
        this.selectedCheckboxes.add(index);
      }
      this.renderWords();
    });

    wordList.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const index = +(target.dataset.bgEdit ?? target.dataset.fgEdit ?? -1);
      if (index === -1) return;

      const word = this.lists[this.currentListIndex].words[index];
      if (target.dataset.bgEdit != null) word.background = target.value;
      if (target.dataset.fgEdit != null) word.foreground = target.value;

      this.save();
    });

    wordList.addEventListener('keydown', (e) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains('word-edit-input')) return;

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
      if (!target.classList.contains('word-edit-input')) return;

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

  private startEditingWord(index: number): void {
    const wordItem = document.querySelector(`.word-item[data-index="${index}"]`);
    if (!wordItem) return;

    const textSpan = wordItem.querySelector('.word-text') as HTMLElement;
    const input = wordItem.querySelector('.word-edit-input') as HTMLInputElement;
    if (!textSpan || !input) return;

    textSpan.classList.add('editing');
    input.classList.add('active');
    input.focus();
    input.select();
  }

  private setupWordSelection(): void {
    document.getElementById('selectAllBtn')?.addEventListener('click', () => {
      const list = this.lists[this.currentListIndex];
      list.words.forEach((_, index) => {
        this.selectedCheckboxes.add(index);
      });
      this.renderWords();
    });

    document.getElementById('deselectAllBtn')?.addEventListener('click', () => {
      this.selectedCheckboxes.clear();
      this.renderWords();
    });

    document.getElementById('deleteSelectedBtn')?.addEventListener('click', () => {
      if (confirm(chrome.i18n.getMessage('confirm_delete_words') || 'Delete selected words?')) {
        const list = this.lists[this.currentListIndex];
        const toDelete = Array.from(this.selectedCheckboxes);
        this.lists[this.currentListIndex].words = list.words.filter((_, i) => !toDelete.includes(i));
        this.selectedCheckboxes.clear();
        this.save();
        this.renderWords();
      }
    });

    document.getElementById('enableSelectedBtn')?.addEventListener('click', () => {
      const list = this.lists[this.currentListIndex];
      this.selectedCheckboxes.forEach(index => {
        list.words[index].active = true;
      });
      this.save();
      this.renderWords();
    });

    document.getElementById('disableSelectedBtn')?.addEventListener('click', () => {
      const list = this.lists[this.currentListIndex];
      this.selectedCheckboxes.forEach(index => {
        list.words[index].active = false;
      });
      this.save();
      this.renderWords();
    });
  }

  private setupSettings(): void {
    const globalToggle = document.getElementById('globalHighlightToggle') as HTMLInputElement;
    const matchCase = document.getElementById('matchCase') as HTMLInputElement;
    const matchWhole = document.getElementById('matchWhole') as HTMLInputElement;

    globalToggle.addEventListener('change', async () => {
      this.globalHighlightEnabled = globalToggle.checked;
      await StorageService.update('globalHighlightEnabled', this.globalHighlightEnabled);
      MessageService.sendToAllTabs({
        type: 'GLOBAL_TOGGLE_UPDATED',
        enabled: this.globalHighlightEnabled
      });
    });

    matchCase.addEventListener('change', async () => {
      this.matchCaseEnabled = matchCase.checked;
      await StorageService.update('matchCaseEnabled', this.matchCaseEnabled);
      MessageService.sendToAllTabs({
        type: 'MATCH_OPTIONS_UPDATED',
        matchCase: this.matchCaseEnabled,
        matchWhole: this.matchWholeEnabled
      });
    });

    matchWhole.addEventListener('change', async () => {
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
    document.getElementById('refreshHighlightsBtn')?.addEventListener('click', async () => {
      await this.loadPageHighlights();
    });

    document.getElementById('pageHighlightsList')?.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
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
  }

  private async loadPageHighlights(): Promise<void> {
    try {
      const response = await MessageService.sendToActiveTab({ type: 'GET_PAGE_HIGHLIGHTS' });

      if (response && response.highlights) {
        this.pageHighlights = response.highlights;
        this.highlightIndices.clear();
        this.pageHighlights.forEach(h => this.highlightIndices.set(h.word, 0));
        this.renderPageHighlights();
      }
    } catch (e) {
      console.error('Error loading page highlights:', e);
      this.pageHighlights = [];
      this.renderPageHighlights();
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

  private renderPageHighlights(): void {
    const container = document.getElementById('pageHighlightsList');
    const countElement = document.getElementById('totalHighlightsCount');

    if (!container || !countElement) return;

    const totalCount = this.pageHighlights.reduce((sum, h) => sum + h.count, 0);
    countElement.textContent = totalCount.toString();

    if (this.pageHighlights.length === 0) {
      container.innerHTML = `<div class="page-highlights-empty">${chrome.i18n.getMessage('no_highlights_on_page') || 'No highlights on this page'}</div>`;
      return;
    }

    container.innerHTML = this.pageHighlights.map(highlight => {
      const currentIndex = this.highlightIndices.get(highlight.word) || 0;
      return `
        <div class="page-highlight-item" data-word="${DOMUtils.escapeHtml(highlight.word)}">
          <div class="page-highlight-word">
            <span class="page-highlight-preview" style="background-color: ${highlight.background}; color: ${highlight.foreground};">
              ${DOMUtils.escapeHtml(highlight.word)}
            </span>
            ${highlight.count > 1 ? `<span class="page-highlight-position">${currentIndex + 1}/${highlight.count}</span>` : ''}
          </div>
          <span class="page-highlight-count">${highlight.count}</span>
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
    }).join('');
  }

  private setupExceptions(): void {
    document.getElementById('toggleExceptionBtn')?.addEventListener('click', async () => {
      if (!this.currentTabHost) return;

      const isException = this.exceptionsList.includes(this.currentTabHost);

      if (isException) {
        this.exceptionsList = this.exceptionsList.filter(domain => domain !== this.currentTabHost);
      } else {
        this.exceptionsList.push(this.currentTabHost);
      }

      this.updateExceptionButton();
      this.renderExceptions();
      await StorageService.update('exceptionsList', this.exceptionsList);
      MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
    });

    document.getElementById('clearExceptionsBtn')?.addEventListener('click', async () => {
      if (confirm(chrome.i18n.getMessage('confirm_clear_exceptions') || 'Clear all exceptions?')) {
        this.exceptionsList = [];
        this.updateExceptionButton();
        this.renderExceptions();
        await StorageService.update('exceptionsList', this.exceptionsList);
        MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
      }
    });

    document.getElementById('exceptionsList')?.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('exception-remove')) {
        const domain = target.dataset.domain!;
        this.exceptionsList = this.exceptionsList.filter(d => d !== domain);
        this.updateExceptionButton();
        this.renderExceptions();
        await StorageService.update('exceptionsList', this.exceptionsList);
        MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
      }
    });
  }

  private setupImportExport(): void {
    const importInput = document.getElementById('importInput') as HTMLInputElement;

    document.getElementById('exportBtn')?.addEventListener('click', () => {
      const exportData: ExportData = {
        lists: this.lists,
        exceptionsList: this.exceptionsList
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'highlight-lists.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('importBtn')?.addEventListener('click', () => {
      importInput.click();
    });

    importInput.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);

          if (Array.isArray(data)) {
            this.lists = data;
          } else if (data && typeof data === 'object') {
            if (Array.isArray(data.lists)) {
              this.lists = data.lists;
            }
            if (Array.isArray(data.exceptionsList)) {
              this.exceptionsList = data.exceptionsList;
            }
          }

          this.currentListIndex = 0;
          this.updateExceptionButton();
          this.renderExceptions();
          this.save();
        } catch (err) {
          alert(chrome.i18n.getMessage('invalid_json_error') + ': ' + (err as Error).message);
        }
      };
      reader.readAsText(file);
    });
  }

  private setupTheme(): void {
    const toggle = document.getElementById('themeToggle') as HTMLInputElement;
    const body = document.body;

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      body.classList.remove('dark');
      body.classList.add('light');
      toggle.checked = false;
    } else {
      body.classList.add('dark');
      body.classList.remove('light');
      toggle.checked = true;
    }

    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        body.classList.add('dark');
        body.classList.remove('light');
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        localStorage.setItem('theme', 'dark');
      } else {
        body.classList.remove('dark');
        body.classList.add('light');
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        localStorage.setItem('theme', 'light');
      }
    });
  }

  private applyListSettings(): void {
    const listName = document.getElementById('listName') as HTMLInputElement;
    const listBg = document.getElementById('listBg') as HTMLInputElement;
    const listFg = document.getElementById('listFg') as HTMLInputElement;
    const listActive = document.getElementById('listActive') as HTMLInputElement;

    this.lists[this.currentListIndex].name = listName.value;
    this.lists[this.currentListIndex].background = listBg.value;
    this.lists[this.currentListIndex].foreground = listFg.value;
    this.lists[this.currentListIndex].active = listActive.checked;

    this.save();
  }

  private async save(): Promise<void> {
    await StorageService.set({
      lists: this.lists,
      globalHighlightEnabled: this.globalHighlightEnabled,
      matchCaseEnabled: this.matchCaseEnabled,
      matchWholeEnabled: this.matchWholeEnabled,
      exceptionsList: this.exceptionsList
    });

    this.renderLists();
    MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
  }

  private openListManagerWindow(): void {
    chrome.windows.create({
      url: chrome.runtime.getURL('list-manager/list-manager.html'),
      type: 'popup',
      width: 800,
      height: 600,
      focused: true
    });
  }

  private setupStorageSync(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.lists || changes.globalHighlightEnabled || changes.matchCaseEnabled || changes.matchWholeEnabled || changes.exceptionsList) {
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
    this.updateExceptionButton();
    this.updateFormValues();
  }

  private renderLists(): void {
    const listSelect = document.getElementById('listSelect') as HTMLSelectElement;
    listSelect.innerHTML = this.lists.map((list, index) =>
      `<option value="${index}">${DOMUtils.escapeHtml(list.name)}</option>`
    ).join('');
    listSelect.value = this.currentListIndex.toString();
    this.updateListForm();
  }

  private updateListForm(): void {
    const list = this.lists[this.currentListIndex];
    (document.getElementById('listName') as HTMLInputElement).value = list.name;
    (document.getElementById('listBg') as HTMLInputElement).value = list.background;
    (document.getElementById('listFg') as HTMLInputElement).value = list.foreground;
    (document.getElementById('listActive') as HTMLInputElement).checked = list.active;
  }

  private renderWords(): void {
    const list = this.lists[this.currentListIndex];
    const wordList = document.getElementById('wordList') as HTMLDivElement;

    let filteredWords = list.words;
    if (this.wordSearchQuery.trim()) {
      const q = this.wordSearchQuery.trim().toLowerCase();
      filteredWords = list.words.filter(w => w.wordStr.toLowerCase().includes(q));
    }

    const itemHeight = 32;
    const itemSpacing = 4;
    const totalItemHeight = itemHeight + itemSpacing;
    const containerHeight = wordList.clientHeight || 250;
    const scrollTop = wordList.scrollTop;
    const startIndex = Math.max(0, Math.floor(scrollTop / totalItemHeight) - 1);
    const visibleCount = Math.ceil(containerHeight / totalItemHeight);
    const endIndex = Math.min(startIndex + visibleCount + 2, filteredWords.length);

    wordList.innerHTML = '';

    const spacer = document.createElement('div');
    spacer.style.position = 'relative';
    spacer.style.height = `${filteredWords.length * totalItemHeight - itemSpacing}px`;
    spacer.style.width = '100%';

    for (let i = startIndex; i < endIndex; i++) {
      const w = filteredWords[i];
      if (!w) continue;

      const realIndex = list.words.indexOf(w);
      const container = this.createWordItem(w, realIndex, i, itemHeight);
      spacer.appendChild(container);
    }

    wordList.appendChild(spacer);

    const wordCount = document.getElementById('wordCount');
    if (wordCount) {
      wordCount.textContent = filteredWords.length.toString();
    }
  }

  private createWordItem(word: HighlightWord, realIndex: number, displayIndex: number, itemHeight: number): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'word-item';
    if (this.selectedCheckboxes.has(realIndex)) {
      container.classList.add('selected');
    }
    if (word.active === false) {
      container.classList.add('disabled');
    }
    container.style.cssText = `
      position: absolute;
      top: ${displayIndex * (itemHeight + 4)}px;
    `;
    container.dataset.index = realIndex.toString();

    const list = this.lists[this.currentListIndex];

    container.innerHTML = `
      <span class="word-text">${DOMUtils.escapeHtml(word.wordStr)}</span>
      <input type="text" class="word-edit-input" value="${DOMUtils.escapeHtml(word.wordStr)}" data-word-edit="${realIndex}">
      <div class="word-actions">
        <button class="icon-btn edit-word-btn" data-index="${realIndex}" title="${chrome.i18n.getMessage('edit') || 'Edit'}">
          <i class="fa-solid fa-pen"></i>
        </button>
        <input type="color" value="${word.background || list.background}" data-bg-edit="${realIndex}" title="${chrome.i18n.getMessage('background_color_title') || 'Background color'}">
        <input type="color" value="${word.foreground || list.foreground}" data-fg-edit="${realIndex}" title="${chrome.i18n.getMessage('text_color_title') || 'Text color'}">
        <button class="toggle-btn ${word.active !== false ? 'active' : ''}" data-index="${realIndex}" title="${chrome.i18n.getMessage('toggle_active') || 'Toggle active'}"></button>
      </div>
    `;

    return container;
  }

  private updateExceptionButton(): void {
    const toggleBtn = document.getElementById('toggleExceptionBtn');
    const btnText = document.getElementById('exceptionBtnText');

    if (!toggleBtn || !btnText || !this.currentTabHost) return;

    const isException = this.exceptionsList.includes(this.currentTabHost);

    if (isException) {
      btnText.textContent = chrome.i18n.getMessage('remove_exception') || 'Remove from Exceptions';
      toggleBtn.className = 'danger';
      const icon = toggleBtn.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-trash';
    } else {
      btnText.textContent = chrome.i18n.getMessage('add_exception') || 'Add to Exceptions';
      toggleBtn.className = '';
      const icon = toggleBtn.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-plus';
    }
  }

  private renderExceptions(): void {
    const container = document.getElementById('exceptionsList');
    if (!container) return;

    if (this.exceptionsList.length === 0) {
      container.innerHTML = `<div class="exception-item">${chrome.i18n.getMessage('no_exceptions') || 'No exceptions'}</div>`;
      return;
    }

    container.innerHTML = this.exceptionsList.map(domain =>
      `<div class="exception-item">
        <span class="exception-domain">${DOMUtils.escapeHtml(domain)}</span>
        <button class="exception-remove" data-domain="${DOMUtils.escapeHtml(domain)}">${chrome.i18n.getMessage('remove') || 'Remove'}</button>
      </div>`
    ).join('');
  }

  private updateFormValues(): void {
    (document.getElementById('globalHighlightToggle') as HTMLInputElement).checked = this.globalHighlightEnabled;
    (document.getElementById('matchCase') as HTMLInputElement).checked = this.matchCaseEnabled;
    (document.getElementById('matchWhole') as HTMLInputElement).checked = this.matchWholeEnabled;
  }
}

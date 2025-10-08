import { HighlightList, HighlightWord, ExportData } from '../types.js';
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
  private sectionStates: Record<string, boolean> = {};

  async initialize(): Promise<void> {
    await this.loadData();
    await this.getCurrentTab();
    this.loadSectionStates();
    this.initializeSectionStates();
    this.setupEventListeners();
    this.render();
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

  private loadSectionStates(): void {
    const saved = localStorage.getItem('goose-highlighter-section-states');
    if (saved) {
      try {
        this.sectionStates = JSON.parse(saved);
      } catch {
        this.sectionStates = {};
      }
    }
  }

  private saveSectionStates(): void {
    localStorage.setItem('goose-highlighter-section-states', JSON.stringify(this.sectionStates));
  }

  private initializeSectionStates(): void {
    Object.keys(this.sectionStates).forEach(sectionName => {
      const section = document.querySelector(`[data-section="${sectionName}"]`);
      if (section && this.sectionStates[sectionName]) {
        section.classList.add('collapsed');
      }
    });
  }

  private setupEventListeners(): void {
    this.setupSectionToggles();
    this.setupListManagement();
    this.setupWordManagement();
    this.setupSettings();
    this.setupExceptions();
    this.setupImportExport();
    this.setupTheme();
  }

  private setupSectionToggles(): void {
    document.querySelectorAll('.collapse-toggle').forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetSection = (button as HTMLElement).getAttribute('data-target');
        if (targetSection) this.toggleSection(targetSection);
      });
    });

    document.querySelectorAll('.section-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON' ||
          (e.target as HTMLElement).tagName === 'INPUT' ||
          (e.target as HTMLElement).closest('button')) {
          return;
        }
        const section = (header as HTMLElement).closest('.section');
        const sectionName = section?.getAttribute('data-section');
        if (sectionName) this.toggleSection(sectionName);
      });
    });
  }

  private toggleSection(sectionName: string): void {
    const section = document.querySelector(`[data-section="${sectionName}"]`);
    if (!section) return;

    const isCollapsed = section.classList.contains('collapsed');

    if (isCollapsed) {
      section.classList.remove('collapsed');
      this.sectionStates[sectionName] = false;
    } else {
      section.classList.add('collapsed');
      this.sectionStates[sectionName] = true;
    }

    this.saveSectionStates();
  }

  private setupListManagement(): void {
    const listSelect = document.getElementById('listSelect') as HTMLSelectElement;
    const listName = document.getElementById('listName') as HTMLInputElement;
    const listBg = document.getElementById('listBg') as HTMLInputElement;
    const listFg = document.getElementById('listFg') as HTMLInputElement;
    const listActive = document.getElementById('listActive') as HTMLInputElement;

    listSelect.addEventListener('change', () => {
      this.selectedCheckboxes.clear();
      this.currentListIndex = +listSelect.value;
      this.renderWords();
      this.updateListForm();
    });

    listName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.lists[this.currentListIndex].name = listName.value;
        this.save();
      }
    });

    listBg.addEventListener('input', () => {
      this.lists[this.currentListIndex].background = listBg.value;
      this.save();
    });

    listFg.addEventListener('input', () => {
      this.lists[this.currentListIndex].foreground = listFg.value;
      this.save();
    });

    listActive.addEventListener('change', () => {
      this.lists[this.currentListIndex].active = listActive.checked;
      this.save();
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
    wordList.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.type === 'checkbox') {
        if (target.dataset.index != null) {
          const index = +target.dataset.index;
          if (target.checked) {
            this.selectedCheckboxes.add(index);
          } else {
            this.selectedCheckboxes.delete(index);
          }
          this.renderWords();
        } else if (target.dataset.activeEdit != null) {
          const index = +target.dataset.activeEdit;
          this.lists[this.currentListIndex].words[index].active = target.checked;
          this.save();
        }
      }
    });

    wordList.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const index = +(target.dataset.bgEdit ?? target.dataset.fgEdit ?? -1);
      if (index === -1) return;

      const word = this.lists[this.currentListIndex].words[index];
      if (target.dataset.bgEdit != null) word.background = target.value;
      if (target.dataset.fgEdit != null) word.foreground = target.value;

      this.save();
    });

    wordList.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const target = e.target as HTMLInputElement;
        const index = +(target.dataset.wordEdit ?? -1);
        if (index === -1) return;

        const word = this.lists[this.currentListIndex].words[index];
        if (target.dataset.wordEdit != null) {
          word.wordStr = target.value;
          this.save();
        }
      }
    });

    let scrollTimeout: number;
    wordList.addEventListener('scroll', () => {
      if (scrollTimeout) return;
      scrollTimeout = window.setTimeout(() => {
        requestAnimationFrame(() => this.renderWords());
        scrollTimeout = 0;
      }, 16);
    });
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

    globalToggle.addEventListener('change', () => {
      this.globalHighlightEnabled = globalToggle.checked;
      this.updateGlobalToggleState();
    });

    matchCase.addEventListener('change', () => {
      this.matchCaseEnabled = matchCase.checked;
      this.save();
    });

    matchWhole.addEventListener('change', () => {
      this.matchWholeEnabled = matchWhole.checked;
      this.save();
    });
  }

  private setupExceptions(): void {
    document.getElementById('toggleExceptionBtn')?.addEventListener('click', () => {
      if (!this.currentTabHost) return;

      const isException = this.exceptionsList.includes(this.currentTabHost);

      if (isException) {
        this.exceptionsList = this.exceptionsList.filter(domain => domain !== this.currentTabHost);
      } else {
        this.exceptionsList.push(this.currentTabHost);
      }

      this.updateExceptionButton();
      this.renderExceptions();
      this.save();
    });

    document.getElementById('manageExceptionsBtn')?.addEventListener('click', () => {
      const panel = document.getElementById('exceptionsPanel');
      if (panel) {
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
      }
    });

    document.getElementById('clearExceptionsBtn')?.addEventListener('click', () => {
      if (confirm(chrome.i18n.getMessage('confirm_clear_exceptions') || 'Clear all exceptions?')) {
        this.exceptionsList = [];
        this.updateExceptionButton();
        this.renderExceptions();
        this.save();
      }
    });

    document.getElementById('exceptionsList')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('exception-remove')) {
        const domain = target.dataset.domain!;
        this.exceptionsList = this.exceptionsList.filter(d => d !== domain);
        this.updateExceptionButton();
        this.renderExceptions();
        this.save();
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
        localStorage.setItem('theme', 'dark');
      } else {
        body.classList.remove('dark');
        body.classList.add('light');
        localStorage.setItem('theme', 'light');
      }
    });
  }

  private async save(): Promise<void> {
    await StorageService.set({
      lists: this.lists,
      globalHighlightEnabled: this.globalHighlightEnabled,
      matchCaseEnabled: this.matchCaseEnabled,
      matchWholeEnabled: this.matchWholeEnabled,
      exceptionsList: this.exceptionsList
    });

    this.render();
    MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
    MessageService.sendToAllTabs({
      type: 'GLOBAL_TOGGLE_UPDATED',
      enabled: this.globalHighlightEnabled
    });
    MessageService.sendToAllTabs({
      type: 'MATCH_OPTIONS_UPDATED',
      matchCase: this.matchCaseEnabled,
      matchWhole: this.matchWholeEnabled
    });
    MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
  }



  private async updateGlobalToggleState(): Promise<void> {
    await StorageService.update('globalHighlightEnabled', this.globalHighlightEnabled);
    MessageService.sendToAllTabs({
      type: 'GLOBAL_TOGGLE_UPDATED',
      enabled: this.globalHighlightEnabled
    });
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
    const containerHeight = wordList.clientHeight;
    const scrollTop = wordList.scrollTop;
    const startIndex = Math.floor(scrollTop / itemHeight);
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeight / itemHeight) + 2,
      filteredWords.length
    );

    wordList.innerHTML = '';

    const spacer = document.createElement('div');
    spacer.style.position = 'relative';
    spacer.style.height = `${filteredWords.length * itemHeight}px`;
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
    container.style.cssText = `
      height: ${itemHeight}px;
      position: absolute;
      top: ${displayIndex * itemHeight}px;
      width: calc(100% - 8px);
      left: 4px;
      right: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 4px;
      box-sizing: border-box;
      background: var(--highlight-tag);
      border: 1px solid var(--highlight-tag-border);
    `;

    const list = this.lists[this.currentListIndex];

    container.innerHTML = `
      <input type="checkbox" class="word-checkbox" data-index="${realIndex}" ${this.selectedCheckboxes.has(realIndex) ? 'checked' : ''}>
      <input type="text" value="${DOMUtils.escapeHtml(word.wordStr)}" data-word-edit="${realIndex}" style="flex-grow: 1; min-width: 0; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--input-border); background-color: var(--input-bg); color: var(--text-color);">
      <input type="color" value="${word.background || list.background}" data-bg-edit="${realIndex}" style="width: 24px; height: 24px; flex-shrink: 0;">
      <input type="color" value="${word.foreground || list.foreground}" data-fg-edit="${realIndex}" style="width: 24px; height: 24px; flex-shrink: 0;">
      <label class="word-active" style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
        <input type="checkbox" ${word.active !== false ? 'checked' : ''} data-active-edit="${realIndex}" class="switch">
      </label>
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
      if (icon) icon.className = 'fa-solid fa-check';
    } else {
      btnText.textContent = chrome.i18n.getMessage('add_exception') || 'Add to Exceptions';
      toggleBtn.className = '';
      const icon = toggleBtn.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-ban';
    }
  }

  private renderExceptions(): void {
    const container = document.getElementById('exceptionsList');
    if (!container) return;

    if (this.exceptionsList.length === 0) {
      container.innerHTML = '<div class="exception-item">No exceptions</div>';
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
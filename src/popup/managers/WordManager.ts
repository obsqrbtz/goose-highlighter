import { HighlightList } from '../../types.js';
import { StorageService } from '../../services/StorageService.js';
import { MessageService } from '../../services/MessageService.js';
import { DOMUtils } from '../../utils/DOMUtils.js';
import { PopupRenderer } from './PopupRenderer.js';

export class WordManager {
  private selectedCheckboxes = new Set<number>();
  private wordMenuOpenForIndex: number | null = null;
  private wordMenuCopyOnly = false;
  private wordMenuCloseListener: (() => void) | null = null;
  private readonly pageSize = 100;
  private totalWords = 0;

  constructor(
    private lists: HighlightList[],
    private getCurrentListIndex: () => number,
    private getWordSearchQuery: () => string,
    private getCurrentPage: () => number,
    private setCurrentPage: (page: number) => void,
    private onWordsChanged: () => void
  ) {}

  setupEventListeners(): void {
    const bulkPaste = document.getElementById('bulkPaste') as HTMLTextAreaElement;
    const wordList = document.getElementById('wordList') as HTMLDivElement;
    const wordSearch = document.getElementById('wordSearch') as HTMLInputElement;

    document.getElementById('addWordsBtn')?.addEventListener('click', () => {
      this.addBulkWords(bulkPaste.value);
      bulkPaste.value = '';
    });

    this.setupWordListEvents(wordList);

    wordSearch.addEventListener('input', () => {
      this.setCurrentPage(1);
      this.onWordsChanged();
    });
  }

  private addBulkWords(text: string): void {
    const words = text.split(/\n+/).map(w => w.trim()).filter(Boolean);
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
    const existingWords = new Set(list.words.map(w => w.wordStr));
    
    for (const w of words) {
      if (!existingWords.has(w)) {
        list.words.push({
          wordStr: w,
          background: '',
          foreground: '',
          active: true
        });
        existingWords.add(w);
      }
    }
    void this.saveAndNotify();
  }

  private setupWordListEvents(wordList: HTMLDivElement): void {
    wordList.addEventListener('click', (e) => this.handleWordListClick(e));
    wordList.addEventListener('change', (e) => this.handleWordListChange(e));
    wordList.addEventListener('keydown', (e) => this.handleWordListKeydown(e));
    wordList.addEventListener('blur', (e) => this.handleWordListBlur(e), true);

    let scrolling = false;
    wordList.addEventListener('scroll', () => {
      if (scrolling) return;
      scrolling = true;
      requestAnimationFrame(() => {
        this.render();
        scrolling = false;
      });
    });
  }

  private handleWordListClick(e: Event): void {
    const target = e.target as HTMLElement;
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
    if (!list) return;

    const menuBtn = target.closest('.word-item-menu-btn');
    if (menuBtn) {
      e.stopPropagation();
      const index = Number((menuBtn as HTMLElement).dataset.index);
      if (!Number.isNaN(index)) {
        this.openWordItemMenu(index, menuBtn as HTMLElement);
      }
      return;
    }

    const editBtn = target.closest('.word-item-icon-btn.edit-word-btn');
    if (editBtn) {
      e.stopPropagation();
      const index = Number((editBtn as HTMLElement).dataset.index);
      if (!Number.isNaN(index)) {
        this.startEditingWord(index);
      }
      return;
    }

    if (target.tagName === 'INPUT') {
      if ((target as HTMLInputElement).type === 'color' || target.classList.contains('word-item-edit-input')) {
        e.stopPropagation();
        return;
      }
    }

    if (target.closest('.word-item-actions') && !target.classList.contains('word-item')) {
      return;
    }

    if (target.closest('.word-item-eye-toggle')) {
      return;
    }

    const wordItem = target.closest('.word-item');
    if (!wordItem) return;

    const index = Number((wordItem as HTMLElement).dataset.index);
    if (Number.isNaN(index)) return;

    const mouseEvent = e as MouseEvent;
    this.toggleWordSelection(index, mouseEvent.ctrlKey || mouseEvent.metaKey);
  }

  private handleWordListChange(e: Event): void {
    const target = e.target as HTMLInputElement;
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];

    if (target.classList.contains('word-item-eye-input')) {
      const wordItem = target.closest('.word-item') as HTMLElement;
      if (wordItem) {
        const index = Number(wordItem.dataset.index);
        if (!Number.isNaN(index)) {
          const word = list.words[index];
          if (word) {
            word.active = target.checked;
            void this.saveAndNotify();
          }
        }
      }
      return;
    }

    const index = +(target.dataset.bgEdit ?? target.dataset.fgEdit ?? -1);
    if (index === -1) return;

    const word = list.words[index];
    if (target.dataset.bgEdit != null) word.background = target.value;
    if (target.dataset.fgEdit != null) word.foreground = target.value;

    void this.saveAndNotify();
  }

  private handleWordListKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLInputElement;
    if (!target.classList.contains('word-item-edit-input')) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      target.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.render();
    }
  }

  private handleWordListBlur(e: FocusEvent): void {
    const target = e.target as HTMLInputElement;
    if (!target.classList.contains('word-item-edit-input')) return;

    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
    if (!list) return;

    const index = Number(target.dataset.wordEdit ?? -1);
    if (Number.isNaN(index) || index < 0) return;

    const word = list.words[index];
    if (!word) return;

    const newValue = target.value.trim();
    if (newValue && newValue !== word.wordStr) {
      word.wordStr = newValue;
      void this.saveAndNotify();
    } else {
      this.render();
    }
  }

  private toggleWordSelection(index: number, multiSelect: boolean): void {
    if (multiSelect) {
      if (this.selectedCheckboxes.has(index)) {
        this.selectedCheckboxes.delete(index);
      } else {
        this.selectedCheckboxes.add(index);
      }
    } else {
      this.selectedCheckboxes.clear();
      this.selectedCheckboxes.add(index);
    }
    this.render();
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
        this.handleMenuAction(action!, effectiveIndices);
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

  private handleMenuAction(action: string, indices: number[]): void {
    if (action === 'move') {
      this.showWordMenuListPickerForIndices(indices, false);
    } else if (action === 'copy') {
      this.showWordMenuListPickerForIndices(indices, true);
    } else if (action === 'enable') {
      this.setSelectedWordsActive(indices, true);
      this.closeWordItemMenu();
      void this.saveAndNotify();
    } else if (action === 'disable') {
      this.setSelectedWordsActive(indices, false);
      this.closeWordItemMenu();
      void this.saveAndNotify();
    } else if (action === 'delete') {
      if (confirm(chrome.i18n.getMessage('confirm_delete_words') || 'Delete selected words?')) {
        this.deleteWordsByIndices(indices);
        this.selectedCheckboxes.clear();
        this.closeWordItemMenu();
        void this.saveAndNotify();
      }
    }
  }

  private showWordMenuListPickerForIndices(indices: number[], copyOnly: boolean): void {
    const dropdown = document.getElementById('wordItemMenuDropdown');
    if (!dropdown || this.wordMenuOpenForIndex === null) return;

    this.wordMenuCopyOnly = copyOnly;
    const currentIndex = this.getCurrentListIndex();
    const otherLists = this.lists
      .map((list, index) => ({ list, index }))
      .filter(({ index }) => index !== currentIndex);

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
        void this.saveAndNotify();
      });
    });
  }

  private setSelectedWordsActive(indices: number[], active: boolean): void {
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
    if (!list) return;
    indices.forEach(index => {
      const word = list.words[index];
      if (word) word.active = active;
    });
  }

  private deleteWordsByIndices(indices: number[]): void {
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
    if (!list) return;
    const toDelete = new Set(indices);
    this.lists[currentIndex].words = list.words.filter((_, i) => !toDelete.has(i));
  }

  private moveWordsToOtherList(indices: number[], targetListIndex: number): void {
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
    const targetList = this.lists[targetListIndex];
    if (!list || !targetList) return;
    const sorted = [...indices].sort((a, b) => b - a);
    const wordsToMove = sorted.map(i => list.words[i]).filter(Boolean);
    sorted.forEach(i => list.words.splice(i, 1));
    targetList.words.push(...wordsToMove);
  }

  private copyWordsToOtherList(indices: number[], targetListIndex: number): void {
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
    const targetList = this.lists[targetListIndex];
    if (!list || !targetList) return;
    indices.forEach(index => {
      const word = list.words[index];
      if (word) targetList.words.push({ ...word });
    });
  }

  closeWordItemMenu(): void {
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

  clearSelection(): void {
    this.selectedCheckboxes.clear();
  }

  render(): void {
    this.closeWordItemMenu();
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
    const wordList = document.getElementById('wordList') as HTMLDivElement;

    let filteredWords = list.words;
    const searchQuery = this.getWordSearchQuery();
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
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
    const currentPage = this.getCurrentPage();
    if (currentPage > totalPages) {
      this.setCurrentPage(Math.max(1, totalPages));
    }
    const startIndex = (currentPage - 1) * this.pageSize;
    const endIndex = Math.min(startIndex + this.pageSize, this.totalWords);
    const paginatedWords = filteredWords.slice(startIndex, endIndex);

    wordList.innerHTML = paginatedWords.map(w => {
      const realIndex = list.words.indexOf(w);
      const isSelected = this.selectedCheckboxes.has(realIndex);
      return PopupRenderer.createWordItemHTML(w, realIndex, isSelected, list.background, list.foreground);
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

    const currentPage = this.getCurrentPage();
    paginationContainer.style.display = 'flex';
    paginationContainer.innerHTML = PopupRenderer.createPaginationHTML(currentPage, totalPages, this.totalWords, this.pageSize);

    this.setupPaginationEventListeners();
  }

  private setupPaginationEventListeners(): void {
    const totalPages = Math.ceil(this.totalWords / this.pageSize);
    const currentPage = this.getCurrentPage();

    document.getElementById('firstPageBtn')?.addEventListener('click', () => {
      this.goToPage(1);
    });

    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
      this.goToPage(currentPage - 1);
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
      this.goToPage(currentPage + 1);
    });

    document.getElementById('lastPageBtn')?.addEventListener('click', () => {
      this.goToPage(totalPages);
    });
  }

  private goToPage(page: number): void {
    const totalPages = Math.ceil(this.totalWords / this.pageSize);
    if (page < 1 || page > totalPages) return;

    this.setCurrentPage(page);
    this.render();
  }

  private async saveAndNotify(): Promise<void> {
    try {
      await StorageService.update('lists', this.lists);
      MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
      this.onWordsChanged();
    } catch (error) {
      console.error('WordManager.saveAndNotify error:', error);
      // Optionally show user-facing error message
    }
  }
}

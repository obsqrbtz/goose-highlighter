import { HighlightList, HighlightWord, ExportData } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { MessageService } from '../services/MessageService.js';
import { DOMUtils } from '../utils/DOMUtils.js';

export class ListManagerController {
  private lists: HighlightList[] = [];
  private currentListIndex = 0;
  private selectedLists = new Set<number>();
  private selectedWords = new Set<number>();
  private wordSearchQuery = '';
  private isReloading = false;

  async initialize(): Promise<void> {
    await this.loadData();
    this.setupEventListeners();
    this.render();
    this.setupStorageSync();
  }

  private async loadData(): Promise<void> {
    const data = await StorageService.get();
    this.lists = data.lists || [];

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
  }

  private setupEventListeners(): void {
    document.getElementById('newListBtn')?.addEventListener('click', () => this.createList());
    document.getElementById('duplicateListBtn')?.addEventListener('click', () => this.duplicateCurrentList());
    document.getElementById('mergeListsBtn')?.addEventListener('click', () => this.mergeSelectedLists());
    document.getElementById('deleteListsBtn')?.addEventListener('click', () => this.deleteSelectedLists());
    document.getElementById('activateListsBtn')?.addEventListener('click', () => this.setSelectedListsActive(true));
    document.getElementById('deactivateListsBtn')?.addEventListener('click', () => this.setSelectedListsActive(false));
    document.getElementById('applyListSettingsBtn')?.addEventListener('click', () => this.applyListSettings());
    document.getElementById('exportListBtn')?.addEventListener('click', () => this.exportCurrentList());

    document.getElementById('selectAllWordsBtn')?.addEventListener('click', () => this.selectAllWords());
    document.getElementById('clearSelectedWordsBtn')?.addEventListener('click', () => this.clearSelectedWords());
    document.getElementById('enableWordsBtn')?.addEventListener('click', () => this.setSelectedWordsActive(true));
    document.getElementById('disableWordsBtn')?.addEventListener('click', () => this.setSelectedWordsActive(false));
    document.getElementById('deleteWordsBtn')?.addEventListener('click', () => this.deleteSelectedWords());
    document.getElementById('addWordsBtn')?.addEventListener('click', () => this.addWordsFromBulkInput());

    document.getElementById('moveWordsBtn')?.addEventListener('click', () => this.moveOrCopySelectedWords(false));
    document.getElementById('copyWordsBtn')?.addEventListener('click', () => this.moveOrCopySelectedWords(true));

    const wordSearch = document.getElementById('wordSearch') as HTMLInputElement;
    wordSearch.addEventListener('input', (e) => {
      this.wordSearchQuery = (e.target as HTMLInputElement).value;
      this.renderWords();
    });

    const listsContainer = document.getElementById('listsContainer');
    listsContainer?.addEventListener('click', (e) => this.handleListClick(e));
    listsContainer?.addEventListener('change', (e) => this.handleListCheckboxChange(e));
    listsContainer?.addEventListener('dragstart', (e) => this.handleDragStart(e));
    listsContainer?.addEventListener('dragover', (e) => this.handleDragOver(e));
    listsContainer?.addEventListener('drop', (e) => this.handleDrop(e));
    listsContainer?.addEventListener('dragend', () => this.clearDragState());

    const wordList = document.getElementById('wordList');
    wordList?.addEventListener('change', (e) => this.handleWordListChange(e));
    wordList?.addEventListener('keydown', (e) => this.handleWordListKeydown(e));
  }

  private setupStorageSync(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (!changes.lists) return;
      if (this.isReloading) return;
      this.reloadFromStorage();
    });
  }

  private async reloadFromStorage(): Promise<void> {
    this.isReloading = true;
    await this.loadData();
    this.selectedLists.clear();
    this.selectedWords.clear();
    this.render();
    this.isReloading = false;
  }

  private createList(): void {
    this.lists.push({
      id: Date.now(),
      name: chrome.i18n.getMessage('new_list_name') || 'New List',
      background: '#ffff00',
      foreground: '#000000',
      active: true,
      words: []
    });
    this.currentListIndex = this.lists.length - 1;
    this.selectedLists.clear();
    this.save();
  }

  private duplicateCurrentList(): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;
    const newList: HighlightList = {
      id: Date.now(),
      name: `${list.name} (Copy)`,
      background: list.background,
      foreground: list.foreground,
      active: list.active,
      words: list.words.map(word => ({ ...word }))
    };
    this.lists.splice(this.currentListIndex + 1, 0, newList);
    this.currentListIndex = this.currentListIndex + 1;
    this.selectedLists.clear();
    this.save();
  }

  private mergeSelectedLists(): void {
    const selected = this.getSelectedListIndices();
    if (selected.length < 2) {
      alert('Select at least two lists to merge.');
      return;
    }

    const targetIndex = selected.includes(this.currentListIndex) ? this.currentListIndex : selected[0];
    const target = this.lists[targetIndex];
    if (!target) return;

    const confirmMessage = `Merge ${selected.length - 1} list(s) into "${target.name}"? Source lists will be removed.`;
    if (!confirm(confirmMessage)) return;

    const sourceIndices = selected.filter(index => index !== targetIndex).sort((a, b) => b - a);
    sourceIndices.forEach(index => {
      const source = this.lists[index];
      if (source) {
        target.words.push(...source.words.map(word => ({ ...word })));
        this.lists.splice(index, 1);
      }
    });

    this.currentListIndex = Math.min(targetIndex, this.lists.length - 1);
    this.selectedLists.clear();
    this.save();
  }

  private deleteSelectedLists(): void {
    const selected = this.getSelectedListIndices();
    if (selected.length === 0) {
      if (!this.lists[this.currentListIndex]) return;
      if (!confirm('Delete current list?')) return;
      this.lists.splice(this.currentListIndex, 1);
    } else {
      if (!confirm(`Delete ${selected.length} selected list(s)?`)) return;
      selected.sort((a, b) => b - a).forEach(index => this.lists.splice(index, 1));
    }

    if (this.lists.length === 0) {
      this.createList();
      return;
    }

    this.currentListIndex = Math.min(this.currentListIndex, this.lists.length - 1);
    this.selectedLists.clear();
    this.save();
  }

  private setSelectedListsActive(active: boolean): void {
    const selected = this.getSelectedListIndices();
    if (selected.length === 0) {
      const list = this.lists[this.currentListIndex];
      if (list) list.active = active;
    } else {
      selected.forEach(index => {
        if (this.lists[index]) this.lists[index].active = active;
      });
    }
    this.save();
  }

  private applyListSettings(): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;

    const listName = document.getElementById('listName') as HTMLInputElement;
    const listBg = document.getElementById('listBg') as HTMLInputElement;
    const listFg = document.getElementById('listFg') as HTMLInputElement;

    list.name = listName.value;
    list.background = listBg.value;
    list.foreground = listFg.value;

    this.save();
  }

  private exportCurrentList(): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;

    const exportData: ExportData = {
      lists: [list],
      exceptionsList: []
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `highlight-list-${this.sanitizeFileName(list.name)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private sanitizeFileName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'list';
  }

  private selectAllWords(): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;
    const entries = this.getFilteredWordEntries(list);
    entries.forEach(entry => this.selectedWords.add(entry.index));
    this.renderWords();
  }

  private clearSelectedWords(): void {
    this.selectedWords.clear();
    this.renderWords();
  }

  private setSelectedWordsActive(active: boolean): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;
    this.selectedWords.forEach(index => {
      if (list.words[index]) list.words[index].active = active;
    });
    this.save();
  }

  private deleteSelectedWords(): void {
    const list = this.lists[this.currentListIndex];
    if (!list || this.selectedWords.size === 0) return;
    if (!confirm(`Delete ${this.selectedWords.size} selected word(s)?`)) return;

    list.words = list.words.filter((_, i) => !this.selectedWords.has(i));
    this.selectedWords.clear();
    this.save();
  }

  private addWordsFromBulkInput(): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;

    const textarea = document.getElementById('bulkAddWords') as HTMLTextAreaElement | null;
    if (!textarea) return;

    const words = textarea.value
      .split(/\n+/)
      .map(word => word.trim())
      .filter(Boolean);

    if (words.length === 0) return;

    words.forEach(word => {
      list.words.push({
        wordStr: word,
        background: '',
        foreground: '',
        active: true
      });
    });

    textarea.value = '';
    this.save();
  }

  private moveOrCopySelectedWords(copyOnly: boolean): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;
    if (this.selectedWords.size === 0) return;

    const targetSelect = document.getElementById('targetListSelect') as HTMLSelectElement;
    const targetIndex = Number(targetSelect.value);
    if (Number.isNaN(targetIndex) || targetIndex === this.currentListIndex) return;

    const targetList = this.lists[targetIndex];
    if (!targetList) return;

    const selectedIndices = Array.from(this.selectedWords).sort((a, b) => a - b);
    const wordsToMove = selectedIndices.map(index => list.words[index]).filter(Boolean);

    if (copyOnly) {
      targetList.words.push(...wordsToMove.map(word => ({ ...word })));
    } else {
      targetList.words.push(...wordsToMove.map(word => ({ ...word })));
      list.words = list.words.filter((_, i) => !this.selectedWords.has(i));
    }

    this.selectedWords.clear();
    this.save();
  }

  private handleListClick(event: Event): void {
    const target = event.target as HTMLElement;
    const listItem = target.closest('.list-item') as HTMLElement | null;
    if (!listItem) return;

    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;

    const index = Number(listItem.dataset.index);
    if (Number.isNaN(index)) return;

    this.currentListIndex = index;
    this.selectedWords.clear();
    this.render();
  }

  private handleListCheckboxChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (!target.classList.contains('list-checkbox')) return;
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) return;

    if (target.checked) {
      this.selectedLists.add(index);
    } else {
      this.selectedLists.delete(index);
    }
  }

  private handleDragStart(event: DragEvent): void {
    const target = (event.target as HTMLElement).closest('.list-item') as HTMLElement | null;
    if (!target) return;
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) return;

    event.dataTransfer?.setData('text/plain', index.toString());
    event.dataTransfer?.setDragImage(target, 10, 10);
  }

  private handleDragOver(event: DragEvent): void {
    event.preventDefault();
    const target = (event.target as HTMLElement).closest('.list-item') as HTMLElement | null;
    if (!target) return;
    target.classList.add('drag-over');
  }

  private handleDrop(event: DragEvent): void {
    event.preventDefault();
    const target = (event.target as HTMLElement).closest('.list-item') as HTMLElement | null;
    if (!target) return;

    const sourceIndex = Number(event.dataTransfer?.getData('text/plain'));
    const targetIndex = Number(target.dataset.index);
    if (Number.isNaN(sourceIndex) || Number.isNaN(targetIndex) || sourceIndex === targetIndex) {
      this.clearDragState();
      return;
    }

    const [moved] = this.lists.splice(sourceIndex, 1);
    this.lists.splice(targetIndex, 0, moved);

    if (this.currentListIndex === sourceIndex) {
      this.currentListIndex = targetIndex;
    } else if (sourceIndex < this.currentListIndex && targetIndex >= this.currentListIndex) {
      this.currentListIndex -= 1;
    } else if (sourceIndex > this.currentListIndex && targetIndex <= this.currentListIndex) {
      this.currentListIndex += 1;
    }

    this.selectedLists.clear();
    this.save();
  }

  private clearDragState(): void {
    document.querySelectorAll('.list-item.drag-over').forEach(item => item.classList.remove('drag-over'));
  }

  private handleWordListChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const list = this.lists[this.currentListIndex];
    if (!list) return;

    if (target.classList.contains('word-checkbox') && target.dataset.index != null) {
      const index = Number(target.dataset.index);
      if (target.checked) {
        this.selectedWords.add(index);
      } else {
        this.selectedWords.delete(index);
      }
      this.renderWords();
      return;
    }

    const editIndex = Number(target.dataset.bgEdit ?? target.dataset.fgEdit ?? target.dataset.activeEdit ?? -1);
    if (Number.isNaN(editIndex) || editIndex < 0) return;

    const word = list.words[editIndex];
    if (!word) return;

    if (target.dataset.bgEdit != null) word.background = target.value;
    if (target.dataset.fgEdit != null) word.foreground = target.value;
    if (target.dataset.activeEdit != null) word.active = target.checked;

    this.save();
  }

  private handleWordListKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    const target = event.target as HTMLInputElement;
    const list = this.lists[this.currentListIndex];
    if (!list) return;

    const index = Number(target.dataset.wordEdit ?? -1);
    if (Number.isNaN(index) || index < 0) return;

    const word = list.words[index];
    if (!word) return;

    word.wordStr = target.value;
    this.save();
  }

  private getSelectedListIndices(): number[] {
    return Array.from(this.selectedLists).filter(index => this.lists[index]);
  }

  private getFilteredWordEntries(list: HighlightList): Array<{ word: HighlightWord; index: number }> {
    const query = this.wordSearchQuery.trim().toLowerCase();
    const entries = list.words.map((word, index) => ({ word, index }));
    if (!query) return entries;
    return entries.filter(entry => entry.word.wordStr.toLowerCase().includes(query));
  }

  private render(): void {
    this.renderLists();
    this.renderSelectedList();
    this.renderWords();
  }

  private renderLists(): void {
    const container = document.getElementById('listsContainer');
    if (!container) return;

    container.innerHTML = '';

    this.lists.forEach((list, index) => {
      const total = list.words.length;
      const activeCount = list.words.filter(word => word.active).length;

      const item = document.createElement('div');
      item.className = 'list-item';
      if (index === this.currentListIndex) item.classList.add('active');
      item.draggable = true;
      item.dataset.index = index.toString();
      item.innerHTML = `
        <input type="checkbox" class="list-checkbox" data-index="${index}" ${this.selectedLists.has(index) ? 'checked' : ''}>
        <div class="list-meta">
          <div class="list-name">${DOMUtils.escapeHtml(list.name)}</div>
          <div class="list-stats">${total} words • ${activeCount} active</div>
        </div>
        <div class="list-badge">${list.active ? 'Active' : 'Paused'}</div>
      `;
      container.appendChild(item);
    });
  }

  private renderSelectedList(): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;

    (document.getElementById('listName') as HTMLInputElement).value = list.name;
    (document.getElementById('listBg') as HTMLInputElement).value = list.background;
    (document.getElementById('listFg') as HTMLInputElement).value = list.foreground;

    const stats = document.getElementById('listStats');
    if (stats) {
      const activeCount = list.words.filter(word => word.active).length;
      const inactiveCount = list.words.length - activeCount;
      stats.textContent = `${list.words.length} words • ${activeCount} active • ${inactiveCount} inactive`;
    }

    this.renderTargetListOptions();
  }

  private renderTargetListOptions(): void {
    const select = document.getElementById('targetListSelect') as HTMLSelectElement;
    if (!select) return;

    const options = this.lists
      .map((list, index) => ({ list, index }))
      .filter(entry => entry.index !== this.currentListIndex)
      .map(entry => `<option value="${entry.index}">${DOMUtils.escapeHtml(entry.list.name)}</option>`);

    select.innerHTML = options.join('');
    select.disabled = options.length === 0;
  }

  private renderWords(): void {
    const list = this.lists[this.currentListIndex];
    const wordList = document.getElementById('wordList');
    if (!list || !wordList) return;

    const entries = this.getFilteredWordEntries(list);

    if (entries.length === 0) {
      wordList.innerHTML = '<div class="empty">No words in this list.</div>';
      return;
    }

    wordList.innerHTML = entries.map(entry => {
      const word = entry.word;
      const index = entry.index;
      return `
        <div class="word-item ${word.active ? '' : 'disabled'}">
          <input type="checkbox" class="word-checkbox" data-index="${index}" ${this.selectedWords.has(index) ? 'checked' : ''}>
          <input type="text" value="${DOMUtils.escapeHtml(word.wordStr)}" data-word-edit="${index}">
          <input type="color" value="${word.background || list.background}" data-bg-edit="${index}">
          <input type="color" value="${word.foreground || list.foreground}" data-fg-edit="${index}">
          <input type="checkbox" data-active-edit="${index}" ${word.active ? 'checked' : ''} title="Active">
        </div>
      `;
    }).join('');
  }

  private async save(): Promise<void> {
    await StorageService.set({
      lists: this.lists
    });
    this.render();
    MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
  }
}

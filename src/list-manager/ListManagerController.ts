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
  private currentPage = 1;
  private pageSize = 100;
  private totalWords = 0;

async initialize(): Promise<void> {
    await this.loadData();
    this.setupEventListeners();
    this.setupTheme();
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
    document.getElementById('editListNameBtn')?.addEventListener('click', () => this.toggleListSettings());
    document.getElementById('applyListSettingsBtn')?.addEventListener('click', () => this.applyListSettings());
    document.getElementById('importListBtn')?.addEventListener('click', () => this.triggerImport());
    document.getElementById('exportListBtn')?.addEventListener('click', () => this.exportCurrentList());

    const importFileInput = document.getElementById('importFileInput') as HTMLInputElement;
    importFileInput?.addEventListener('change', (e) => this.handleImportFile(e));

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
      this.currentPage = 1;
      this.renderWords();
    });

    const listsContainer = document.getElementById('listsContainer');
    listsContainer?.addEventListener('click', (e) => this.handleListClick(e));
    listsContainer?.addEventListener('keydown', (e) => this.handleListsKeydown(e));
    listsContainer?.addEventListener('dragstart', (e) => this.handleDragStart(e));
    listsContainer?.addEventListener('dragover', (e) => this.handleDragOver(e));
    listsContainer?.addEventListener('drop', (e) => this.handleDrop(e));
    listsContainer?.addEventListener('dragend', () => this.clearDragState());

    const wordList = document.getElementById('wordList');
    wordList?.addEventListener('click', (e) => this.handleWordListClick(e));
    wordList?.addEventListener('change', (e) => this.handleWordListChange(e));
    wordList?.addEventListener('keydown', (e) => this.handleWordListKeydown(e));
    wordList?.addEventListener('blur', (e) => this.handleWordListBlur(e), true);
    wordList?.addEventListener('dragstart', (e) => this.handleWordDragStart(e));
    wordList?.addEventListener('dragend', () => this.clearDragState());
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
    const toDuplicate = this.getEffectiveSelectedListIndices();
    if (toDuplicate.length === 0) return;
    const sortedDesc = [...toDuplicate].sort((a, b) => b - a);
    sortedDesc.forEach(index => {
      const list = this.lists[index];
      if (!list) return;
      const newList: HighlightList = {
        id: Date.now() + Math.random(),
        name: `${list.name} (Copy)`,
        background: list.background,
        foreground: list.foreground,
        active: list.active,
        words: list.words.map(word => ({ ...word }))
      };
      this.lists.splice(index + 1, 0, newList);
    });
    const firstInsertedIndex = Math.min(...toDuplicate) + 1;
    this.currentListIndex = Math.min(firstInsertedIndex, this.lists.length - 1);
    this.selectedLists.clear();
    this.save();
  }

  private mergeSelectedLists(): void {
    const selected = this.getEffectiveSelectedListIndices();
    if (selected.length < 2) {
      alert(chrome.i18n.getMessage('merge_lists_min_two') || 'Select at least two lists to merge.');
      return;
    }

    const targetIndex = selected.includes(this.currentListIndex) ? this.currentListIndex : selected[0];
    const target = this.lists[targetIndex];
    if (!target) return;

    const confirmMessage = chrome.i18n.getMessage('merge_lists_confirm')
      ?.replace('{count}', String(selected.length - 1))
      .replace('{target}', target.name) 
      || `Merge ${selected.length - 1} list(s) into "${target.name}"? Source lists will be removed.`;
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
    const selected = this.getEffectiveSelectedListIndices();
    if (selected.length === 0) return;
    const confirmMessage = chrome.i18n.getMessage('delete_lists_confirm')
      ?.replace('{count}', String(selected.length))
      || `Delete ${selected.length} selected list(s)?`;
    if (!confirm(confirmMessage)) return;
    selected.sort((a, b) => b - a).forEach(index => this.lists.splice(index, 1));

    if (this.lists.length === 0) {
      this.createList();
      return;
    }

    this.currentListIndex = Math.min(this.currentListIndex, this.lists.length - 1);
    this.selectedLists.clear();
    this.save();
  }

  private toggleListActive(index: number): void {
    const list = this.lists[index];
    if (list) {
      list.active = !list.active;
      this.save();
    }
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

    this.toggleListSettings();
    this.save();
  }

  private toggleListSettings(): void {
    const panel = document.getElementById('listSettingsPanel');
    if (!panel) return;
    
    if (panel.classList.contains('expanded')) {
      panel.classList.remove('expanded');
    } else {
      panel.classList.add('expanded');
      const listName = document.getElementById('listName') as HTMLInputElement;
      listName?.focus();
      listName?.select();
    }
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

  private triggerImport(): void {
    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  private async handleImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!this.validateImportData(data)) {
        alert(chrome.i18n.getMessage('invalid_import_format') || 'Invalid file format. Please select a valid Goose Highlighter export file.');
        return;
      }

      this.importLists(data);
    } catch (error) {
      console.error('Import error:', error);
      alert(chrome.i18n.getMessage('import_failed') || 'Failed to import file. Please ensure it is a valid JSON file.');
      alert('Failed to import file. Please ensure it is a valid JSON file.');
    }
  }

  private validateImportData(data: any): data is ExportData {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.lists)) return false;
    
    return data.lists.every((list: any) => 
      list &&
      typeof list === 'object' &&
      typeof list.name === 'string' &&
      typeof list.background === 'string' &&
      typeof list.foreground === 'string' &&
      typeof list.active === 'boolean' &&
      Array.isArray(list.words) &&
      list.words.every((word: any) =>
        word &&
        typeof word === 'object' &&
        typeof word.wordStr === 'string' &&
        typeof word.background === 'string' &&
        typeof word.foreground === 'string' &&
        typeof word.active === 'boolean'
      )
    );
  }

  private importLists(data: ExportData): void {
    const importedLists = data.lists.map(list => ({
      ...list,
      id: Date.now() + Math.random(),
      name: this.getUniqueListName(list.name)
    }));

    const count = importedLists.length;
    const wordCount = importedLists.reduce((sum, list) => sum + list.words.length, 0);

    if (!confirm(`Import ${count} list(s) with ${wordCount} total word(s)?`)) return;

    this.lists.push(...importedLists);
    this.currentListIndex = this.lists.length - 1;
    this.selectedLists.clear();
    this.save();

    alert(`Successfully imported ${count} list(s) with ${wordCount} word(s).`);
  }

  private getUniqueListName(baseName: string): string {
    const existingNames = new Set(this.lists.map(list => list.name));
    if (!existingNames.has(baseName)) return baseName;

    let counter = 1;
    let newName = `${baseName} (${counter})`;
    while (existingNames.has(newName)) {
      counter++;
      newName = `${baseName} (${counter})`;
    }
    return newName;
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
    const confirmMessage = chrome.i18n.getMessage('confirm_delete_words')
      ?.replace('{count}', String(this.selectedWords.size))
      || `Delete ${this.selectedWords.size} selected word(s)?`;
    if (!confirm(confirmMessage)) return;

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

    const index = Number(listItem.dataset.index);
    if (Number.isNaN(index)) return;

    // Click on active/paused badge toggles that list's active state
    if (target.closest('.list-badge')) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleListActive(index);
      return;
    }

    const mouseEvent = event as MouseEvent;
    // Ctrl/Cmd + click for multi-select
    if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
      if (this.selectedLists.has(index)) {
        this.selectedLists.delete(index);
      } else {
        this.selectedLists.add(index);
      }
      this.renderLists();
      return;
    }

    // Regular click - set as current and clear multi-selection
    this.currentListIndex = index;
    this.selectedLists.clear();
    this.selectedWords.clear();
    this.currentPage = 1; // Reset to first page when selecting a list
    this.render();
  }

  private handleListsKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const badge = target.closest('.list-badge');
    if (!badge) return;
    const listItem = badge.closest('.list-item') as HTMLElement | null;
    if (!listItem) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const index = Number(listItem.dataset.index);
    if (!Number.isNaN(index)) this.toggleListActive(index);
  }

  private handleDragStart(event: DragEvent): void {
    const target = (event.target as HTMLElement).closest('.list-item') as HTMLElement | null;
    if (!target) return;
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) return;

    event.dataTransfer?.setData('text/plain', JSON.stringify({ type: 'list', index }));
    event.dataTransfer?.setDragImage(target, 10, 10);
  }

  private handleDragOver(event: DragEvent): void {
    event.preventDefault();
    const target = (event.target as HTMLElement).closest('.list-item') as HTMLElement | null;
    if (!target) {
      this.clearDragState();
      return;
    }
    
    // Clear drag state from all items first
    this.clearDragState();
    
    // Check if we're dragging words or lists
    const data = event.dataTransfer?.types.includes('text/plain');
    if (data) {
      target.classList.add('drag-over');
    }
  }

  private handleDrop(event: DragEvent): void {
    event.preventDefault();
    const target = (event.target as HTMLElement).closest('.list-item') as HTMLElement | null;
    if (!target) return;

    const targetIndex = Number(target.dataset.index);
    if (Number.isNaN(targetIndex)) {
      this.clearDragState();
      return;
    }

    try {
      const dataStr = event.dataTransfer?.getData('text/plain');
      if (!dataStr) {
        this.clearDragState();
        return;
      }

      const data = JSON.parse(dataStr);

      // Handle word drag
      if (data.type === 'words') {
        this.dropWordsOnList(data.wordIndices, targetIndex);
        this.clearDragState();
        return;
      }

      // Handle list drag (reordering)
      if (data.type === 'list') {
        const sourceIndex = data.index;
        if (sourceIndex === targetIndex) {
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
    } catch (error) {
      console.error('Drop error:', error);
    }

    this.clearDragState();
  }

  private clearDragState(): void {
    document.querySelectorAll('.list-item.drag-over').forEach(item => item.classList.remove('drag-over'));
  }

  private handleWordDragStart(event: DragEvent): void {
    const target = (event.target as HTMLElement).closest('.word-item') as HTMLElement | null;
    if (!target) return;
    
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) return;

    // If dragging a selected word, drag all selected words
    let wordIndices: number[];
    if (this.selectedWords.has(index)) {
      wordIndices = Array.from(this.selectedWords);
    } else {
      wordIndices = [index];
    }

    event.dataTransfer?.setData('text/plain', JSON.stringify({ type: 'words', wordIndices }));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  private dropWordsOnList(wordIndices: number[], targetListIndex: number): void {
    const sourceList = this.lists[this.currentListIndex];
    const targetList = this.lists[targetListIndex];
    
    if (!sourceList || !targetList) return;
    if (targetListIndex === this.currentListIndex) return; // Can't drop on same list

    const wordsToCopy = wordIndices
      .map(index => sourceList.words[index])
      .filter(Boolean)
      .map(word => ({ ...word })); // Create copies

    if (wordsToCopy.length === 0) return;

    targetList.words.push(...wordsToCopy);
    this.save();

    // Show feedback
    const count = wordsToCopy.length;
    const message = `Copied ${count} word${count > 1 ? 's' : ''} to "${targetList.name}"`;
    console.log(message);
  }

  private handleWordListClick(event: Event): void {
    const target = event.target as HTMLElement;
    const list = this.lists[this.currentListIndex];
    if (!list) return;

    const editBtn = target.closest('.edit-word-btn') as HTMLElement | null;
    if (editBtn) {
      event.stopPropagation();
      const index = Number(editBtn.dataset.index);
      if (Number.isNaN(index)) return;
      this.startEditingWord(index);
      return;
    }

    // Don't select if clicking on eye toggle
    if (target.closest('.word-item-eye-toggle')) {
      return;
    }

    // Don't select if clicking on color inputs or edit input
    if (target.tagName === 'INPUT') {
      if ((target as HTMLInputElement).type === 'color') {
        event.stopPropagation();
        return;
      }
      if (target.classList.contains('word-edit-input')) {
        event.stopPropagation();
        return;
      }
    }

    // Don't select if clicking inside word-actions area (except on the word item itself)
    if (target.closest('.word-actions') && !target.classList.contains('word-item')) {
      return;
    }

    // Handle word item selection
    const wordItem = target.closest('.word-item') as HTMLElement | null;
    if (!wordItem) return;

    const index = Number(wordItem.dataset.index);
    if (Number.isNaN(index)) return;

    const mouseEvent = event as MouseEvent;
    // Ctrl/Cmd + click for multi-select
    if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
      if (this.selectedWords.has(index)) {
        this.selectedWords.delete(index);
      } else {
        this.selectedWords.add(index);
      }
      this.renderWords();
      return;
    }

    // Regular click - clear all and select only this one
    this.selectedWords.clear();
    this.selectedWords.add(index);
    this.renderWords();
  }

  private handleWordListChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const list = this.lists[this.currentListIndex];
    if (!list) return;

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

    const editIndex = Number(target.dataset.bgEdit ?? target.dataset.fgEdit ?? -1);
    if (Number.isNaN(editIndex) || editIndex < 0) return;

    const word = list.words[editIndex];
    if (!word) return;

    if (target.dataset.bgEdit != null) word.background = target.value;
    if (target.dataset.fgEdit != null) word.foreground = target.value;

    this.save();
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

  private handleWordListBlur(event: Event): void {
    const target = event.target as HTMLInputElement;
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
  }

  private handleWordListKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLInputElement;
    if (!target.classList.contains('word-edit-input')) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      target.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.renderWords();
    }
  }

  private getSelectedListIndices(): number[] {
    return Array.from(this.selectedLists).filter(index => this.lists[index]);
  }

  /** Current list plus any Ctrl+clicked lists (effective selection for merge/duplicate/delete). */
  private getEffectiveSelectedListIndices(): number[] {
    const indices = new Set(this.getSelectedListIndices());
    indices.add(this.currentListIndex);
    return Array.from(indices).filter(index => this.lists[index]);
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
      if (this.selectedLists.has(index)) item.classList.add('selected');
      item.draggable = true;
      item.dataset.index = index.toString();
      
      const wordsLabel = chrome.i18n.getMessage('words_label') || 'words';
      const activeLabel = chrome.i18n.getMessage('active_label') || 'active';
      const badgeText = list.active 
        ? (chrome.i18n.getMessage('list_active_badge') || 'Active')
        : (chrome.i18n.getMessage('list_paused_badge') || 'Paused');
      const toggleBadgeTitle = chrome.i18n.getMessage('toggle_active') || 'Toggle active';
      
      item.innerHTML = `
        <div class="list-meta">
          <div class="list-name">${DOMUtils.escapeHtml(list.name)}</div>
          <div class="list-stats">${total} ${wordsLabel} • ${activeCount} ${activeLabel}</div>
        </div>
        <div class="list-badge" role="button" title="${DOMUtils.escapeHtml(toggleBadgeTitle)}" tabindex="0" aria-label="${DOMUtils.escapeHtml(toggleBadgeTitle)}">${badgeText}</div>
      `;
      container.appendChild(item);
    });
  }

  private renderSelectedList(): void {
    const list = this.lists[this.currentListIndex];
    if (!list) return;

    const selectedListName = document.getElementById('selectedListName');
    if (selectedListName) {
      selectedListName.textContent = list.name;
    }

    (document.getElementById('listName') as HTMLInputElement).value = list.name;
    (document.getElementById('listBg') as HTMLInputElement).value = list.background;
    (document.getElementById('listFg') as HTMLInputElement).value = list.foreground;

    const stats = document.getElementById('listStats');
    if (stats) {
      const activeCount = list.words.filter(word => word.active).length;
      const inactiveCount = list.words.length - activeCount;
      const wordsLabel = chrome.i18n.getMessage('words_label') || 'words';
      const activeLabel = chrome.i18n.getMessage('active_label') || 'active';
      const inactiveLabel = chrome.i18n.getMessage('inactive_label') || 'inactive';
      stats.textContent = `${list.words.length} ${wordsLabel} • ${activeCount} ${activeLabel} • ${inactiveCount} ${inactiveLabel}`;
    }

    // Collapse settings panel when switching lists
    const panel = document.getElementById('listSettingsPanel');
    if (panel) {
      panel.classList.remove('expanded');
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
    this.totalWords = entries.length;

    if (entries.length === 0) {
      const emptyMessage = chrome.i18n.getMessage('no_words_in_list') || 'No words in this list.';
      wordList.innerHTML = `<div class="empty">${emptyMessage}</div>`;
      this.renderPaginationControls();
      return;
    }

    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = Math.min(startIndex + this.pageSize, this.totalWords);
    const paginatedEntries = entries.slice(startIndex, endIndex);

    const editWordTitle = chrome.i18n.getMessage('edit_word') || 'Edit word';
    const bgColorTitle = chrome.i18n.getMessage('background_color_title') || 'Background color';
    const fgColorTitle = chrome.i18n.getMessage('text_color_title') || 'Text color';
    const toggleActiveTitle = chrome.i18n.getMessage('toggle_active') || 'Toggle active';

    wordList.innerHTML = paginatedEntries.map(entry => {
      const word = entry.word;
      const index = entry.index;
      const isSelected = this.selectedWords.has(index);
      return `
        <div class="word-item ${word.active ? '' : 'disabled'} ${isSelected ? 'selected' : ''}" data-index="${index}" draggable="true">
          <span class="word-text">${DOMUtils.escapeHtml(word.wordStr)}</span>
          <input type="text" class="word-edit-input" value="${DOMUtils.escapeHtml(word.wordStr)}" data-word-edit="${index}">
          <div class="word-actions">
            <button class="icon-btn edit-word-btn" data-index="${index}" title="${editWordTitle}">
              <i class="fa-solid fa-pen"></i>
            </button>
            <input type="color" value="${word.background || list.background}" data-bg-edit="${index}" title="${bgColorTitle}">
            <input type="color" value="${word.foreground || list.foreground}" data-fg-edit="${index}" title="${fgColorTitle}">
            <label class="word-item-eye-toggle" title="${toggleActiveTitle}" aria-label="${toggleActiveTitle}">
              <input type="checkbox" class="word-item-eye-input" ${word.active ? 'checked' : ''} data-index="${index}">
              <span class="word-item-eye-icon">
                <i class="fa-solid fa-eye eye-active"></i>
                <i class="fa-solid fa-eye-slash eye-disabled"></i>
              </span>
            </label>
          </div>
        </div>
      `;
    }).join('');

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
    
    const itemsPerPageLabel = chrome.i18n.getMessage('items_per_page') || 'Items per page:';
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
      <div class="page-size-controls">
        <label for="pageSizeSelect">${itemsPerPageLabel}</label>
        <select id="pageSizeSelect" class="page-size-select">
          <option value="25" ${this.pageSize === 25 ? 'selected' : ''}>25</option>
          <option value="50" ${this.pageSize === 50 ? 'selected' : ''}>50</option>
          <option value="100" ${this.pageSize === 100 ? 'selected' : ''}>100</option>
          <option value="200" ${this.pageSize === 200 ? 'selected' : ''}>200</option>
        </select>
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

    const pageSizeSelect = document.getElementById('pageSizeSelect') as HTMLSelectElement;
    pageSizeSelect?.addEventListener('change', (e) => {
      const newSize = Number((e.target as HTMLSelectElement).value);
      if (!Number.isNaN(newSize) && newSize > 0) {
        this.pageSize = newSize;
        this.currentPage = 1;
        this.renderWords();
      }
    });
  }

  private goToPage(page: number): void {
    const totalPages = Math.ceil(this.totalWords / this.pageSize);
    if (page < 1 || page > totalPages) return;
    
    this.currentPage = page;
    this.renderWords();
  }

private async save(): Promise<void> {
    await StorageService.set({
      lists: this.lists
    });
    this.render();
    MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
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
}

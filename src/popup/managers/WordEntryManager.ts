import { browserAPI } from '../../utils/browser.js';
import { HighlightList } from '../../types.js';
import { StorageService } from '../../services/StorageService.js';
import { MessageService } from '../../services/MessageService.js';

interface EntryDraft {
  listId: number;
  listName: string;
  rows: string[];
}

export class WordEntryManager {
  private readonly draftKey = 'goose-word-entry-draft';
  private draft: EntryDraft | null = null;
  private busy = false;

  constructor(
    private lists: HighlightList[],
    private getCurrentListIndex: () => number,
    private onWordsChanged: () => void
  ) {
    try {
      const saved = JSON.parse(localStorage.getItem(this.draftKey) || 'null');
      if (saved && typeof saved.listId === 'number' && typeof saved.listName === 'string'
        && Array.isArray(saved.rows) && saved.rows.every((row: unknown) => typeof row === 'string')) {
        this.draft = saved;
      }
    } catch { /* Ignore an invalid draft. */ }
  }

  private message(key: string, fallback: string): string {
    return browserAPI.i18n.getMessage(key) || fallback;
  }

  setupEventListeners(): void {
    const quick = document.getElementById('quickWord') as HTMLInputElement;
    quick.setAttribute('aria-label', this.message('quick_word_hint', 'Word or phrase'));
    document.getElementById('bulkWordEditor')!.setAttribute('aria-label', this.message('add_multiple', 'Add multiple entries'));
    quick.value = localStorage.getItem(`${this.draftKey}-quick`) || '';
    quick.addEventListener('input', () => this.persistQuick());
    document.getElementById('quickWordForm')!.addEventListener('submit', event => {
      event.preventDefault();
      if (!this.busy && quick.value.trim()) void this.save([quick.value], false);
    });
    quick.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text/plain');
      if (!text || !/[\r\n]/.test(text) || this.busy) return;
      event.preventDefault();
      const combined = quick.value.slice(0, quick.selectionStart ?? 0) + text
        + quick.value.slice(quick.selectionEnd ?? quick.value.length);
      this.open(combined.split(/\r\n|\r|\n/));
      quick.value = '';
      this.persistQuick();
    });
    document.getElementById('addMultipleBtn')!.addEventListener('click', () => {
      this.open([quick.value]);
      quick.value = '';
      this.persistQuick();
    });
    document.getElementById('addBulkRowBtn')!.addEventListener('click', () => {
      if (!this.draft || this.busy) return;
      this.draft.rows.push('');
      this.persist();
      this.renderRows(this.draft.rows.length - 1);
    });
    document.getElementById('cancelBulkWords')!.addEventListener('click', () => {
      if (this.busy) return;
      this.draft = null;
      this.persist();
      this.status('');
      this.render();
      quick.focus();
    });
    document.getElementById('saveBulkWords')!.addEventListener('click', () => {
      if (this.draft && !this.busy) void this.save(this.draft.rows, true);
    });
    this.renderRows();
  }

  private persistQuick(): void {
    localStorage.setItem(`${this.draftKey}-quick`, (document.getElementById('quickWord') as HTMLInputElement).value);
  }

  private persist(): void {
    if (this.draft) localStorage.setItem(this.draftKey, JSON.stringify(this.draft));
    else localStorage.removeItem(this.draftKey);
  }

  private open(rows: string[]): void {
    const list = this.lists[this.getCurrentListIndex()];
    if (!list) return;
    this.draft = { listId: list.id, listName: list.name, rows: rows.length ? rows : [''] };
    this.persist();
    this.status('');
    this.render();
    this.renderRows(0);
  }

  private destination(): HighlightList | undefined {
    return this.draft ? this.lists.find(list => list.id === this.draft!.listId)
      : this.lists[this.getCurrentListIndex()];
  }

  private newEntries(rows: string[], list: HighlightList): string[] {
    const seen = new Set(list.words.map(word => word.wordStr));
    return rows.map(row => row.trim()).filter(row => {
      if (!row || seen.has(row)) return false;
      seen.add(row);
      return true;
    });
  }

  render(): void {
    const list = this.lists[this.getCurrentListIndex()];
    const destination = document.getElementById('wordsDestination');
    if (destination) destination.textContent = list?.name || '';
    const editor = document.getElementById('bulkWordEditor')!;
    editor.hidden = !this.draft;
    (document.querySelector('.add-words-section') as HTMLElement).hidden = !!this.draft;
    (document.querySelector('.word-list-section') as HTMLElement).hidden = !!this.draft;
    if (!this.draft) return;
    const target = this.destination();
    document.getElementById('bulkDestination')!.textContent =
      this.message('adding_to_list', 'Adding to: {list}').replace('{list}', target?.name ?? this.draft.listName);
    const button = document.getElementById('saveBulkWords') as HTMLButtonElement;
    const count = target ? this.newEntries(this.draft.rows, target).length : 0;
    button.textContent = this.message('add_n_entries', 'Add {count} entries').replace('{count}', count.toLocaleString());
    button.disabled = this.busy || !target || count === 0;
    if (!target) this.status(this.message('entry_list_missing', 'This list no longer exists. Cancel to choose another list.'));
  }

  private renderRows(focusIndex?: number): void {
    const container = document.getElementById('bulkWordRows')!;
    container.replaceChildren();
    this.draft?.rows.forEach((value, index) => {
      const row = document.createElement('div');
      row.className = 'bulk-word-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value;
      input.setAttribute('aria-label', `${this.message('entry_row', 'Entry')} ${index + 1}`);
      input.addEventListener('input', () => {
        this.draft!.rows[index] = input.value;
        this.persist();
        this.render();
      });
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        if (index === this.draft!.rows.length - 1) {
          this.draft!.rows.push('');
          this.persist();
          this.renderRows(index + 1);
        } else (container.children[index + 1].querySelector('input') as HTMLInputElement).focus();
      });
      input.addEventListener('paste', event => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text || !/[\r\n]/.test(text)) return;
        event.preventDefault();
        const combined = input.value.slice(0, input.selectionStart ?? 0) + text
          + input.value.slice(input.selectionEnd ?? input.value.length);
        const entries = combined.split(/\r\n|\r|\n/);
        this.draft!.rows.splice(index, 1, ...entries);
        this.persist();
        this.renderRows(index + entries.length - 1);
        this.render();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', this.message('remove', 'Remove'));
      remove.addEventListener('click', () => {
        this.draft!.rows.splice(index, 1);
        if (!this.draft!.rows.length) this.draft!.rows.push('');
        this.persist();
        this.renderRows(Math.min(index, this.draft!.rows.length - 1));
        this.render();
      });
      row.append(input, remove);
      container.append(row);
    });
    if (focusIndex !== undefined) (container.children[focusIndex]?.querySelector('input') as HTMLInputElement)?.focus();
  }

  private status(text: string): void {
    const element = document.getElementById('wordEntryStatus')!;
    element.textContent = text;
    element.hidden = !text;
  }

  private async save(rows: string[], bulk: boolean): Promise<void> {
    const list = this.destination();
    if (!list) return;
    const entries = this.newEntries(rows, list);
    if (!entries.length) {
      this.status(this.message('entry_duplicate', 'This entry is already in the list.'));
      return;
    }
    this.busy = true;
    document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.add-words-section input, .add-words-section button, #bulkWordEditor input, #bulkWordEditor button')
      .forEach(control => { control.disabled = true; });
    try {
      // Keep the live list unchanged until storage confirms the write.
      const updated = this.lists.map(item => item.id === list.id ? {
        ...item, words: [...item.words, ...entries.map(wordStr => ({ wordStr, background: '', foreground: '', active: true }))]
      } : item);
      await StorageService.update('lists', updated);
      const current = this.lists.findIndex(item => item.id === list.id);
      if (current >= 0) this.lists[current] = updated.find(item => item.id === list.id)!;
      if (bulk) {
        this.draft = null;
        this.persist();
      } else {
        (document.getElementById('quickWord') as HTMLInputElement).value = '';
        this.persistQuick();
      }
      MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
      this.onWordsChanged();
      this.status(this.message('entries_added', 'Added {count} entries.').replace('{count}', entries.length.toLocaleString()));
    } catch (error) {
      console.error('Could not save word entries:', error);
      this.status(this.message('entry_save_failed', 'Could not save. Your draft is kept; please try again.'));
    } finally {
      this.busy = false;
      document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.add-words-section input, .add-words-section button, #bulkWordEditor input, #bulkWordEditor button')
        .forEach(control => { control.disabled = false; });
      this.render();
      if (!this.draft) document.getElementById('quickWord')!.focus();
    }
  }
}

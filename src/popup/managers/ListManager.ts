import { browserAPI } from '../../utils/browser.js';
import { HighlightList } from '../../types.js';
import { StorageService } from '../../services/StorageService.js';
import { MessageService } from '../../services/MessageService.js';
import { DOMUtils } from '../../utils/DOMUtils.js';

export class ListManager {
  constructor(
    private lists: HighlightList[],
    private getCurrentListIndex: () => number,
    private setCurrentListIndex: (index: number) => void,
    private onListsChanged: () => void
  ) {}

  setupEventListeners(): void {
    const dropdownBtn = document.getElementById('listDropdownBtn');
    const dropdownMenu = document.getElementById('listDropdownMenu');

    dropdownBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu?.classList.toggle('open');
    });

    document.addEventListener('click', () => {
      dropdownMenu?.classList.remove('open');
    });

    document.getElementById('applyListSettingsBtn')?.addEventListener('click', () => {
      this.applyListSettings();
    });

    document.getElementById('renameListBtn')?.addEventListener('click', () => {
      this.renameList();
    });

    document.getElementById('newListBtn')?.addEventListener('click', () => {
      this.createNewList();
    });

    document.getElementById('deleteListBtn')?.addEventListener('click', () => {
      this.deleteList();
    });

    this.setupColorPickers();
  }

  private setupColorPickers(): void {
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

  private renameList(): void {
    const currentIndex = this.getCurrentListIndex();
    const newName = prompt(
      browserAPI.i18n.getMessage('enter_list_name') || 'Enter list name:',
      this.lists[currentIndex].name
    );
    if (newName && newName.trim()) {
      this.lists[currentIndex].name = newName.trim();
      void this.saveAndNotify();
    }
  }

  private createNewList(): void {
    this.lists.push({
      id: Date.now(),
      name: browserAPI.i18n.getMessage('new_list_name') || 'New List',
      background: '#22c55e',
      foreground: '#000000',
      active: true,
      words: []
    });
    this.setCurrentListIndex(this.lists.length - 1);
    void this.saveAndNotify();
  }

  private deleteList(): void {
    if (this.lists.length <= 1) {
      alert(browserAPI.i18n.getMessage('cannot_delete_last_list') || 'Cannot delete the last list');
      return;
    }
    if (confirm(browserAPI.i18n.getMessage('confirm_delete_list') || 'Delete this list?')) {
      const currentIndex = this.getCurrentListIndex();
      this.lists.splice(currentIndex, 1);
      this.setCurrentListIndex(Math.max(0, currentIndex - 1));
      void this.saveAndNotify();
    }
  }

  private applyListSettings(): void {
    const listBg = document.getElementById('listBg') as HTMLInputElement;
    const listFg = document.getElementById('listFg') as HTMLInputElement;
    const listActive = document.getElementById('listActive') as HTMLInputElement;
    const currentIndex = this.getCurrentListIndex();

    this.lists[currentIndex].background = listBg.value;
    this.lists[currentIndex].foreground = listFg.value;
    this.lists[currentIndex].active = listActive.checked;

    void this.saveAndNotify();
  }

  updatePreview(): void {
    const listBg = document.getElementById('listBg') as HTMLInputElement;
    const listFg = document.getElementById('listFg') as HTMLInputElement;
    const preview = document.getElementById('previewHighlight') as HTMLElement;

    if (preview && listBg && listFg) {
      preview.style.backgroundColor = listBg.value;
      preview.style.color = listFg.value;
    }
  }

  render(): void {
    const currentListName = document.getElementById('currentListName');
    const currentListColor = document.getElementById('currentListColor') as HTMLElement;
    const dropdownMenu = document.getElementById('listDropdownMenu');
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];

    if (currentListName) {
      currentListName.textContent = list.name;
    }
    if (currentListColor) {
      currentListColor.style.backgroundColor = list.background;
    }

    if (dropdownMenu) {
      dropdownMenu.innerHTML = this.lists.map((l, index) => `
        <div class="list-dropdown-item ${index === currentIndex ? 'selected' : ''}" data-index="${index}">
          <div class="list-color-indicator" style="background-color: ${l.background}"></div>
          <span>${DOMUtils.escapeHtml(l.name)}</span>
          ${index === currentIndex ? '<i class="fa-solid fa-check list-dropdown-item-check"></i>' : ''}
        </div>
      `).join('');

      dropdownMenu.querySelectorAll('.list-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const index = Number((item as HTMLElement).dataset.index);
          if (!Number.isNaN(index)) {
            this.setCurrentListIndex(index);
            this.onListsChanged();
            dropdownMenu.classList.remove('open');
          }
        });
      });
    }

    this.updateListForm();
  }

  updateListForm(): void {
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
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

  private async saveAndNotify(): Promise<void> {
    try {
      await StorageService.update('lists', this.lists);
      MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
      this.onListsChanged();
    } catch (error) {
      console.error('ListManager.saveAndNotify error:', error);
    }
  }
}

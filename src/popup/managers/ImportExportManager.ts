import { browserAPI } from '../../utils/browser.js';
import { HighlightList, ExportData, ExceptionsMode } from '../../types.js';
import { StorageService } from '../../services/StorageService.js';
import { MessageService } from '../../services/MessageService.js';

export class ImportExportManager {
  constructor(
    private lists: HighlightList[],
    private getCurrentListIndex: () => number,
    private setCurrentListIndex: (index: number) => void,
    private getExceptionsList: () => string[],
    private getExceptionsWhiteList: () => string[],
    private getExceptionsMode: () => ExceptionsMode,
    private setExceptionsList: (list: string[]) => void,
    private setExceptionsWhiteList: (list: string[]) => void,
    private setExceptionsMode: (mode: ExceptionsMode) => void,
    private onDataChanged: () => void
  ) {}

  setupEventListeners(): void {
    this.setupListImportExport();
    this.setupSettingsImportExport();
  }

  private setupListImportExport(): void {
    const importListInput = document.getElementById('importListInput') as HTMLInputElement;

    document.getElementById('exportListBtn')?.addEventListener('click', () => {
      this.exportCurrentList();
    });

    document.getElementById('importListBtn')?.addEventListener('click', () => {
      importListInput?.click();
    });

    importListInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        this.importLists(e.target?.result as string);
      };
      reader.readAsText(file);
      importListInput.value = '';
    });
  }

  private setupSettingsImportExport(): void {
    const importSettingsInput = document.getElementById('importSettingsInput') as HTMLInputElement;

    document.getElementById('exportSettingsBtn')?.addEventListener('click', () => {
      this.exportSettings();
    });

    document.getElementById('importSettingsBtn')?.addEventListener('click', () => {
      importSettingsInput?.click();
    });

    importSettingsInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        await this.importSettings(event.target?.result as string);
        importSettingsInput.value = '';
      };
      reader.readAsText(file);
    });
  }

  private exportCurrentList(): void {
    const currentIndex = this.getCurrentListIndex();
    const list = this.lists[currentIndex];
    if (!list) return;
    
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (list.name || 'list').replace(/[^a-zA-Z0-9-_]/g, '-');
    a.download = `${safeName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importLists(jsonString: string): void {
    try {
      const data = JSON.parse(jsonString);
      const toAdd: HighlightList[] = [];

      if (Array.isArray(data)) {
        data.forEach((item: unknown) => {
          if (this.isValidList(item)) toAdd.push(item);
        });
      } else if (data && typeof data === 'object') {
        if (Array.isArray(data.lists)) {
          data.lists.forEach((item: unknown) => {
            if (this.isValidList(item)) toAdd.push(item);
          });
        } else if (this.isValidList(data)) {
          toAdd.push(data);
        }
      }

      if (toAdd.length === 0) {
        alert(browserAPI.i18n.getMessage('invalid_import_format') || 'Invalid list format. Please select a valid list file.');
        return;
      }
      
      const baseId = Date.now();
      toAdd.forEach((l, i) => {
        this.lists.push({ ...l, id: baseId + i });
      });
      
      this.saveAndNotify();
    } catch (err) {
      alert(browserAPI.i18n.getMessage('invalid_json_error') + ': ' + (err as Error).message);
    }
  }

  private exportSettings(): void {
    const data: ExportData = {
      lists: this.lists,
      exceptionsList: [...this.getExceptionsList()],
      exceptionsWhiteList: [...this.getExceptionsWhiteList()],
      exceptionsMode: this.getExceptionsMode()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'goose-highlighter-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private async importSettings(jsonString: string): Promise<void> {
    try {
      const data = JSON.parse(jsonString) as unknown;

      if (!data || typeof data !== 'object') {
        alert(browserAPI.i18n.getMessage('invalid_import_format') || 'Invalid file format. Please select a valid export file.');
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
          this.lists.length = 0;
          this.lists.push(...validLists);
          const currentIndex = this.getCurrentListIndex();
          this.setCurrentListIndex(Math.min(currentIndex, this.lists.length - 1));
          listsApplied = true;
        }
      }

      if (Array.isArray(obj.exceptionsList)) {
        this.setExceptionsList(obj.exceptionsList.filter((d): d is string => typeof d === 'string'));
        exceptionsApplied = true;
      }
      if (Array.isArray(obj.exceptionsWhiteList)) {
        this.setExceptionsWhiteList(obj.exceptionsWhiteList.filter((d): d is string => typeof d === 'string'));
        exceptionsApplied = true;
      }
      if (obj.exceptionsMode === 'whitelist' || obj.exceptionsMode === 'blacklist') {
        this.setExceptionsMode(obj.exceptionsMode);
        exceptionsApplied = true;
      }

      if (!listsApplied && !exceptionsApplied) {
        alert(browserAPI.i18n.getMessage('invalid_import_format') || 'Invalid file format. Please select a valid export file.');
        return;
      }

      if (listsApplied && this.lists.length === 0) {
        this.lists.push({
          id: Date.now(),
          name: browserAPI.i18n.getMessage('default_list_name') || 'Default List',
          background: '#ffff00',
          foreground: '#000000',
          active: true,
          words: []
        });
      }

      await StorageService.set({
        lists: this.lists,
        exceptionsList: this.getExceptionsList(),
        exceptionsWhiteList: this.getExceptionsWhiteList(),
        exceptionsMode: this.getExceptionsMode()
      });
      MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
      MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
      this.onDataChanged();
    } catch (err) {
      alert((browserAPI.i18n.getMessage('invalid_json_error') || 'Invalid JSON file') + ': ' + (err as Error).message);
    }
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

  private async saveAndNotify(): Promise<void> {
    await StorageService.update('lists', this.lists);
    MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
    this.onDataChanged();
  }
}

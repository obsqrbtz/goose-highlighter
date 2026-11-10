import { browserAPI } from '../../utils/browser.js';
import { HighlightList, ExportData, ExceptionsMode } from '../../types.js';
import { StorageService } from '../../services/StorageService.js';
import { MessageService } from '../../services/MessageService.js';
import { ImportService } from '../../services/ImportService.js';

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
    private ensureLists: () => Promise<void>,
    private onDataChanged: () => void
  ) {}

  private isLinux = false;

  setupEventListeners(): void {
    void this.detectPlatform();
    this.setupListImportExport();
    this.setupSettingsImportExport();
  }

  private async detectPlatform(): Promise<void> {
    try {
      const info = await browserAPI.runtime.getPlatformInfo();
      this.isLinux = info.os === 'linux';
    } catch {
      this.isLinux = false;
    }
  }

  private openImportTab(type: 'list' | 'settings'): void {
    const url = browserAPI.runtime.getURL(`import/import.html?type=${type}`);
    void browserAPI.tabs.create({ url });
  }

  private setupListImportExport(): void {
    const importListInput = document.getElementById('importListInput') as HTMLInputElement;

    document.getElementById('exportListBtn')?.addEventListener('click', () => {
      this.exportCurrentList();
    });

    document.getElementById('importListBtn')?.addEventListener('click', () => {
      if (this.isLinux) {
        this.openImportTab('list');
      } else {
        importListInput?.click();
      }
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
      void this.exportSettings();
    });

    document.getElementById('importSettingsBtn')?.addEventListener('click', () => {
      if (this.isLinux) {
        this.openImportTab('settings');
      } else {
        importSettingsInput?.click();
      }
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
      const toAdd = ImportService.extractLists(jsonString);

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

  private async exportSettings(): Promise<void> {
    await this.ensureLists();
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
      const settings = ImportService.extractSettings(jsonString);
      await this.ensureLists();
      let listsApplied = false;
      let exceptionsApplied = false;

      if (settings.lists?.length) {
        const baseId = Date.now();
        const validLists = settings.lists.map((item, i) => ({ ...item, id: baseId + i }));
        this.lists.length = 0;
        this.lists.push(...validLists);
        const currentIndex = this.getCurrentListIndex();
        this.setCurrentListIndex(Math.min(currentIndex, this.lists.length - 1));
        listsApplied = true;
      }

      if (settings.exceptionsList) {
        this.setExceptionsList(settings.exceptionsList);
        exceptionsApplied = true;
      }
      if (settings.exceptionsWhiteList) {
        this.setExceptionsWhiteList(settings.exceptionsWhiteList);
        exceptionsApplied = true;
      }
      if (settings.exceptionsMode) {
        this.setExceptionsMode(settings.exceptionsMode);
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

  private async saveAndNotify(): Promise<void> {
    await StorageService.update('lists', this.lists);
    MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
    this.onDataChanged();
  }
}

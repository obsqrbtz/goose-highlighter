import { ExceptionsMode } from '../../types.js';
import { StorageService } from '../../services/StorageService.js';
import { MessageService } from '../../services/MessageService.js';
import { PopupRenderer } from './PopupRenderer.js';

export class ExceptionsManager {
  constructor(
    private exceptionsList: string[],
    private exceptionsWhiteList: string[],
    private exceptionsMode: ExceptionsMode,
    private currentTabHost: string,
    private onExceptionsChanged: () => void
  ) {}

  setupEventListeners(): void {
    document.getElementById('exceptionsModeSelect')?.addEventListener('change', async (e) => {
      try {
        const value = (e.target as HTMLSelectElement).value;
        this.exceptionsMode = value === 'whitelist' ? 'whitelist' : 'blacklist';
        await StorageService.update('exceptionsMode', this.exceptionsMode);
        MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
        this.onExceptionsChanged();
      } catch (error) {
        console.error('Error updating exceptions mode:', error);
      }
    });

    document.getElementById('addExceptionBtn')?.addEventListener('click', () => this.addExceptionFromInput());
    document.getElementById('addCurrentSiteBtn')?.addEventListener('click', () => void this.addCurrentSiteToExceptions());
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
        await this.saveAndNotify();
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
        await this.saveAndNotify();
      }
    });
  }

  private getCurrentExceptionsList(): string[] {
    return this.exceptionsMode === 'whitelist' ? this.exceptionsWhiteList : this.exceptionsList;
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
    void this.saveAndNotify();
  }

  private async addCurrentSiteToExceptions(): Promise<void> {
    const host = this.currentTabHost;
    if (!host) return;
    const domain = host.toLowerCase();
    const list = this.getCurrentExceptionsList();
    if (list.includes(domain)) return;
    if (this.exceptionsMode === 'whitelist') {
      this.exceptionsWhiteList.push(domain);
    } else {
      this.exceptionsList.push(domain);
    }
    await this.saveAndNotify();
  }

  render(): void {
    this.updateExceptionsModeSelect();
    this.updateExceptionsModeLabel();
    this.updateExceptionsModeHint();
    this.updateAddCurrentSiteButton();
    this.renderExceptionsList();
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

  private renderExceptionsList(): void {
    const container = document.getElementById('exceptionsList');
    if (!container) return;

    const list = this.getCurrentExceptionsList();
    if (list.length === 0) {
      container.innerHTML = `<div class="exception-item exception-empty">${chrome.i18n.getMessage('no_exceptions') || 'No exceptions'}</div>`;
      return;
    }

    container.innerHTML = list.map(domain => PopupRenderer.createExceptionItemHTML(domain)).join('');
  }

  private async saveAndNotify(): Promise<void> {
    try {
      await StorageService.set({
        exceptionsList: this.exceptionsList,
        exceptionsWhiteList: this.exceptionsWhiteList
      });
      MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
      this.onExceptionsChanged();
    } catch (error) {
      console.error('ExceptionsManager.saveAndNotify error:', error);
    }
  }

  getExceptionsList(): string[] {
    return this.exceptionsList;
  }

  getExceptionsWhiteList(): string[] {
    return this.exceptionsWhiteList;
  }

  getExceptionsMode(): ExceptionsMode {
    return this.exceptionsMode;
  }
}

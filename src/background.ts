import { StorageService } from './services/StorageService.js';

const POPUP_STATE_KEY = 'goose-popup-ui-state';

class BackgroundService {
    constructor() {
        this.initialize();
    }

    private initialize(): void {
        this.setupTabUpdateListener();
        this.setupInstallListener();
        this.setupPopupStateListener();
    }

    private setupPopupStateListener(): void {
        chrome.runtime.onMessage.addListener((msg: { type?: string; payload?: unknown }, _sender, sendResponse) => {
            if (msg.type === 'SAVE_POPUP_STATE' && msg.payload !== undefined) {
                chrome.storage.local.set({ [POPUP_STATE_KEY]: JSON.stringify(msg.payload) }).then(() => sendResponse(undefined)).catch(() => sendResponse(undefined));
                return true;
            }
            return false;
        });
    }

    private setupTabUpdateListener(): void {
        chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): void => {
            if (changeInfo.status === 'complete' && tab.url && /^https?:/.test(tab.url)) {
                chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['dist/content-standalone.js']
                }).catch((err: unknown) => {
                    console.warn('Injection failed:', err);
                });
            }
        });
    }

    private setupInstallListener(): void {
        chrome.runtime.onInstalled.addListener(async (): Promise<void> => {
            const data = await StorageService.get(['exceptionsList']);
            if (!data.exceptionsList) {
                await StorageService.update('exceptionsList', []);
            }
        });
    }

}

new BackgroundService();

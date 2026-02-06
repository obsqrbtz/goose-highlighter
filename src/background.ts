import { StorageService } from './services/StorageService.js';

class BackgroundService {
    constructor() {
        this.initialize();
    }

    private initialize(): void {
        this.setupTabUpdateListener();
        this.setupInstallListener();
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

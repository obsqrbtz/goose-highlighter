import { StorageService } from './services/StorageService.js';

class BackgroundService {
    constructor() {
        this.initialize();
    }

    private initialize(): void {
        this.setupTabUpdateListener();
        this.setupInstallListener();
        this.setupContextMenu();
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
            chrome.contextMenus.removeAll(() => {
                chrome.contextMenus.create({
                    id: 'manage-lists',
                    title: 'Manage Lists',
                    contexts: ['action']
                });
            });
        });
    }

    private setupContextMenu(): void {
        chrome.contextMenus.onClicked.addListener((info) => {
            if (info.menuItemId === 'manage-lists') {
                this.openListManagerWindow();
            }
        });
    }

    private openListManagerWindow(): void {
        chrome.windows.create({
            url: chrome.runtime.getURL('list-manager/list-manager.html'),
            type: 'popup',
            width: 1280,
            height: 700,
            focused: true
        });
    }
}

new BackgroundService();

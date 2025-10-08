// Handle tab updates to inject content script
chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): void => {
    if (changeInfo.status === 'complete' && tab.url && /^https?:/.test(tab.url)) {
        chrome.scripting.executeScript({
            target: { tabId },
            files: ['dist/main.js']
        }).catch((err: unknown) => {
            console.warn('Injection failed:', err);
        });
    }
});

// Initialize storage on extension install
chrome.runtime.onInstalled.addListener((): void => {
    chrome.storage.local.get(['exceptionsList'], (result: any) => {
        if (!result.exceptionsList) {
            chrome.storage.local.set({ exceptionsList: [] });
        }
    });
});
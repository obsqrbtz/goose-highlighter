chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && /^https?:/.test(tab.url)) {
        chrome.scripting.executeScript({
            target: { tabId },
            files: ["main.js"]
        }).catch(err => {
            console.warn("Injection failed:", err);
        });
    }
});
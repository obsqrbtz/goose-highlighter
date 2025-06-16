async function getLists() {
    const { lists } = await chrome.storage.local.get("lists");
    return lists || [];
}

async function saveLists(lists) {
    await chrome.storage.local.set({ lists });
}

export async function getLists() {
    const { lists } = await chrome.storage.local.get("lists");
    return lists || [];
}

export async function saveLists(lists) {
    await chrome.storage.local.set({ lists });
}

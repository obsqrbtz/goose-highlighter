const globalBrowser = (globalThis as unknown as { browser?: typeof chrome }).browser;

export const browserAPI: typeof chrome = globalBrowser ?? chrome;

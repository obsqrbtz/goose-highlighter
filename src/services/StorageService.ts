import { StorageData, DEFAULT_STORAGE } from '../types.js';

export class StorageService {
  static async get<K extends keyof StorageData>(keys: K[]): Promise<Pick<StorageData, K>>;
  static async get(): Promise<StorageData>;
  static async get(keys?: (keyof StorageData)[]): Promise<any> {
    const defaults = DEFAULT_STORAGE;
    if (keys) {
      const keyDefaults: any = {};
      keys.forEach(key => {
        keyDefaults[key] = defaults[key];
      });
      return chrome.storage.local.get(keyDefaults);
    }
    return chrome.storage.local.get(defaults);
  }

  static async set(data: Partial<StorageData>): Promise<void> {
    return chrome.storage.local.set(data);
  }

  static async update<K extends keyof StorageData>(key: K, value: StorageData[K]): Promise<void> {
    return this.set({ [key]: value } as Partial<StorageData>);
  }
}
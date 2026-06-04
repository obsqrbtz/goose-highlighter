import { StorageData, DEFAULT_STORAGE } from '../types.js';

export class StorageService {
  static async get<K extends keyof StorageData>(keys: K[]): Promise<Pick<StorageData, K>>;
  static async get(): Promise<StorageData>;
  static async get(keys?: (keyof StorageData)[]): Promise<StorageData | Pick<StorageData, keyof StorageData>> {
    try {
      const defaults = DEFAULT_STORAGE;
      if (keys) {
        const keyDefaults = {} as Record<string, unknown>;
        keys.forEach(key => {
          keyDefaults[key] = defaults[key];
        });
        return await chrome.storage.local.get(keyDefaults) as Pick<StorageData, typeof keys[number]>;
      }
      return await chrome.storage.local.get(defaults) as StorageData;
    } catch (error) {
      console.error('StorageService.get error:', error);
      // Return defaults on error
      if (keys) {
        const keyDefaults = {} as Record<string, unknown>;
        keys.forEach(key => {
          keyDefaults[key] = DEFAULT_STORAGE[key];
        });
        return keyDefaults as Pick<StorageData, typeof keys[number]>;
      }
      return DEFAULT_STORAGE;
    }
  }

  static async set(data: Partial<StorageData>): Promise<void> {
    try {
      await chrome.storage.local.set(data);
    } catch (error) {
      console.error('StorageService.set error:', error);
      throw error;
    }
  }

  static async update<K extends keyof StorageData>(key: K, value: StorageData[K]): Promise<void> {
    try {
      await this.set({ [key]: value });
    } catch (error) {
      console.error(`StorageService.update error for key '${String(key)}':`, error);
      throw error;
    }
  }
}
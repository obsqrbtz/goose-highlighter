import { browserAPI } from '../utils/browser.js';
import { HighlightList, ExceptionsMode, StorageData } from '../types.js';
import { StorageService } from './StorageService.js';
import { MessageService } from './MessageService.js';

export interface ParsedSettings {
  lists?: HighlightList[];
  exceptionsList?: string[];
  exceptionsWhiteList?: string[];
  exceptionsMode?: ExceptionsMode;
}

export class ImportService {
  static isValidList(obj: unknown): obj is HighlightList {
    if (!obj || typeof obj !== 'object') return false;
    const o = obj as Record<string, unknown>;
    return (
      typeof o.name === 'string' &&
      Array.isArray(o.words) &&
      (typeof o.background === 'string' || typeof o.background === 'undefined') &&
      (typeof o.foreground === 'string' || typeof o.foreground === 'undefined')
    );
  }

  /** Parse a "list import" file into valid lists (no ids assigned). Throws on bad JSON. */
  static extractLists(jsonString: string): HighlightList[] {
    const data = JSON.parse(jsonString) as unknown;
    const out: HighlightList[] = [];
    if (Array.isArray(data)) {
      data.forEach((item: unknown) => { if (this.isValidList(item)) out.push(item); });
    } else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.lists)) {
        obj.lists.forEach((item: unknown) => { if (this.isValidList(item)) out.push(item); });
      } else if (this.isValidList(data)) {
        out.push(data);
      }
    }
    return out;
  }

  /** Parse a "settings export" file. Throws on bad JSON. */
  static extractSettings(jsonString: string): ParsedSettings {
    const data = JSON.parse(jsonString) as unknown;
    if (!data || typeof data !== 'object') return {};
    const obj = data as Record<string, unknown>;
    const result: ParsedSettings = {};
    if (Array.isArray(obj.lists)) {
      result.lists = obj.lists.filter((item: unknown) => this.isValidList(item)) as HighlightList[];
    }
    if (Array.isArray(obj.exceptionsList)) {
      result.exceptionsList = obj.exceptionsList.filter((d): d is string => typeof d === 'string');
    }
    if (Array.isArray(obj.exceptionsWhiteList)) {
      result.exceptionsWhiteList = obj.exceptionsWhiteList.filter((d): d is string => typeof d === 'string');
    }
    if (obj.exceptionsMode === 'whitelist' || obj.exceptionsMode === 'blacklist') {
      result.exceptionsMode = obj.exceptionsMode;
    }
    return result;
  }

  /** Append imported lists to whatever is already stored. Returns count added. */
  static async importListsToStorage(jsonString: string): Promise<number> {
    const toAdd = this.extractLists(jsonString);
    if (toAdd.length === 0) {
      throw new Error(browserAPI.i18n.getMessage('invalid_import_format') || 'Invalid list format.');
    }
    const data = await StorageService.get();
    const lists = data.lists || [];
    const baseId = Date.now();
    toAdd.forEach((l, i) => lists.push({ ...l, id: baseId + i }));
    await StorageService.update('lists', lists);
    MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
    return toAdd.length;
  }

  /** Apply a settings export (lists replace, exceptions replace). */
  static async importSettingsToStorage(jsonString: string): Promise<void> {
    const parsed = this.extractSettings(jsonString);
    const hasLists = !!parsed.lists && parsed.lists.length > 0;
    const hasExceptions =
      parsed.exceptionsList !== undefined ||
      parsed.exceptionsWhiteList !== undefined ||
      parsed.exceptionsMode !== undefined;
    if (!hasLists && !hasExceptions) {
      throw new Error(browserAPI.i18n.getMessage('invalid_import_format') || 'Invalid file format.');
    }
    const patch: Partial<StorageData> = {};
    if (hasLists) {
      const baseId = Date.now();
      patch.lists = parsed.lists!.map((l, i) => ({ ...l, id: baseId + i }));
    }
    if (parsed.exceptionsList !== undefined) patch.exceptionsList = parsed.exceptionsList;
    if (parsed.exceptionsWhiteList !== undefined) patch.exceptionsWhiteList = parsed.exceptionsWhiteList;
    if (parsed.exceptionsMode !== undefined) patch.exceptionsMode = parsed.exceptionsMode;
    await StorageService.set(patch);
    MessageService.sendToAllTabs({ type: 'WORD_LIST_UPDATED' });
    MessageService.sendToAllTabs({ type: 'EXCEPTIONS_LIST_UPDATED' });
  }
}

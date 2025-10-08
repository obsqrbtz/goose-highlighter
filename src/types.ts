// Type definitions for the Goose Highlighter extension

export interface HighlightWord {
  wordStr: string;
  background: string;
  foreground: string;
  active: boolean;
}

export interface HighlightList {
  id: number;
  name: string;
  background: string;
  foreground: string;
  active: boolean;
  words: HighlightWord[];
}

export interface StorageData {
  lists: HighlightList[];
  globalHighlightEnabled: boolean;
  matchCaseEnabled: boolean;
  matchWholeEnabled: boolean;
  exceptionsList: string[];
}

export interface ActiveWord {
  text: string;
  background: string;
  foreground: string;
}

export interface MessageData {
  type: 'WORD_LIST_UPDATED' | 'GLOBAL_TOGGLE_UPDATED' | 'MATCH_OPTIONS_UPDATED' | 'EXCEPTIONS_LIST_UPDATED';
  enabled?: boolean;
  matchCase?: boolean;
  matchWhole?: boolean;
}

export interface SectionStates {
  [sectionName: string]: boolean;
}

export interface ExportData {
  lists: HighlightList[];
  exceptionsList: string[];
}

// DOM element selectors used in popup
export interface PopupElements {
  listSelect: HTMLSelectElement;
  listName: HTMLInputElement;
  listBg: HTMLInputElement;
  listFg: HTMLInputElement;
  listActive: HTMLInputElement;
  bulkPaste: HTMLTextAreaElement;
  wordList: HTMLDivElement;
  importInput: HTMLInputElement;
  matchCase: HTMLInputElement;
  matchWhole: HTMLInputElement;
}

// Default storage values
export const DEFAULT_STORAGE: Partial<StorageData> = {
  lists: [],
  globalHighlightEnabled: true,
  matchCaseEnabled: false,
  matchWholeEnabled: false,
  exceptionsList: []
};

// Constants
export const WORD_ITEM_HEIGHT = 32;
export const DEBOUNCE_DELAY = 300;
export const SCROLL_THROTTLE = 16; // ~60fps
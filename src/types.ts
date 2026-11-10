export interface HighlightWord {
  wordStr: string;
  background: string;
  foreground: string;
  active: boolean;
}

export function isValidHighlightWord(value: unknown): value is { wordStr: string } & Partial<HighlightWord> {
  if (!value || typeof value !== 'object') return false;
  const word = value as Partial<HighlightWord>;
  return typeof word.wordStr === 'string' && word.wordStr.trim().length > 0 &&
    (word.active === undefined || typeof word.active === 'boolean') &&
    (word.background === undefined || typeof word.background === 'string') &&
    (word.foreground === undefined || typeof word.foreground === 'string');
}

export interface HighlightList {
  id: number;
  name: string;
  background: string;
  foreground: string;
  active: boolean;
  words: HighlightWord[];
}

export type ExceptionsMode = 'blacklist' | 'whitelist';

export type BadgeHorizontal = 'left' | 'right';
export type BadgeVertical = 'top' | 'center' | 'bottom';
export type BadgePlacement = 'inside' | 'outside' | 'border';

export interface BadgePosition {
  horizontal: BadgeHorizontal;
  vertical: BadgeVertical;
  placement: BadgePlacement;
}

export interface StorageData {
  lists: HighlightList[];
  globalHighlightEnabled: boolean;
  matchCaseEnabled: boolean;
  matchWholeEnabled: boolean;
  exceptionsList: string[];
  exceptionsWhiteList: string[];
  exceptionsMode: ExceptionsMode;
  badgePosition: BadgePosition;
}

export interface ActiveWord {
  text: string;
  background: string;
  foreground: string;
  listId?: number;
  listName?: string;
}

export interface HighlightInfo {
  word: string;
  count: number;
  background: string;
  foreground: string;
  listId?: number;
  listName?: string;
  listNames?: string[];
}

export interface MessageData {
  type: 'WORD_LIST_UPDATED' | 'GLOBAL_TOGGLE_UPDATED' | 'MATCH_OPTIONS_UPDATED' | 'EXCEPTIONS_LIST_UPDATED' | 'GET_PAGE_HIGHLIGHTS' | 'PAGE_HIGHLIGHTS_RESPONSE' | 'SCROLL_TO_HIGHLIGHT' | 'BADGE_POSITION_UPDATED';
  enabled?: boolean;
  matchCase?: boolean;
  matchWhole?: boolean;
  highlights?: HighlightInfo[];
  word?: string;
  index?: number;
  badgePosition?: BadgePosition;
}

export interface ExportData {
  lists: HighlightList[];
  exceptionsList: string[];
  exceptionsWhiteList?: string[];
  exceptionsMode?: ExceptionsMode;
}

export const DEFAULT_STORAGE: StorageData = {
  lists: [],
  globalHighlightEnabled: true,
  matchCaseEnabled: false,
  matchWholeEnabled: false,
  exceptionsList: [],
  exceptionsWhiteList: [],
  exceptionsMode: 'blacklist',
  badgePosition: { horizontal: 'right', vertical: 'top', placement: 'border' }
};

export const CONSTANTS = {
  WORD_ITEM_HEIGHT: 32,
  DEBOUNCE_DELAY: 150,
  SCROLL_THROTTLE: 16
} as const;

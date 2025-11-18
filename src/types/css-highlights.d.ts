// CSS Highlights API type declarations
interface Highlight {
  new(...ranges: Range[]): Highlight;
  add(range: Range): void;
  clear(): void;
  delete(range: Range): boolean;
  has(range: Range): boolean;
  readonly size: number;
}

interface HighlightRegistry {
  set(name: string, highlight: Highlight): void;
  get(name: string): Highlight | undefined;
  delete(name: string): boolean;
  clear(): void;
  has(name: string): boolean;
  readonly size: number;
}

interface CSS {
  highlights: HighlightRegistry;
}

declare var Highlight: {
  prototype: Highlight;
  new(...ranges: Range[]): Highlight;
};

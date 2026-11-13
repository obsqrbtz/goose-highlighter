// CSS Highlights API type declarations
interface Highlight {
  new(...ranges: AbstractRange[]): Highlight;
  priority: number;
  add(range: AbstractRange): void;
  clear(): void;
  delete(range: AbstractRange): boolean;
  has(range: AbstractRange): boolean;
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
  new(...ranges: AbstractRange[]): Highlight;
};

declare module '*.css' {
  const content: string;
  export default content;
}

declare module 'html-to-image' {
  export function toPng(node: HTMLElement, options?: object): Promise<string>;
}

interface ViewTransition {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

interface Document {
  startViewTransition?(callback: () => void): ViewTransition;
}

interface HTMLTextAreaElement {
  scrollTarget?: number;
  onInputHandler?: (e: { target: HTMLTextAreaElement }) => void;
}

interface Window {
  logSSEEvents?: boolean;
  startViewTransition?: (callback: () => void) => ViewTransition;
}

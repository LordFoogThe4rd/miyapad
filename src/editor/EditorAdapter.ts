import type { EditorView as PMEditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { textOffsetToPMPos, pmPosToTextOffset } from './chunkDecorations';
import { textToDoc } from './syncReactToPM';

export interface EditorAdapter {
  getText(): string;
  // All positions below are flat text offsets into getText() (e.g. substring indexes),
  // NOT ProseMirror document positions. Implementations convert internally.
  getSelection(): { from: number; to: number };
  replaceText(newText: string): void;
  replaceRange(from: number, to: number, insert: string): void;
  replaceRanges(changes: { from: number; to: number; insert: string }[]): void;
  focus(): void;
  scrollIntoView(pos: number, options?: { y?: string }): void;
  setSelection(anchor: number, head: number): void;
  posAtCoords(coords: { x: number; y: number }): number | null;
  coordsAtPos(pos: number): { top: number; left: number; right: number; bottom: number } | null;
  readonly dom: HTMLElement;
  destroy(): void;
}

export class ProseMirrorAdapter implements EditorAdapter {
  constructor(private view: PMEditorView, private scroller?: HTMLElement | null) {}

  getText(): string {
    return this.view.state.doc.textBetween(0, this.view.state.doc.content.size, '\n');
  }

  getSelection(): { from: number; to: number } {
    const sel = this.view.state.selection;
    return { from: pmPosToTextOffset(this.view.state.doc, sel.from), to: pmPosToTextOffset(this.view.state.doc, sel.to) };
  }

  replaceText(newText: string): void {
    const { doc } = this.view.state;
    // Compare using the same \n-separated representation as getText()
    if (newText === doc.textBetween(0, doc.content.size, '\n')) return;
    const newDoc = textToDoc(this.view.state.schema, newText);
    this.view.dispatch(
      this.view.state.tr.replaceWith(0, doc.content.size, newDoc.content)
    );
  }

  replaceRange(from: number, to: number, insert: string): void {
    const pmFrom = textOffsetToPMPos(this.view.state.doc, from);
    const pmTo = textOffsetToPMPos(this.view.state.doc, to);
    this.view.dispatch(this.view.state.tr.insertText(insert, pmFrom, pmTo));
  }

  replaceRanges(changes: { from: number; to: number; insert: string }[]): void {
    // Sort descending by `from` so later changes don't invalidate earlier offsets
    const sorted = [...changes].sort((a, b) => b.from - a.from);
    let tr = this.view.state.tr;
    for (const change of sorted) {
      const pmFrom = textOffsetToPMPos(this.view.state.doc, change.from);
      const pmTo = textOffsetToPMPos(this.view.state.doc, change.to);
      tr = tr.insertText(change.insert, pmFrom, pmTo);
    }
    this.view.dispatch(tr);
  }

  focus(): void {
    this.view.focus();
  }

  scrollIntoView(pos: number, options?: { y?: string }): void {
    const coords = this.coordsAtPos(pos);
    const scroller = this.scroller;
    if (!coords || !scroller) return;
    const viewRect = this.view.dom.getBoundingClientRect();
    if (options?.y === 'center') {
      scroller.scrollTop = coords.top - viewRect.top - scroller.clientHeight / 2;
    } else if (options?.y === 'end') {
      scroller.scrollTop = coords.bottom - viewRect.top - scroller.clientHeight;
    } else {
      scroller.scrollTop = coords.top - viewRect.top;
    }
  }

  setSelection(anchor: number, head: number): void {
    const pmAnchor = textOffsetToPMPos(this.view.state.doc, anchor);
    const pmHead = textOffsetToPMPos(this.view.state.doc, head);
    const $anchor = this.view.state.doc.resolve(pmAnchor);
    const $head = this.view.state.doc.resolve(pmHead);
    const sel = TextSelection.create(this.view.state.doc, $anchor.pos, $head.pos);
    this.view.dispatch(this.view.state.tr.setSelection(sel));
  }

  posAtCoords(coords: { x: number; y: number }): number | null {
    const result = this.view.posAtCoords({ left: coords.x, top: coords.y });
    if (!result) return null;
    return pmPosToTextOffset(this.view.state.doc, result.pos);
  }

  coordsAtPos(pos: number): { top: number; left: number; right: number; bottom: number } | null {
    const pmPos = textOffsetToPMPos(this.view.state.doc, pos);
    return this.view.coordsAtPos(pmPos);
  }

  get dom(): HTMLElement {
    return this.view.dom;
  }

  destroy(): void {
    this.view.destroy();
  }

}

import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Decoration } from 'prosemirror-view';
import { schema } from './schema';
import { textToDoc } from './syncReactToPM';
import { markdownDecorationPlugin } from './markdownDecorations';
import { markdownCaretKey, markdownCaretPlugin } from './markdownCaret';

// attrs (not spec) carry the class; Decoration exposes spec publicly but attrs
// only via the internal DecorationType.
function classOf(d: Decoration): string {
	const attrs = (d as unknown as { type: { attrs?: Record<string, unknown> } }).type.attrs;
	return (attrs?.class as string) ?? '';
}

function decosFor(text: string, caret: number, active = true): Decoration[] {
	const state = EditorState.create({
		doc: textToDoc(schema, text),
		plugins: [markdownDecorationPlugin({ current: active }), markdownCaretPlugin],
	});
	const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, caret)));
	return markdownCaretKey.getState(moved)!.find();
}

function spans(text: string, caret: number, className: string): [number, number][] {
	return decosFor(text, caret)
		.filter((d) => classOf(d).split(' ').includes(className))
		.map((d) => [d.from, d.to]);
}

// "# H **bold** tail": heading marker at [1,3), strong markers at [5,7) and
// [11,13) around the content at [7,11), paragraph node at [0,19).
const LINE = '# H **bold** tail';

describe('markdownCaretPlugin', () => {
	it('reveals only the construct the caret is inside', () => {
		expect(spans(LINE, 9, 'pm-md-reveal')).toEqual([[5, 7], [11, 13]]);
	});

	it('leaves inline markers hidden when the caret is elsewhere on the line', () => {
		expect(spans(LINE, 15, 'pm-md-reveal')).toEqual([]);
	});

	it('holds back the line prefix while an inline construct is revealed', () => {
		// Innermost wins: in bold, only the asterisks show. In tail, no inline
		// construct contains the caret, so the paragraph goes active and the
		// "# " comes back.
		expect(spans(LINE, 9, 'pm-md-active')).toEqual([]);
		expect(spans(LINE, 15, 'pm-md-active')).toEqual([[0, 19]]);
	});

	it('reveals with the caret against either edge of the construct', () => {
		// You have to be able to sit just past the closing "**" to delete it.
		expect(spans(LINE, 5, 'pm-md-reveal')).toEqual([[5, 7], [11, 13]]);
		expect(spans(LINE, 13, 'pm-md-reveal')).toEqual([[5, 7], [11, 13]]);
		expect(spans(LINE, 4, 'pm-md-reveal')).toEqual([]);
		expect(spans(LINE, 14, 'pm-md-reveal')).toEqual([]);
	});

	it('activates exactly the paragraph holding the caret', () => {
		// three single-char paragraphs: [0,3), [3,6), [6,9)
		expect(spans('a\nb\nc', 4, 'pm-md-active')).toEqual([[3, 6]]);
	});

	it('reveals a nested construct and its parent together', () => {
		// "**bold *and italic***" — caret inside the em is inside the strong too
		expect(spans('**bold *and italic***', 12, 'pm-md-reveal')).toHaveLength(4);
	});

	it('puts the reveal class on the marker element itself, not around it', () => {
		// The whole CSS contract rests on this: .pm-md-marker is display:none and
		// .pm-md-marker.pm-md-reveal undoes it, which only works because
		// ProseMirror merges decorations covering the same range onto one element.
		const container = document.createElement('div');
		document.body.appendChild(container);
		const view = new EditorView(container, {
			state: EditorState.create({
				doc: textToDoc(schema, LINE),
				plugins: [markdownDecorationPlugin({ current: true }), markdownCaretPlugin],
			}),
		});

		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9)));
		expect(container.querySelectorAll('.pm-md-marker.pm-md-reveal')).toHaveLength(2);
		// the heading's "# " stays hidden while the asterisks are showing
		expect(container.querySelectorAll('p.pm-md-active')).toHaveLength(0);

		// out of the bold, the asterisks hide and the paragraph class brings the
		// "# " back instead
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 15)));
		expect(container.querySelectorAll('.pm-md-reveal')).toHaveLength(0);
		expect(container.querySelectorAll('.pm-md-marker')).toHaveLength(2);
		expect(container.querySelectorAll('p.pm-md-active > .pm-md-marker-line')).toHaveLength(1);

		view.destroy();
		container.remove();
	});

	it('reveals only the near delimiter of a construct split across lines', () => {
		// Accepted limitation: addInlineSpan clips to paragraph bounds and only the
		// caret's paragraph is searched, so the far "**" stays hidden.
		expect(spans('**bold\ntext**', 4, 'pm-md-reveal')).toEqual([[1, 3]]);
	});

	it('stays empty in source mode', () => {
		expect(decosFor(LINE, 9, false)).toEqual([]);
	});

	it('follows the caret without the markdown set being rebuilt', () => {
		const state = EditorState.create({
			doc: textToDoc(schema, LINE),
			plugins: [markdownDecorationPlugin({ current: true }), markdownCaretPlugin],
		});
		const inBold = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 9)));
		const inTail = inBold.apply(inBold.tr.setSelection(TextSelection.create(inBold.doc, 15)));
		// two reveals in the bold, one active paragraph outside it
		expect(markdownCaretKey.getState(inBold)!.find()).toHaveLength(2);
		expect(markdownCaretKey.getState(inTail)!.find()).toHaveLength(1);
	});
});

import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema } from './schema';
import { textToDoc } from './syncReactToPM';
import { changedRange } from './changedRange';

function stateOf(text: string): EditorState {
	return EditorState.create({ doc: textToDoc(schema, text), schema });
}

describe('changedRange', () => {
	it('reports an empty range for a transaction with no steps', () => {
		const state = stateOf('hello world');
		expect(changedRange(state.tr)).toEqual({ from: Infinity, to: -Infinity });
	});

	it('covers the inserted text for a single insertion', () => {
		const state = stateOf('hello world');
		// doc is <p>hello world</p>, so text offset 0 is pos 1.
		const tr = state.tr.insertText('XY', 6);

		// The step replaces the empty range at 6, producing 6..8 in the new doc.
		expect(changedRange(tr)).toEqual({ from: 6, to: 8 });
	});

	it('covers the whole replaced span for a replacement', () => {
		const state = stateOf('hello world');
		const tr = state.tr.insertText('BIG', 1, 6);

		expect(changedRange(tr)).toEqual({ from: 1, to: 4 });
	});

	it('collapses to the deletion point for a pure deletion', () => {
		const state = stateOf('hello world');
		const tr = state.tr.delete(1, 6);

		expect(changedRange(tr)).toEqual({ from: 1, to: 1 });
	});

	it('spans every step of a multi-step transaction', () => {
		const state = stateOf('hello world');
		const tr = state.tr.insertText('A', 1).insertText('B', 13);

		const { from, to } = changedRange(tr);
		expect(from).toBe(1);
		expect(to).toBe(14);
	});

	it('maps earlier steps through later ones into final doc coordinates', () => {
		const state = stateOf('hello world');
		// Insert at the end first, then insert at the front: the first step's
		// range must still be reported relative to the final doc.
		const tr = state.tr.insertText('ZZ', 12).insertText('AAAA', 1);

		const { from, to } = changedRange(tr);
		expect(from).toBe(1);
		// Final doc is "AAAAhello worldZZ" (17 chars), the tail insert now ends at 18.
		expect(to).toBe(18);
		expect(tr.doc.textBetween(1, tr.doc.content.size - 1)).toBe('AAAAhello worldZZ');
	});

	it('spans across paragraphs when an edit joins two blocks', () => {
		const state = stateOf('one\ntwo');
		// <p>one</p><p>two</p>: delete the block boundary at 4..6.
		const tr = state.tr.delete(4, 6);

		const { from, to } = changedRange(tr);
		expect(from).toBe(4);
		expect(to).toBe(4);
		expect(tr.doc.childCount).toBe(1);
	});
});

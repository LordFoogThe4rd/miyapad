import { describe, it, expect, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import { textToDoc } from './syncReactToPM';
import { ProseMirrorAdapter } from './EditorAdapter';

function createDoc(text: string) {
	return textToDoc(schema, text);
}

function makeView(text: string): { adapter: ProseMirrorAdapter; view: EditorView; container: HTMLDivElement } {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const state = EditorState.create({ doc: createDoc(text) });
	const view = new EditorView(container, { state });
	return { adapter: new ProseMirrorAdapter(view), view, container };
}

function dispose({ view, container }: { view: EditorView; container: HTMLDivElement }) {
	view.destroy();
	container.remove();
}

describe('getText', () => {
	it('returns flat text with \\n paragraph separators', () => {
		const { adapter, view, container } = makeView('hello\nworld');
		expect(adapter.getText()).toBe('hello\nworld');
		dispose({ view, container });
	});
});

describe('getSelection / setSelection', () => {
	it('roundtrips flat offsets across paragraphs', () => {
		const { adapter, view, container } = makeView('ab\ncd');
		adapter.setSelection(0, 3);
		expect(adapter.getSelection()).toEqual({ from: 0, to: 3 });
		dispose({ view, container });
	});

	it('normalizes reversed anchor/head to from <= to', () => {
		const { adapter, view, container } = makeView('abcdef');
		adapter.setSelection(5, 2);
		expect(adapter.getSelection()).toEqual({ from: 2, to: 5 });
		dispose({ view, container });
	});
});

describe('replaceText', () => {
	it('replaces the whole document text', () => {
		const { adapter, view, container } = makeView('old\nprompt');
		adapter.replaceText('new\nmulti\nline');
		expect(adapter.getText()).toBe('new\nmulti\nline');
		dispose({ view, container });
	});
});

describe('replaceRange (single line, fast path)', () => {
	it('splices text inside one paragraph', () => {
		const { adapter, view, container } = makeView('hello world');
		adapter.replaceRange(0, 5, 'bye');
		expect(adapter.getText()).toBe('bye world');
		dispose({ view, container });
	});

	it('replaces across a paragraph boundary', () => {
		const { adapter, view, container } = makeView('one\ntwo');
		adapter.replaceRange(0, 4, 'z');
		expect(adapter.getText()).toBe('ztwo');
		dispose({ view, container });
	});
});

describe('replaceRange (newline insert)', () => {
	it('splits a paragraph at a mid-paragraph offset', () => {
		const { adapter, view, container } = makeView('hello world');
		adapter.replaceRange(4, 6, '\n');
		expect(adapter.getText()).toBe('hell\nworld');
		dispose({ view, container });
	});

	it('splices multi-line text mid-paragraph', () => {
		const { adapter, view, container } = makeView('abc def');
		adapter.replaceRange(2, 5, 'x\ny');
		expect(adapter.getText()).toBe('abx\nyef');
		dispose({ view, container });
	});

	it('preserves paragraph boundaries for whole-paragraph replacements', () => {
		const { adapter, view, container } = makeView('one\ntwo');
		adapter.replaceRange(0, 3, 'a\nb');
		expect(adapter.getText()).toBe('a\nb\ntwo');
		dispose({ view, container });
	});

	it('inserts a newline at the end of a paragraph', () => {
		const { adapter, view, container } = makeView('ab\ncd');
		adapter.replaceRange(2, 2, '\n');
		expect(adapter.getText()).toBe('ab\n\ncd');
		dispose({ view, container });
	});

	it('inserts a leading newline at the start of a paragraph', () => {
		const { adapter, view, container } = makeView('ab\ncd');
		adapter.replaceRange(0, 0, '\nX');
		expect(adapter.getText()).toBe('\nXab\ncd');
		dispose({ view, container });
	});
});

describe('replaceRanges', () => {
	it('applies several non-overlapping single-line replacements via offsets on the original doc', () => {
		const { adapter, view, container } = makeView('aaa\nbbb\nccc');
		adapter.replaceRanges([
			{ from: 1, to: 2, insert: 'X' },
			{ from: 5, to: 6, insert: 'Y' },
		]);
		expect(adapter.getText()).toBe('aXa\nbYb\nccc');
		dispose({ view, container });
	});

	it('rebuilds flat text through textToDoc when any insert contains a newline', () => {
		const { adapter, view, container } = makeView('aaa\nbbb\nccc');
		adapter.replaceRanges([
			{ from: 1, to: 2, insert: 'X' },
			{ from: 4, to: 4, insert: '\n' },
		]);
		expect(adapter.getText()).toBe('aXa\n\nbbb\nccc');
		dispose({ view, container });
	});

	it('handles multiple newline inserts in one batch', () => {
		const { adapter, view, container } = makeView('aaa\nbbb\nccc');
		adapter.replaceRanges([
			{ from: 4, to: 4, insert: '\n' },
			{ from: 8, to: 8, insert: '\n' },
		]);
		expect(adapter.getText()).toBe('aaa\n\nbbb\n\nccc');
		dispose({ view, container });
	});
});

describe('posAtCoords / coordsAtPos (hit-testing)', () => {
	// jsdom cannot lay out text, so stub the ProseMirror view's coordinate
	// lookups and assert the adapter's PM<->flat-offset conversions on top.
	function stubPosAtCoords(view: EditorView, pmPos: number) {
		return vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: pmPos, inside: -1 });
	}

	it('resolves PM positions to flat offsets across multiline prompts', () => {
		const { adapter, view, container } = makeView('abc\ndef');
		// 'a' (first char, para 1)
		stubPosAtCoords(view, 1);
		expect(adapter.posAtCoords({ x: 0, y: 0 })).toBe(0);
		// 'c' (last char, para 1)
		stubPosAtCoords(view, 3);
		expect(adapter.posAtCoords({ x: 0, y: 0 })).toBe(2);
		// 'f' (last char, para 2 / final character)
		stubPosAtCoords(view, 8);
		expect(adapter.posAtCoords({ x: 10, y: 12 })).toBe(6);
		dispose({ view, container });
	});

	it('maps paragraph-boundary and end-of-document positions through', () => {
		const { adapter, view, container } = makeView('abc\ndef');
		// boundary between paragraphs (closing token of para 1)
		stubPosAtCoords(view, 4);
		expect(adapter.posAtCoords({ x: 0, y: 0 })).toBe(3);
		// position one past the last character (doc end)
		stubPosAtCoords(view, 9);
		expect(adapter.posAtCoords({ x: 0, y: 0 })).toBe(7);
		dispose({ view, container });
	});

	it('forwards the requested pm position to coordsAtPos for flat offsets', () => {
		const { adapter, view, container } = makeView('abc\ndef');
		const spy = vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 1, left: 2, right: 14, bottom: 20 });
		expect(adapter.coordsAtPos(6)).toEqual({ top: 1, left: 2, right: 14, bottom: 20 });
		expect(spy).toHaveBeenCalledWith(8);
		dispose({ view, container });
	});

	it('keeps the final character of a single-line prompt in the document', () => {
		const { adapter, view, container } = makeView('abc');
		// 'c' at offset 2, one past it at offset 3
		stubPosAtCoords(view, 3);
		expect(adapter.posAtCoords({ x: 0, y: 0 })).toBe(2);
		stubPosAtCoords(view, 4);
		expect(adapter.posAtCoords({ x: 0, y: 0 })).toBe(3);
		dispose({ view, container });
	});
});
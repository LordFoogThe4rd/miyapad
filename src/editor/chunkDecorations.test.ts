import { describe, it, expect, vi } from 'vitest';
import { AllSelection, EditorState } from 'prosemirror-state';
import { DecorationSet, EditorView } from 'prosemirror-view';
import type { Decoration } from 'prosemirror-view';
import { schema } from './schema';
import { applyChunksToPM, textToDoc } from './syncReactToPM';
import {
	getRatioColor,
	chunkDecorationKey,
	chunkDecorationPlugin,
	chunkHoverKey,
	chunkHoverPlugin,
	textOffsetToPMPos,
	pmPosToTextOffset,
	type ChunkDecorationState,
	type ChunkHoverState,
} from './chunkDecorations';

function u(content: string): PromptChunk {
	return { type: 'user', content };
}

function m(content: string, prob?: number, probs?: ProbItem[]): PromptChunk {
	return {
		content,
		prob,
		completion_probabilities: probs ? [{ content, probs }] : undefined,
	};
}

function makeDecoState(overrides: Partial<ChunkDecorationState> = {}): ChunkDecorationState {
	return {
		chunks: [],
		tokenColorMode: 0,
		tokenHighlightMode: 0,
		...overrides,
	};
}

function makeHoverState(overrides: Partial<ChunkHoverState> = {}): ChunkHoverState {
	return {
		chunks: [],
		tokenHighlightMode: 0,
		currentPromptChunk: null,
		undoHovered: null,
		...overrides,
	};
}

/** The class/style/data-promptchunk pairs a decoration renders, which live on its type, not its spec. */
function decoAttrs(deco: Decoration): Record<string, string> {
	return (deco as unknown as { type: { attrs: Record<string, string> } }).type.attrs;
}

function createDoc(text: string) {
	return textToDoc(schema, text);
}

function createState(text: string) {
	return EditorState.create({
		doc: createDoc(text),
		plugins: [chunkDecorationPlugin, chunkHoverPlugin],
	});
}

function dispatchDeco(state: EditorState, deco: ChunkDecorationState) {
	return state.apply(state.tr.setMeta(chunkDecorationKey, deco));
}

function createView(text: string): { view: EditorView; container: HTMLDivElement } {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const state = EditorState.create({
		doc: createDoc(text),
		plugins: [chunkDecorationPlugin, chunkHoverPlugin],
	});
	const view = new EditorView(container, { state });
	return { view, container };
}

function disposeView(view: EditorView, container: HTMLDivElement) {
	view.destroy();
	container.remove();
}

describe('getRatioColor', () => {
	it('returns mid-to-low mix for ratio <= 0.5', () => {
		const color = getRatioColor(0.5);
		expect(color).toContain('var(--color-prob-mid)');
		expect(color).toContain('var(--color-prob-low)');
	});

	it('returns mid-to-high mix for ratio > 0.5', () => {
		const color = getRatioColor(0.8);
		expect(color).toContain('var(--color-prob-mid)');
		expect(color).toContain('var(--color-prob-high)');
	});

	it('clamps to [0, 1]', () => {
		const low = getRatioColor(-0.1);
		const high = getRatioColor(1.5);
		expect(low).toBe(getRatioColor(0));
		expect(high).toBe(getRatioColor(1));
	});

	it('ratio 0 produces only low color', () => {
		const color = getRatioColor(0);
		expect(color).toContain('var(--color-prob-low) 100%');
		expect(color).toContain('var(--color-prob-mid) 0%');
	});
});

describe('textOffsetToPMPos / pmPosToTextOffset', () => {
	it('roundtrips single paragraph', () => {
		const doc = createDoc('hello');
		for (let i = 0; i <= 5; i++) {
			expect(pmPosToTextOffset(doc, textOffsetToPMPos(doc, i))).toBe(i);
		}
	});

	it('roundtrips multi-paragraph', () => {
		const doc = createDoc('ab\ncd');
		const len = 'ab\ncd'.length;
		for (let i = 0; i <= len; i++) {
			expect(pmPosToTextOffset(doc, textOffsetToPMPos(doc, i))).toBe(i);
		}
	});
});

describe('chunkDecorationPlugin', () => {
	it('has no decorations initially', () => {
		const state = createState('hello');
		const decos = chunkDecorationKey.getState(state)!.decos;
		expect(decos.find().length).toBe(0);
	});

	it('builds correct number of decorations for given chunks', () => {
		const state = createState('hi there');
		const s = dispatchDeco(state, makeDecoState({ chunks: [u('hi'), m(' there', 0.3)], tokenColorMode: 1 }));
		const found = chunkDecorationKey.getState(s)!.decos.find();
		expect(found.length).toBe(2);
		// Positions: paragraph open token at 0, text starts at 1
		expect(found[0].from).toBe(1);
		expect(found[0].to).toBe(3);
		expect(found[1].from).toBe(3);
		expect(found[1].to).toBe(9);
	});

	it('setMeta replaces all decorations', () => {
		const state = createState('one two');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: [u('one'), m(' two')] }));
		expect(chunkDecorationKey.getState(s1)!.decos.find().length).toBe(2);

		const s2 = dispatchDeco(s1, makeDecoState({ chunks: [u('foo'), m('bar')] }));
		const found = chunkDecorationKey.getState(s2)!.decos.find();
		expect(found.length).toBe(2);
		expect(found[0].to - found[0].from).toBe(3);
	});

	it('decorations survive text insertion mid-chunk via map', () => {
		const state = createState('abc');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: [u('abc')] }));

		// Insert 'X' after 'a' (PM pos 2)
		const s2 = s1.apply(s1.tr.insertText('X', 2));
		const found = chunkDecorationKey.getState(s2)!.decos.find();
		expect(found.length).toBe(1);
		expect(found[0].from).toBe(1);
		expect(found[0].to).toBe(5);
	});

	it('breaks on chunks extending beyond the flat text length', () => {
		const state = createState('ab\ncd');
		const s = dispatchDeco(state, makeDecoState({ chunks: [u('ab'), m('\ncd'), m('x')] }));
		const found = chunkDecorationKey.getState(s)!.decos.find();
		expect(found.length).toBe(2);
	});

	it('color mode 2 skips when minProb === maxProb', () => {
		const state = createState('x');
		const s = dispatchDeco(state, makeDecoState({
			chunks: [m('x', 0.5, [{ tok_str: 'A', prob: 0.5 }, { tok_str: 'B', prob: 0.5 }])],
			tokenColorMode: 2,
		}));
		const found = chunkDecorationKey.getState(s)!.decos.find();
		expect(found.length).toBe(1);
		// spec is empty when no bg color computed
		expect(found[0].spec).toEqual({});
	});

	it('reuses the prefix decorations when a chunk is appended', () => {
		const kept = [u('ab'), m('cd')];
		const state = createState('abcd');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: kept }));

		// Streaming append: same chunk objects plus one, text grows at the end.
		const s2 = s1.apply(
			s1.tr.insertText('ef', s1.doc.content.size - 1)
				.setMeta(chunkDecorationKey, makeDecoState({ chunks: [...kept, m('ef')] })),
		);

		const found = chunkDecorationKey.getState(s2)!.decos.find();
		expect(found.map(d => [d.from, d.to])).toEqual([[1, 3], [3, 5], [5, 7]]);
		expect(found.map(d => decoAttrs(d)['data-promptchunk'])).toEqual(['0', '1', '2']);
	});

	it('splices an appended chunk in without a full DecorationSet.create', () => {
		const kept = [u('ab'), m('cd')];
		const state = createState('abcd');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: kept }));

		const create = vi.spyOn(DecorationSet, 'create');
		s1.apply(
			s1.tr.insertText('ef', s1.doc.content.size - 1)
				.setMeta(chunkDecorationKey, makeDecoState({ chunks: [...kept, m('ef')] })),
		);
		expect(create).not.toHaveBeenCalled();
		create.mockRestore();
	});

	it('rebuilds from the first changed chunk when the doc changed in an earlier transaction', () => {
		const head = u('ab');
		const state = createState('abcd');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: [head, m('cd')] }));

		// A user edit reaches the plugin as a bare doc change; the chunk meta only
		// arrives on the following transaction, so dirtyFrom has to survive it.
		const s2 = s1.apply(s1.tr.insertText('X', 4));
		const s3 = dispatchDeco(s2, makeDecoState({ chunks: [head, u('cXd')] }));

		const found = chunkDecorationKey.getState(s3)!.decos.find();
		expect(found.map(d => [d.from, d.to])).toEqual([[1, 3], [3, 6]]);
		expect(decoAttrs(found[1]).class).toBe('user');
	});

	it('drops decorations left past the end when the chunks shrink', () => {
		const kept = [u('ab'), m('cd')];
		const state = createState('abcd');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: kept }));

		// Doc loses a character with no meta, then the same chunk array is
		// re-reported: chunk 1 no longer fits, and its decoration must not linger.
		const s2 = s1.apply(s1.tr.delete(4, 5));
		const s3 = dispatchDeco(s2, makeDecoState({ chunks: kept }));

		const found = chunkDecorationKey.getState(s3)!.decos.find();
		expect(found.map(d => [d.from, d.to])).toEqual([[1, 3]]);
	});

	it('rebuilds every chunk when a colour mode changes', () => {
		const kept = [u('ab'), m('cd', 0.3)];
		const state = createState('abcd');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: kept }));
		const s2 = dispatchDeco(s1, makeDecoState({ chunks: kept, tokenColorMode: 1 }));

		const found = chunkDecorationKey.getState(s2)!.decos.find();
		expect(found.length).toBe(2);
		expect(found.every(d => String(decoAttrs(d).style ?? '').includes('--bg-color'))).toBe(true);
	});

	it('does not rebuild base decorations on a hover-only meta', () => {
		const state = createState('abcd');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: [u('a'), m('bcd')] }));
		const before = chunkDecorationKey.getState(s1);

		const s2 = s1.apply(s1.tr.setMeta(chunkHoverKey, makeHoverState({ chunks: [u('a'), m('bcd')], currentPromptChunk: 1 })));

		expect(chunkDecorationKey.getState(s2)).toBe(before);
	});
});

describe('integration: PM editor with chunk decorations', () => {
	it('renders decoration classes in DOM', () => {
		const { view, container } = createView('hello world');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('hello'), m(' world')] })));

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans.length).toBe(2);
		expect(spans[0].className).toContain('user');
		expect(spans[1].className).toContain('machine');
		expect(spans[0].textContent).toBe('hello');
		expect(spans[1].textContent).toBe(' world');

		disposeView(view, container);
	});

	it('marks current chunk with .current class', () => {
		const { view, container } = createView('ab');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('a'), m('b')] })));
		view.dispatch(view.state.tr.setMeta(chunkHoverKey, makeHoverState({ chunks: [u('a'), m('b')], currentPromptChunk: 0 })));

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans[0].className).toContain('current');
		expect(spans[1].className).not.toContain('current');

		disposeView(view, container);
	});

	it('marks erase range from undoHovered', () => {
		const { view, container } = createView('abcd');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({
			chunks: [u('a'), m('b'), m('c'), m('d')],
		})));
		view.dispatch(view.state.tr.setMeta(chunkHoverKey, makeHoverState({
			chunks: [u('a'), m('b'), m('c'), m('d')],
			undoHovered: 2,
		})));

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans[0].className).not.toContain('erase');
		expect(spans[1].className).not.toContain('erase');
		expect(spans[2].className).toContain('erase');
		expect(spans[3].className).toContain('erase');

		disposeView(view, container);
	});

	it('color mode 1 applies background-color from prob', () => {
		const { view, container } = createView('x');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({
			chunks: [m('x', 0.3)],
			tokenColorMode: 1,
		})));

		const span = container.querySelector('[data-promptchunk]') as HTMLElement;
		expect(span.style.getPropertyValue('--bg-color')).toContain('color-mix');

		disposeView(view, container);
	});

	it('color mode 1 colors prob=1 chunks (deterministic)', () => {
		const { view, container } = createView('x');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({
			chunks: [m('x', 1)],
			tokenColorMode: 1,
		})));

		const span = container.querySelector('[data-promptchunk]') as HTMLElement;
		expect(span.style.getPropertyValue('--bg-color')).toContain('color-mix');

		disposeView(view, container);
	});

	it('color mode 2 uses normalized relative prob from completion_probabilities', () => {
		const { view, container } = createView('x');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({
			chunks: [m('x', 0.5, [{ tok_str: 'A', prob: 0.2 }, { tok_str: 'B', prob: 0.8 }])],
			tokenColorMode: 2,
		})));

		const span = container.querySelector('[data-promptchunk]') as HTMLElement;
		expect(span.style.getPropertyValue('--bg-color')).toContain('color-mix');

		disposeView(view, container);
	});

	it('updates decorations in DOM on text change', () => {
		const { view, container } = createView('hello world');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('hello'), m(' world')] })));

		// Insert 'X' after 'hello'
		view.dispatch(view.state.tr.insertText('X', 6));

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans.length).toBeGreaterThanOrEqual(2);

		disposeView(view, container);
	});

	it('re-adds machine for the hovered chunk in highlight mode 1', () => {
		const { view, container } = createView('ab');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('a'), m('b')], tokenHighlightMode: 1 })));
		view.dispatch(view.state.tr.setMeta(chunkHoverKey, makeHoverState({ chunks: [u('a'), m('b')], tokenHighlightMode: 1, currentPromptChunk: 1 })));

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans[0].className).toContain('user');
		expect(spans[0].className).not.toContain('machine');
		expect(spans[0].className).not.toContain('current');
		expect(spans[1].className).toContain('machine');
		expect(spans[1].className).toContain('current');

		disposeView(view, container);
	});

	it('keeps the erase range growing across a streaming append', () => {
		const { view, container } = createView('ab');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('a'), m('b')] })));
		view.dispatch(view.state.tr.setMeta(chunkHoverKey, makeHoverState({ chunks: [u('a'), m('b')], undoHovered: 1 })));

		// applyChunksToPM's incremental path inserts at docSize - 1, exactly on
		// the erase decoration's end edge; the rebuild-on-base-meta path must
		// re-derive it instead of mapping (mapping leaves the new char outside).
		view.dispatch(
			view.state.tr.insertText('c', view.state.doc.content.size - 1)
				.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('a'), m('bc')] })),
		);

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans.length).toBe(2);
		expect(spans[1].textContent).toBe('bc');
		expect(spans[1].className).toContain('erase');

		disposeView(view, container);
	});

	it('keeps the earlier chunk decorations across a multi-line streamed token', () => {
		const { view, container } = createView('ab');
		const kept = [u('a'), m('b')];
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks: kept })));

		// applyChunksToPM appends the extra paragraph instead of replacing the
		// document, so the two existing decorations map through untouched.
		const create = vi.spyOn(DecorationSet, 'create');
		const next = [...kept, m('\ncd')];
		applyChunksToPM(view, next, makeDecoState({ chunks: next }));
		expect(create).not.toHaveBeenCalled();
		create.mockRestore();

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect([...spans].map(el => el.textContent)).toEqual(['a', 'b', 'cd']);
		expect([...spans].map(el => el.getAttribute('data-promptchunk'))).toEqual(['0', '1', '2']);

		disposeView(view, container);
	});

	it('restores the hovered outline across a full document replacement', () => {
		const { view, container } = createView('ab');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('a'), m('b')] })));
		view.dispatch(view.state.tr.setMeta(chunkHoverKey, makeHoverState({ chunks: [u('a'), m('b')], currentPromptChunk: 1 })));

		// A multi-line streamed suffix takes the replaceWith path in
		// applyChunksToPM, which maps the hover decorations away entirely.
		const newDoc = textToDoc(schema, 'a\ncd');
		view.dispatch(
			view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content)
				.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('a'), m('\ncd')] })),
		);

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans.length).toBe(2);
		expect(spans[1].textContent).toBe('cd');
		expect(spans[1].className).toContain('current');

		disposeView(view, container);
	});
});

describe('applyChunksToPM selection preservation', () => {
	it('keeps a select-all selection as an AllSelection across a full rebuild', () => {
		const { view, container } = createView('abc');
		view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));

		applyChunksToPM(view, [u('x'), m('yz')], makeDecoState());

		expect(view.state.selection).toBeInstanceOf(AllSelection);
		disposeView(view, container);
	});
});

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
		// The appended chunk renders differently from the one before it, so it
		// gets its own decoration rather than extending the trailing one.
		const s2 = s1.apply(
			s1.tr.insertText('ef', s1.doc.content.size - 1)
				.setMeta(chunkDecorationKey, makeDecoState({ chunks: [...kept, u('ef')] })),
		);

		const found = chunkDecorationKey.getState(s2)!.decos.find();
		expect(found.map(d => [d.from, d.to])).toEqual([[1, 3], [3, 5], [5, 7]]);
		expect(found.map(d => decoAttrs(d)['data-promptchunk'])).toEqual(['0', '1', '2']);
	});

	it('extends the trailing decoration when an appended chunk renders the same', () => {
		const kept = [u('ab'), m('cd')];
		const state = createState('abcd');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: kept }));

		const create = vi.spyOn(DecorationSet, 'create');
		const s2 = s1.apply(
			s1.tr.insertText('ef', s1.doc.content.size - 1)
				.setMeta(chunkDecorationKey, makeDecoState({ chunks: [...kept, m('ef')] })),
		);
		// Growing the trailing span still goes through the splice, not a rebuild.
		expect(create).not.toHaveBeenCalled();
		create.mockRestore();

		const found = chunkDecorationKey.getState(s2)!.decos.find();
		expect(found.map(d => [d.from, d.to])).toEqual([[1, 3], [3, 7]]);
		// A merged span is labelled with the first chunk it covers.
		expect(found.map(d => decoAttrs(d)['data-promptchunk'])).toEqual(['0', '1']);
	});

	it('keeps a state usable after a later one grew the shared run list', () => {
		const kept = [u('a'), m('b'), u('c')];
		const state = createState('abc');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: kept }));

		// The run list is appended to in place, so it is shared with s1. A state
		// that gets applied again after a later one grew it must still see only
		// the runs its own decorations have.
		const grown = s1.apply(
			s1.tr.insertText('d', s1.doc.content.size - 1)
				.setMeta(chunkDecorationKey, makeDecoState({ chunks: [...kept, m('d')] })),
		);
		expect(chunkDecorationKey.getState(grown)!.decos.find().length).toBe(4);

		const other = s1.apply(
			s1.tr.insertText('ef', s1.doc.content.size - 1)
				.setMeta(chunkDecorationKey, makeDecoState({ chunks: [...kept, u('ef')] })),
		);
		const found = chunkDecorationKey.getState(other)!.decos.find();
		expect(found.map(d => [d.from, d.to])).toEqual([[1, 2], [2, 3], [3, 6]]);
	});

	it('merges a run of identically rendered chunks into one decoration', () => {
		const state = createState('abcdef');
		const s = dispatchDeco(state, makeDecoState({ chunks: [u('ab'), m('cd'), m('e'), m('f')] }));

		const found = chunkDecorationKey.getState(s)!.decos.find();
		expect(found.map(d => [d.from, d.to])).toEqual([[1, 3], [3, 7]]);
		expect(found.map(d => decoAttrs(d).class)).toEqual(['user', 'machine']);
	});

	it('keeps chunks apart when only their colour differs', () => {
		const state = createState('abcd');
		const s = dispatchDeco(state, makeDecoState({
			chunks: [m('ab', 0.2), m('cd', 0.8)],
			tokenColorMode: 1,
		}));

		const found = chunkDecorationKey.getState(s)!.decos.find();
		expect(found.map(d => [d.from, d.to])).toEqual([[1, 3], [3, 5]]);
		expect(decoAttrs(found[0]).style).not.toBe(decoAttrs(found[1]).style);
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
		const head = [u('ab'), m('cd')];
		const state = createState('abcdef');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: [...head, u('ef')] }));

		// A user edit reaches the plugin as a bare doc change; the chunk meta only
		// arrives on the following transaction, so dirtyFrom has to survive it.
		const s2 = s1.apply(s1.tr.insertText('X', 6));
		const s3 = dispatchDeco(s2, makeDecoState({ chunks: [...head, m('eXf')] }));

		const found = chunkDecorationKey.getState(s3)!.decos.find();
		// The tail turned machine, so it merges into the machine chunk in front of
		// it — which means the rebuild has to reach one decoration further back
		// than reuse alone would allow. The leading user span is still reused.
		expect(found.map(d => [d.from, d.to])).toEqual([[1, 3], [3, 8]]);
		expect(found.map(d => decoAttrs(d).class)).toEqual(['user', 'machine']);
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

		// The three machine chunks render identically and share one decoration;
		// the erase decoration is what splits it back apart at chunk 2.
		const spans = [...container.querySelectorAll('[data-promptchunk]')];
		expect(spans.map(el => el.textContent)).toEqual(['a', 'b', 'cd']);
		expect(spans.map(el => el.className.includes('erase'))).toEqual([false, false, true]);

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

		// The streamed chunk renders like the one before it, so it extends that
		// decoration; the two DOM spans are the paragraph break, not two spans.
		const spans = container.querySelectorAll('[data-promptchunk]');
		expect([...spans].map(el => el.textContent)).toEqual(['a', 'b', 'cd']);
		expect([...spans].map(el => el.getAttribute('data-promptchunk'))).toEqual(['0', '1', '1']);

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

describe('incremental chunk decorations match a fresh build', () => {
	/** The decorations a plugin with no history would build for this doc. */
	function freshDecos(doc: ReturnType<typeof createDoc>, deco: ChunkDecorationState): DecorationSet {
		const state = EditorState.create({ doc, plugins: [chunkDecorationPlugin, chunkHoverPlugin] });
		return chunkDecorationKey.getState(state.apply(state.tr.setMeta(chunkDecorationKey, deco)))!.decos;
	}

	function describeDecos(set: DecorationSet): string[] {
		return set.find().map(d => `${d.from}-${d.to} ${JSON.stringify(decoAttrs(d))}`);
	}

	function mulberry32(seed: number): () => number {
		let a = seed;
		return () => {
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	// Small alphabets on purpose: identical probs and types are what make runs
	// merge, and merging is what the incremental splice has to reproduce.
	const PROBS = [undefined, 0.2, 0.2, 0.9];
	const WORDS = ['a', 'bc', 'def', ' ', '\n', 'gh\ni'];

	function makeChunk(rnd: () => number): PromptChunk {
		const content = WORDS[Math.floor(rnd() * WORDS.length)];
		return rnd() < 0.4 ? u(content) : m(content, PROBS[Math.floor(rnd() * PROBS.length)]);
	}

	it.each([1, 2, 3, 4])('stays identical to a rebuild across a random walk (seed %i)', (seed) => {
		const rnd = mulberry32(seed);
		const { view, container } = createView('a');
		let chunks: PromptChunk[] = [u('a')];
		let tokenColorMode = 0;
		let tokenHighlightMode = 0;
		const forks: EditorState[] = [];

		for (let step = 0; step < 150; step++) {
			// Re-applying an older state is what the shared run list has to
			// survive: it appends in place, and the branch below must not pick up
			// runs some other state added.
			if (step % 17 === 0) forks.push(view.state);
			if (step % 23 === 0 && forks.length > 0) {
				const old = forks[Math.floor(rnd() * forks.length)];
				old.apply(old.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks, tokenColorMode })));
			}

			const roll = rnd();
			if (roll < 0.5 || chunks.length < 2) {
				chunks = [...chunks, makeChunk(rnd)]; // streaming append
			} else if (roll < 0.7) {
				const i = Math.floor(rnd() * chunks.length);
				chunks = [...chunks.slice(0, i), makeChunk(rnd), ...chunks.slice(i + 1)]; // mid-doc edit
			} else if (roll < 0.85) {
				const i = Math.floor(rnd() * chunks.length);
				chunks = [...chunks.slice(0, i), ...chunks.slice(i + 1)]; // delete
			} else if (roll < 0.95) {
				tokenColorMode = Math.floor(rnd() * 3);
			} else {
				tokenHighlightMode = rnd() < 0.5 ? 0 : 1;
			}
			if (!chunks.some(c => c.content.length > 0)) chunks = [...chunks, u('z')];

			const deco = makeDecoState({ chunks, tokenColorMode, tokenHighlightMode });
			const before = view.state.doc;
			applyChunksToPM(view, chunks, deco);
			// A restructure that leaves the text alone never reaches the plugin
			// through applyChunksToPM, but it still restyles.
			if (view.state.doc === before) view.dispatch(view.state.tr.setMeta(chunkDecorationKey, deco));

			expect(describeDecos(chunkDecorationKey.getState(view.state)!.decos))
				.toEqual(describeDecos(freshDecos(view.state.doc, deco)));
		}

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

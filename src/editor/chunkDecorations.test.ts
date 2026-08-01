import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import {
	getRatioColor,
	chunkDecorationKey,
	textOffsetToPMPos,
	pmPosToTextOffset,
	chunkDecorationPlugin,
	type ChunkDecorationState,
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
		currentPromptChunk: null,
		undoHovered: null,
		...overrides,
	};
}

function createDoc(text: string) {
	const paragraphs = text.split('\n').map(line =>
		schema.node('paragraph', null, line ? [schema.text(line)] : [])
	);
	return schema.node('doc', null, paragraphs);
}

function createState(text: string) {
	return EditorState.create({
		doc: createDoc(text),
		plugins: [chunkDecorationPlugin],
	});
}

function dispatchDeco(state: EditorState, deco: ChunkDecorationState) {
	return state.apply(state.tr.setMeta(chunkDecorationKey, deco));
}

function createView(text: string): { view: EditorView; container: HTMLDivElement } {
	const container = document.createElement('div');
	const state = EditorState.create({
		doc: createDoc(text),
		plugins: [chunkDecorationPlugin],
	});
	const view = new EditorView(container, { state });
	return { view, container };
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
		const decos = chunkDecorationKey.getState(state)!;
		expect(decos.find().length).toBe(0);
	});

	it('builds correct number of decorations for given chunks', () => {
		const state = createState('hi there');
		const s = dispatchDeco(state, makeDecoState({ chunks: [u('hi'), m(' there', 0.3)], tokenColorMode: 1 }));
		const found = chunkDecorationKey.getState(s)!.find();
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
		expect(chunkDecorationKey.getState(s1)!.find().length).toBe(2);

		const s2 = dispatchDeco(s1, makeDecoState({ chunks: [u('foo'), m('bar')] }));
		const found = chunkDecorationKey.getState(s2)!.find();
		expect(found.length).toBe(2);
		expect(found[0].to - found[0].from).toBe(3);
	});

	it('decorations survive text insertion mid-chunk via map', () => {
		const state = createState('abc');
		const s1 = dispatchDeco(state, makeDecoState({ chunks: [u('abc')] }));

		// Insert 'X' after 'a' (PM pos 2)
		const s2 = s1.apply(s1.tr.insertText('X', 2));
		const found = chunkDecorationKey.getState(s2)!.find();
		expect(found.length).toBe(1);
		expect(found[0].from).toBe(1);
		expect(found[0].to).toBe(5);
	});

	it('color mode 2 skips when minProb === maxProb', () => {
		const state = createState('x');
		const s = dispatchDeco(state, makeDecoState({
			chunks: [m('x', 0.5, [{ tok_str: 'A', prob: 0.5 }, { tok_str: 'B', prob: 0.5 }])],
			tokenColorMode: 2,
		}));
		const found = chunkDecorationKey.getState(s)!.find();
		expect(found.length).toBe(1);
		// spec is empty when no bg color computed
		expect(found[0].spec).toEqual({});
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

		view.destroy();
	});

	it('marks current chunk with .current class', () => {
		const { view, container } = createView('ab');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('a'), m('b')], currentPromptChunk: 0 })));

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans[0].className).toContain('current');
		expect(spans[1].className).not.toContain('current');

		view.destroy();
	});

	it('marks erase range from undoHovered', () => {
		const { view, container } = createView('abcd');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({
			chunks: [u('a'), m('b'), m('c'), m('d')],
			undoHovered: 2,
		})));

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans[0].className).not.toContain('erase');
		expect(spans[1].className).not.toContain('erase');
		expect(spans[2].className).toContain('erase');
		expect(spans[3].className).toContain('erase');

		view.destroy();
	});

	it('color mode 1 applies background-color from prob', () => {
		const { view, container } = createView('x');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({
			chunks: [m('x', 0.3)],
			tokenColorMode: 1,
		})));

		const span = container.querySelector('[data-promptchunk]') as HTMLElement;
		expect(span.style.getPropertyValue('--bg-color')).toContain('color-mix');

		view.destroy();
	});

	it('color mode 1 colors prob=1 chunks (deterministic)', () => {
		const { view, container } = createView('x');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({
			chunks: [m('x', 1)],
			tokenColorMode: 1,
		})));

		const span = container.querySelector('[data-promptchunk]') as HTMLElement;
		expect(span.style.getPropertyValue('--bg-color')).toContain('color-mix');

		view.destroy();
	});

	it('color mode 2 uses normalized relative prob from completion_probabilities', () => {
		const { view, container } = createView('x');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({
			chunks: [m('x', 0.5, [{ tok_str: 'A', prob: 0.2 }, { tok_str: 'B', prob: 0.8 }])],
			tokenColorMode: 2,
		})));

		const span = container.querySelector('[data-promptchunk]') as HTMLElement;
		expect(span.style.getPropertyValue('--bg-color')).toContain('color-mix');

		view.destroy();
	});

	it('updates decorations in DOM on text change', () => {
		const { view, container } = createView('hello world');
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, makeDecoState({ chunks: [u('hello'), m(' world')] })));

		// Insert 'X' after 'hello'
		view.dispatch(view.state.tr.insertText('X', 6));

		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans.length).toBeGreaterThanOrEqual(2);

		view.destroy();
	});
});

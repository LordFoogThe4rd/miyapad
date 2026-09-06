/**
 * Costs behind the incremental chunk-decoration splice: the streamed-append
 * path and the reuse prefix an edit leaves intact (docs/prompt-editor.md,
 * "Incremental Rebuilds" and "Merged Chunk Spans").
 *
 * These run under jsdom, whose DOM is far slower than a browser's, so the
 * absolute milliseconds do not transfer. Only the ratios between benches on one
 * machine mean anything; there is no stored baseline, so read them by hand.
 *
 * `mode` drives `tokenColorMode`. At 0 `chunkBgColor` returns '' for every
 * chunk whatever its probability, so adjacent chunks render identically and
 * merge into one run; at 1 each chunk gets its own probability colour, which
 * defeats merging and leaves every chunk its own span.
 */
import { bench, describe } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import { applyChunksToPM, textToDoc } from './syncReactToPM';
import { chunkDecorationKey, chunkDecorationPlugin, chunkHoverPlugin } from './chunkDecorations';

function m(content: string, prob?: number): PromptChunk {
	return { content, prob };
}

function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** No newlines, so every generated document is a single paragraph and flat offset N sits at PM position N + 1. */
const WORDS = [' the', ' quick', ' brown', 'fox', ' jumps', ' over'];

function makeChunks(mode: number, count: number, seed: number): PromptChunk[] {
	const rnd = rng(seed);
	return Array.from({ length: count }, () =>
		m(WORDS[Math.floor(rnd() * WORDS.length)], mode === 0 ? undefined : Math.round(rnd() * 10) / 10));
}

/** Streams `n` chunks through a live EditorView via applyChunksToPM — the path a real generation follows, DOM updates included. */
function streamTokens(mode: number, n: number): void {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const view = new EditorView(container, {
		state: EditorState.create({ doc: textToDoc(schema, 'a'), plugins: [chunkDecorationPlugin, chunkHoverPlugin] }),
	});
	const tail = makeChunks(mode, n, 11);
	const chunks: PromptChunk[] = [m('a', 1)];
	for (let i = 0; i < n; i++) {
		chunks.push(tail[i]);
		applyChunksToPM(view, chunks, { chunks: [...chunks], tokenColorMode: mode, tokenHighlightMode: 0 });
	}
	view.destroy();
	container.remove();
}

/**
 * Grows one chunk `edits` times, `fraction` of the way through the list. Only
 * the chunks after it need rebuilding, so an edit near the end is cheap and one
 * near the start is not — if the reuse prefix ever stops working the two
 * converge. The insert and the decoration meta ride one transaction, as
 * applyChunksToPM dispatches them.
 */
function editAtFraction(mode: number, chunkCount: number, fraction: number, edits: number): void {
	let live = makeChunks(mode, chunkCount, 5);
	const meta = (chunks: PromptChunk[]) => ({ chunks, tokenColorMode: mode, tokenHighlightMode: 0 });
	let state = EditorState.create({
		doc: textToDoc(schema, live.map(c => c.content).join('')),
		plugins: [chunkDecorationPlugin],
	});
	state = state.apply(state.tr.setMeta(chunkDecorationKey, meta([...live])));

	const idx = Math.floor(chunkCount * fraction);
	for (let e = 0; e < edits; e++) {
		// Flat offset of the end of chunk `idx`, recomputed because the chunk it
		// points at grows by a character every pass. Identity is preserved either
		// side of `idx`, which is what reusablePrefix keys on.
		let offset = 0;
		for (let i = 0; i <= idx; i++) offset += live[i].content.length;
		live = [...live.slice(0, idx), m(live[idx].content + 'X', live[idx].prob), ...live.slice(idx + 1)];
		state = state.apply(state.tr.insertText('X', offset + 1).setMeta(chunkDecorationKey, meta(live)));
	}
}

describe('chunkDecorationPlugin: streaming', () => {
	bench('300 tokens, no colour (adjacent chunks merge)', () => streamTokens(0, 300));
	bench('300 tokens, per-token colour (chunks stay distinct)', () => streamTokens(1, 300));
});

// Per-token colour throughout: every chunk is its own span, so nothing merges
// and the reuse prefix is the only thing separating these two.
describe('chunkDecorationPlugin: reuse prefix, 300-chunk doc, per-token colour', () => {
	bench('15 edits 5% in (almost nothing reusable)', () => editAtFraction(1, 300, 0.05, 15));
	bench('15 edits 95% in (almost everything reusable)', () => editAtFraction(1, 300, 0.95, 15));
});

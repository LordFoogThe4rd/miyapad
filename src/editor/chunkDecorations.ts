import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import { changedRange } from './changedRange';
import { flatTextLength } from './docText';

export interface ChunkDecorationState {
	chunks: PromptChunk[];
	tokenColorMode: number;
	tokenHighlightMode: number;
}

export interface ChunkHoverState {
	chunks: PromptChunk[];
	tokenHighlightMode: number;
	currentPromptChunk: number | null;
	undoHovered: number | null;
}

export interface ChunkDecorationPluginState {
	decos: DecorationSet;
	/** Chunks/modes `decos` was built from; null before the first meta arrives. */
	built: ChunkDecorationState | null;
	/** Where the last build stopped, so an appending build can resume there. */
	cursor: BuildCursor | null;
	/**
	 * Lowest position in the current doc that a step has touched since `built`
	 * was applied, `Infinity` while clean. A decoration ending at or before it
	 * came through `map()` untouched and can be reused; anything past it is
	 * suspect. Tracked across transactions because the doc change and the meta
	 * that describes it do not always arrive together — a user edit changes the
	 * doc first and the chunk meta lands on a later, doc-unchanged transaction.
	 */
	dirtyFrom: number;
}

export const chunkDecorationKey = new PluginKey<ChunkDecorationPluginState>('chunkDecorations');

export function getRatioColor(ratio: number): string {
	const sRatio = Math.max(0, Math.min(1, ratio));
	if (sRatio <= 0.5) {
		const adjustedRatio = sRatio / 0.5;
		return `color-mix(in srgb, var(--color-prob-low) ${100 - adjustedRatio * 100}%, var(--color-prob-mid) ${adjustedRatio * 100}%)`;
	} else {
		const adjustedRatio = (sRatio - 0.5) / 0.5;
		return `color-mix(in srgb, var(--color-prob-mid) ${100 - adjustedRatio * 100}%, var(--color-prob-high) ${adjustedRatio * 100}%)`;
	}
}

/** Convert flat text offset to PM document position */
export function textOffsetToPMPos(doc: Node, offset: number): number {
	let remaining = offset;
	let pos = 0;
	for (let i = 0; i < doc.childCount; i++) {
		const para = doc.child(i);
		const paraTextLen = para.textContent.length;
		if (remaining <= paraTextLen) {
			return pos + 1 + remaining; // +1 for paragraph open token
		}
		remaining -= paraTextLen + 1; // +1 for the \n
		pos += para.nodeSize;
	}
	return doc.content.size - 1; // -1 to stay inside the doc close token
}

/** Convert PM document position to flat text offset */
export function pmPosToTextOffset(doc: Node, pmPos: number): number {
	let offset = 0;
	let pos = 0;
	for (let i = 0; i < doc.childCount; i++) {
		const para = doc.child(i);
		if (pmPos <= pos + para.nodeSize) {
			return offset + Math.max(0, pmPos - pos - 1); // -1 for paragraph open token
		}
		offset += para.textContent.length + 1; // +1 for the \n
		pos += para.nodeSize;
	}
	return offset;
}

function chunkBaseClass(chunk: PromptChunk, tokenHighlightMode: number, isCurrent: boolean): string {
	return (tokenHighlightMode === 1 && !isCurrent) || chunk.type === 'user' ? 'user' : 'machine';
}

/**
 * A resumption point for the chunk walk: everything before `chunkIdx` has a
 * decoration in the set already, and the flat-offset → PM-pos state needed to
 * carry on from there without rescanning. Valid for as long as nothing before
 * `pmPos` has changed, which the plugin's `dirtyFrom` tracks.
 */
interface BuildCursor {
	/** First chunk the build did not cover. */
	chunkIdx: number;
	/** Flat text offset that chunk starts at. */
	offset: number;
	/** PM position of `offset`. */
	pmPos: number;
	/** doc.child index of the paragraph holding `offset`, and that paragraph's start. */
	paraIdx: number;
	pmStart: number;
	offStart: number;
}

interface BuiltChunkDecorations {
	decorations: Decoration[];
	/**
	 * PM position the rebuilt tail starts at — where the reused prefix ends, so
	 * the caller knows which of the mapped decorations went stale. Meaningful
	 * even when `decorations` is empty (chunks can shrink without any rebuild).
	 */
	fromPM: number;
	/** How many leading chunks kept their existing decoration. */
	skipped: number;
	/** Where this build stopped, to hand to the next one as `resume`. */
	cursor: BuildCursor;
}

/**
 * Builds the chunk decorations, skipping leading chunks whose decorations are
 * already in the set and untouched: `reuseUpTo` bounds the run of chunks that
 * still match the last build by identity, `dirtyFrom` the lowest position an
 * edit has touched since, and `resume` (when it is still inside both bounds)
 * jumps straight past the skippable run instead of rescanning it — which is
 * what makes an appended chunk O(1) rather than O(chunks). Pass `reuseUpTo` 0
 * for a full rebuild.
 */
function buildDecorations(
	state: ChunkDecorationState,
	doc: Node,
	flatTextLen: number,
	reuseUpTo = 0,
	dirtyFrom = Infinity,
	resume: BuildCursor | null = null,
): BuiltChunkDecorations {
	const decorations: Decoration[] = [];
	let pos = 0;
	let skipped = 0;
	let fromPM = -1;
	let startChunk = 0;

	// Incremental flat-offset → PM-pos cursor, only advances forward
	let paraIdx = 0;
	let pmStart = 1; // PM pos of first char in current paragraph
	let offStart = 0; // flat offset of first char in current paragraph
	if (resume && resume.chunkIdx <= reuseUpTo && resume.pmPos <= dirtyFrom) {
		startChunk = resume.chunkIdx;
		skipped = resume.chunkIdx;
		pos = resume.offset;
		paraIdx = resume.paraIdx;
		pmStart = resume.pmStart;
		offStart = resume.offStart;
	}
	const toPMPos = (offset: number): number => {
		while (paraIdx < doc.childCount) {
			const para = doc.child(paraIdx);
			const paraTextLen = para.textContent.length;
			if (offset <= offStart + paraTextLen) {
				return Math.min(pmStart + (offset - offStart), doc.content.size - 1);
			}
			offStart += paraTextLen + 1;
			pmStart += para.nodeSize;
			paraIdx++;
		}
		return doc.content.size - 1;
	};

	let i = startChunk;
	for (; i < state.chunks.length; i++) {
		const chunk = state.chunks[i];
		const chunkLen = chunk.content.length;
		if (chunkLen === 0) continue;
		if (pos + chunkLen > flatTextLen) break;
		const end = pos + chunkLen;
		const pmFrom = toPMPos(pos);
		const pmTo = toPMPos(end);

		// Contiguous spans, so the previous chunk's decoration ends exactly at
		// pmFrom — once one chunk has to be rebuilt every later one does too.
		if (fromPM === -1 && i < reuseUpTo && pmTo <= dirtyFrom) {
			skipped++;
			pos = end;
			continue;
		}
		if (fromPM === -1) fromPM = pmFrom;

		const chunkProb = chunk.prob ?? 1;
		let bgColor = '';
		if (state.tokenColorMode === 1) {
			bgColor = getRatioColor(chunkProb);
		} else if (state.tokenColorMode === 2) {
			const probs = chunk.completion_probabilities?.[0]?.probs ?? [];
			if (probs.length > 0) {
				const minProb = probs.length < 10
					? Math.min(...probs.map((p: ProbItem) => p.prob ?? 0))
					: 0;
				const maxProb = Math.max(...probs.map((p: ProbItem) => p.prob ?? 0));
				if (maxProb !== minProb) {
					bgColor = getRatioColor((chunkProb - minProb) / (maxProb - minProb));
				}
			}
		}

		const baseClass = chunkBaseClass(chunk, state.tokenHighlightMode, false);
		const attrs: Record<string, string> = { 'data-promptchunk': String(i) };
		if (bgColor) attrs.style = `--bg-color: ${bgColor}`;

		decorations.push(Decoration.inline(pmFrom, pmTo, { class: baseClass, ...attrs }));

		pos = end;
	}

	// Everything was reused: the tail starts (and ends) at the last chunk's end.
	const endPM = toPMPos(pos);
	if (fromPM === -1) fromPM = endPM;
	return {
		decorations,
		fromPM,
		skipped,
		cursor: { chunkIdx: i, offset: pos, pmPos: endPM, paraIdx, pmStart, offStart },
	};
}

/**
 * How many leading chunks are unchanged since the last build. Streaming appends
 * to the array and diffPromptChunksWithMeta reuses the chunk objects it kept,
 * so reference equality is exact — a rebuilt or merged chunk is always a fresh
 * object. Returns 0 when a mode changed, since that restyles every chunk.
 */
function reusablePrefix(prev: ChunkDecorationState, next: ChunkDecorationState): number {
	if (prev.tokenColorMode !== next.tokenColorMode || prev.tokenHighlightMode !== next.tokenHighlightMode) return 0;
	const max = Math.min(prev.chunks.length, next.chunks.length);
	let i = 0;
	while (i < max && prev.chunks[i] === next.chunks[i]) i++;
	return i;
}

export const chunkDecorationPlugin = new Plugin<ChunkDecorationPluginState>({
	key: chunkDecorationKey,
	state: {
		init(): ChunkDecorationPluginState {
			return { decos: DecorationSet.empty, built: null, cursor: null, dirtyFrom: Infinity };
		},
		apply(tr, prev): ChunkDecorationPluginState {
			const meta: ChunkDecorationState | undefined = tr.getMeta(chunkDecorationKey);
			const dirtyFrom = tr.docChanged
				? Math.min(
					prev.dirtyFrom === Infinity ? Infinity : tr.mapping.map(prev.dirtyFrom, -1),
					changedRange(tr).from,
				)
				: prev.dirtyFrom;
			if (!meta) {
				if (!tr.docChanged) return prev;
				return { decos: prev.decos.map(tr.mapping, tr.doc), built: prev.built, cursor: prev.cursor, dirtyFrom };
			}
			// DecorationSet.create is O(paragraphs x decorations) — every line is
			// its own paragraph, so a full rebuild costs tens of ms on a long
			// document. A streaming token only appends chunks, so map the set
			// forward and splice the tail instead: add() only walks the paragraph
			// list once per added span.
			const built = buildDecorations(
				meta,
				tr.doc,
				flatTextLength(tr.doc),
				prev.built ? reusablePrefix(prev.built, meta) : 0,
				dirtyFrom,
				prev.cursor,
			);
			if (built.skipped === 0) {
				return { decos: DecorationSet.create(tr.doc, built.decorations), built: meta, cursor: built.cursor, dirtyFrom: Infinity };
			}
			const mapped = prev.decos.map(tr.mapping, tr.doc);
			// find() is inclusive at both ends; the reused prefix's last decoration
			// stops exactly at fromPM and must survive.
			const stale = mapped.find(built.fromPM, tr.doc.content.size).filter(deco => deco.to > built.fromPM);
			return {
				decos: mapped.remove(stale).add(tr.doc, built.decorations),
				built: meta,
				cursor: built.cursor,
				dirtyFrom: Infinity,
			};
		},
	},
	props: {
		decorations(state) {
			return chunkDecorationKey.getState(state)?.decos;
		},
	},
});

interface ChunkHoverPluginState {
	decos: DecorationSet;
	/** Last dispatched hover state, kept so a base-chunk rebuild can re-derive these decorations. */
	hover: ChunkHoverState | null;
}

export const chunkHoverKey = new PluginKey<ChunkHoverPluginState>('chunkHoverDecorations');

/**
 * Hover-only decorations (the `current` outline and the `erase` range), kept in
 * their own plugin so moving the mouse never rebuilds the O(N) chunk set.
 * ProseMirror merges these inline decorations with the base plugin's spans into
 * a single DOM element, so the rendered markup is unchanged.
 */
function buildHoverDecorations(state: ChunkHoverState, doc: Node, flatTextLen: number): Decoration[] {
	let pos = 0;
	let curChunk: PromptChunk | undefined;
	let curFrom = -1;
	let curTo = -1;
	let eraseFrom = -1;
	let eraseTo = -1;

	// Same skip-empty and break rules as buildDecorations so ranges stay identical
	for (let i = 0; i < state.chunks.length; i++) {
		const chunkLen = state.chunks[i].content.length;
		if (chunkLen === 0) continue;
		if (pos + chunkLen > flatTextLen) break;
		const end = pos + chunkLen;

		if (state.currentPromptChunk === i) {
			curChunk = state.chunks[i];
			curFrom = pos;
			curTo = end;
		}
		if (state.undoHovered !== null && state.undoHovered < state.chunks.length && i >= state.undoHovered) {
			if (eraseFrom === -1) eraseFrom = pos;
			eraseTo = end;
		}
		pos = end;
	}

	const decorations: Decoration[] = [];
	if (curChunk && curFrom !== -1) {
		// Re-emitting the base class is intentional: in highlight mode 1 the
		// static plugin emits `user` for every chunk and this decoration is what
		// re-adds `machine` for the hovered one.
		decorations.push(Decoration.inline(
			textOffsetToPMPos(doc, curFrom),
			textOffsetToPMPos(doc, curTo),
			{ class: `${chunkBaseClass(curChunk, state.tokenHighlightMode, true)} current` },
		));
	}
	if (eraseFrom !== -1) {
		decorations.push(Decoration.inline(
			textOffsetToPMPos(doc, eraseFrom),
			textOffsetToPMPos(doc, eraseTo),
			{ class: 'erase' },
		));
	}
	return decorations;
}

export const chunkHoverPlugin = new Plugin({
	key: chunkHoverKey,
	state: {
		init(): ChunkHoverPluginState { return { decos: DecorationSet.empty, hover: null }; },
		apply(tr, { decos, hover }) {
			const hoverMeta = tr.getMeta(chunkHoverKey);
			if (hoverMeta) {
				return {
					decos: DecorationSet.create(tr.doc, buildHoverDecorations(hoverMeta, tr.doc, flatTextLength(tr.doc))),
					hover: hoverMeta,
				};
			}
			// Mapping alone is not enough when the base set rebuilds: a streaming
			// append lands exactly on a deco's end edge (insert at docSize - 1) and
			// with inclusiveEnd=false does not extend it, and a full replaceWith
			// maps the decorations away entirely. Re-derive from the stored indices
			// against the fresh chunks carried by the base meta — cheap, since the
			// walk is arithmetic and `create` gets at most two decorations.
			const baseMeta = tr.getMeta(chunkDecorationKey);
			if (baseMeta && hover && (hover.currentPromptChunk !== null || hover.undoHovered !== null)) {
				const next = { ...hover, chunks: baseMeta.chunks };
				return {
					decos: DecorationSet.create(tr.doc, buildHoverDecorations(next, tr.doc, flatTextLength(tr.doc))),
					hover: next,
				};
			}
			return { decos: decos.map(tr.mapping, tr.doc), hover };
		},
	},
	props: {
		decorations(state) {
			return chunkHoverKey.getState(state)?.decos;
		},
	},
});

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
	 * First chunk index of each decoration in `decos`, ascending — adjacent
	 * chunks that render identically share one span, so this is what maps a
	 * decoration boundary back to a chunk boundary. Needed because reuse can
	 * only ever start at a decoration boundary: pulling up short inside a
	 * merged run would strand the chunks before the cut with no span.
	 */
	runStarts: RunStarts;
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

/** The `--bg-color` a chunk paints, or '' when the mode leaves it unpainted. */
function chunkBgColor(chunk: PromptChunk, tokenColorMode: number): string {
	const chunkProb = chunk.prob ?? 1;
	if (tokenColorMode === 1) return getRatioColor(chunkProb);
	if (tokenColorMode !== 2) return '';
	const probs = chunk.completion_probabilities?.[0]?.probs ?? [];
	if (probs.length === 0) return '';
	const minProb = probs.length < 10
		? Math.min(...probs.map((p: ProbItem) => p.prob ?? 0))
		: 0;
	const maxProb = Math.max(...probs.map((p: ProbItem) => p.prob ?? 0));
	if (maxProb === minProb) return '';
	return getRatioColor((chunkProb - minProb) / (maxProb - minProb));
}

function runDecoration(from: number, to: number, chunkIdx: number, cls: string, bg: string): Decoration {
	const attrs: Record<string, string> = { class: cls, 'data-promptchunk': String(chunkIdx) };
	if (bg) attrs.style = `--bg-color: ${bg}`;
	return Decoration.inline(from, to, attrs);
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
	/**
	 * The trailing decoration, left open across builds so an appended chunk that
	 * renders identically extends it instead of adding a span beside it. -1 when
	 * the set is empty.
	 */
	runFrom: number;
	/** Chunk index that decoration is labelled with — its first chunk. */
	runIndex: number;
	/** What it renders; a chunk joins it only if both of these match. */
	runClass: string;
	runBg: string;
}

/**
 * The first chunk index of every decoration in the set, as an append-only list.
 * `arr` is shared between plugin states and only ever grown, so a streamed chunk
 * costs a push instead of copying a list as long as the chunk array; `len` is
 * this state's own view of it. Elements below a state's `len` are never
 * rewritten, which is what keeps the sharing safe when an older state is applied
 * again — a build that keeps fewer runs than the array holds takes a copy.
 */
interface RunStarts {
	arr: number[];
	len: number;
}

function appendRuns(prev: RunStarts, keep: number, added: number[]): RunStarts {
	if (keep === 0) return { arr: added, len: added.length };
	if (keep === prev.len && prev.arr.length === prev.len) {
		for (const start of added) prev.arr.push(start);
		return { arr: prev.arr, len: prev.arr.length };
	}
	return { arr: [...prev.arr.slice(0, keep), ...added], len: keep + added.length };
}

/** Walk state at a decoration boundary, so the emit pass can restart there. */
interface RunPoint {
	chunkIdx: number;
	/** Index of that decoration in the previous build's `runStarts`. */
	runIdx: number;
	offset: number;
	pmPos: number;
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
	/** How many leading decorations were kept as they are. */
	reusedRuns: number;
	/** First chunk index of every decoration in the resulting set. */
	runStarts: RunStarts;
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
 *
 * Adjacent chunks that render identically share one decoration, so the rebuilt
 * tail has to start on a decoration boundary rather than any chunk boundary:
 * `prevRunStarts` is what maps one to the other. The emit pass deliberately
 * starts one decoration *earlier* than reuse would allow, so a tail that now
 * renders the same as the decoration in front of it merges into it — that is
 * what keeps an incremental set identical to a fresh one.
 */
function buildDecorations(
	state: ChunkDecorationState,
	doc: Node,
	flatTextLen: number,
	reuseUpTo = 0,
	dirtyFrom = Infinity,
	resume: BuildCursor | null = null,
	prevRunStarts: RunStarts = { arr: [], len: 0 },
): BuiltChunkDecorations {
	const decorations: Decoration[] = [];
	const runStarts: number[] = [];
	let pos = 0;
	let startChunk = 0;
	let reusedRuns = 0;

	// Incremental flat-offset → PM-pos cursor, only advances forward
	let paraIdx = 0;
	let pmStart = 1; // PM pos of first char in current paragraph
	let offStart = 0; // flat offset of first char in current paragraph
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

	// The decoration currently being extended. Carried in from `resume` so a
	// streamed chunk grows the trailing span rather than starting a new one.
	let runFrom = -1;
	let runTo = -1;
	let runIndex = 0;
	let runClass = '';
	let runBg = '';
	// Whether the open run is still exactly the decoration already in the set,
	// so a streamed chunk that starts a new run leaves it alone instead of
	// removing and re-adding an identical span.
	let runInSet = false;
	// PM position the set is being rebuilt from; -1 until something is emitted.
	let emitFrom = -1;

	if (resume && resume.chunkIdx <= reuseUpTo && resume.pmPos <= dirtyFrom) {
		startChunk = resume.chunkIdx;
		pos = resume.offset;
		paraIdx = resume.paraIdx;
		pmStart = resume.pmStart;
		offStart = resume.offStart;
		if (resume.runFrom !== -1) {
			runFrom = resume.runFrom;
			runTo = toPMPos(pos);
			runIndex = resume.runIndex;
			runClass = resume.runClass;
			runBg = resume.runBg;
			runInSet = true;
			// Every previous run survives — the open one keeps its start chunk
			// whether or not it grows, so the run list only ever gets appended to.
			reusedRuns = prevRunStarts.len;
		}
	} else if (reuseUpTo > 0 && prevRunStarts.len > 0) {
		// Locate pass: arithmetic only, no colours computed, so a mid-document
		// edit still costs one cheap walk of the leading chunks. Both bounds are
		// monotonic, so the first failure ends it.
		let ptr = 0;
		let safe: RunPoint | null = null;
		let prevSafe: RunPoint | null = null;
		for (let i = 0; i < state.chunks.length; i++) {
			const chunkLen = state.chunks[i].content.length;
			if (chunkLen === 0) continue;
			if (pos + chunkLen > flatTextLen || i > reuseUpTo) break;
			const pmFrom = toPMPos(pos);
			if (pmFrom > dirtyFrom) break;
			if (ptr < prevRunStarts.len && prevRunStarts.arr[ptr] === i) {
				// Every decoration before this one ends at or before pmFrom, which
				// is inside the identical, untouched prefix: they all survive.
				prevSafe = safe;
				safe = { chunkIdx: i, runIdx: ptr, offset: pos, pmPos: pmFrom, paraIdx, pmStart, offStart };
				ptr++;
			}
			pos += chunkLen;
		}
		if (prevSafe) {
			startChunk = prevSafe.chunkIdx;
			reusedRuns = prevSafe.runIdx;
			pos = prevSafe.offset;
			paraIdx = prevSafe.paraIdx;
			pmStart = prevSafe.pmStart;
			offStart = prevSafe.offStart;
		} else {
			pos = 0;
			paraIdx = 0;
			pmStart = 1;
			offStart = 0;
		}
	}

	let i = startChunk;
	for (; i < state.chunks.length; i++) {
		const chunk = state.chunks[i];
		const chunkLen = chunk.content.length;
		if (chunkLen === 0) continue;
		if (pos + chunkLen > flatTextLen) break;
		const end = pos + chunkLen;
		const pmFrom = toPMPos(pos);
		const pmTo = toPMPos(end);
		const baseClass = chunkBaseClass(chunk, state.tokenHighlightMode, false);
		const bgColor = chunkBgColor(chunk, state.tokenColorMode);

		// Chunks tile the text, so runTo === pmFrom holds for every chunk after
		// the first; the check is what stops a resumed run from swallowing a gap
		// if the doc ever moved under the cursor.
		if (runFrom !== -1 && runTo === pmFrom && baseClass === runClass && bgColor === runBg) {
			if (runInSet) {
				// It grows, so the span in the set has to be replaced.
				runInSet = false;
				emitFrom = runFrom;
			}
			runTo = pmTo;
		} else {
			if (runFrom !== -1 && !runInSet) decorations.push(runDecoration(runFrom, runTo, runIndex, runClass, runBg));
			runInSet = false;
			if (emitFrom === -1) emitFrom = pmFrom;
			runFrom = pmFrom;
			runTo = pmTo;
			runIndex = i;
			runClass = baseClass;
			runBg = bgColor;
			runStarts.push(i);
		}

		pos = end;
	}
	if (runFrom !== -1 && !runInSet) decorations.push(runDecoration(runFrom, runTo, runIndex, runClass, runBg));
	const endPM = toPMPos(pos);

	return {
		decorations,
		// Nothing was rebuilt: the set is still good all the way to the end, and
		// only decorations left past it (the chunks shrank) are stale.
		fromPM: emitFrom === -1 ? endPM : emitFrom,
		reusedRuns,
		runStarts: appendRuns(prevRunStarts, reusedRuns, runStarts),
		cursor: {
			chunkIdx: i,
			offset: pos,
			pmPos: endPM,
			paraIdx,
			pmStart,
			offStart,
			runFrom,
			runIndex,
			runClass,
			runBg,
		},
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
			return { decos: DecorationSet.empty, built: null, cursor: null, runStarts: { arr: [], len: 0 }, dirtyFrom: Infinity };
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
				return { ...prev, decos: prev.decos.map(tr.mapping, tr.doc), dirtyFrom };
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
				prev.runStarts,
			);
			if (built.reusedRuns === 0) {
				return {
					decos: DecorationSet.create(tr.doc, built.decorations),
					built: meta,
					cursor: built.cursor,
					runStarts: built.runStarts,
					dirtyFrom: Infinity,
				};
			}
			const mapped = prev.decos.map(tr.mapping, tr.doc);
			// find() is inclusive at both ends; the reused prefix's last decoration
			// stops exactly at fromPM and must survive.
			const stale = mapped.find(built.fromPM, tr.doc.content.size).filter(deco => deco.to > built.fromPM);
			return {
				decos: mapped.remove(stale).add(tr.doc, built.decorations),
				built: meta,
				cursor: built.cursor,
				runStarts: built.runStarts,
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
			const hoverMeta: ChunkHoverState | undefined = tr.getMeta(chunkHoverKey);
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
			const baseMeta: ChunkDecorationState | undefined = tr.getMeta(chunkDecorationKey);
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

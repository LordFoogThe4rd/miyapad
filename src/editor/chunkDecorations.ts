import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';

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

export const chunkDecorationKey = new PluginKey<DecorationSet>('chunkDecorations');

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

function buildDecorations(state: ChunkDecorationState, doc: Node, flatTextLen: number): Decoration[] {
	const decorations: Decoration[] = [];
	let pos = 0;

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

	for (let i = 0; i < state.chunks.length; i++) {
		const chunk = state.chunks[i];
		const chunkLen = chunk.content.length;
		if (chunkLen === 0) continue;
		if (pos + chunkLen > flatTextLen) break;
		const end = pos + chunkLen;

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

		const pmFrom = toPMPos(pos);
		const pmTo = toPMPos(end);
		decorations.push(Decoration.inline(pmFrom, pmTo, { class: baseClass, ...attrs }));

		pos = end;
	}

	return decorations;
}

export const chunkDecorationPlugin = new Plugin({
	key: chunkDecorationKey,
	state: {
		init() { return DecorationSet.empty; },
		apply(tr, decorations) {
			const meta = tr.getMeta(chunkDecorationKey);
			if (meta) {
				const flatTextLen = tr.doc.textBetween(0, tr.doc.content.size, '\n').length;
				return DecorationSet.create(tr.doc, buildDecorations(meta, tr.doc, flatTextLen));
			}
			return decorations.map(tr.mapping, tr.doc);
		},
	},
	props: {
		decorations(state) {
			return chunkDecorationKey.getState(state);
		},
	},
});

export const chunkHoverKey = new PluginKey<DecorationSet>('chunkHoverDecorations');

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
		init() { return DecorationSet.empty; },
		apply(tr, decorations) {
			const meta = tr.getMeta(chunkHoverKey);
			if (meta) {
				const flatTextLen = tr.doc.textBetween(0, tr.doc.content.size, '\n').length;
				return DecorationSet.create(tr.doc, buildHoverDecorations(meta, tr.doc, flatTextLen));
			}
			return decorations.map(tr.mapping, tr.doc);
		},
	},
	props: {
		decorations(state) {
			return chunkHoverKey.getState(state);
		},
	},
});

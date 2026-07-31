import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';

export interface ChunkDecorationState {
	chunks: PromptChunk[];
	tokenColorMode: number;
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

function buildDecorations(state: ChunkDecorationState, doc: Node, docLength: number): Decoration[] {
	const decorations: Decoration[] = [];
	let pos = 0;

	for (let i = 0; i < state.chunks.length; i++) {
		const chunk = state.chunks[i];
		const chunkLen = chunk.content.length;
		if (chunkLen === 0) continue;
		if (pos + chunkLen > docLength) break;
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

		const isCurrent = state.currentPromptChunk === i;
		const isErase = state.undoHovered !== null && state.undoHovered < state.chunks.length && i >= state.undoHovered;
		const baseClass = (state.tokenHighlightMode === 1 && !isCurrent) || chunk.type === 'user' ? 'user' : 'machine';
		const classes = [baseClass];
		if (isCurrent) classes.push('current');
		if (isErase) classes.push('erase');

		const attrs: Record<string, string> = { 'data-promptchunk': String(i) };
		if (bgColor) attrs.style = `--bg-color: ${bgColor}`;

		const pmFrom = textOffsetToPMPos(doc, pos);
		const pmTo = textOffsetToPMPos(doc, end);
		decorations.push(Decoration.inline(pmFrom, pmTo, { class: classes.join(' '), ...attrs }));

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
				return DecorationSet.create(tr.doc, buildDecorations(meta, tr.doc, tr.doc.content.size));
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

import type { Node, Schema } from 'prosemirror-model';
import { AllSelection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { chunkDecorationKey, type ChunkDecorationState } from './chunkDecorations';
import { pmPosToTextOffset, textOffsetToPMPos } from './chunkDecorations';
import { docText } from './docText';

/**
 * Appends newContent to trailing user chunks, collapsing adjacent user chunks into one.
 * MUTATES the supplied chunks array in place when its last chunk is user-typed and
 * returns that same array; otherwise appends a new user chunk to a copy.
 */
function mergeUserChunks(chunks: PromptChunk[], newContent: string): PromptChunk[] {
	let lastChunk = chunks[chunks.length - 1];
	while (lastChunk && lastChunk.type === 'user') {
		const merged: PromptChunk = { ...lastChunk, content: lastChunk.content + newContent };
		chunks[chunks.length - 1] = merged;
		if (chunks[chunks.length - 2] && chunks[chunks.length - 2].type === 'user') {
			newContent = merged.content;
			lastChunk = chunks[chunks.length - 2];
			chunks.pop();
		} else {
			return chunks;
		}
	}
	return [...chunks, { type: 'user', content: newContent }];
}

export function diffPromptChunks(prev: PromptChunk[], nv: string): PromptChunk[] {
	return diffPromptChunksWithMeta(prev, nv).chunks;
}

/**
 * Returns the new chunk array plus the number of leading/trailing chunks of prev that
 * survived the diff unchanged. startLen/endLen are measured on the ORIGINAL array,
 * before mergeUserChunks collapses adjacent user chunks — the result may contain fewer
 * leading/trailing chunks than startLen/endLen report.
 */
export function diffPromptChunksWithMeta(prev: PromptChunk[], nv: string): { chunks: PromptChunk[]; startLen: number; endLen: number } {
	const start: PromptChunk[] = [];
	const end: PromptChunk[] = [];
	let scratch = nv;

	let i = 0;
	for (; i < prev.length; i++) {
		if (!scratch.startsWith(prev[i].content)) break;
		start.push(prev[i]);
		scratch = scratch.slice(prev[i].content.length);
	}

	for (let j = prev.length; j > i; j--) {
		const content = prev[j - 1].content;
		if (!content) continue;
		if (!scratch.endsWith(content)) break;
		end.push(prev[j - 1]);
		scratch = scratch.slice(0, -content.length);
	}
	end.reverse();

	let newPrompt = [...start];
	if (scratch) {
		newPrompt = mergeUserChunks(newPrompt, scratch);
	}
	if (end.length && end[0].type === 'user') {
		const endChunk = end.shift()!;
		newPrompt = mergeUserChunks(newPrompt, endChunk.content);
	}
	newPrompt.push(...end);
	return { chunks: newPrompt, startLen: start.length, endLen: end.length };
}

export function applyChunksToPM(
	view: EditorView,
	newChunks: PromptChunk[],
	decoState: ChunkDecorationState,
	scrollToEnd?: boolean,
	scroller?: HTMLElement | null,
): void {
	const newText = newChunks.map((c) => c.content).join('');
	const oldText = docText(view.state.doc);

	if (newText === oldText) return;

	const docSize = view.state.doc.content.size;

	// Pin the scroller to the bottom while streaming only if the user is already
	// at the bottom. PM's selection-based scrollIntoView is unreliable: the
	// selection sits mid-doc or at the start after a regenerate/undo, so it never
	// scrolls. atBottom is measured before dispatch, while the old height stands.
	const scrollerEl = scrollToEnd && scroller ? scroller : null;
	const atBottom = scrollerEl ? scrollerEl.scrollTop + scrollerEl.clientHeight + 4 >= scrollerEl.scrollHeight : false;

	const suffix = newText.length > oldText.length && newText.startsWith(oldText) ? newText.slice(oldText.length) : null;
	// insertText would embed a literal \n inside a paragraph's text node, but
	// textToDoc models newlines as paragraph boundaries — only single-line
	// suffixes can use the incremental path.
	if (suffix !== null && !suffix.includes('\n')) {
		const insertPos = docSize - 1;
		let tr = view.state.tr.insertText(suffix, insertPos);
		tr = tr.setMeta(chunkDecorationKey, decoState);
		view.dispatch(tr);
	} else {
		const sel = view.state.selection;
		const newDoc = textToDoc(view.state.schema, newText);
		let tr = view.state.tr.replaceWith(0, docSize, newDoc.content);
		// Preserve the selection through the full rebuild by mapping the flat
		// endpoints onto the new doc; applyChunksToPM is the sole PM mutation on
		// non-append updates, so anchoring the selection here keeps the cursor
		// (and a selected range) stable across undo/redo regenerates.
		if (sel instanceof AllSelection) {
			tr = tr.setSelection(new AllSelection(tr.doc));
		} else {
			const anchorOffset = Math.min(pmPosToTextOffset(view.state.doc, sel.anchor), newText.length);
			const headOffset = Math.min(pmPosToTextOffset(view.state.doc, sel.head), newText.length);
			if (suffix !== null && anchorOffset >= oldText.length && headOffset >= oldText.length) {
				// Streaming append whose token contains a newline: mapping the
				// old end-of-text offset onto the new doc lands on the boundary
				// right before the appended token, and later single-line inserts
				// sit after it — so the caret never advances again. A caret that
				// was at the end of the pre-append doc should follow the stream
				// to the new end of the document instead.
				tr = tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
			} else {
				tr = tr.setSelection(
					TextSelection.create(
						tr.doc,
						textOffsetToPMPos(tr.doc, anchorOffset),
						textOffsetToPMPos(tr.doc, headOffset),
					),
				);
			}
		}
		tr = tr.setMeta(chunkDecorationKey, decoState);
		view.dispatch(tr);
	}
	if (atBottom && scrollerEl) {
		scrollerEl.scrollTop = scrollerEl.scrollHeight;
	}
}

export function textToDoc(schema: Schema, text: string): Node {
	const paragraphs = text.split('\n').map(line =>
		schema.node('paragraph', null, line ? [schema.text(line)] : [])
	);
	return schema.node('doc', null, paragraphs);
}

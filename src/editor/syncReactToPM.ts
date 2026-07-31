import type { Node, Schema } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { chunkDecorationKey, type ChunkDecorationState } from './chunkDecorations';

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

/** Returns the new chunk array plus how many leading/trailing chunks were preserved unchanged. */
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
		if (!scratch.endsWith(prev[j - 1].content)) break;
		end.push(prev[j - 1]);
		scratch = scratch.slice(0, -prev[j - 1].content.length);
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
): void {
	const newText = newChunks.map((c) => c.content).join('');
	const oldText = view.state.doc.textBetween(0, view.state.doc.content.size, '\n');

	if (newText === oldText) return;

	const docSize = view.state.doc.content.size;

	if (newText.length > oldText.length && newText.startsWith(oldText)) {
		const suffix = newText.slice(oldText.length);
		const insertPos = docSize - 1;
		let tr = view.state.tr.insertText(suffix, insertPos);
		tr = tr.setMeta(chunkDecorationKey, decoState);
		// Pin the scroller to the bottom while streaming only if the user is already
		// at the bottom. PM's selection-based scrollIntoView is unreliable: the
		// selection sits mid-doc or at the start after a regenerate/undo, so it never
		// scrolls. atBottom is measured before dispatch, while the old height stands.
		const scroller = scrollToEnd ? (view.dom.closest('#prompt-container') as HTMLElement | null) : null;
		const atBottom = scroller ? scroller.scrollTop + scroller.clientHeight + 1 >= scroller.scrollHeight : false;
		view.dispatch(tr);
		if (atBottom && scroller) {
			scroller.scrollTop = scroller.scrollHeight;
		}
	} else {
		const newDoc = textToDoc(view.state.schema, newText);
		let tr = view.state.tr.replaceWith(0, docSize, newDoc.content);
		tr = tr.setMeta(chunkDecorationKey, decoState);
		view.dispatch(tr);
	}
}

export function textToDoc(schema: Schema, text: string): Node {
	const paragraphs = text.split('\n').map(line =>
		schema.node('paragraph', null, line ? [schema.text(line)] : [])
	);
	return schema.node('doc', null, paragraphs);
}

import { describe, it, expect } from 'vitest';
import { diffPromptChunks, diffPromptChunksWithMeta } from './syncReactToPM';

function u(content: string): PromptChunk {
	return { type: 'user', content };
}

function m(content: string, prob?: number): PromptChunk {
	return { content, prob };
}

// Mirrors the undo/redo entry model in useGenerationLogic: numbers are generation
// boundaries (slice), arrays are exact pre-edit checkpoints (restore).
function undoEntry(undoStack: (number | PromptChunk[])[], current: PromptChunk[]): PromptChunk[] {
	const last = undoStack.pop()!;
	if (typeof last === 'number') return current.slice(0, last);
	return last;
}

const UNDO_COALESCE_MS = 500;
let editClock = 0;
let lastEditMs = 0;

// Mirrors dispatchTransaction maintenance with coalescing: consecutive edits within
// UNDO_COALESCE_MS of the last one reuse the existing checkpoint instead of pushing a
// new one. dt is the simulated elapsed time since the previous edit.
function edit(undoStack: (number | PromptChunk[])[], redoStack: PromptChunk[][], prev: PromptChunk[], newText: string, dt = UNDO_COALESCE_MS + 1): PromptChunk[] {
	editClock += dt;
	const last = undoStack[undoStack.length - 1];
	if (!(Array.isArray(last) && editClock - lastEditMs < UNDO_COALESCE_MS)) undoStack.push(prev);
	redoStack.length = 0;
	lastEditMs = editClock;
	return diffPromptChunksWithMeta(prev, newText).chunks;
}

describe('diffPromptChunks', () => {
	it('insert at cursor — middle of first chunk, suffix preserved', () => {
		const prev = [u('ab'), m('cd')];
		const result = diffPromptChunks(prev, 'axbcd');
		expect(result).toEqual([u('axb'), m('cd')]);
	});

	it('delete range — chars removed from first chunk, suffix preserved', () => {
		const prev = [u('abc'), m('def')];
		const result = diffPromptChunks(prev, 'adef');
		expect(result).toEqual([u('a'), m('def')]);
	});

	it('paste multi-character — replacement merges into user chunk', () => {
		const prev = [u('ab'), m('cd')];
		const result = diffPromptChunks(prev, 'aXYcd');
		expect(result).toEqual([u('aXY'), m('cd')]);
	});

	it('edit consumes multiple machine chunks — middle erased, edges kept', () => {
		const prev = [u('a'), m('b'), m('c')];
		const result = diffPromptChunks(prev, 'aXc');
		expect(result).toEqual([u('aX'), m('c')]);
	});

	it('append only — streaming adds content at end', () => {
		const prev = [u('hello'), m(' world')];
		const result = diffPromptChunks(prev, 'hello world!!!');
		expect(result).toEqual([u('hello'), m(' world'), u('!!!')]);
	});

	it('empty input — first typed text becomes user chunk', () => {
		const result = diffPromptChunks([], 'hello');
		expect(result).toEqual([u('hello')]);
	});

	it('newline inserted — newline belongs to user chunk', () => {
		const prev = [u('ab'), m('cd')];
		const result = diffPromptChunks(prev, 'a\nbcd');
		expect(result).toEqual([u('a\nb'), m('cd')]);
	});

	it('all user chunks merged — adjacent user content collapses', () => {
		const prev = [u('x'), u('y'), m('z')];
		const result = diffPromptChunks(prev, 'XYz');
		expect(result).toEqual([u('XY'), m('z')]);
	});

	it('edit at boundary — user and machine chunks partially consumed', () => {
		const prev = [u('hello'), m('world'), m('!')];
		const result = diffPromptChunks(prev, 'helWORL!');
		expect(result).toEqual([u('helWORL'), m('!')]);
	});

	it('identical text — returns identical chunk array', () => {
		const prev = [u('a'), m('b')];
		const result = diffPromptChunks(prev, 'ab');
		expect(result).toEqual([u('a'), m('b')]);
	});

	it('does not mutate the previous chunks (undo/redo safety)', () => {
		const prev = [u('a'), u('b')];
		const snapshot = prev.map(c => ({ ...c }));
		diffPromptChunks(prev, 'abX');
		expect(prev).toEqual(snapshot);
	});
});

describe('diffPromptChunksWithMeta', () => {
	it('reports preserved prefix/suffix lengths for a mid edit', () => {
		const { chunks, startLen, endLen } = diffPromptChunksWithMeta([u('a'), m('b')], 'aXb');
		expect(chunks).toEqual([u('aX'), m('b')]);
		expect(startLen).toBe(1);
		expect(endLen).toBe(1);
	});

	it('reports endLen 0 when a trailing user chunk absorbs the edit', () => {
		const { chunks, startLen, endLen } = diffPromptChunksWithMeta([u('a'), u('b')], 'abX');
		expect(chunks).toEqual([u('abX')]);
		expect(startLen).toBe(2);
		expect(endLen).toBe(0);
	});

	it('reports 0/0 for a full replace', () => {
		const { chunks, startLen, endLen } = diffPromptChunksWithMeta([u('abc'), m('def')], 'XYZ');
		expect(chunks).toEqual([u('XYZ')]);
		expect(startLen).toBe(0);
		expect(endLen).toBe(0);
	});
});

describe('undo checkpoint model', () => {
	const text = (chunks: PromptChunk[]) => chunks.map(c => c.content).join('');

	it('an edit pushes a checkpoint that undoes the edit without wiping the generation undo', () => {
		const undoStack: (number | PromptChunk[])[] = [];
		const redoStack: PromptChunk[][] = [];

		// Generation starts at 1 chunk, streams 'gen'.
		undoStack.push(1);
		let chunks: PromptChunk[] = [u('a'), { content: 'gen' }];

		// User appends 'X'.
		const prev = chunks;
		chunks = edit(undoStack, redoStack, prev, text(prev) + 'X');
		expect(undoStack[undoStack.length - 1]).toEqual([u('a'), { content: 'gen' }]);

		// Undo the edit: restores the exact pre-edit array.
		chunks = undoEntry(undoStack, chunks);
		expect(text(chunks)).toBe('agen');

		// Undo the generation: slices by the preserved boundary.
		chunks = undoEntry(undoStack, chunks);
		expect(text(chunks)).toBe('a');
	});

	it('a mid-text edit checkpoint restores the pre-edit chunks exactly', () => {
		const undoStack: (number | PromptChunk[])[] = [];
		const redoStack: PromptChunk[][] = [];
		let chunks: PromptChunk[] = [u('a'), m('bc')];

		// Replace 'b' with 'X' mid-chunk.
		const prev = chunks;
		chunks = edit(undoStack, redoStack, prev, 'aXc');
		expect(undoStack[undoStack.length - 1]).toEqual([u('a'), m('bc')]);

		chunks = undoEntry(undoStack, chunks);
		expect(chunks).toEqual([u('a'), m('bc')]);
	});

	it('consecutive edits within the window collapse into one undo step', () => {
		const undoStack: (number | PromptChunk[])[] = [];
		const redoStack: PromptChunk[][] = [];
		let chunks: PromptChunk[] = [u('a'), m('bc')];

		// A burst of fast edits (100ms apart) shares a single checkpoint.
		const before = chunks;
		chunks = edit(undoStack, redoStack, before, 'aXc', 100);
		chunks = edit(undoStack, redoStack, chunks, 'aXYc', 100);
		chunks = edit(undoStack, redoStack, chunks, 'aXYzc', 100);
		expect(undoStack).toHaveLength(1);
		expect(undoStack[0]).toEqual(before);

		// One undo removes the whole burst.
		chunks = undoEntry(undoStack, chunks);
		expect(chunks).toEqual(before);
	});

	it('a pause past the window starts a new checkpoint', () => {
		const undoStack: (number | PromptChunk[])[] = [];
		const redoStack: PromptChunk[][] = [];
		let chunks: PromptChunk[] = [u('a'), m('bc')];

		chunks = edit(undoStack, redoStack, chunks, 'aXc', 100);
		chunks = edit(undoStack, redoStack, chunks, 'aXYc', 600);
		expect(undoStack).toHaveLength(2);

		chunks = undoEntry(undoStack, chunks);
		expect(text(chunks)).toBe('aXc');
	});
});

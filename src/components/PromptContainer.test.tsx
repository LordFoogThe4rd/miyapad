import { html } from 'htm/react';
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { EditorView } from 'prosemirror-view';
import { PromptContainer } from './PromptContainer';

function u(content: string): PromptChunk {
	return { type: 'user', content };
}

function m(content: string): PromptChunk {
	return { content };
}

const { genState, bridge, views, settings, logic, t, screenshot } = vi.hoisted(() => {
	const genState: Record<string, any> = {
		promptEditorView: { current: null },
		setPromptEditorVersion: vi.fn(),
		promptChunks: [],
		setPromptChunks: vi.fn(),
		currentPromptChunk: undefined,
		setCurrentPromptChunk: vi.fn(),
		undoHovered: false,
		setUndoHovered: vi.fn(),
		undoStack: { current: [] as (number | PromptChunk[])[] },
		redoStack: { current: [] as PromptChunk[][] },
		lastEditMsRef: { current: 0 },
		showProbs: false,
		setShowProbs: vi.fn(),
		cancel: null,
		markdownPreviewRef: { current: null },
		isSyncingScroll: { current: false },
		keyState: { current: {} },
		probsDelayTimer: { current: undefined },
		modalState: {},
		closeModal: vi.fn(),
		toggleModal: vi.fn(),
		setTriggerPredict: vi.fn(),
	};
	const bridge: { initialChunks: PromptChunk[]; setPromptChunks: any; setCancel: any } = {
		initialChunks: [],
		setPromptChunks: null,
		setCancel: null,
	};
	return {
		genState,
		bridge,
		views: [] as EditorView[],
		settings: {
			showMarkdownPreview: false,
			setShowMarkdownPreview: vi.fn(),
			isMobile: false,
			tokenHighlightMode: -1,
			tokenColorMode: 0,
			promptAreaWidth: undefined,
			setPromptAreaWidth: vi.fn(),
			showProbsMode: -1,
			setShowProbsMode: vi.fn(),
			spellCheck: true,
		},
		logic: { undo: vi.fn(), redo: vi.fn(), undoAndPredict: vi.fn() },
		t: (key: string) => key,
		screenshot: { takeScreenshot: vi.fn() },
	};
});

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settings }));
vi.mock('../contexts/GenerationContext', () => ({ useGeneration: () => genState }));
vi.mock('../i18n', () => ({ useT: () => t }));
vi.mock('../hooks/usePromptBuilder', () => ({ usePromptBuilder: () => ({ promptText: '' }) }));
vi.mock('../hooks/useGenerationLogic', () => ({ useGenerationLogic: () => logic }));
vi.mock('../hooks/useScreenshotCapture', () => ({ useScreenshotCapture: () => screenshot }));
vi.mock('../editor/EditorAdapter', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../editor/EditorAdapter')>();
	return {
		...mod,
		ProseMirrorAdapter: class extends mod.ProseMirrorAdapter {
			constructor(view: EditorView, scroller?: HTMLElement | null) {
				super(view, scroller);
				views.push(view);
			}
		},
	};
});

const setPromptChunksCalls: PromptChunk[][] = [];

function Harness() {
	const [promptChunks, setPromptChunksState] = useState<PromptChunk[]>(bridge.initialChunks);
	const [cancel, setCancel] = useState<unknown>(null);
	bridge.setPromptChunks = setPromptChunksState;
	bridge.setCancel = setCancel;
	genState.promptChunks = promptChunks;
	genState.cancel = cancel;
	genState.setPromptChunks = (v: PromptChunk[]) => {
		setPromptChunksCalls.push(v);
		setPromptChunksState(v);
	};
	return html`<${PromptContainer} sidebarHeight=${0} />`;
}

function renderEditor(chunks: PromptChunk[] = [u('a'), m('bc')]) {
	bridge.initialChunks = chunks;
	setPromptChunksCalls.length = 0;
	const result = render(html`<${Harness} />`);
	return { ...result, view: views[0] };
}

beforeEach(() => {
	views.length = 0;
	genState.undoStack.current = [];
	genState.redoStack.current = [];
	genState.lastEditMsRef.current = 0;
});

afterEach(() => {
	cleanup();
});

describe('PromptContainer transaction synchronization', () => {
	it('renders a real ProseMirror view with chunks and decorations', () => {
		const { view, container } = renderEditor([u('hello'), m(' world')]);

		expect(container.querySelector('#pm-editor .ProseMirror')).toBeTruthy();
		expect(view.state.doc.textBetween(0, view.state.doc.content.size, '\n')).toBe('hello world');
		const spans = container.querySelectorAll('[data-promptchunk]');
		expect(spans.length).toBe(2);
		expect(spans[0].className).toContain('user');
		expect(spans[1].className).toContain('machine');
	});

	it('sends the diffed chunk array to setPromptChunks on a user edit', () => {
		const { view } = renderEditor();

		act(() => view.dispatch(view.state.tr.insertText('X', 2)));

		expect(setPromptChunksCalls).toHaveLength(1);
		expect(setPromptChunksCalls[0]).toEqual([u('aX'), m('bc')]);
	});

	it('creates one exact undo checkpoint per edit and clears redo', () => {
		const { view } = renderEditor();
		genState.redoStack.current = [[u('old')]];

		act(() => view.dispatch(view.state.tr.insertText('X', 2)));

		expect(genState.undoStack.current).toEqual([[u('a'), m('bc')]]);
		expect(genState.redoStack.current).toEqual([]);
	});

	it('reuses the checkpoint for edits within 500ms and starts a new one after a pause', () => {
		const { view } = renderEditor();

		act(() => view.dispatch(view.state.tr.insertText('X', 2)));
		act(() => view.dispatch(view.state.tr.insertText('Y', 3)));
		expect(genState.undoStack.current).toHaveLength(1);
		expect(genState.undoStack.current[0]).toEqual([u('a'), m('bc')]);

		genState.lastEditMsRef.current = Date.now() - 600;
		act(() => view.dispatch(view.state.tr.insertText('Z', 4)));
		expect(genState.undoStack.current).toHaveLength(2);
		expect(genState.undoStack.current[1]).toEqual([u('aXY'), m('bc')]);
	});

	it('syncs an external promptChunks update into the doc without feeding back', () => {
		const { view, container } = renderEditor([u('a'), m('bc')]);

		act(() => view.dispatch(view.state.tr.insertText('X', 2)));
		expect(setPromptChunksCalls).toHaveLength(1);

		act(() => bridge.setPromptChunks!([u('aX'), m('bc'), u('!')]));

		expect(view.state.doc.textBetween(0, view.state.doc.content.size, '\n')).toBe('aXbc!');
		expect(container.querySelectorAll('[data-promptchunk]')).toHaveLength(3);
		expect(setPromptChunksCalls).toHaveLength(1);

		act(() => view.dispatch(view.state.tr.insertText('Y', 4)));
		expect(setPromptChunksCalls).toHaveLength(2);
		expect(setPromptChunksCalls[1]).toEqual([u('aXbYc!')]);
	});

	it('restores editability and focus when generation completes', async () => {
		const { view } = renderEditor();
		const focusSpy = vi.spyOn(view, 'focus');

		// {} is a truthy non-function cancel; a function arg would be invoked as
		// a React functional updater and evaluate to undefined.
		await act(async () => bridge.setCancel!({}));
		expect(view.props.editable!(view.state)).toBe(false);

		await act(async () => bridge.setCancel!(null));
		expect(view.props.editable!(view.state)).toBe(true);
		expect(focusSpy).toHaveBeenCalled();
	});
});

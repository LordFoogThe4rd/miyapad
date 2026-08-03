import { useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useGenerationLogic } from './useGenerationLogic';

function u(content: string): PromptChunk {
	return { type: 'user', content };
}

function m(content: string): PromptChunk {
	return { content };
}

const { genState, settings, builder, tts, api } = vi.hoisted(() => {
	const genState: Record<string, any> = {
		promptEditorView: { current: null },
		undoStack: { current: [] as (number | PromptChunk[])[] },
		redoStack: { current: [] as PromptChunk[][] },
		lastEditMsRef: { current: 0 },
		useScrollSmoothing: { current: true },
		hordeTaskId: { current: undefined },
		promptChunks: [],
		setPromptChunks: null,
		cancel: null,
		setCancel: vi.fn(),
		tokens: 0,
		setTokens: vi.fn(),
		setTokensPerSec: vi.fn(),
		setPredictStartTokens: vi.fn(),
		setLastError: vi.fn(),
		setUndoHovered: vi.fn(),
		setRejectedAPIKey: vi.fn(),
		setHordeQueuePos: vi.fn(),
		setHordeProcessing: vi.fn(),
		ttsNewText: { current: '' },
		ttsPaused: { current: false },
		ttsQueue: { current: [] },
		activeGenId: { current: 0 },
		abortControllerRef: { current: null },
		restartedPredict: false,
		setRestartedPredict: vi.fn(),
		triggerPredict: false,
		setTriggerPredict: vi.fn(),
	};
	return {
		genState,
		settings: {
			endpoint: 'http://localhost:5001',
			endpointAPI: 'koboldcpp',
			seed: -1,
			maxPredictTokens: 16,
			enabledSamplers: [],
			logitBias: { bias: {} },
			grammar: '',
			useChatAPI: false,
			chatMode: false,
			useTokenStreaming: true,
			disableLogprobs: false,
			templates: {},
			isMiyapadEndpoint: false,
			ttsEnabled: false,
			useServerTokenization: false,
			useBasicStoppingMode: false,
			stoppingStrings: '[]',
			openaiPresets: false,
		},
		builder: { fimPromptInfo: undefined, finalPromptText: '', convertChatToJSON: vi.fn() },
		tts: { ttsProcessQueue: vi.fn(), ttsStop: vi.fn(), ttsPushUserInput: vi.fn(), ttsAddChunk: vi.fn(), listTTSVoices: vi.fn() },
		api: { getTokenCount: vi.fn(), serverTokenCount: vi.fn(), completion: vi.fn(), chatCompletion: vi.fn(), abortCompletion: vi.fn() },
	};
});

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settings }));
vi.mock('../contexts/GenerationContext', () => ({ useGeneration: () => genState }));
vi.mock('../hooks/usePromptBuilder', () => ({ usePromptBuilder: () => builder }));
vi.mock('../hooks/useTTS', () => ({ useTTS: () => tts }));
vi.mock('../api/index', () => api);

const bridge = vi.hoisted(() => ({ initialChunks: [] as PromptChunk[] }));

function Harness({ children }: { children: ReactNode }) {
	const [promptChunks, setPromptChunksState] = useState<PromptChunk[]>(bridge.initialChunks);
	genState.promptChunks = promptChunks;
	genState.setPromptChunks = setPromptChunksState;
	return children;
}

function zeroTokenCompletion() {
	return (async function* () { })();
}

function oneTokenCompletion() {
	return (async function* () { yield m('gen'); })();
}

function renderLogic(chunks: PromptChunk[]) {
	bridge.initialChunks = chunks;
	genState.undoStack.current = [];
	genState.redoStack.current = [];
	genState.activeGenId.current = 0;
	api.getTokenCount.mockResolvedValue(10);
	return renderHook(() => useGenerationLogic(), { wrapper: Harness });
}

beforeEach(() => {
	api.completion.mockReset();
	api.getTokenCount.mockReset();
	api.abortCompletion.mockReset();
});

afterEach(() => {
	cleanup();
});

describe('useGenerationLogic undo/redo', () => {
	it('undo of a numeric generation boundary slices back to the chunk count', () => {
		const { result } = renderLogic([u('a'), m('gen')]);
		genState.undoStack.current = [1];

		act(() => result.current.undo());

		expect(genState.promptChunks).toEqual([u('a')]);
		expect(genState.redoStack.current).toEqual([[u('a'), m('gen')]]);
	});

	it('undo of a PromptChunk[] user-edit checkpoint restores the exact pre-edit array', () => {
		const { result } = renderLogic([u('aX'), m('c')]);
		genState.undoStack.current = [[u('a'), m('bc')]];

		act(() => result.current.undo());

		expect(genState.promptChunks).toEqual([u('a'), m('bc')]);
	});

	it('redo restores the forward state after a numeric-boundary undo', () => {
		const { result } = renderLogic([u('a')]);
		genState.undoStack.current = [1];
		genState.redoStack.current = [[u('a'), m('gen')]];

		act(() => result.current.redo());

		expect(genState.promptChunks).toEqual([u('a'), m('gen')]);
		expect(genState.undoStack.current).toEqual([1, [u('a')]]);
	});

	it('redo restores the forward state after a user-edit checkpoint undo', () => {
		const { result } = renderLogic([u('a'), m('bc')]);
		genState.undoStack.current = [[u('a')]];
		genState.redoStack.current = [[u('a'), m('bc')]];

		act(() => result.current.redo());

		expect(genState.promptChunks).toEqual([u('a'), m('bc')]);
		expect(genState.undoStack.current).toEqual([[u('a')], [u('a'), m('bc')]]);
	});

	it('a new generation clears the redo history', async () => {
		// The user-edit path that clears redo lives in PromptContainer (covered by
		// PromptContainer.test.tsx); the hook clears redo when a generation starts.
		const { result } = renderLogic([u('a')]);
		genState.undoStack.current = [[u('a')]];
		genState.redoStack.current = [[u('old')]];
		api.completion.mockImplementation(zeroTokenCompletion);

		await act(async () => { await result.current.predict(); });

		expect(genState.redoStack.current).toEqual([]);
		expect(genState.undoStack.current).toEqual([[u('a')]]);
	});

	it('a zero-token generation removes its own boundary and prunes stale trailing boundaries', async () => {
		const { result } = renderLogic([u('a'), m('gen')]);
		// 5 and 2 are stale boundaries >= the current chunk count (2) and must be
		// pruned before the new boundary is pushed; the checkpoint stays.
		genState.undoStack.current = [[u('a')], 2, 5];
		api.completion.mockImplementation(zeroTokenCompletion);

		await act(async () => { await result.current.predict(); });

		expect(genState.undoStack.current).toEqual([[u('a')]]);
	});

	it('the generation boundary is on the undo stack before token counting completes', async () => {
		const { result } = renderLogic([u('a'), m('gen')]);
		api.completion.mockImplementation(oneTokenCompletion);
		let resolveCount!: (n: number) => void;
		api.getTokenCount.mockReturnValue(new Promise<number>((r) => { resolveCount = r; }));

		const p = result.current.predict();
		await vi.waitFor(() => expect(genState.undoStack.current).toEqual([2]));

		resolveCount(10);
		await act(async () => { await p; });

		expect(genState.promptChunks).toEqual([u('a'), m('gen'), m('gen')]);
		expect(genState.undoStack.current).toEqual([2]);
	});
});

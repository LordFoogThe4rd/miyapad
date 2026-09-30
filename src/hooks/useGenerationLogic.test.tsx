import { useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useGenerationLogic } from './useGenerationLogic';
import { API_AI_HORDE, API_DEEPSEEK, API_KOBOLD_CPP, API_LLAMA_CPP, API_OPENAI_COMPAT } from '../constants';

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
			endpointAPI: 'koboldcpp' as string | number,
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
			sessionStorage: { snapshot: vi.fn(), addStats: vi.fn() },
			historyBeforeGenerate: false,
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

describe('useGenerationLogic version history', () => {
	afterEach(() => {
		settings.historyBeforeGenerate = false;
		settings.sessionStorage.snapshot.mockClear();
	});

	it('saves no version before a generation by default', async () => {
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(zeroTokenCompletion);

		await act(async () => { await result.current.predict(); });

		expect(settings.sessionStorage.snapshot).not.toHaveBeenCalled();
	});

	it('saves a version before each generation when the option is on', async () => {
		settings.historyBeforeGenerate = true;
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(zeroTokenCompletion);

		await act(async () => { await result.current.predict(); });

		expect(settings.sessionStorage.snapshot).toHaveBeenCalledTimes(1);
		expect(settings.sessionStorage.snapshot).toHaveBeenCalledWith('generation');
	});
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

describe('useGenerationLogic statistics', () => {
	beforeEach(() => {
		settings.sessionStorage.addStats.mockClear();
	});

	it('counts a whole non-streamed completion as more than a single token', async () => {
		const { result } = renderLogic([u('a')]);
		// One chunk carrying the entire reply with no per-token probabilities, the shape a
		// non-streaming provider returns.
		api.completion.mockImplementation(() => (async function* () { yield { content: 'x'.repeat(400) }; })());

		await act(async () => { await result.current.predict(); });

		expect(settings.sessionStorage.addStats).toHaveBeenCalledWith(
			expect.objectContaining({ generations: 1, genChars: 400, genTokens: 100 }),
		);
	});

	it('counts one token per chunk that reports its probabilities', async () => {
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(() => (async function* () {
			for (const word of ['al', 'pha', 'bet']) {
				yield { content: word, completion_probabilities: [{ content: word, probs: [] }] };
			}
		})());

		await act(async () => { await result.current.predict(); });

		expect(settings.sessionStorage.addStats).toHaveBeenCalledWith(
			expect.objectContaining({ generations: 1, genChars: 8, genTokens: 3 }),
		);
	});
});

function yieldAll(...chunks: unknown[]) {
	return () => (async function* () { yield* chunks; })();
}

function lastCompletionArgs() {
	return api.completion.mock.calls.at(-1)![0];
}

describe('useGenerationLogic requests and responses', () => {
	const savedSettings = { ...settings };
	const savedBuilder = { ...builder };

	beforeEach(() => {
		genState.setLastError.mockClear();
		genState.setRejectedAPIKey.mockClear();
		genState.setHordeQueuePos.mockClear();
		genState.setHordeProcessing.mockClear();
		genState.setTriggerPredict.mockClear();
		genState.setCancel.mockClear();
		genState.cancel = null;
		genState.triggerPredict = false;
		api.chatCompletion.mockReset();
		vi.stubGlobal('reportError', vi.fn());
	});

	afterEach(() => {
		Object.assign(settings, savedSettings);
		Object.assign(builder, savedBuilder);
		genState.cancel = null;
		genState.triggerPredict = false;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it.each([
		[API_OPENAI_COMPAT, 'HTTP 401', 'Error: Rejected API Key'],
		[API_LLAMA_CPP, 'HTTP 401', 'Error: Rejected API Key'],
		[API_DEEPSEEK, 'HTTP 403', 'Error: Proxy access denied — check your endpoint URL'],
		[API_OPENAI_COMPAT, 'HTTP 429', 'Error: Insufficient Quota'],
		[API_KOBOLD_CPP, 'HTTP 401', 'Error: HTTP 401'],
		[API_LLAMA_CPP, 'HTTP 429', 'Error: HTTP 429'],
	])('reports a failed request from API %s with "%s" as "%s"', async (endpointAPI, message, shown) => {
		settings.endpointAPI = endpointAPI;
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(() => { throw new Error(message); });

		let returned: unknown;
		await act(async () => { returned = await result.current.predict(); });

		expect(returned).toBe(false);
		expect(genState.setLastError).toHaveBeenLastCalledWith(shown);
		expect(genState.setRejectedAPIKey).toHaveBeenLastCalledWith(shown === 'Error: Rejected API Key');
	});

	it('shows no error when the generation is aborted', async () => {
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(() => { throw Object.assign(new Error('stopped'), { name: 'AbortError' }); });

		await act(async () => { await result.current.predict(); });

		expect(genState.setLastError).toHaveBeenCalledTimes(1);
		expect(genState.setLastError).toHaveBeenCalledWith(undefined);
	});

	it('sends the custom stop strings, dropping anything that is not a string', async () => {
		settings.stoppingStrings = '["###", 5, "\\n\\n"]';
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(zeroTokenCompletion);

		await act(async () => { await result.current.predict(); });

		expect(lastCompletionArgs().stop).toEqual(['###', '\n\n']);
	});

	it('sends no stop strings when the saved list is not valid JSON', async () => {
		settings.stoppingStrings = '["###"';
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(zeroTokenCompletion);

		await act(async () => { await result.current.predict(); });

		expect(lastCompletionArgs()).not.toHaveProperty('stop');
	});

	it('stops at a new line in basic stopping mode', async () => {
		Object.assign(settings, { useBasicStoppingMode: true, basicStoppingModeType: 'new_line', stoppingStrings: '["###"]' });
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(zeroTokenCompletion);

		await act(async () => { await result.current.predict(); });

		expect(lastCompletionArgs().stop).toEqual(['\n']);
	});

	it('fills a {fill} placeholder between the text around it, stopping where the text after it starts', async () => {
		Object.assign(settings, { useBasicStoppingMode: true, basicStoppingModeType: 'fill_suffix' });
		builder.fimPromptInfo = { fimLeftChunks: [u('before ')], fimRightChunks: [u('  after it')] } as any;
		const { result } = renderLogic([u('before {fill}  after it')]);
		api.completion.mockImplementation(yieldAll(m('X'), m('Y')));

		let returned: unknown;
		await act(async () => { returned = await result.current.predict(); });
		await vi.waitFor(() => expect(genState.promptChunks).toEqual([u('before '), m('X'), m('Y'), u('  after it')]));

		expect(returned).toBe(true);
		expect(lastCompletionArgs().stop).toEqual(['af']);
	});

	it('shows a stopping word as the text of its chunk', async () => {
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(yieldAll(m('b'), { content: '', stopping_word: '###' }));

		await act(async () => { await result.current.predict(); });

		expect(genState.promptChunks).toEqual([u('a'), m('b'), expect.objectContaining({ content: '###' })]);
	});

	it('shows the AI Horde queue position, then streams the reply', async () => {
		settings.endpointAPI = API_AI_HORDE;
		const { result } = renderLogic([u('a')]);
		api.completion.mockImplementation(yieldAll(
			{ status: 'queue_init', taskId: 'task-1' },
			{ status: 'queue_status', position: 3, processing: true },
			{ status: 'done', content: 'reply' },
		));

		await act(async () => { await result.current.predict(); });

		expect(genState.setHordeQueuePos).toHaveBeenCalledWith(3);
		expect(genState.setHordeProcessing).toHaveBeenCalledWith(true);
		expect(genState.promptChunks).toEqual([u('a'), expect.objectContaining({ content: 'reply' })]);
		// Cleared when the generation ends.
		expect(genState.hordeTaskId.current).toBeUndefined();
		expect(genState.setHordeQueuePos).toHaveBeenLastCalledWith(undefined);
	});

	describe('chat mode', () => {
		const templates = { T: { sysPre: '', sysSuf: '', instPre: '[INST]', instSuf: '[/INST]' } };

		it('closes the user turn before generating and opens the next one after', async () => {
			Object.assign(settings, { chatMode: true, templates, selectedTemplate: 'T' });
			builder.finalPromptText = '[INST]hi';
			const { result } = renderLogic([u('[INST]hi')]);
			api.completion.mockImplementation(yieldAll(m('hello')));

			await act(async () => { await result.current.predict(); });

			expect(lastCompletionArgs().prompt).toBe('[INST]hi[/INST]');
			expect(genState.promptChunks).toEqual([u('[INST]hi'), u('[/INST]'), m('hello'), u('[INST]')]);
		});

		it('adds no suffix when the user turn is already closed', async () => {
			Object.assign(settings, { chatMode: true, templates, selectedTemplate: 'T' });
			builder.finalPromptText = '[INST]hi[/INST]';
			const { result } = renderLogic([u('[INST]hi[/INST]')]);
			api.completion.mockImplementation(zeroTokenCompletion);

			await act(async () => { await result.current.predict(); });

			expect(lastCompletionArgs().prompt).toBe('[INST]hi[/INST]');
			expect(genState.promptChunks).toEqual([u('[INST]hi[/INST]')]);
		});

		it('with the chat API and a missing template, switches to Mistral and generates again', async () => {
			const setSelectedTemplate = vi.fn();
			Object.assign(settings, { useChatAPI: true, templates: { Alpaca: {}, Mistral: {} }, selectedTemplate: 'gone', setSelectedTemplate });
			const { result } = renderLogic([u('a')]);

			await act(async () => { await result.current.predict(); });

			expect(setSelectedTemplate).toHaveBeenCalledWith('Mistral');
			expect(genState.setTriggerPredict).toHaveBeenCalledWith(true);
			expect(api.chatCompletion).not.toHaveBeenCalled();
		});

		it('with the chat API and no templates at all, turns chat off', async () => {
			const setChatMode = vi.fn();
			const setUseChatAPI = vi.fn();
			Object.assign(settings, { useChatAPI: true, templates: {}, selectedTemplate: 'gone', setChatMode, setUseChatAPI });
			const { result } = renderLogic([u('a')]);

			await act(async () => { await result.current.predict(); });

			expect(setChatMode).toHaveBeenCalledWith(false);
			expect(setUseChatAPI).toHaveBeenCalledWith(false);
			expect(api.chatCompletion).not.toHaveBeenCalled();
		});
	});

	describe('restarting while a generation runs', () => {
		it('cancels the running generation and waits half a second before starting', async () => {
			vi.useFakeTimers();
			const running = vi.fn();
			genState.cancel = running;
			const { result } = renderLogic([u('a')]);
			api.completion.mockImplementation(zeroTokenCompletion);

			const p = result.current.predict();
			expect(running).toHaveBeenCalled();
			await act(async () => { await vi.advanceTimersByTimeAsync(499); });
			expect(api.getTokenCount).not.toHaveBeenCalled();
			await act(async () => { await vi.advanceTimersByTimeAsync(1); await p; });
			expect(api.completion).toHaveBeenCalled();
		});

		it('gives up if cancelled again during the wait', async () => {
			vi.useFakeTimers();
			genState.cancel = vi.fn();
			const { result } = renderLogic([u('a')]);

			const p = result.current.predict();
			const cancelWait = genState.setCancel.mock.calls[0][0]();
			cancelWait();
			let returned: unknown;
			await act(async () => { await vi.advanceTimersByTimeAsync(500); returned = await p; });

			expect(returned).toBe(false);
			expect(api.getTokenCount).not.toHaveBeenCalled();
		});
	});

	describe('undoAndPredict', () => {
		it('undoes the last generation and asks for a new one', () => {
			const { result } = renderLogic([u('a'), m('gen')]);
			genState.undoStack.current = [1];

			act(() => result.current.undoAndPredict());

			expect(genState.promptChunks).toEqual([u('a')]);
			expect(genState.setTriggerPredict).toHaveBeenCalledWith(true);
		});

		it('does nothing while a new generation is already queued', () => {
			genState.triggerPredict = true;
			const { result } = renderLogic([u('a'), m('gen')]);
			genState.undoStack.current = [1];
			genState.setTriggerPredict.mockClear();

			act(() => result.current.undoAndPredict());

			expect(genState.undoStack.current).toEqual([1]);
			expect(genState.setTriggerPredict).not.toHaveBeenCalledWith(true);
		});
	});
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_DEEPSEEK } from '../constants';
import { useTokenCounters } from './useTokenCounters';
import { useSessionState } from './useSessionState';
import { SessionStorage } from '../storage/SessionStorage';

const { settings, generation, builder, api } = vi.hoisted(() => ({
	settings: {} as Record<string, any>,
	generation: { setMemoryTokenCount: vi.fn(), setWorldInfoTokenCount: vi.fn(), setAuthorNoteTokenCount: vi.fn() },
	builder: {
		templateReplacements: {} as Record<string, string>,
		replacePlaceholders: vi.fn((s: string) => s),
		assembledWorldInfo: '',
	},
	api: { getTokenCount: vi.fn(), serverTokenCount: vi.fn() },
}));

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settings }));
vi.mock('../contexts/GenerationContext', () => ({ useGeneration: () => generation }));
vi.mock('./usePromptBuilder', () => ({ usePromptBuilder: () => builder }));
vi.mock('../api/index', () => api);

const emptyAuthorNote = { prefix: '', text: '', suffix: '' };
const emptyMemory = { contextOrder: '', prefix: '', text: '', suffix: '' };

function configure(overrides: Record<string, any> = {}) {
	Object.keys(settings).forEach(k => delete settings[k]);
	Object.assign(settings, {
		endpoint: 'http://localhost:8080',
		endpointAPI: API_LLAMA_CPP,
		endpointAPIKey: 'sk-abc',
		sessionStorage: { sessionEndpoint: 'http://localhost:3000', proxyEndpoint: 'http://proxy.local' },
		isMiyapadEndpoint: false,
		useServerTokenization: false,
		authorNoteTokens: { ...emptyAuthorNote },
		setAuthorNoteTokens: vi.fn(),
		memoryTokens: { ...emptyMemory },
		setMemoryTokens: vi.fn(),
		worldInfo: { prefix: '[WI]', suffix: '[/WI]' },
		...overrides,
	});
}

function setup(overrides: Record<string, any> = {}) {
	configure(overrides);
	return renderHook(() => useTokenCounters());
}

/** Run every updater the setter was given against `prev` and return the final state. */
function reduce(setter: ReturnType<typeof vi.fn>, prev: Record<string, unknown>) {
	return setter.mock.calls.reduce((acc, [updater]) => updater(acc), prev);
}

async function advance(ms: number) {
	await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
	vi.useFakeTimers();
	api.getTokenCount.mockReset();
	api.serverTokenCount.mockReset();
	builder.replacePlaceholders.mockClear();
	builder.replacePlaceholders.mockImplementation((s: string) => s);
	builder.assembledWorldInfo = '';
	Object.values(generation).forEach(setter => setter.mockClear());
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('useTokenCounters change handlers', () => {
	it('handleauthorNoteTokensChange merges one key into the author note state', () => {
		const { result } = setup();
		const setter = settings.setAuthorNoteTokens;
		setter.mockClear();

		act(() => result.current.handleauthorNoteTokensChange('text', 'hello'));

		expect(reduce(setter, { ...emptyAuthorNote })).toEqual({ ...emptyAuthorNote, text: 'hello' });
	});

	it('handleMemoryTokensChange merges one key into the memory state', () => {
		const { result } = setup();
		const setter = settings.setMemoryTokens;
		setter.mockClear();

		act(() => result.current.handleMemoryTokensChange('text', 'entry'));

		expect(reduce(setter, { ...emptyMemory })).toEqual({ ...emptyMemory, text: 'entry' });
	});

	it('returns stable-shaped handlers', () => {
		const { result } = setup();
		expect(typeof result.current.handleauthorNoteTokensChange).toBe('function');
		expect(typeof result.current.handleMemoryTokensChange).toBe('function');
	});
});

describe('useTokenCounters author note counting', () => {
	it('zeroes the count without any request when the note text is empty', async () => {
		setup({ authorNoteTokens: { prefix: 'p', text: '', suffix: 's' } });

		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
		expect(generation.setAuthorNoteTokenCount).toHaveBeenLastCalledWith(0);
	});

	it('counts prefix + text + suffix and stores the count minus the leading BOS token', async () => {
		api.getTokenCount.mockResolvedValue(11);
		setup({ authorNoteTokens: { prefix: '[', text: 'note', suffix: ']' } });

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({
			endpoint: 'http://localhost:8080',
			endpointAPI: API_LLAMA_CPP,
			content: '[note]',
		}));
		expect(generation.setAuthorNoteTokenCount).toHaveBeenLastCalledWith(10);
	});

	it('debounces: nothing is requested before 500ms have passed', async () => {
		api.getTokenCount.mockResolvedValue(5);
		setup({ authorNoteTokens: { prefix: '', text: 'note', suffix: '' } });

		await advance(499);
		expect(api.getTokenCount).not.toHaveBeenCalled();

		await advance(1);
		expect(api.getTokenCount).toHaveBeenCalledTimes(1);
	});

	it('runs the note through the template placeholder replacer', async () => {
		api.getTokenCount.mockResolvedValue(3);
		builder.replacePlaceholders.mockImplementation(() => 'EXPANDED');
		setup({ authorNoteTokens: { prefix: '', text: '{inst}', suffix: '' } });

		await advance(500);

		expect(builder.replacePlaceholders).toHaveBeenCalledWith('{inst}', builder.templateReplacements);
		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({ content: 'EXPANDED' }));
	});

	it('cancels the pending debounce when the hook unmounts', async () => {
		api.getTokenCount.mockResolvedValue(5);
		const { unmount } = setup({ authorNoteTokens: { prefix: '', text: 'note', suffix: '' } });

		await advance(400);
		act(() => unmount());
		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
	});

	it('zeroes the count when the request fails for a reason other than an abort', async () => {
		api.getTokenCount.mockRejectedValue(new Error('boom'));
		vi.stubGlobal('reportError', vi.fn());
		setup({ authorNoteTokens: { prefix: '', text: 'note', suffix: '' } });

		await advance(500);

		expect(generation.setAuthorNoteTokenCount).toHaveBeenLastCalledWith(0);
		vi.unstubAllGlobals();
	});
});

describe('useTokenCounters memory and world info counting', () => {
	it('counts the assembled memory block', async () => {
		api.getTokenCount.mockResolvedValue(9);
		setup({ memoryTokens: { ...emptyMemory, prefix: '<', text: 'mem', suffix: '>' } });

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({ content: '<mem>' }));
		expect(generation.setMemoryTokenCount).toHaveBeenLastCalledWith(8);
		expect(generation.setWorldInfoTokenCount).toHaveBeenLastCalledWith(0);
	});

	it('wraps the active world info in the worldInfo prefix and suffix', async () => {
		api.getTokenCount.mockResolvedValue(7);
		builder.assembledWorldInfo = 'entry';
		setup();

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledTimes(1);
		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({ content: '[WI]entry[/WI]' }));
		expect(generation.setWorldInfoTokenCount).toHaveBeenLastCalledWith(6);
		expect(generation.setMemoryTokenCount).toHaveBeenLastCalledWith(0);
	});

	it('counts memory and world info as two separate requests', async () => {
		api.getTokenCount.mockResolvedValue(4);
		builder.assembledWorldInfo = 'entry';
		setup({ memoryTokens: { ...emptyMemory, text: 'mem' } });

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledTimes(2);
		expect(generation.setMemoryTokenCount).toHaveBeenLastCalledWith(3);
		expect(generation.setWorldInfoTokenCount).toHaveBeenLastCalledWith(3);
	});

	it('zeroes the world info count without a request when there is no world info', async () => {
		setup();

		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
		expect(generation.setWorldInfoTokenCount).toHaveBeenLastCalledWith(0);
	});
});

describe('useTokenCounters session persistence', () => {
	it('counting leaves the session unmodified and keeps counts out of stored state', async () => {
		api.getTokenCount.mockResolvedValue(4);
		const storage = new SessionStorage({} as DatabaseAdapter);
		storage.sessions = { 0: { name: 'Story', modified: 1, memoryTokens: { ...emptyMemory, text: 'mem' }, authorNoteTokens: { ...emptyAuthorNote } } };
		storage.selectedSession = 0;
		configure();

		renderHook(() => {
			const [memoryTokens, setMemoryTokens] = useSessionState(storage, 'memoryTokens', emptyMemory);
			const [authorNoteTokens, setAuthorNoteTokens] = useSessionState(storage, 'authorNoteTokens', emptyAuthorNote);
			Object.assign(settings, { memoryTokens, setMemoryTokens, authorNoteTokens, setAuthorNoteTokens });
			return useTokenCounters();
		});
		await advance(1000);

		expect(api.getTokenCount).toHaveBeenCalled();
		expect(storage.sessions[0]!.modified).toBe(1);
		expect(storage.sessions[0]!.memoryTokens).toEqual({ ...emptyMemory, text: 'mem' });
		expect(storage.sessions[0]!.authorNoteTokens).toEqual(emptyAuthorNote);
	});
});

describe('useTokenCounters endpoint selection', () => {
	it('skips counting entirely for OpenAI-compatible endpoints', async () => {
		builder.assembledWorldInfo = 'wi';
		setup({
			endpointAPI: API_OPENAI_COMPAT,
			authorNoteTokens: { prefix: '', text: 'note', suffix: '' },
			memoryTokens: { ...emptyMemory, text: 'mem' },
		});

		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
		expect(generation.setAuthorNoteTokenCount).toHaveBeenLastCalledWith(0);
		expect(generation.setMemoryTokenCount).toHaveBeenLastCalledWith(0);
		expect(generation.setWorldInfoTokenCount).toHaveBeenLastCalledWith(0);
	});

	it('skips counting entirely for DeepSeek endpoints', async () => {
		setup({ endpointAPI: API_DEEPSEEK, authorNoteTokens: { prefix: '', text: 'note', suffix: '' } });

		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
	});

	it('uses the miyapad server tokenizer when server tokenization is on', async () => {
		api.serverTokenCount.mockResolvedValue(6);
		setup({
			isMiyapadEndpoint: true,
			useServerTokenization: true,
			authorNoteTokens: { prefix: '', text: 'note', suffix: '' },
		});

		await advance(500);

		expect(api.getTokenCount).not.toHaveBeenCalled();
		expect(api.serverTokenCount).toHaveBeenCalledWith(expect.objectContaining({
			sessionEndpoint: 'http://localhost:3000',
			content: 'note',
		}));
		expect(generation.setAuthorNoteTokenCount).toHaveBeenLastCalledWith(5);
	});

	it('passes the proxy endpoint through for a miyapad endpoint without server tokenization', async () => {
		api.getTokenCount.mockResolvedValue(2);
		setup({
			isMiyapadEndpoint: true,
			useServerTokenization: false,
			authorNoteTokens: { prefix: '', text: 'note', suffix: '' },
		});

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({ proxyEndpoint: 'http://proxy.local' }));
	});

	it('sends the API key for llama.cpp but not for koboldcpp', async () => {
		api.getTokenCount.mockResolvedValue(2);
		setup({ authorNoteTokens: { prefix: '', text: 'note', suffix: '' } });
		await advance(500);
		expect(api.getTokenCount.mock.calls[0]![0]).toHaveProperty('endpointAPIKey', 'sk-abc');

		cleanup();
		api.getTokenCount.mockReset();
		api.getTokenCount.mockResolvedValue(2);
		setup({ endpointAPI: API_KOBOLD_CPP, authorNoteTokens: { prefix: '', text: 'note', suffix: '' } });
		await advance(500);
		expect(api.getTokenCount.mock.calls[0]![0]).not.toHaveProperty('endpointAPIKey');
	});
});

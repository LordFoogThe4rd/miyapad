import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_DEEPSEEK } from '../constants';
import { useTokenCounters } from './useTokenCounters';

const { settings, generation, builder, api } = vi.hoisted(() => ({
	settings: {} as Record<string, any>,
	generation: { cancel: null as unknown, modalState: {} },
	builder: {
		templateReplacements: {} as Record<string, string>,
		replacePlaceholders: vi.fn((s: string) => s),
	},
	api: { getTokenCount: vi.fn(), serverTokenCount: vi.fn() },
}));

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settings }));
vi.mock('../contexts/GenerationContext', () => ({ useGeneration: () => generation }));
vi.mock('./usePromptBuilder', () => ({ usePromptBuilder: () => builder }));
vi.mock('../api/index', () => api);

const emptyAuthorNote = { prefix: '', text: '', suffix: '', tokens: 0 };
const emptyMemory = { prefix: '', text: '', suffix: '', worldInfo: '', tokens: 0, tokensWI: 0 };

function setup(overrides: Record<string, any> = {}) {
	Object.keys(settings).forEach(k => delete settings[k]);
	Object.assign(settings, {
		endpoint: 'http://localhost:8080',
		endpointAPI: API_LLAMA_CPP,
		endpointAPIKey: 'sk-abc',
		sessionStorage: { sessionEndpoint: 'http://localhost:3000', proxyEndpoint: 'http://proxy.local' },
		isMiyapadEndpoint: false,
		useServerTokenization: false,
		contextLength: 4096,
		authorNoteTokens: { ...emptyAuthorNote },
		setAuthorNoteTokens: vi.fn(),
		memoryTokens: { ...emptyMemory },
		setMemoryTokens: vi.fn(),
		worldInfo: { prefix: '[WI]', suffix: '[/WI]' },
		...overrides,
	});
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

		act(() => result.current.handleMemoryTokensChange('worldInfo', 'entry'));

		expect(reduce(setter, { ...emptyMemory })).toEqual({ ...emptyMemory, worldInfo: 'entry' });
	});

	it('returns stable-shaped handlers', () => {
		const { result } = setup();
		expect(typeof result.current.handleauthorNoteTokensChange).toBe('function');
		expect(typeof result.current.handleMemoryTokensChange).toBe('function');
	});
});

describe('useTokenCounters author note counting', () => {
	it('zeroes the count without any request when the note text is empty', async () => {
		setup({ authorNoteTokens: { prefix: 'p', text: '', suffix: 's', tokens: 12 } });

		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
		expect(reduce(settings.setAuthorNoteTokens, { tokens: 12 })).toEqual({ tokens: 0 });
	});

	it('counts prefix + text + suffix and stores the count minus the leading BOS token', async () => {
		api.getTokenCount.mockResolvedValue(11);
		setup({ authorNoteTokens: { prefix: '[', text: 'note', suffix: ']', tokens: 0 } });

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({
			endpoint: 'http://localhost:8080',
			endpointAPI: API_LLAMA_CPP,
			content: '[note]',
		}));
		expect(reduce(settings.setAuthorNoteTokens, { tokens: 0 })).toEqual({ tokens: 10 });
	});

	it('debounces: nothing is requested before 500ms have passed', async () => {
		api.getTokenCount.mockResolvedValue(5);
		setup({ authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 0 } });

		await advance(499);
		expect(api.getTokenCount).not.toHaveBeenCalled();

		await advance(1);
		expect(api.getTokenCount).toHaveBeenCalledTimes(1);
	});

	it('runs the note through the template placeholder replacer', async () => {
		api.getTokenCount.mockResolvedValue(3);
		builder.replacePlaceholders.mockImplementation(() => 'EXPANDED');
		setup({ authorNoteTokens: { prefix: '', text: '{inst}', suffix: '', tokens: 0 } });

		await advance(500);

		expect(builder.replacePlaceholders).toHaveBeenCalledWith('{inst}', builder.templateReplacements);
		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({ content: 'EXPANDED' }));
	});

	it('cancels the pending debounce when the hook unmounts', async () => {
		api.getTokenCount.mockResolvedValue(5);
		const { unmount } = setup({ authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 0 } });

		await advance(400);
		act(() => unmount());
		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
	});

	it('zeroes the count when the request fails for a reason other than an abort', async () => {
		api.getTokenCount.mockRejectedValue(new Error('boom'));
		vi.stubGlobal('reportError', vi.fn());
		setup({ authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 42 } });

		await advance(500);

		expect(reduce(settings.setAuthorNoteTokens, { tokens: 42 })).toEqual({ tokens: 0 });
		vi.unstubAllGlobals();
	});
});

describe('useTokenCounters memory and world info counting', () => {
	it('counts the assembled memory block', async () => {
		api.getTokenCount.mockResolvedValue(9);
		setup({ memoryTokens: { prefix: '<', text: 'mem', suffix: '>', worldInfo: '', tokens: 0, tokensWI: 0 } });

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({ content: '<mem>' }));
		expect(reduce(settings.setMemoryTokens, { tokens: 0, tokensWI: 0 })).toEqual({ tokens: 8, tokensWI: 0 });
	});

	it('wraps world info in the worldInfo prefix and suffix and stores it as tokensWI', async () => {
		api.getTokenCount.mockResolvedValue(7);
		setup({ memoryTokens: { prefix: '', text: '', suffix: '', worldInfo: 'entry', tokens: 0, tokensWI: 0 } });

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledTimes(1);
		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({ content: '[WI]entry[/WI]' }));
		expect(reduce(settings.setMemoryTokens, { tokens: 0, tokensWI: 0 })).toEqual({ tokens: 0, tokensWI: 6 });
	});

	it('counts memory and world info as two separate requests', async () => {
		api.getTokenCount.mockResolvedValue(4);
		setup({ memoryTokens: { prefix: '', text: 'mem', suffix: '', worldInfo: 'entry', tokens: 0, tokensWI: 0 } });

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledTimes(2);
		expect(reduce(settings.setMemoryTokens, { tokens: 0, tokensWI: 0 })).toEqual({ tokens: 3, tokensWI: 3 });
	});

	it('zeroes tokensWI without a request when there is no world info', async () => {
		setup({ memoryTokens: { ...emptyMemory } });

		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
		expect(reduce(settings.setMemoryTokens, { tokens: 5, tokensWI: 5 })).toEqual({ tokens: 0, tokensWI: 0 });
	});
});

describe('useTokenCounters endpoint selection', () => {
	it('skips counting entirely for OpenAI-compatible endpoints', async () => {
		setup({
			endpointAPI: API_OPENAI_COMPAT,
			authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 3 },
			memoryTokens: { prefix: '', text: 'mem', suffix: '', worldInfo: 'wi', tokens: 3, tokensWI: 3 },
		});

		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
		expect(reduce(settings.setAuthorNoteTokens, { tokens: 3 })).toEqual({ tokens: 0 });
		expect(reduce(settings.setMemoryTokens, { tokens: 3, tokensWI: 3 })).toEqual({ tokens: 0, tokensWI: 0 });
	});

	it('skips counting entirely for DeepSeek endpoints', async () => {
		setup({ endpointAPI: API_DEEPSEEK, authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 3 } });

		await advance(1000);

		expect(api.getTokenCount).not.toHaveBeenCalled();
	});

	it('uses the miyapad server tokenizer when server tokenization is on', async () => {
		api.serverTokenCount.mockResolvedValue(6);
		setup({
			isMiyapadEndpoint: true,
			useServerTokenization: true,
			authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 0 },
		});

		await advance(500);

		expect(api.getTokenCount).not.toHaveBeenCalled();
		expect(api.serverTokenCount).toHaveBeenCalledWith(expect.objectContaining({
			sessionEndpoint: 'http://localhost:3000',
			content: 'note',
		}));
		expect(reduce(settings.setAuthorNoteTokens, { tokens: 0 })).toEqual({ tokens: 5 });
	});

	it('passes the proxy endpoint through for a miyapad endpoint without server tokenization', async () => {
		api.getTokenCount.mockResolvedValue(2);
		setup({
			isMiyapadEndpoint: true,
			useServerTokenization: false,
			authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 0 },
		});

		await advance(500);

		expect(api.getTokenCount).toHaveBeenCalledWith(expect.objectContaining({ proxyEndpoint: 'http://proxy.local' }));
	});

	it('sends the API key for llama.cpp but not for koboldcpp', async () => {
		api.getTokenCount.mockResolvedValue(2);
		setup({ authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 0 } });
		await advance(500);
		expect(api.getTokenCount.mock.calls[0]![0]).toHaveProperty('endpointAPIKey', 'sk-abc');

		cleanup();
		api.getTokenCount.mockReset();
		api.getTokenCount.mockResolvedValue(2);
		setup({ endpointAPI: API_KOBOLD_CPP, authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 0 } });
		await advance(500);
		expect(api.getTokenCount.mock.calls[0]![0]).not.toHaveProperty('endpointAPIKey');
	});
});

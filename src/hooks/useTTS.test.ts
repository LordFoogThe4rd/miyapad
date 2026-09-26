import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useTTS } from './useTTS';

const { settings, gen } = vi.hoisted(() => ({
	settings: {
		ttsEnabled: true, setTTSEnabled: vi.fn(), ttsVoiceId: 0, ttsPitch: 1, ttsRate: 1.2, ttsVolume: 0.8,
		ttsSpeakInputs: true, ttsMaxUserInput: 100,
	},
	gen: {
		ttsAvailable: true, setTTSAvailable: vi.fn(),
		ttsNewText: { current: '' }, ttsLastChunk: { current: '' }, ttsQueue: { current: [] as string[] },
		ttsVoices: { current: [] as { name: string }[] }, ttsPaused: { current: false },
		promptChunks: [] as PromptChunk[],
	},
}));

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settings }));
vi.mock('../contexts/GenerationContext', () => ({ useGeneration: () => gen }));

class Utterance extends EventTarget {
	text: string;
	voice: unknown;
	pitch = 0;
	rate = 0;
	volume = 0;
	constructor(text: string) {
		super();
		this.text = text;
	}
}

let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: () => { name: string }[]; speaking: boolean; pending: boolean; onvoiceschanged: null | (() => void) };

/** What was handed to the speech engine, in order. */
function spoken() {
	return synth.speak.mock.calls.map(([u]) => (u as Utterance).text);
}

beforeEach(() => {
	vi.clearAllMocks();
	settings.ttsEnabled = true;
	settings.ttsSpeakInputs = true;
	settings.ttsMaxUserInput = 100;
	gen.ttsNewText.current = '';
	gen.ttsLastChunk.current = '';
	gen.ttsQueue.current = [];
	gen.ttsVoices.current = [{ name: 'Alice' }, { name: 'Bob' }];
	gen.ttsPaused.current = false;
	gen.promptChunks = [];
	synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [{ name: 'Carol' }], speaking: false, pending: false, onvoiceschanged: null };
	vi.stubGlobal('speechSynthesis', synth);
	vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('useTTS', () => {
	it('turns speech off in a browser without it', () => {
		vi.stubGlobal('speechSynthesis', undefined);

		renderHook(() => useTTS());

		expect(gen.setTTSAvailable).toHaveBeenCalledWith(false);
		expect(settings.setTTSEnabled).toHaveBeenCalledWith(false);
	});

	it('picks up the voices once the browser has them', () => {
		renderHook(() => useTTS());

		expect(gen.setTTSAvailable).toHaveBeenCalledWith(true);
		synth.onvoiceschanged!();
		expect(gen.ttsVoices.current).toEqual([{ name: 'Carol' }]);
	});

	it('lists the voices by name and index', () => {
		const { result } = renderHook(() => useTTS());
		expect(result.current.listTTSVoices()).toEqual([{ name: 'Alice', value: 0 }, { name: 'Bob', value: 1 }]);
	});

	it('holds generated text until a sentence ends, then speaks it with the chosen voice', () => {
		const { result } = renderHook(() => useTTS());

		result.current.ttsAddChunk('Hello');
		result.current.ttsAddChunk(' there');
		expect(synth.speak).not.toHaveBeenCalled();

		result.current.ttsAddChunk('!');

		expect(spoken()).toEqual(['Hello there!']);
		const utterance = synth.speak.mock.calls[0][0] as Utterance;
		expect(utterance).toMatchObject({ voice: { name: 'Alice' }, pitch: 1, rate: 1.2, volume: 0.8 });
		expect(gen.ttsNewText.current).toBe('');
	});

	it('does not end a sentence at the dot after Mr', () => {
		const { result } = renderHook(() => useTTS());

		result.current.ttsAddChunk('Ask Mr');
		result.current.ttsAddChunk('.');
		expect(synth.speak).not.toHaveBeenCalled();

		result.current.ttsAddChunk(' Smith.');
		expect(spoken()).toEqual(['Ask Mr. Smith.']);
	});

	it('leaves out special tokens, bracketed text and asterisks', () => {
		const { result } = renderHook(() => useTTS());

		result.current.ttsAddChunk('<|im_end|>*waves* Hi [OOC: note] there.');

		expect(spoken()).toEqual(['waves Hi  there.']);
	});

	it('skips a sentence with nothing to pronounce', () => {
		const { result } = renderHook(() => useTTS());

		result.current.ttsAddChunk('...');

		expect(synth.speak).not.toHaveBeenCalled();
	});

	it('queues the next sentence while one is being spoken, and speaks it when that ends', () => {
		const { result } = renderHook(() => useTTS());
		result.current.ttsAddChunk('One.');
		synth.speaking = true;

		result.current.ttsAddChunk(' Two.');
		expect(spoken()).toEqual(['One.']);

		(synth.speak.mock.calls[0][0] as Utterance).dispatchEvent(new Event('end'));
		expect(spoken()).toEqual(['One.', 'Two.']);
	});

	it('does nothing while speech is off', () => {
		settings.ttsEnabled = false;
		const { result } = renderHook(() => useTTS());

		result.current.ttsAddChunk('Hello.');
		result.current.ttsStop();

		expect(synth.speak).not.toHaveBeenCalled();
		expect(synth.cancel).not.toHaveBeenCalled();
	});

	it('stops speaking, drops the queue, and stays quiet until unpaused', () => {
		const { result } = renderHook(() => useTTS());
		gen.ttsQueue.current = ['Later.'];

		result.current.ttsStop();
		result.current.ttsAddChunk('More.');

		expect(synth.cancel).toHaveBeenCalled();
		expect(gen.ttsQueue.current).toEqual([]);
		expect(synth.speak).not.toHaveBeenCalled();
	});

	it('reads the finished sentences the user typed and keeps the unfinished one for later', () => {
		gen.promptChunks = [{ type: 'user', content: 'First one. Second one? Third' }];
		const { result } = renderHook(() => useTTS());

		result.current.ttsPushUserInput();

		expect(spoken()).toEqual(['First one. Second one?']);
		expect(gen.ttsNewText.current).toBe(' Third');
	});

	it('reads only the last words of a long input', () => {
		settings.ttsMaxUserInput = 3;
		gen.promptChunks = [{ type: 'user', content: 'one two three four five.' }];
		const { result } = renderHook(() => useTTS());

		result.current.ttsPushUserInput();

		expect(spoken()).toEqual(['three four five.']);
	});

	it('does not read the input when the last chunk is generated text, or reading inputs is off', () => {
		gen.promptChunks = [{ content: 'Generated.' }];
		const { result, rerender } = renderHook(() => useTTS());
		result.current.ttsPushUserInput();

		settings.ttsSpeakInputs = false;
		gen.promptChunks = [{ type: 'user', content: 'Typed.' }];
		rerender();
		result.current.ttsPushUserInput();

		expect(synth.speak).not.toHaveBeenCalled();
	});
});

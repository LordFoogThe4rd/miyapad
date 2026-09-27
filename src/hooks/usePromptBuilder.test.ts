import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { usePromptBuilder } from './usePromptBuilder';
import { defaultTemplates } from '../defaults/templates';

const { settings, generation } = vi.hoisted(() => ({
	settings: {} as Record<string, any>,
	generation: {} as Record<string, any>,
}));

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settings }));
vi.mock('../contexts/GenerationContext', () => ({ useGeneration: () => generation }));

const chatml = defaultTemplates.ChatML;

function setup(prompt: string | PromptChunk[], overrides: Record<string, any> = {}, cancel = false) {
	Object.keys(settings).forEach(k => delete settings[k]);
	Object.assign(settings, {
		templates: { chatml, fim: { ...chatml, fimTemplate: '<PRE>{prefix}<SUF>{suffix}<MID>' } },
		selectedTemplate: 'chatml',
		worldInfo: { entries: [], prefix: '[WI]', suffix: '[/WI]' },
		memoryTokens: { contextOrder: '', prefix: '', text: '', suffix: '' },
		authorNoteTokens: { prefix: '', text: '', suffix: '' },
		authorNoteDepth: 0,
		contextLength: 8192,
		...overrides,
	});
	generation.promptChunks = typeof prompt === 'string' ? [{ type: 'user', content: prompt }] : prompt;
	generation.cancel = cancel;
	return renderHook(() => usePromptBuilder()).result.current;
}

const wi = (keys: string[], text: string, search: string | number = '') => ({ keys, text, search });

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('prompt text', () => {
	it('joins every chunk, generated text included', () => {
		const out = setup([{ type: 'user', content: 'Hello ' }, { content: 'world' }]);
		expect(out.promptText).toBe('Hello world');
		expect(out.finalPromptText).toBe('Hello world');
		expect(out.fimPromptInfo).toBeUndefined();
	});
});

describe('{predict} and {fill}', () => {
	it('cuts the prompt at {predict} and drops one trailing space', () => {
		const out = setup([
			{ type: 'user', content: 'Before ' },
			{ content: 'gen' },
			{ type: 'user', content: ' left {predict} right' },
			{ content: 'after' },
		]);
		expect(out.modifiedPromptText).toBe('Before gen left');
		expect(out.fimPromptInfo).toEqual({
			fimPlaceholder: '{predict}',
			fimLeftChunks: [
				{ type: 'user', content: 'Before ' },
				{ content: 'gen' },
				{ type: 'user', content: ' left' },
			],
			fimRightChunks: [{ type: 'user', content: ' right' }, { content: 'after' }],
		});
	});

	it('keeps indentation and double spaces before a placeholder', () => {
		expect(setup('code\n    {predict}').modifiedPromptText).toBe('code\n    ');
		expect(setup('code\n\t {predict}').modifiedPromptText).toBe('code\n\t ');
	});

	it('leaves out empty sides', () => {
		const out = setup('{predict}');
		expect(out.fimPromptInfo).toEqual({ fimPlaceholder: '{predict}', fimLeftChunks: [], fimRightChunks: [] });
	});

	it('only splits at the first placeholder', () => {
		const out = setup('a{predict}b{predict}c');
		expect(out.modifiedPromptText).toBe('a');
		expect(out.fimPromptInfo?.fimRightChunks).toEqual([{ type: 'user', content: 'b{predict}c' }]);
	});

	it('ignores a placeholder in generated text', () => {
		const out = setup([{ content: 'a {predict} b' }]);
		expect(out.modifiedPromptText).toBe('a {predict} b');
		expect(out.fimPromptInfo).toBeUndefined();
	});

	it('fills the template\'s FIM format around {fill}', () => {
		const out = setup('def f():\n{fill}\nreturn x', { selectedTemplate: 'fim' });
		expect(out.modifiedPromptText).toBe('<PRE>def f():\n<SUF>\nreturn x<MID>');
		expect(out.fimPromptInfo?.fimPlaceholder).toBe('{fill}');
	});

	it('leaves {fill} as text when the template has no FIM format', () => {
		const out = setup('a {fill} b');
		expect(out.modifiedPromptText).toBe('a {fill} b');
		expect(out.fimPromptInfo).toBeUndefined();
	});

	it('leaves the prompt whole while a generation is being cancelled', () => {
		const out = setup('a {predict} b', {}, true);
		expect(out.modifiedPromptText).toBe('a {predict} b');
		expect(out.fimPromptInfo).toBeUndefined();
	});
});

describe('world info', () => {
	it('includes entries whose key matches the prompt, ignoring case, in entry order', () => {
		const out = setup('The DRAGON met the knight.', {
			worldInfo: {
				prefix: '[WI]', suffix: '[/WI]',
				entries: [wi(['knight'], 'Knights fight.'), wi(['elf'], 'Elves hide.'), wi(['dragon'], 'Dragons fly.')],
			},
		});
		expect(out.assembledWorldInfo).toBe('Knights fight.\nDragons fly.');
		expect(out.finalPromptText).toBe('[WI]Knights fight.\nDragons fly.[/WI]The DRAGON met the knight.');
	});

	it('treats keys as regular expressions', () => {
		const out = setup('the gr3y wolf', { worldInfo: { prefix: '', suffix: '', entries: [wi(['gr[0-9]y'], 'Wolf.')] } });
		expect(out.assembledWorldInfo).toBe('Wolf.');
	});

	it('skips entries without keys or text', () => {
		const out = setup('dragon', {
			worldInfo: { prefix: '', suffix: '', entries: [wi([], 'No keys.'), wi([''], 'Blank key.'), wi(['dragon'], '')] },
		});
		expect(out.assembledWorldInfo).toBe('');
	});

	it('only searches the end of the prompt given by the entry\'s search range', () => {
		const prompt = 'dragon ' + 'x'.repeat(100) + ' elf';
		const entries = [wi(['dragon'], 'Dragon.', '2'), wi(['elf'], 'Elf.', '2')];
		expect(setup(prompt, { worldInfo: { prefix: '', suffix: '', entries } }).assembledWorldInfo).toBe('Elf.');
	});

	it('logs a broken regex and carries on with the other entries', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const out = setup('dragon', { worldInfo: { prefix: '', suffix: '', entries: [wi(['(unclosed'], 'Bad.'), wi(['dragon'], 'Good.')] } });
		expect(out.assembledWorldInfo).toBe('Good.');
		expect(error).toHaveBeenCalledOnce();
	});

	it('copes with world info that has no entry list', () => {
		expect(setup('dragon', { worldInfo: { prefix: '', suffix: '' } }).assembledWorldInfo).toBe('');
	});
});

describe('memory, author\'s note and context order', () => {
	const memory = { contextOrder: '', prefix: '<mem>', text: 'Remember this.', suffix: '</mem>' };

	it('puts memory before the prompt in the default order', () => {
		expect(setup('Story.', { memoryTokens: memory }).finalPromptText).toBe('<mem>Remember this.</mem>Story.');
	});

	it('keeps the memory wrapper when only world info is present', () => {
		const out = setup('dragon', {
			memoryTokens: { ...memory, text: '' },
			worldInfo: { prefix: '[WI]', suffix: '[/WI]', entries: [wi(['dragon'], 'Fire.')] },
		});
		expect(out.finalPromptText).toBe('<mem>[WI]Fire.[/WI]</mem>dragon');
	});

	it('drops the memory and world info wrappers when both are empty', () => {
		expect(setup('Story.', { memoryTokens: { ...memory, text: '' } }).finalPromptText).toBe('Story.');
	});

	it('follows a custom context order, dropping lines that end up blank', () => {
		const out = setup('Story.', {
			memoryTokens: { ...memory, contextOrder: '{sys}{memText}{/sys}\n{wiText}\n{inst}{prompt}' },
		});
		expect(out.finalPromptText).toBe('<|im_start|>system\nRemember this.\n<|im_end|>\n<|im_start|>user\nStory.');
	});

	it('inserts the author\'s note the given number of lines from the end', () => {
		const authorNoteTokens = { prefix: '[', text: 'note', suffix: ']\\n' };
		expect(setup('l1\nl2\nl3', { authorNoteTokens, authorNoteDepth: 1 }).finalPromptText).toBe('l1\nl2\n[note]\nl3');
		expect(setup('l1\nl2\nl3', { authorNoteTokens, authorNoteDepth: 0 }).finalPromptText).toBe('l1\nl2\nl3[note]\n');
	});

	it('puts the author\'s note at the top when the depth is deeper than the prompt', () => {
		const authorNoteTokens = { prefix: '', text: 'note', suffix: '\\n' };
		expect(setup('l1\nl2', { authorNoteTokens, authorNoteDepth: 10 }).finalPromptText).toBe('note\nl1\nl2');
	});

	it('leaves the author\'s note out when it has no text', () => {
		const authorNoteTokens = { prefix: '[', text: '', suffix: ']' };
		expect(setup('l1\nl2', { authorNoteTokens, authorNoteDepth: 1 }).finalPromptText).toBe('l1\nl2');
	});

	it('drops the start of a prompt longer than the context, leaving room for memory', () => {
		const prompt = 'START' + 'x'.repeat(100) + 'END';
		const bare = setup(prompt, { contextLength: 10 }).finalPromptText;
		expect(bare).not.toContain('START');
		expect(bare.endsWith('xEND')).toBe(true);

		const withMemory = setup(prompt, { contextLength: 10, memoryTokens: { ...memory, prefix: '', suffix: '' } }).finalPromptText;
		expect(withMemory.startsWith('Remember this.')).toBe(true);
		expect(withMemory.length).toBe(bare.length);
	});
});

describe('template placeholders', () => {
	it('maps each placeholder to the selected template', () => {
		expect(setup('').templateReplacements).toEqual({
			'{inst}': chatml.instPre, '{/inst}': chatml.instSuf, '{sys}': chatml.sysPre, '{/sys}': chatml.sysSuf,
		});
	});

	it('replaces them with nothing when no template is selected', () => {
		const out = setup('{inst}hi{/inst}', { selectedTemplate: 'missing' });
		expect(out.finalPromptText).toBe('hi');
	});

	it('replacePlaceholders leaves unknown placeholders and turns \\n into newlines', () => {
		const { replacePlaceholders } = setup('');
		expect(replacePlaceholders('{a}-{b}\\n', { '{a}': 'A' })).toBe('A-{b}\n');
	});
});

describe('convertChatToJSON', () => {
	const convert = (chat: string, template: any = chatml) => setup('').convertChatToJSON(chat, template);

	it('splits a ChatML transcript into system, user and assistant messages', () => {
		const chat = '<|im_start|>system\nBe nice.'
			+ '<|im_end|>\n<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\nHello!'
			+ '<|im_end|>\n<|im_start|>user\nBye<|im_end|>\n<|im_start|>assistant\n';
		expect(convert(chat)).toEqual([
			{ role: 'system', content: 'Be nice.' },
			{ role: 'user', content: 'Hi' },
			{ role: 'assistant', content: 'Hello!' },
			{ role: 'user', content: 'Bye' },
		]);
	});

	it('keeps an unfinished assistant reply without trimming its end', () => {
		const chat = '<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\nOnce upon ';
		expect(convert(chat)).toEqual([
			{ role: 'user', content: 'Hi' },
			{ role: 'assistant', content: 'Once upon ' },
		]);
	});

	it('treats text before any prefix as a user instruction', () => {
		const chat = 'Write a poem.<|im_end|>\n<|im_start|>assistant\nRoses';
		expect(convert(chat)).toEqual([
			{ role: 'user', content: 'Write a poem.' },
			{ role: 'assistant', content: 'Roses' },
		]);
	});

	it('matches prefixes regardless of case and whitespace', () => {
		const alpaca = { sysPre: '', sysSuf: '', instPre: '### Instruction:\\n', instSuf: '\\n### Response:\\n' };
		expect(convert('###  instruction:\nDo it.\n### RESPONSE:\nDone.', alpaca)).toEqual([
			{ role: 'user', content: 'Do it.' },
			{ role: 'assistant', content: 'Done.' },
		]);
	});

	it('returns nothing for a missing template', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(convert('hi', null)).toEqual([]);
	});
});

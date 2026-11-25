import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePromptBuilder } from '../hooks/usePromptBuilder';
import { defaultTemplates } from '../defaults/templates';
import { pluginContext } from './context';
import { clearPluginRuntimeError, getPluginRuntimeErrors } from '../plugins';

const { settings, generation } = vi.hoisted(() => ({
	settings: {} as Record<string, any>,
	generation: {} as Record<string, any>,
}));

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settings }));
vi.mock('../contexts/GenerationContext', () => ({ useGeneration: () => generation }));

const chatml = defaultTemplates.ChatML;
const wi = (keys: string[], text: string, search: string | number = '') => ({ keys, text, search });

function setup(prompt: string, overrides: Record<string, any> = {}) {
	Object.keys(settings).forEach(k => delete settings[k]);
	Object.assign(settings, {
		templates: { chatml },
		selectedTemplate: 'chatml',
		worldInfo: { entries: [], prefix: '[WI]', suffix: '[/WI]' },
		memoryTokens: { contextOrder: '', prefix: '', text: '', suffix: '' },
		authorNoteTokens: { prefix: '', text: '', suffix: '' },
		authorNoteDepth: 0,
		contextLength: 8192,
		...overrides,
	});
	generation.promptChunks = [{ type: 'user', content: prompt }];
	generation.cancel = false;
	return renderHook(() => usePromptBuilder());
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	pluginContext.clear();
	clearPluginRuntimeError();
	cleanup();
	vi.restoreAllMocks();
});

describe('miyapad.context injections', () => {
	it('places before and after injections around the prompt in (order, id, key) order and removes them with null', () => {
		const late = pluginContext.forPlugin('z-plugin', 5);
		const early = pluginContext.forPlugin('a-plugin', -1);
		const sameOrder = pluginContext.forPlugin('b-plugin', -1);

		late.setInjection('late', { text: 'LATE', position: 'before' });
		early.setInjection('b-key', { text: 'EARLY-B', position: 'before' });
		early.setInjection('a-key', { text: 'EARLY-A', position: 'before' });
		sameOrder.setInjection('first', { text: 'SAME', position: 'before' });
		early.setInjection('tail', { text: 'AFTER', position: 'after' });

		const { result } = setup('Story.');
		expect(result.current.finalPromptText).toBe('EARLY-A\nEARLY-B\nSAME\nLATE\nStory.\nAFTER');

		act(() => {
			early.setInjection('b-key', null);
			early.setInjection('tail', null);
		});
		expect(result.current.finalPromptText).toBe('EARLY-A\nSAME\nLATE\nStory.');
	});

	it('splices depth injections into the truncated prompt by line depth like Author\'s Note', () => {
		const ctx = pluginContext.forPlugin('notes', 0);
		ctx.setInjection('mid', { text: '[MID]\n', position: 'depth', depth: 1 });
		ctx.setInjection('end', { text: '[END]', position: 'depth' });

		const { result } = setup('l1\nl2\nl3');
		expect(result.current.finalPromptText).toBe('l1\nl2\n[MID]\nl3[END]');
	});

	it('scans World Info against injections marked scanWorldInfo: true', () => {
		const ctx = pluginContext.forPlugin('tracker', 0);
		ctx.setInjection('ignored', { text: 'secret elf', position: 'before', scanWorldInfo: false });
		ctx.setInjection('scanned', { text: 'active dragon', position: 'before', scanWorldInfo: true });

		const { result } = setup('Quiet tavern.', {
			worldInfo: {
				prefix: '[WI]',
				suffix: '[/WI]',
				entries: [
					wi(['dragon'], 'Dragons breathe fire.'),
					wi(['elf'], 'Elves live in trees.'),
				],
			},
		});

		expect(result.current.assembledWorldInfo).toBe('Dragons breathe fire.');
		expect(result.current.finalPromptText).toBe('[WI]Dragons breathe fire.[/WI]secret elf\nactive dragon\nQuiet tavern.');
	});

	it('counts active injections in additionalContext before truncation so contextLength is respected', () => {
		const prompt = 'START' + 'x'.repeat(100) + 'END';
		const bare = setup(prompt, { contextLength: 10 }).result.current.finalPromptText;

		const ctx = pluginContext.forPlugin('summary', 0);
		ctx.setInjection('s', { text: 'SUMMARY', position: 'before' });
		ctx.setInjection('d', { text: '[D]', position: 'depth', depth: 0 });

		const withInjections = setup(prompt, { contextLength: 10 }).result.current.finalPromptText;
		expect(withInjections.startsWith('SUMMARY\n')).toBe(true);
		expect(withInjections.endsWith('END[D]')).toBe(true);
		expect(withInjections.length).toBe(bare.length);
	});

	it('validates setInjection arguments', () => {
		const ctx = pluginContext.forPlugin('p', 0);
		expect(() => ctx.setInjection('', { text: 'x' })).toThrow(TypeError);
		expect(() => ctx.setInjection('k', { text: 123 as unknown as string })).toThrow(TypeError);
		expect(() => ctx.setInjection('k', { text: 'x', position: 'sideways' as any })).toThrow(TypeError);
		expect(() => ctx.setInjection('k', { text: 'x', position: 'depth', depth: -1 })).toThrow(RangeError);
	});
});

describe('miyapad.context placeholders', () => {
	it('expands {name} and {{name}} before World Info scanning and truncation', () => {
		const ctx = pluginContext.forPlugin('vars', 0);
		ctx.setPlaceholder('creature', () => 'dragon');
		ctx.setPlaceholder('place', () => 'castle');

		const { result } = setup('A {{creature}} guards the {place}.', {
			worldInfo: {
				prefix: '[WI]',
				suffix: '[/WI]',
				entries: [wi(['dragon'], 'Dragons fly.')],
			},
		});

		expect(result.current.assembledWorldInfo).toBe('Dragons fly.');
		expect(result.current.finalPromptText).toBe('[WI]Dragons fly.[/WI]A dragon guards the castle.');

		// Expanded length is counted during truncation.
		ctx.setPlaceholder('long', () => 'Y'.repeat(50));
		const truncated = setup('PREFIX{{long}}TAIL', { contextLength: 10 }).result.current.finalPromptText;
		expect(truncated).not.toContain('PREFIX');
		expect(truncated.endsWith('TAIL')).toBe(true);
	});

	it('logs throwing or non-string placeholders under plugin id and leaves them untouched', () => {
		const bad = pluginContext.forPlugin('broken-ph', 0);
		const wrong = pluginContext.forPlugin('wrong-ph', 0);
		bad.setPlaceholder('boom', () => { throw new Error('ph failed'); });
		wrong.setPlaceholder('num', (() => 42) as unknown as () => string);

		const { result } = setup('Keep {{boom}} and {num} intact.');
		expect(result.current.finalPromptText).toBe('Keep {{boom}} and {num} intact.');
		expect(getPluginRuntimeErrors()).toEqual({
			'broken-ph': 'Error: ph failed',
			'wrong-ph': 'placeholder "num" returned number instead of a string',
		});
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugins] "broken-ph":'), expect.any(Error));
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugins] "wrong-ph":'), 42);
	});

	it('allows removing a placeholder with null without affecting other plugins', () => {
		const p1 = pluginContext.forPlugin('p1', 0);
		const p2 = pluginContext.forPlugin('p2', 1);
		p1.setPlaceholder('x', () => 'one');
		p2.setPlaceholder('x', () => 'two');

		const { result } = setup('{x}');
		expect(result.current.finalPromptText).toBe('two');

		act(() => { p2.setPlaceholder('x', null); });
		expect(result.current.finalPromptText).toBe('one');

		act(() => { p1.setPlaceholder('x', null); });
		expect(result.current.finalPromptText).toBe('{x}');
	});
});

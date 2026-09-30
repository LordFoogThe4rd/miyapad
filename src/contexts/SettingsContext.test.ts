import { html } from 'htm/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { SettingsProvider, useSettings } from './SettingsContext';

/** Values a session saved before this version, handed back by the stub session state. */
let saved: Record<string, unknown> = {};

function useSessionState<T>(name: string, initialState: T) {
	return useState<T>(Object.hasOwn(saved, name) ? saved[name] as T : initialState);
}

function useDB<T>(initialState: T) {
	return useState(initialState);
}

function Wrapper({ children }: { children: ReactNode }) {
	return html`<${SettingsProvider}
		sessionStorage=${{}} templateStorage=${{}} themeStorage=${{}} connectionStorage=${{}} samplerPresetStorage=${{}}
		useSessionState=${useSessionState} useDBTemplates=${useDB} useDBThemes=${useDB} useDBConnections=${useDB} useDBSamplerPresets=${useDB}
		isMiyapadEndpoint=${false}>${children}</${SettingsProvider}>`;
}

function load(session: Record<string, unknown> = {}, stored: Record<string, unknown> = {}) {
	saved = session;
	for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, JSON.stringify(value));
	return renderHook(() => useSettings(), { wrapper: Wrapper }).result.current;
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe('SettingsProvider conversion of old saved settings', () => {
	it('turns an old flat logit bias map into bias entries and drops values that are not numbers', () => {
		const { logitBias } = load({ logitBias: { hello: 2, ' world': -1.5, junk: 'x' } });

		expect(logitBias).toEqual({
			bias: {
				hello: { ids: [], strings: ['hello'], power: 2 },
				' world': { ids: [], strings: [' world'], power: -1.5 },
			},
			model: 'none',
		});
	});

	it('passes a logit bias already in the new shape through unchanged', () => {
		const current = { bias: { a: { ids: [1], strings: [], power: 3 } }, model: 'llama' };

		expect(load({ logitBias: current }).logitBias).toBe(current);
	});

	it('starts token highlighting off when the old highlightGenTokens was off, and on otherwise', () => {
		expect(load({}, { highlightGenTokens: false }).tokenHighlightMode).toBe(-1);
		cleanup();
		localStorage.clear();
		expect(load().tokenHighlightMode).toBe(0);
	});

	it('starts perplexity colouring when the old colorizePerplexity was on, and none otherwise', () => {
		expect(load({}, { colorizePerplexity: true }).tokenColorMode).toBe(2);
		cleanup();
		localStorage.clear();
		expect(load().tokenColorMode).toBe(0);
	});

	it('prefers the new keys over the old ones once they are saved', () => {
		const settings = load({}, { highlightGenTokens: false, tokenHighlightMode: 1, colorizePerplexity: true, tokenColorMode: 1, theme: 2, themeName: 'Custom' });

		expect([settings.tokenHighlightMode, settings.tokenColorMode, settings.currentThemeName]).toEqual([1, 1, 'Custom']);
	});

	it.each([
		[1, 'Serif Dark'],
		[2, 'Monospace Dark'],
		[3, 'NockoffAI'],
		[4, 'E-Reader'],
		[0, 'Serif Light'],
		[undefined, 'Serif Light'],
	])('picks the theme named for old theme number %s', (theme, name) => {
		expect(load({}, theme === undefined ? {} : { theme }).currentThemeName).toBe(name);
	});

	it('turns basic stopping mode off for a session that saved its own stopping strings', () => {
		expect(load({ stoppingStrings: '["\\n"]' }).useBasicStoppingMode).toBe(false);
	});

	it('keeps the default basic stopping mode when the saved stopping strings are empty', () => {
		expect(load({ stoppingStrings: '[]' }).useBasicStoppingMode).toBe(true);
	});
});

describe('useSettings', () => {
	it('throws outside a SettingsProvider', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(() => renderHook(() => useSettings())).toThrow('useSettings must be used within a SettingsProvider');
		vi.restoreAllMocks();
	});
});

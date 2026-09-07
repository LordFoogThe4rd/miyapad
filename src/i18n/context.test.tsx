import { html } from 'htm/react';
import type { ReactNode } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import en from './en.json';
import { I18nProvider, useT } from './context';

function wrapper({ children }: { children: ReactNode }) {
	return html`<${I18nProvider} locale="en">${children}<//>`;
}

function renderT() {
	return renderHook(() => useT(), { wrapper }).result;
}

afterEach(() => {
	cleanup();
});

describe('useT', () => {
	it('looks a key up in the bundled English strings', () => {
		const t = renderT();
		expect(t.current('about.title')).toBe(en['about.title']);
	});

	it('returns the key itself when it is missing from the bundle', () => {
		const t = renderT();
		expect(t.current('does.not.exist' as never)).toBe('does.not.exist');
	});

	it('works without a provider, falling back to the default English context', () => {
		const { result } = renderHook(() => useT());
		expect(result.current('about.title')).toBe(en['about.title']);
	});

	it('substitutes a {{param}} placeholder', () => {
		const t = renderT();
		expect(t.current('themeManager.copySuffix', { name: 'Midnight' })).toBe('Midnight (Copy)');
	});

	it('substitutes every occurrence of a repeated placeholder', () => {
		const t = renderT();
		expect(t.current('does.not.exist {{a}} and {{a}}' as never, { a: 'x' }))
			.toBe('does.not.exist x and x');
	});

	it('substitutes several distinct placeholders', () => {
		const t = renderT();
		expect(t.current('themeManager.copySuffixNum', { name: 'Midnight', counter: 2 }))
			.toBe('Midnight (Copy 2)');
	});

	it('stringifies numeric params', () => {
		const t = renderT();
		expect(t.current('worldInfo.indexOutOfRange', { index: 7 })).toBe('Index 7 out of range!');
	});

	it('leaves placeholders alone when no params are passed', () => {
		const t = renderT();
		expect(t.current('themeManager.copySuffix')).toBe(en['themeManager.copySuffix']);
		expect(t.current('themeManager.copySuffix')).toContain('{{name}}');
	});

	it('leaves a placeholder untouched when the param is not supplied', () => {
		const t = renderT();
		expect(t.current('themeManager.copySuffixNum', { name: 'Midnight' }))
			.toBe('Midnight (Copy {{counter}})');
	});

	it('does not treat $& in a replacement value as a regex reference', () => {
		const t = renderT();
		expect(t.current('themeManager.copySuffix', { name: 'a$&b' })).toBe('a$&b (Copy)');
	});

	it('returns a stable callback identity while the strings do not change', () => {
		const { result, rerender } = renderHook(() => useT(), { wrapper });
		const first = result.current;
		rerender();
		expect(result.current).toBe(first);
	});
});

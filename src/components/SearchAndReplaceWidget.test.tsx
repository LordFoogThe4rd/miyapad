import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { html } from 'htm/react';
import { SearchAndReplaceWidget } from './SearchAndReplaceWidget';

// ponytail: fake adapter (string ops) instead of a real ProseMirrorAdapter; adapter behavior is covered in EditorAdapter.test.ts
function makeAdapter(text: string) {
	const adapter: any = {
		text,
		getText: () => adapter.text,
		focus: vi.fn(),
		setSelection: vi.fn(),
		scrollIntoView: vi.fn(),
		replaceRanges: vi.fn((changes: { from: number; to: number; insert: string }[]) => {
			for (const c of changes) {
				adapter.text = adapter.text.slice(0, c.from) + c.insert + adapter.text.slice(c.to);
			}
		}),
		replaceText: vi.fn((newText: string) => {
			adapter.text = newText;
		}),
	};
	return { current: adapter };
}

function renderWidget(adapter: any, props: Record<string, any> = {}) {
	return render(html`
		<${SearchAndReplaceWidget}
			isOpen=${true}
			closeWidget=${vi.fn()}
			editorView=${adapter}
			...${props}
		/>`);
}

const counter = () => document.querySelector('.number-matches')!.textContent ?? '';
const errorText = () => document.querySelector('.error-text')?.textContent ?? '';

function typeSearch(value: string) {
	fireEvent.change(screen.getByPlaceholderText('Hatsune Miku'), { target: { value } });
}
function typeReplace(value: string) {
	fireEvent.change(screen.getByPlaceholderText('GUMI'), { target: { value } });
}
function typeRegexSearch(value: string) {
	fireEvent.change(screen.getByPlaceholderText('(\\w+) Miku'), { target: { value } });
}
function setMode(value: string) {
	fireEvent.change(screen.getByRole('combobox'), { target: { value } });
}
const findNext = () => fireEvent.click(screen.getByTitle('Find Next Match'));
const findPrev = () => fireEvent.click(screen.getByTitle('Find Previous Match'));
const replaceAll = () => fireEvent.click(screen.getByRole('button', { name: 'Replace All' }));

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal('reportError', vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
	cleanup();
});

describe('SearchAndReplaceWidget', () => {
	it('replaces all plain-text matches', () => {
		const adapter = makeAdapter('aaa bbb aaa ccc aaa');
		renderWidget(adapter);
		typeSearch('aaa');
		typeReplace('X');
		replaceAll();
		expect(adapter.current.text).toBe('X bbb X ccc X');
		expect(adapter.current.focus).toHaveBeenCalled();
	});

	it('unescapes literal \\n in plain-text replacement', () => {
		const adapter = makeAdapter('aaa bbb aaa');
		renderWidget(adapter);
		typeSearch('aaa');
		typeReplace('X\\nY');
		replaceAll();
		expect(adapter.current.text).toBe('X\nY bbb X\nY');
	});

	it('supports regex replacement with capture-group refs', () => {
		const adapter = makeAdapter('Miku Miku');
		renderWidget(adapter);
		setMode('1');
		typeRegexSearch('(\\w+)');
		fireEvent.change(screen.getByPlaceholderText('$1 GUMI'), { target: { value: '$1!' } });
		replaceAll();
		expect(adapter.current.text).toBe('Miku! Miku!');
	});

	it('unescapes literal \\n in regex replacement', () => {
		const adapter = makeAdapter('Miku Miku');
		renderWidget(adapter);
		setMode('1');
		typeRegexSearch('Miku');
		fireEvent.change(screen.getByPlaceholderText('$1 GUMI'), { target: { value: 'X\\nY' } });
		replaceAll();
		expect(adapter.current.text).toBe('X\nY X\nY');
	});

	it('navigates next/prev with wrap-around', () => {
		const adapter = makeAdapter('aaa bbb aaa ccc aaa');
		renderWidget(adapter);
		typeSearch('aaa');
		findNext();
		expect(counter()).toContain('1 /');
		expect(counter()).toContain('3 Matches');
		findNext();
		expect(counter()).toContain('2 /');
		findPrev();
		expect(counter()).toContain('1 /');
		findPrev();
		expect(counter()).toContain('3 /');
		expect(adapter.current.setSelection).toHaveBeenCalledWith(16, 19);
		expect(adapter.current.scrollIntoView).toHaveBeenCalledWith(16, { y: 'center' });
		expect(adapter.current.focus).toHaveBeenCalledTimes(4);
	});

	it('starts previous navigation at the last match', () => {
		const adapter = makeAdapter('aaa bbb aaa');
		renderWidget(adapter);
		typeSearch('aaa');
		findPrev();
		expect(counter()).toContain('2 /');
	});

	it('rebuilds the match list and clamps the index when the search changes', () => {
		const adapter = makeAdapter('aaa bbb aaa ccc aaa');
		renderWidget(adapter);
		typeSearch('aaa');
		findNext();
		findNext();
		expect(counter()).toContain('2 /');
		typeSearch('ccc');
		expect(counter()).toContain('1 /');
		expect(counter()).toContain('1 Match');
		findNext();
		expect(counter()).toContain('1 /');
		findPrev();
		expect(counter()).toContain('1 /');
	});

	it('clears the match list when the search term is cleared', () => {
		const adapter = makeAdapter('aaa bbb aaa');
		renderWidget(adapter);
		typeSearch('aaa');
		findNext();
		expect(counter()).toContain('1 /');
		typeSearch('');
		expect(counter().trim()).toBe('');
		replaceAll();
		expect(adapter.current.text).toBe('aaa bbb aaa');
	});

	it('rebuilds matches when switching mode', () => {
		const adapter = makeAdapter('aaa bbb aaa ccc aaa');
		renderWidget(adapter);
		typeSearch('a+');
		expect(counter()).toContain('0 Matches');
		setMode('1');
		expect(counter()).toContain('3 Matches');
	});

	it('recounts when the editor text changes (promptText rerender)', () => {
		const adapter = makeAdapter('aaa bbb');
		const { rerender } = renderWidget(adapter);
		typeSearch('aaa');
		expect(counter()).toContain('1 Match');
		adapter.current.text = 'aaa aaa bbb';
		rerender(html`
			<${SearchAndReplaceWidget}
				isOpen=${true}
				closeWidget=${vi.fn()}
				editorView=${adapter}
				promptText=${'aaa aaa bbb'}
			/>`);
		expect(counter()).toContain('2 Matches');
	});

	it('shows an error for an invalid regex and does not replace', () => {
		const adapter = makeAdapter('aaa bbb aaa');
		renderWidget(adapter);
		setMode('1');
		typeRegexSearch('[');
		expect(errorText()).toContain('Invalid regular expression');
		replaceAll();
		expect(adapter.current.text).toBe('aaa bbb aaa');
		expect(errorText()).toContain('Invalid regular expression');
	});

	it('warns when there are no matches', () => {
		const adapter = makeAdapter('aaa bbb');
		renderWidget(adapter);
		typeSearch('zzz');
		expect(counter()).toContain('0 Matches');
		findNext();
		expect(errorText()).toContain('No matches found');
		expect(errorText()).toContain('zzz');
		replaceAll();
		expect(adapter.current.text).toBe('aaa bbb');
	});

	it('disables replacement when cancel is set', () => {
		const adapter = makeAdapter('aaa bbb aaa');
		renderWidget(adapter, { cancel: true });
		expect((screen.getByPlaceholderText('GUMI') as HTMLInputElement).readOnly).toBe(true);
		expect(screen.getByRole('button', { name: 'Replace All' }).hasAttribute('disabled')).toBe(true);
	});
});

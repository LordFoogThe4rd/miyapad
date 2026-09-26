import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { html } from 'htm/react';
import en from '../../i18n/en.json';
import { SessionsModal, tagSuggestions, typeAheadMatch } from './SessionsModal';

describe('tagSuggestions', () => {
	const tags = ['wip', 'archived', 'draft'];

	it('offers every tag for an empty box or the first tag', () => {
		expect(tagSuggestions('', tags)).toEqual(tags);
		expect(tagSuggestions('ar', tags)).toEqual(tags);
	});

	it('prefixes each suggestion with the tags typed so far, keeping the spacing', () => {
		expect(tagSuggestions('wip, ar', tags)).toEqual(['wip, archived', 'wip, draft']);
		expect(tagSuggestions('wip,', tags)).toEqual(['wip,archived', 'wip,draft']);
	});

	it('leaves out tags already typed, whatever their case', () => {
		expect(tagSuggestions('Draft , wip, ', tags)).toEqual(['Draft , wip, archived']);
	});
});

describe('typeAheadMatch', () => {
	const names: Record<string, string> = { a: 'Alpha', b: 'Beta', c: 'alps', d: 'Delta' };
	const ids = Object.keys(names);
	const nameOf = (id: string) => names[id]!;

	it('steps to the next match below the row for a single letter, wrapping round, whatever the case', () => {
		expect(typeAheadMatch(ids, nameOf, 0, 'a')).toBe('c');
		expect(typeAheadMatch(ids, nameOf, 2, 'a')).toBe('a');
	});

	it('steps on when the same letter is pressed again quickly, instead of looking for "aa"', () => {
		expect(typeAheadMatch(ids, nameOf, 2, 'aa')).toBe('a');
		expect(typeAheadMatch(ids, nameOf, 0, 'aaa')).toBe('c');
	});

	it('stays on the row while it still matches the longer text', () => {
		expect(typeAheadMatch(ids, nameOf, 0, 'alp')).toBe('a');
		expect(typeAheadMatch(ids, nameOf, 0, 'alps')).toBe('c');
	});

	it('finds nothing when no name starts with the text', () => {
		expect(typeAheadMatch(ids, nameOf, 1, 'z')).toBeUndefined();
	});
});

describe('SessionsModal', () => {
	afterEach(() => {
		cleanup();
		localStorage.clear();
		vi.restoreAllMocks();
	});

	/** Session 1 is open; the others' text is only in the database, as `texts`. */
	const fakeStorage = (texts: Record<string, string> = {}) => ({
		sessions: {
			1: { name: 'Open one', modified: 3, prompt: [{ content: 'open text' }] },
			2: { name: 'Draft', modified: 2, folder: 'Stories' },
			3: { name: 'Notes', modified: 1 },
		},
		trash: {},
		selectedSession: 1,
		addEventListener() {},
		removeEventListener() {},
		switchSession: vi.fn(async () => {}),
		openDatabase: async () => ({}),
		loadFromDatabase: vi.fn(async (_db: unknown, id: string) => ({ prompt: [{ content: texts[id] ?? '' }] })),
	});

	const renderModal = (storage: ReturnType<typeof fakeStorage>, closeModal = () => {}) => render(html`
		<${SessionsModal} isOpen=${true} closeModal=${closeModal} sessionStorage=${storage} cancel=${null}
			openHistory=${() => {}} openStatistics=${() => {}}/>`);

	const item = (key: string) => [...document.querySelectorAll<HTMLElement>('[data-key]')].find(el => el.dataset.key === key);
	const paneName = () => document.querySelector('.sessions-pane-name')?.textContent;
	/** What a real click does: the press focuses the item before the click lands. */
	const click = (el: HTMLElement, init: MouseEventInit = {}) => {
		fireEvent.mouseDown(el, init);
		fireEvent.focus(el);
		fireEvent.click(el, init);
	};

	it('shows a clicked session in the pane, and opens it on a second click', async () => {
		const storage = fakeStorage();
		const closeModal = vi.fn();
		renderModal(storage, closeModal);
		expect(paneName()).toBe('Open one');

		click(item('3')!);
		expect(paneName()).toBe('Notes');
		expect(storage.switchSession).not.toHaveBeenCalled();

		click(item('3')!);
		await waitFor(() => expect(closeModal).toHaveBeenCalled());
		expect(storage.switchSession).toHaveBeenCalledWith('3');
	});

	it('shows the end of the text, reading it from the database for a session that is not open', async () => {
		const long = 'x'.repeat(400) + 'the end';
		const storage = fakeStorage({ 3: long });
		renderModal(storage);
		const text = () => document.querySelector('.sessions-pane-text')!.textContent;
		expect(text()).toBe('open text');

		click(item('3')!);
		expect(text()).toBe('…');
		await waitFor(() => expect(text()).toBe(`…${long.slice(-300)}`));

		vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.loadFromDatabase.mockRejectedValueOnce(new Error('gone'));
		click(item('2')!);
		await waitFor(() => expect(text()).toBe(en['sessions.previewFailed']));
	});

	it('remembers the icon view, where a second plain click opens a folder and Backspace leaves it', () => {
		const storage = fakeStorage();
		renderModal(storage);
		fireEvent.click(screen.getByRole('button', { name: en['sessions.viewIcons'] }));
		expect(item('2')).toBeUndefined();

		const folder = item('folder:Stories')!;
		click(folder);
		expect(paneName()).toBe('Stories');
		click(folder, { ctrlKey: true });
		expect(item('3')).toBeDefined();
		click(folder);
		expect(item('3')).toBeUndefined();
		expect(document.activeElement).toBe(item('2'));

		fireEvent.keyDown(item('2')!, { key: 'Backspace' });
		expect(document.activeElement).toBe(item('folder:Stories'));

		cleanup();
		renderModal(storage);
		expect(document.querySelector('.sessions-grid')).not.toBeNull();
	});

	it('resizes the pane with the arrow keys and by dragging the divider, and remembers the width', () => {
		const storage = fakeStorage();
		renderModal(storage);
		const divider = screen.getByRole('separator', { name: en['sessions.resizePane'] });
		const pane = () => document.querySelector<HTMLElement>('.sessions-pane')!;
		const width = () => pane().style.getPropertyValue('--pane-width');
		expect(width()).toBe('');

		// jsdom has no layout, so give the pane and the divider the sizes a browser would.
		Object.defineProperty(pane(), 'offsetWidth', { configurable: true, value: 300 });
		fireEvent.keyDown(divider, { key: 'ArrowLeft' });
		expect(width()).toBe('316px');
		fireEvent.keyDown(divider, { key: 'ArrowRight' });
		expect(width()).toBe('284px');

		divider.setPointerCapture = vi.fn();
		vi.spyOn(divider.parentElement!, 'getBoundingClientRect').mockReturnValue({ right: 1000 } as DOMRect);
		vi.spyOn(divider, 'getBoundingClientRect').mockReturnValue({ right: 612 } as DOMRect);
		// jsdom has no PointerEvent, and the Event fireEvent falls back to has no clientX.
		const pointer = (type: string, clientX: number) => fireEvent(divider, new MouseEvent(type, { bubbles: true, clientX }));
		// Grabbed 6px left of its right edge, so the pane's edge is 6px right of the pointer.
		pointer('pointerdown', 606);
		pointer('pointermove', 700);
		expect(width()).toBe('294px');
		fireEvent(divider, new Event('lostpointercapture'));
		pointer('pointermove', 500);
		expect(width()).toBe('294px');

		cleanup();
		renderModal(storage);
		expect(width()).toBe('294px');
	});
});

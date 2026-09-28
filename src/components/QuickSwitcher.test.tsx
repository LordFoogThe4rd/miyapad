import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { html } from 'htm/react';
import { QuickSwitcher } from './QuickSwitcher';

afterEach(cleanup);

const storage = { sessions: {}, addEventListener() {}, removeEventListener() {} };
const page = (isOpen: boolean) => html`
	<div>
		<button id="editor">editor</button>
		<${QuickSwitcher} isOpen=${isOpen} closeModal=${() => {}} sessionStorage=${storage} cancel=${null} commands=${[]}/>
	</div>`;

describe('QuickSwitcher', () => {
	it('is a dialog that keeps Tab in its box and gives focus back when it closes', async () => {
		const { rerender } = render(page(false));
		const editor = document.getElementById('editor')!;
		editor.focus();

		rerender(page(true));
		expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
		const input = screen.getByRole('combobox', { name: 'Switch session or run a command' });
		await waitFor(() => expect(document.activeElement).toBe(input));
		// fireEvent returns false when the default action was prevented.
		expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);

		rerender(page(false));
		expect(document.activeElement).toBe(editor);
	});

	it('lists commands after >, and runs the picked one once it has closed', () => {
		const calls: string[] = [];
		const closeModal = vi.fn(() => calls.push('close'));
		const switchSession = vi.fn(async () => {});
		const commands = [
			{ label: 'Memory', action: () => calls.push('memory'), disabled: false },
			{ label: 'Manage Themes', action: () => calls.push('themes'), disabled: true },
			{ label: 'Undo (Ctrl + Z)', action: () => calls.push('undo'), disabled: false },
		];
		const sessions = { sessions: { 1: { name: 'Memory lane' } }, switchSession, addEventListener() {}, removeEventListener() {} };
		render(html`<${QuickSwitcher} isOpen=${true} closeModal=${closeModal} sessionStorage=${sessions} cancel=${() => {}} commands=${commands}/>`);
		const input = screen.getByRole('combobox');
		const labels = () => [...document.querySelectorAll('.quick-switcher-item')].map(el => el.textContent);

		fireEvent.change(input, { target: { value: 'mem' } });
		expect(labels()).toEqual(['Memory lane']);
		// A generation is running, so the session can't be switched to.
		fireEvent.keyDown(input, { key: 'ArrowDown' });
		fireEvent.keyDown(input, { key: 'Enter' });
		expect(switchSession).not.toHaveBeenCalled();

		fireEvent.change(input, { target: { value: '>' } });
		expect(labels()).toEqual(['Memory', 'Manage Themes', 'Undo (Ctrl + Z)']);
		fireEvent.change(input, { target: { value: '> THE' } });
		expect(labels()).toEqual(['Manage Themes']);
		fireEvent.keyDown(input, { key: 'ArrowDown' });
		fireEvent.keyDown(input, { key: 'Enter' });
		expect(calls).toEqual([]);

		fireEvent.change(input, { target: { value: '>mem' } });
		fireEvent.keyDown(input, { key: 'ArrowDown' });
		// Focus stays in the box, so screen readers learn the highlighted row through the combobox.
		const [option] = screen.getAllByRole('option');
		expect(option.getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe(option.id);
		fireEvent.keyDown(input, { key: 'Enter' });
		expect(calls).toEqual(['close', 'memory']);

		fireEvent.change(input, { target: { value: '>zzz' } });
		expect(screen.getByText('No commands found')).toBeTruthy();
	});
});

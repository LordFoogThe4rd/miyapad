import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { html } from 'htm/react';
import { QuickSwitcher } from './QuickSwitcher';

afterEach(cleanup);

const storage = { sessions: {}, addEventListener() {}, removeEventListener() {} };
const page = (isOpen: boolean) => html`
	<div>
		<button id="editor">editor</button>
		<${QuickSwitcher} isOpen=${isOpen} closeModal=${() => {}} sessionStorage=${storage} cancel=${null}/>
	</div>`;

describe('QuickSwitcher', () => {
	it('is a dialog that keeps Tab in its box and gives focus back when it closes', async () => {
		const { rerender } = render(page(false));
		const editor = document.getElementById('editor')!;
		editor.focus();

		rerender(page(true));
		expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
		const input = screen.getByRole('textbox');
		await waitFor(() => expect(document.activeElement).toBe(input));
		// fireEvent returns false when the default action was prevented.
		expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);

		rerender(page(false));
		expect(document.activeElement).toBe(editor);
	});
});

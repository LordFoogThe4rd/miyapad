import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { html } from 'htm/react';
import { Modal } from './Modal';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const page = (isOpen: boolean) => html`
	<div>
		<button id="trigger">open</button>
		<${Modal} isOpen=${isOpen} onClose=${() => {}} title="Test" description="">
			<input id="first"/>
			<button>inner</button>
		<//>
	</div>`;

describe('Modal', () => {
	it('takes focus on open, keeps Tab inside, and gives focus back on close', () => {
		// jsdom has no layout, so every element would count as hidden.
		vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
		const { rerender } = render(page(false));
		document.getElementById('trigger')!.focus();

		rerender(page(true));
		const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Test');
		expect(document.activeElement).toBe(dialog);

		const close = dialog.querySelector<HTMLElement>('.button-modal-top')!;
		close.focus();
		fireEvent.keyDown(close, { key: 'Tab' });
		expect(document.activeElement).toBe(document.getElementById('first'));
		fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(close);

		rerender(page(false));
		expect(document.activeElement).toBe(document.getElementById('trigger'));
	});

	it('lets a press inside reach the document, and closes only on a press that starts on the background', () => {
		const onClose = vi.fn();
		const pressed = vi.fn();
		document.addEventListener('mousedown', pressed);
		render(html`<${Modal} isOpen=${true} onClose=${onClose} title="Test"><button id="inner">x</button><//>`);
		const overlay = document.querySelector('.modal-overlay')!;

		fireEvent.mouseDown(document.getElementById('inner')!);
		expect(pressed).toHaveBeenCalled();
		// Pressed inside and let go outside, as when selecting text.
		fireEvent.click(overlay);
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.mouseDown(overlay);
		fireEvent.click(overlay);
		expect(onClose).toHaveBeenCalledOnce();
		document.removeEventListener('mousedown', pressed);
	});

	it('leaves focus with a field that asked for it', () => {
		const { rerender } = render(html`<${Modal} isOpen=${false} onClose=${() => {}} title="Test"><input autoFocus/><//>`);
		rerender(html`<${Modal} isOpen=${true} onClose=${() => {}} title="Test"><input autoFocus/><//>`);
		expect(document.activeElement?.tagName).toBe('INPUT');
	});
});

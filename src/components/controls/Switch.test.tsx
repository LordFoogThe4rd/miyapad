import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { html } from 'htm/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

afterEach(cleanup);

describe('Switch', () => {
	it('renders role="switch" with aria-checked and toggles on click', () => {
		const onChange = vi.fn();
		const { rerender } = render(html`<${Switch} checked=${false} ariaLabel="Enable feature" onChange=${onChange}/>`);

		const sw = screen.getByRole('switch', { name: 'Enable feature' });
		expect(sw.getAttribute('aria-checked')).toBe('false');

		fireEvent.click(sw);
		expect(onChange).toHaveBeenCalledWith(true);

		rerender(html`<${Switch} checked=${true} ariaLabel="Enable feature" onChange=${onChange}/>`);
		expect(sw.getAttribute('aria-checked')).toBe('true');

		fireEvent.click(sw);
		expect(onChange).toHaveBeenCalledWith(false);
	});

	it('associates a visible label and toggles when the label is clicked', () => {
		const onChange = vi.fn();
		render(html`<${Switch} checked=${false} label="Auto save" onChange=${onChange}/>`);

		const sw = screen.getByRole('switch', { name: 'Auto save' });
		expect(sw.getAttribute('aria-label')).toBeNull();

		fireEvent.click(screen.getByText('Auto save'));
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it('does not call onChange when disabled', () => {
		const onChange = vi.fn();
		render(html`<${Switch} checked=${false} ariaLabel="Locked" disabled=${true} onChange=${onChange}/>`);

		const sw = screen.getByRole('switch', { name: 'Locked' });
		expect((sw as HTMLButtonElement).disabled).toBe(true);

		fireEvent.click(sw);
		expect(onChange).not.toHaveBeenCalled();
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { html } from 'htm/react';
import { PluginsLoadingScreen } from './PluginsLoadingScreen';

afterEach(cleanup);

describe('PluginsLoadingScreen', () => {
	it('names the plugin being started and calls onSkip when Skip is pressed', () => {
		const onSkip = vi.fn();
		render(html`<${PluginsLoadingScreen} name=${'foo'} index=${2} total=${3} onSkip=${onSkip}/>`);

		expect(screen.getByText('Starting plugins…')).toBeTruthy();
		expect(screen.getByText('Starting foo (2 of 3)…')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
		expect(onSkip).toHaveBeenCalledOnce();
	});
});

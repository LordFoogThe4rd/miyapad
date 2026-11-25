import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { html } from 'htm/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearPluginRuntimeError,
	clearPluginUiHooks,
	getPluginRuntimeErrors,
	pluginHooksFor,
} from '../plugins';
import { EditorToolbar } from './EditorToolbar';

function makeRecord(id: string, name: string, order = 0): PluginRecord {
	return {
		code: '',
		enabled: true,
		manifest: { id, name, version: '1.0.0', order, api: 1 },
	};
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	clearPluginUiHooks();
	clearPluginRuntimeError();
	vi.restoreAllMocks();
});

describe('EditorToolbar', () => {
	const baseProps = () => ({
		layout: 'rail' as const,
		sessionTitle: 'Chapter 1',
		editorMode: 'source' as const,
		onOpenPreferences: vi.fn(),
		onOpenSearch: vi.fn(),
		onToggleMarkdown: vi.fn(),
		onTakeScreenshot: vi.fn(),
	});

	it('renders the built-in group and wires built-in actions', () => {
		const props = baseProps();
		const { container } = render(html`<${EditorToolbar} ...${props}/>`);

		const groups = container.querySelectorAll('.editor-toolbar-group');
		expect(groups).toHaveLength(1);
		expect(groups[0].getAttribute('data-group')).toBe('builtin');

		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
		fireEvent.click(screen.getByRole('button', { name: 'Search & Replace' }));
		fireEvent.click(screen.getByRole('button', { name: 'Toggle Markdown Mode' }));
		fireEvent.click(screen.getByRole('button', { name: 'Take Screenshot' }));

		expect(props.onOpenPreferences).toHaveBeenCalledTimes(1);
		expect(props.onOpenSearch).toHaveBeenCalledTimes(1);
		expect(props.onToggleMarkdown).toHaveBeenCalledTimes(1);
		expect(props.onTakeScreenshot).toHaveBeenCalledTimes(1);
	});

	it('pools 1-button plugins into one group and gives 2+-button plugins separate groups sorted by order then id', () => {
		const singleLate = pluginHooksFor('zeta', makeRecord('zeta', 'Zeta', 10));
		const singleEarly = pluginHooksFor('alpha', makeRecord('alpha', 'Alpha', -1));
		const multiB = pluginHooksFor('beta-tools', makeRecord('beta-tools', 'Beta Tools', 2));
		const multiA = pluginHooksFor('alpha-tools', makeRecord('alpha-tools', 'Alpha Tools', 2));

		singleLate.toolbar.push({ title: 'Ping', icon: 'Z', onClick: vi.fn() });
		singleEarly.toolbar.push({ title: 'Spark', icon: 'A', onClick: vi.fn(), active: () => true });

		multiB.toolbar.push({ title: 'One', icon: '1', onClick: vi.fn() });
		multiB.toolbar.push({ title: 'Two', icon: '2', onClick: vi.fn(), disabled: () => true });

		multiA.toolbar.push({ title: 'First', icon: 'F', onClick: vi.fn() });
		multiA.toolbar.push({ title: 'Second', icon: 'S', onClick: vi.fn() });

		const { container } = render(html`<${EditorToolbar} ...${baseProps()}/>`);
		const groups = [...container.querySelectorAll('.editor-toolbar-group')];
		expect(groups.map(g => g.getAttribute('data-group'))).toEqual([
			'builtin',
			'plugins-pooled',
			'plugin-alpha-tools',
			'plugin-beta-tools',
		]);

		const pooledButtons = [...groups[1].querySelectorAll('button')];
		expect(pooledButtons.map(b => b.getAttribute('title'))).toEqual([
			'Alpha: Spark',
			'Zeta: Ping',
		]);
		expect(pooledButtons[0].classList.contains('is-active')).toBe(true);

		const alphaMultiButtons = [...groups[2].querySelectorAll('button')];
		expect(alphaMultiButtons.map(b => b.getAttribute('title'))).toEqual([
			'Alpha Tools: First',
			'Alpha Tools: Second',
		]);

		const betaMultiButtons = [...groups[3].querySelectorAll('button')];
		expect(betaMultiButtons.map(b => b.getAttribute('title'))).toEqual([
			'Beta Tools: One',
			'Beta Tools: Two',
		]);
		expect(betaMultiButtons[1].disabled).toBe(true);
	});

	it('isolates a throwing plugin toolbar button inside PluginErrorBoundary without breaking sibling buttons', () => {
		const broken = pluginHooksFor('broken', makeRecord('broken', 'Broken', 0));
		const healthy = pluginHooksFor('healthy', makeRecord('healthy', 'Healthy', 1));
		const onHealthy = vi.fn();

		const BadIcon = () => { throw new Error('boom icon'); };
		broken.toolbar.push({ title: 'Explode', icon: BadIcon, onClick: vi.fn() });
		healthy.toolbar.push({ title: 'Run', icon: 'OK', onClick: onHealthy });

		render(html`<${EditorToolbar} ...${baseProps()}/>`);

		expect(screen.getByRole('alert', { name: 'Plugin "broken" failed to render.' })).toBeTruthy();
		expect(getPluginRuntimeErrors().broken).toContain('boom icon');

		fireEvent.click(screen.getByRole('button', { name: 'Healthy: Run' }));
		expect(onHealthy).toHaveBeenCalledTimes(1);
	});

	it('renders the session title in top-bar layout', () => {
		render(html`<${EditorToolbar} ...${baseProps()} layout="top" sessionTitle="My Story"/>`);
		expect(screen.getByText('My Story')).toBeTruthy();
		expect(screen.getByRole('toolbar').getAttribute('aria-orientation')).toBe('horizontal');
	});
});

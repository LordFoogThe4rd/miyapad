import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import { html } from 'htm/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPluginRuntimeError, recordPluginRuntimeError } from '../../plugins';
import { legacyManifest } from '../../plugins/manifest';
import type { PluginStorage } from '../../storage/PluginStorage';
import { PluginsTab } from './PluginsTab';

const LEGACY_URL = 'https://example.com/date.js';
const ARCHIVE_URL = 'https://example.com/date.miyaplugin';

const textReply = (code: string) => vi.fn().mockResolvedValue(new Response(code, { headers: { 'content-type': 'text/plain' } }));
const zipReply = (files: Record<string, string>) => {
	const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
	return vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
};

function storageWith(records: Record<string, PluginRecord>) {
	const storage = {
		plugins: { ...records },
		pending: Promise.resolve(),
		resolveId: (id: string) => Object.keys(storage.plugins).find(k => k.toLowerCase() === id.toLowerCase()) ?? id,
		resolveName: (id: string) => Object.keys(storage.plugins).find(k => k.toLowerCase() === id.toLowerCase()) ?? id,
		importPlugin: vi.fn(async input => {
			storage.plugins = {
				...storage.plugins,
				[input.manifest.id]: {
					code: input.code,
					enabled: false,
					manifest: input.manifest,
					...(input.changelog !== undefined ? { changelog: input.changelog } : {}),
					...(input.url !== undefined ? { url: input.url } : {}),
					...(input.source !== undefined ? { source: input.source } : {}),
				},
			};
		}),
		updatePlugin: vi.fn(async (id: string, input) => {
			const cur = storage.plugins[id];
			storage.plugins = {
				...storage.plugins,
				[id]: {
					...cur,
					code: input.code,
					manifest: input.manifest,
					...(input.changelog !== undefined ? { changelog: input.changelog } : {}),
				},
			};
		}),
		setEnabled: vi.fn(async (id: string, enabled: boolean, allowedVersion?: string) => {
			storage.plugins = {
				...storage.plugins,
				[id]: { ...storage.plugins[id], enabled, ...(allowedVersion ? { allowedVersion } : {}) },
			};
		}),
		remove: vi.fn(async (id: string) => {
			const { [id]: _, ...rest } = storage.plugins;
			storage.plugins = rest;
		}),
	};
	return storage as unknown as PluginStorage & typeof storage;
}

const renderTab = (pluginStorage: PluginStorage, isMiyapadEndpoint = false) =>
	render(html`<${PluginsTab} pluginStorage=${pluginStorage}
		pluginStart=${{ safeMode: false, switchedOff: [], errors: {}, timedOut: [], skipped: [] }}
		showStartupNotice=${false} isMiyapadEndpoint=${isMiyapadEndpoint} handleExportDB=${vi.fn()}/>`);

beforeEach(() => {
	vi.stubGlobal('alert', vi.fn());
	vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
	cleanup();
	clearPluginRuntimeError();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('PluginsTab', () => {
	it('marks legacy .js plugins with "no manifest" and updates them without gaining a manifest', async () => {
		const storage = storageWith({
			date: { code: 'old', enabled: true, url: LEGACY_URL, manifest: legacyManifest('date') },
		});
		vi.stubGlobal('fetch', textReply('// @miyapad-min 2.0.0\nnew'));
		renderTab(storage);

		expect(screen.getByText('no manifest')).toBeTruthy();
		expect(screen.getByText(`From ${LEGACY_URL}`)).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Update date' }));

		await waitFor(() => expect(storage.updatePlugin).toHaveBeenCalledWith('date', {
			code: '// @miyapad-min 2.0.0\nnew',
			manifest: legacyManifest('date', { min: '2.0.0' }),
		}));
		expect(confirm).toHaveBeenCalledWith(expect.stringContaining(LEGACY_URL));
		expect(alert).not.toHaveBeenCalled();
	});

	it('imports a .miyaplugin file and rejects unbundled static imports with the bundle hint', async () => {
		const storage = storageWith({});
		renderTab(storage);

		const createdInputs: HTMLInputElement[] = [];
		const origCreate = document.createElement.bind(document);
		vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = origCreate(tag);
			if (tag === 'input') {
				vi.spyOn(el as HTMLInputElement, 'click').mockImplementation(() => {});
				createdInputs.push(el as HTMLInputElement);
			}
			return el;
		});

		fireEvent.click(screen.getByRole('button', { name: 'Import file…' }));
		const archiveBytes = zipSync({
			'manifest.json': strToU8(JSON.stringify({ id: 'date', name: 'Date Helper', version: '1.0.0', minMiyapad: '2.0.0' })),
			'main.js': strToU8('const ok = 1;'),
			'CHANGELOG.md': strToU8('## [1.0.0]\n- Initial release'),
		});
		const archiveFile = new File([archiveBytes], 'date.miyaplugin', { type: 'application/octet-stream' });
		Object.defineProperty(createdInputs[0], 'files', { value: [archiveFile] });
		await act(async () => { await createdInputs[0].onchange?.(new Event('change')); });

		expect(storage.importPlugin).toHaveBeenCalledWith(expect.objectContaining({
			code: 'const ok = 1;',
			changelog: '## [1.0.0]\n- Initial release',
			manifest: expect.objectContaining({ id: 'date', name: 'Date Helper', version: '1.0.0' }),
		}));
		expect(screen.getByText('Date Helper')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Import file…' }));
		const unbundledBytes = zipSync({
			'manifest.json': strToU8(JSON.stringify({ id: 'bad', name: 'Bad', version: '1.0.0' })),
			'main.js': strToU8('import { x } from "./x.js";'),
		});
		const unbundledFile = new File([unbundledBytes], 'bad.miyaplugin');
		Object.defineProperty(createdInputs[1], 'files', { value: [unbundledFile] });
		await act(async () => { await createdInputs[1].onchange?.(new Event('change')); });

		expect(alert).toHaveBeenCalledWith(expect.stringMatching(/bundle the plugin into main\.js/i));
	});

	it('shows version changes, same-version code changes, and changelog notes in the update confirm', async () => {
		const storage = storageWith({
			date: {
				code: 'v1',
				enabled: true,
				url: ARCHIVE_URL,
				manifest: { id: 'date', name: 'Date Helper', version: '1.3.0', order: 0, api: 1, minMiyapad: '2.0.0' },
			},
		});
		vi.stubGlobal('fetch', zipReply({
			'manifest.json': JSON.stringify({ id: 'date', name: 'Date Helper', version: '1.4.0', minMiyapad: '2.0.0' }),
			'main.js': 'v2',
			'CHANGELOG.md': '## [1.4.0]\n- Added ISO format\n\n## [1.3.0]\n- Older note',
		}));
		renderTab(storage);

		fireEvent.click(screen.getByRole('button', { name: 'Update Date Helper' }));
		await waitFor(() => expect(storage.updatePlugin).toHaveBeenCalledTimes(1));
		expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('1.3.0 → 1.4.0'));
		expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('- Added ISO format'));

		// Same version 1.4.0, modified main.js, no matching changelog section
		vi.stubGlobal('fetch', zipReply({
			'manifest.json': JSON.stringify({ id: 'date', name: 'Date Helper', version: '1.4.0', minMiyapad: '2.0.0' }),
			'main.js': 'v2-hotfix',
		}));
		fireEvent.click(screen.getByRole('button', { name: 'Update Date Helper' }));
		await waitFor(() => expect(storage.updatePlugin).toHaveBeenCalledTimes(2));
		expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('changed, version still 1.4.0'));
		expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('No notes for this version.'));
	});

	it('refuses an archive update whose manifest id differs from the installed plugin', async () => {
		const storage = storageWith({
			date: {
				code: 'v1',
				enabled: true,
				url: ARCHIVE_URL,
				manifest: { id: 'date', name: 'Date Helper', version: '1.0.0', order: 0, api: 1, minMiyapad: '2.0.0' },
			},
		});
		vi.stubGlobal('fetch', zipReply({
			'manifest.json': JSON.stringify({ id: 'other', name: 'Other Plugin', version: '1.0.0', minMiyapad: '2.0.0' }),
			'main.js': 'v2',
		}));
		renderTab(storage);

		fireEvent.click(screen.getByRole('button', { name: 'Update Date Helper' }));
		await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('This archive is for a different plugin.'));
		expect(storage.updatePlugin).not.toHaveBeenCalled();
	});

	it('shows the requires server marker and refuses switching on in standalone mode', () => {
		const storage = storageWith({
			sql: {
				code: 'const x = 1;',
				enabled: false,
				manifest: { id: 'sql', name: 'SQL Notes', version: '1.0.0', order: 0, api: 1, minMiyapad: '2.0.0', requires: ['server'] },
			},
		});
		renderTab(storage, false);

		expect(screen.getByText('requires server')).toBeTruthy();
		expect(screen.getByLabelText('Requires the Miyapad server')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Run SQL Notes' }));
		expect(alert).toHaveBeenCalledWith(expect.stringContaining('requires the Miyapad server'));
		expect(storage.setEnabled).not.toHaveBeenCalled();
	});

	it('displays runtime hook errors attributed to the plugin row', async () => {
		const storage = storageWith({
			date: {
				code: 'const x = 1;',
				enabled: true,
				manifest: { id: 'date', name: 'Date Helper', version: '1.0.0', order: 0, api: 1, minMiyapad: '2.0.0' },
			},
		});
		renderTab(storage);

		act(() => { recordPluginRuntimeError('date', 'Error: timed out after 10s'); });
		expect(screen.getByText('Hook error: Error: timed out after 10s')).toBeTruthy();
	});

	it('does not fetch anything for a plugin that was imported from a file', () => {
		vi.stubGlobal('fetch', vi.fn());
		renderTab(storageWith({ date: { code: 'old', enabled: true, manifest: legacyManifest('date') } }));

		expect(screen.queryByRole('button', { name: 'Update date' })).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});
});

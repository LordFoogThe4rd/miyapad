import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import { html } from 'htm/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPluginRuntimeError, clearPluginUiHooks, pluginHooksFor, recordPluginRuntimeError } from '../../plugins';
import type { PluginStorage } from '../../storage/PluginStorage';
import { PluginsTab } from './PluginsTab';

const ARCHIVE_URL = 'https://example.com/date.miyaplugin';

const makeZipBytes = (files: Record<string, string>) =>
	zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

const zipReply = (files: Record<string, string>) => {
	const bytes = makeZipBytes(files);
	return vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
};

function storageWith(records: Record<string, PluginRecord>) {
	const storage = {
		plugins: { ...records },
		pending: Promise.resolve(),
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
	clearPluginUiHooks();
	clearPluginRuntimeError();
	localStorage.clear();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('PluginsTab', () => {
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

		fireEvent.click(screen.getByRole('switch', { name: 'Run SQL Notes' }));
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
		renderTab(storageWith({
			date: {
				code: 'old',
				enabled: true,
				manifest: { id: 'date', name: 'Date Helper', version: '1.0.0', order: 0, api: 1 },
			},
		}));

		expect(screen.queryByRole('button', { name: 'Update Date Helper' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Check updates' })).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('checks URL plugins four at a time on open, shows all row update states, and re-checks on demand', async () => {
		const storage = storageWith({
			p1: { code: 'same', enabled: true, url: 'https://example.com/p1.miyaplugin', manifest: { id: 'p1', name: 'One', version: '1.0.0', order: 1, api: 1 } },
			p2: { code: 'v1', enabled: true, url: 'https://example.com/p2.miyaplugin', manifest: { id: 'p2', name: 'Two', version: '1.3.0', order: 2, api: 1 } },
			p3: { code: 'v1', enabled: true, url: 'https://example.com/p3.miyaplugin', manifest: { id: 'p3', name: 'Three', version: '1.3.0', order: 3, api: 1 } },
			p4: { code: 'v1', enabled: true, url: 'https://example.com/p4.miyaplugin', manifest: { id: 'p4', name: 'Four', version: '1.0.0', order: 4, api: 1 } },
			p5: { code: 'same', enabled: true, url: 'https://example.com/p5.miyaplugin', manifest: { id: 'p5', name: 'Five', version: '2.0.0', order: 5, api: 1 } },
		});

		let active = 0;
		let peak = 0;
		const gates: Array<() => void> = [];
		const fetchMock = vi.fn((url: string) => new Promise<Response>((resolve, reject) => {
			active += 1;
			peak = Math.max(peak, active);
			gates.push(() => {
				active -= 1;
				if (url.endsWith('/p1.miyaplugin')) {
					resolve(new Response(makeZipBytes({
						'manifest.json': JSON.stringify({ id: 'p1', name: 'One', version: '1.0.0' }),
						'main.js': 'same',
					})));
				} else if (url.endsWith('/p2.miyaplugin')) {
					resolve(new Response(makeZipBytes({
						'manifest.json': JSON.stringify({ id: 'p2', name: 'Two', version: '1.4.0' }),
						'main.js': 'v2',
					})));
				} else if (url.endsWith('/p3.miyaplugin')) {
					resolve(new Response(makeZipBytes({
						'manifest.json': JSON.stringify({ id: 'p3', name: 'Three', version: '1.3.0' }),
						'main.js': 'v1-patched',
					})));
				} else if (url.endsWith('/p4.miyaplugin')) {
					reject(new Error('network down'));
				} else {
					resolve(new Response(makeZipBytes({
						'manifest.json': JSON.stringify({ id: 'p5', name: 'Five', version: '2.0.0' }),
						'main.js': 'same',
					})));
				}
			});
		}));
		vi.stubGlobal('fetch', fetchMock);

		renderTab(storage);

		expect(screen.getAllByText('Checking…')).toHaveLength(5);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(peak).toBe(4);

		// Releasing one slot starts the 5th request while keeping peak concurrency at 4
		gates.shift()!();
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
		expect(peak).toBe(4);

		while (gates.length > 0) gates.shift()!();

		await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull());
		expect(peak).toBe(4);
		expect(screen.getAllByText('Up to date')).toHaveLength(2);
		expect(screen.getByText('Update available (1.3.0 → 1.4.0)')).toBeTruthy();
		expect(screen.getByText('Update available (changed, version still 1.3.0)')).toBeTruthy();
		expect(screen.getByText("Couldn't check")).toBeTruthy();

		// Re-run batch check via the "Check updates" button
		fireEvent.click(screen.getByRole('button', { name: 'Check updates' }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(9));
		gates.shift()!();
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(10));
		while (gates.length > 0) gates.shift()!();
		await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull());
	});

	it('imports from a GitHub repo address, stores the latest-release asset URL, and shows the pinned source label', async () => {
		const storage = storageWith({});
		vi.stubGlobal('prompt', vi.fn(() => 'https://github.com/o/r'));
		vi.stubGlobal('fetch', vi.fn(async (url: string) => {
			if (url === 'https://api.github.com/repos/o/r/releases/latest') {
				return new Response(JSON.stringify({
					tag_name: 'v1.0.0',
					assets: [{ name: 'example.miyaplugin', browser_download_url: 'https://github.com/o/r/releases/download/v1.0.0/example.miyaplugin' }],
				}));
			}
			if (url === '/proxy-url?url=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Freleases%2Flatest%2Fdownload%2Fexample.miyaplugin') {
				return new Response(makeZipBytes({
					'manifest.json': JSON.stringify({ id: 'example', name: 'Example Plugin', version: '1.0.0', minMiyapad: '2.0.0' }),
					'main.js': 'const ok = true;',
				}), { headers: { 'content-type': 'application/octet-stream' } });
			}
			if (url === '/version') {
				return new Response(JSON.stringify({ backup: { enabled: false, intervalMinutes: null, lastBackupAt: null } }));
			}
			throw new Error(`Unexpected fetch: ${url}`);
		}));

		renderTab(storage, true);
		fireEvent.click(screen.getByRole('button', { name: 'Import from URL…' }));

		await waitFor(() => expect(storage.importPlugin).toHaveBeenCalledWith(expect.objectContaining({
			url: 'https://github.com/o/r/releases/latest/download/example.miyaplugin',
			source: 'https://github.com/o/r',
		})));
		expect(screen.getByText('From o/r (latest release)')).toBeTruthy();
		expect(screen.getByText('Up to date')).toBeTruthy();
	});

	it('sends the saved GitHub Personal Access Token to api.github.com when importing a GitHub release', async () => {
		const storage = storageWith({});
		vi.stubGlobal('prompt', vi.fn(() => 'https://github.com/o/r'));
		const fetchMock = vi.fn(async (url: string) => {
			if (url === 'https://api.github.com/repos/o/r/releases/latest') {
				return new Response('', { status: 401, statusText: 'Unauthorized' });
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		renderTab(storage, false);
		const tokenInput = screen.getByLabelText(/GitHub Personal Access Token/);
		fireEvent.change(tokenInput, { target: { value: 'ghp_testtoken' } });
		expect(JSON.parse(localStorage.getItem('githubToken')!)).toBe('ghp_testtoken');

		fireEvent.click(screen.getByRole('button', { name: 'Import from URL…' }));
		await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringMatching(/Personal Access Token/i)));
		expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/o/r/releases/latest', {
			headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ghp_testtoken' },
		});
	});

	it('renders Configure button in inline and modal modes and isolates settings render errors', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const inlineRecord: PluginRecord = {
			code: '',
			enabled: true,
			manifest: { id: 'inline-p', name: 'Inline Plugin', version: '1.0.0', order: 0, api: 1, minMiyapad: '2.0.0' },
		};
		const modalRecord: PluginRecord = {
			code: '',
			enabled: true,
			manifest: { id: 'modal-p', name: 'Modal Plugin', version: '1.0.0', order: 1, api: 1, minMiyapad: '2.0.0' },
		};
		const disabledRecord: PluginRecord = {
			code: '',
			enabled: false,
			manifest: { id: 'off-p', name: 'Off Plugin', version: '1.0.0', order: 2, api: 1, minMiyapad: '2.0.0' },
		};
		const brokenRecord: PluginRecord = {
			code: '',
			enabled: true,
			manifest: { id: 'broken-p', name: 'Broken Plugin', version: '1.0.0', order: 3, api: 1, minMiyapad: '2.0.0' },
		};

		pluginHooksFor('inline-p', inlineRecord).settings({
			Component: () => html`<div>Inline settings body</div>`,
		});
		pluginHooksFor('modal-p', modalRecord).settings({
			mode: 'modal',
			Component: () => html`<div>Modal settings body</div>`,
		});
		pluginHooksFor('off-p', disabledRecord).settings({
			Component: () => html`<div>Should not appear</div>`,
		});
		pluginHooksFor('broken-p', brokenRecord).settings({
			Component: () => { throw new Error('settings crash'); },
		});

		const storage = storageWith({
			'inline-p': inlineRecord,
			'modal-p': modalRecord,
			'off-p': disabledRecord,
			'broken-p': brokenRecord,
		});
		renderTab(storage);

		expect(screen.queryByRole('button', { name: 'Configure Off Plugin' })).toBeNull();

		// Inline drawer toggles open and closed
		const inlineBtn = screen.getByRole('button', { name: 'Configure Inline Plugin' });
		expect(screen.queryByText('Inline settings body')).toBeNull();
		fireEvent.click(inlineBtn);
		expect(screen.getByText('Inline settings body')).toBeTruthy();
		fireEvent.click(inlineBtn);
		expect(screen.queryByText('Inline settings body')).toBeNull();

		// Modal mode opens stacked Modal titled with manifest.name
		fireEvent.click(screen.getByRole('button', { name: 'Configure Modal Plugin' }));
		expect(screen.getByRole('dialog', { name: 'Modal Plugin' })).toBeTruthy();
		expect(screen.getByText('Modal settings body')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		// Broken settings component is isolated by PluginErrorBoundary
		fireEvent.click(screen.getByRole('button', { name: 'Configure Broken Plugin' }));
		expect(screen.getByText('Plugin "broken-p" failed to render.')).toBeTruthy();
	});
});

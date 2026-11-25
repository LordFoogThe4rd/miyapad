import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	describePluginSource,
	parsePluginSource,
	PluginSourceError,
	resolvePluginSource,
	selectReleaseAsset,
} from './sources';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('parsePluginSource & resolvePluginSource', () => {
	it('resolves all six address forms into concrete archive URLs', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url === 'https://api.github.com/repos/o/r/releases/latest') {
				return new Response(
					JSON.stringify({
						tag_name: 'v1.4.0',
						assets: [
							{ name: 'checksums.txt', browser_download_url: 'https://github.com/o/r/releases/download/v1.4.0/checksums.txt' },
							// browser_download_url pins v1.4.0; latest mode must NOT store it.
							{ name: 'example.miyaplugin', browser_download_url: 'https://github.com/o/r/releases/download/v1.4.0/example.miyaplugin' },
						],
					}),
					{ headers: { 'content-type': 'application/json' } },
				);
			}
			if (url === 'https://api.github.com/repos/o/r/releases/tags/v1.2.3') {
				return new Response(
					JSON.stringify({
						tag_name: 'v1.2.3',
						assets: [{ name: 'example.miyaplugin' }],
					}),
					{ headers: { 'content-type': 'application/json' } },
				);
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		// 1. GitHub repo -> latest release
		await expect(resolvePluginSource('https://github.com/o/r')).resolves.toEqual({
			mode: 'github-latest',
			source: 'https://github.com/o/r',
			url: 'https://github.com/o/r/releases/latest/download/example.miyaplugin',
		});

		// 2. GitHub release tag -> pinned release
		await expect(resolvePluginSource('https://github.com/o/r/releases/tag/v1.2.3')).resolves.toEqual({
			mode: 'github-tag',
			source: 'https://github.com/o/r/releases/tag/v1.2.3',
			url: 'https://github.com/o/r/releases/download/v1.2.3/example.miyaplugin',
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);

		// 3. GitHub branch file -> raw.githubusercontent.com (no API call)
		await expect(resolvePluginSource('https://github.com/o/r/tree/main/dist/x.miyaplugin')).resolves.toEqual({
			mode: 'github-branch',
			source: 'https://github.com/o/r/tree/main/dist/x.miyaplugin',
			url: 'https://raw.githubusercontent.com/o/r/main/dist/x.miyaplugin',
		});

		// 4. GitHub commit file -> raw.githubusercontent.com (no API call)
		const sha = '0123456789abcdef0123456789abcdef01234567';
		await expect(resolvePluginSource(`https://github.com/o/r/blob/${sha}/dist/x.miyaplugin`)).resolves.toEqual({
			mode: 'github-commit',
			source: `https://github.com/o/r/blob/${sha}/dist/x.miyaplugin`,
			url: `https://raw.githubusercontent.com/o/r/${sha}/dist/x.miyaplugin`,
		});

		// 5. Direct .miyaplugin (no API call)
		await expect(resolvePluginSource('https://example.com/plugins/x.miyaplugin')).resolves.toEqual({
			mode: 'direct',
			source: 'https://example.com/plugins/x.miyaplugin',
			url: 'https://example.com/plugins/x.miyaplugin',
		});

		// 6. Direct .zip (no API call)
		await expect(resolvePluginSource('https://example.com/plugins/x.zip')).resolves.toEqual({
			mode: 'direct',
			source: 'https://example.com/plugins/x.zip',
			url: 'https://example.com/plugins/x.zip',
		});

		// Direct GitHub release asset URL also needs no API call (used when rate-limited)
		await expect(resolvePluginSource('https://github.com/o/r/releases/latest/download/x.miyaplugin')).resolves.toEqual({
			mode: 'direct',
			source: 'https://github.com/o/r/releases/latest/download/x.miyaplugin',
			url: 'https://github.com/o/r/releases/latest/download/x.miyaplugin',
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('prefers .miyaplugin assets, falls back to .zip, and rejects releases with neither', async () => {
		expect(selectReleaseAsset([{ name: 'readme.md' }, { name: 'a.zip' }, { name: 'b.miyaplugin' }])).toBe('b.miyaplugin');
		expect(selectReleaseAsset([{ name: 'readme.md' }, { name: 'fallback.zip' }])).toBe('fallback.zip');
		expect(() => selectReleaseAsset([{ name: 'notes.txt' }])).toThrowError(
			expect.objectContaining({ name: 'PluginSourceError', kind: 'no-release-asset' }),
		);

		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ assets: [] }))));
		await expect(resolvePluginSource('https://github.com/o/r')).rejects.toMatchObject({
			name: 'PluginSourceError',
			kind: 'no-release-asset',
		});
	});

	it('reports GitHub API 401 auth errors, 403 rate limits, and 404 missing releases distinctly', async () => {
		const authFetch = vi.fn(async () => new Response(JSON.stringify({ assets: [{ name: 'example.miyaplugin' }] })));
		vi.stubGlobal('fetch', authFetch);
		await resolvePluginSource('https://github.com/o/r', { token: '  ghp_secret123  ' });
		expect(authFetch).toHaveBeenCalledWith('https://api.github.com/repos/o/r/releases/latest', {
			headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ghp_secret123' },
		});

		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401, statusText: 'Unauthorized' })));
		await expect(resolvePluginSource('https://github.com/o/r', { token: 'bad' })).rejects.toMatchObject({
			name: 'PluginSourceError',
			kind: 'github-auth-failed',
		});

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(
				JSON.stringify({ message: 'API rate limit exceeded for 1.2.3.4.' }),
				{ status: 403, headers: { 'x-ratelimit-remaining': '0' } },
			)),
		);
		await expect(resolvePluginSource('https://github.com/o/r')).rejects.toMatchObject({
			name: 'PluginSourceError',
			kind: 'github-rate-limit',
		});

		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' })));
		await expect(resolvePluginSource('https://github.com/o/r/releases/tag/v9.9.9')).rejects.toMatchObject({
			name: 'PluginSourceError',
			kind: 'release-not-found',
		});
	});

	it('rejects commit/<sha> without a path, missing repo paths, and non-http addresses', () => {
		expect(() => parsePluginSource('https://github.com/o/r/commit/0123456789abcdef')).toThrowError(
			expect.objectContaining({
				name: 'PluginSourceError',
				kind: 'commit-without-path',
				message: expect.stringContaining('blob/<sha>/<path>'),
			}),
		);
		expect(() => parsePluginSource('https://github.com/o/r/blob/0123456789abcdef')).toThrowError(
			expect.objectContaining({ kind: 'commit-without-path' }),
		);
		expect(() => parsePluginSource('https://github.com/o/r/tree/main')).toThrowError(
			expect.objectContaining({ kind: 'missing-repo-path' }),
		);
		expect(() => parsePluginSource('https://github.com/only-owner')).toThrowError(
			expect.objectContaining({ kind: 'invalid-github-url' }),
		);
		expect(() => parsePluginSource('ftp://example.com/x.miyaplugin')).toThrow(PluginSourceError);
	});
});

describe('describePluginSource', () => {
	it('describes what each source or resolved URL is pinned to', () => {
		expect(describePluginSource('https://github.com/o/r')).toEqual({
			mode: 'github-latest',
			repo: 'o/r',
			label: 'o/r (latest release)',
		});
		expect(describePluginSource('https://github.com/o/r/releases/latest/download/x.miyaplugin')).toEqual({
			mode: 'github-latest',
			repo: 'o/r',
			label: 'o/r (latest release)',
		});
		expect(describePluginSource('https://github.com/o/r/releases/tag/v1.2.3')).toEqual({
			mode: 'github-tag',
			repo: 'o/r',
			tag: 'v1.2.3',
			label: 'o/r (release v1.2.3)',
		});
		expect(describePluginSource('https://github.com/o/r/tree/main/dist/x.miyaplugin')).toEqual({
			mode: 'github-branch',
			repo: 'o/r',
			branch: 'main',
			path: 'dist/x.miyaplugin',
			label: 'o/r (branch main)',
		});
		expect(describePluginSource('https://github.com/o/r/blob/a1b2c3d4e5f6/dist/x.miyaplugin')).toEqual({
			mode: 'github-commit',
			repo: 'o/r',
			sha: 'a1b2c3d4e5f6',
			shortSha: 'a1b2c3d',
			path: 'dist/x.miyaplugin',
			label: 'o/r (commit a1b2c3d)',
		});
		expect(describePluginSource('https://example.com/x.miyaplugin')).toEqual({
			mode: 'direct',
			url: 'https://example.com/x.miyaplugin',
			label: 'https://example.com/x.miyaplugin',
		});
	});
});

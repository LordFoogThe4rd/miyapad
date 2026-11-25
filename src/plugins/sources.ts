import { isHttpUrl } from './manifest';

const COMMIT_SHA_REGEX = /^[0-9a-f]{7,64}$/i;

export type PluginSourceErrorKind =
	| 'bad-url'
	| 'invalid-github-url'
	| 'commit-without-path'
	| 'missing-repo-path'
	| 'github-auth-failed'
	| 'github-rate-limit'
	| 'release-not-found'
	| 'no-release-asset'
	| 'github-api-error';

export class PluginSourceError extends Error {
	readonly kind: PluginSourceErrorKind;

	constructor(kind: PluginSourceErrorKind, message: string) {
		super(message);
		this.name = 'PluginSourceError';
		this.kind = kind;
	}
}

export type ParsedPluginSource =
	| { mode: 'github-latest'; source: string; owner: string; repo: string }
	| { mode: 'github-tag'; source: string; owner: string; repo: string; tag: string }
	| { mode: 'github-branch'; source: string; owner: string; repo: string; branch: string; path: string; url: string }
	| { mode: 'github-commit'; source: string; owner: string; repo: string; sha: string; path: string; url: string }
	| { mode: 'direct'; source: string; url: string };

export interface ResolvedPluginSource {
	mode: ParsedPluginSource['mode'];
	/** Address pasted by the user, saved on `PluginRecord.source` for display. */
	source: string;
	/** Concrete archive address saved on `PluginRecord.url` for fetching and future update checks. */
	url: string;
}

export type PluginSourceDescription =
	| { mode: 'github-latest'; repo: string; label: string }
	| { mode: 'github-tag'; repo: string; tag: string; label: string }
	| { mode: 'github-branch'; repo: string; branch: string; path: string; label: string }
	| { mode: 'github-commit'; repo: string; sha: string; shortSha: string; path: string; label: string }
	| { mode: 'direct'; url: string; label: string };

function stripGitSuffix(repo: string): string {
	return repo.endsWith('.git') && repo.length > 4 ? repo.slice(0, -4) : repo;
}

/**
 * Classifies an import address into one of the supported source modes without making network calls.
 */
export function parsePluginSource(rawInput: string): ParsedPluginSource {
	const source = rawInput.trim();
	if (!isHttpUrl(source)) {
		throw new PluginSourceError('bad-url', 'Address must start with http:// or https://');
	}

	const parsed = new URL(source);
	if (parsed.hostname.toLowerCase() !== 'github.com') {
		return { mode: 'direct', source, url: source };
	}

	const parts = parsed.pathname.split('/').filter(Boolean);
	if (parts.length < 2) {
		throw new PluginSourceError('invalid-github-url', 'GitHub address must include owner and repository');
	}

	const owner = decodeURIComponent(parts[0]);
	const repo = stripGitSuffix(decodeURIComponent(parts[1]));
	if (parts.length === 2) {
		return { mode: 'github-latest', source, owner, repo };
	}

	const section = parts[2];
	if (section === 'releases') {
		if (parts.length === 3 || (parts.length === 4 && parts[3] === 'latest')) {
			return { mode: 'github-latest', source, owner, repo };
		}
		if (parts[3] === 'tag') {
			if (parts.length < 5) {
				throw new PluginSourceError('invalid-github-url', 'GitHub release tag address is missing a tag');
			}
			const tag = parts.slice(4).map(decodeURIComponent).join('/');
			return { mode: 'github-tag', source, owner, repo, tag };
		}
		if (
			(parts[3] === 'download' && parts.length >= 6) ||
			(parts[3] === 'latest' && parts[4] === 'download' && parts.length >= 6)
		) {
			return { mode: 'direct', source, url: source };
		}
		throw new PluginSourceError('invalid-github-url', 'Unsupported GitHub releases address');
	}

	if (section === 'commit' || section === 'commits') {
		throw new PluginSourceError(
			'commit-without-path',
			'Commit addresses need a file path in the repository; use blob/<sha>/<path>',
		);
	}

	if (section === 'tree' || section === 'blob') {
		if (parts.length < 5) {
			if (parts.length === 4 && COMMIT_SHA_REGEX.test(decodeURIComponent(parts[3]))) {
				throw new PluginSourceError(
					'commit-without-path',
					'Commit addresses need a file path in the repository; use blob/<sha>/<path>',
				);
			}
			throw new PluginSourceError(
				'missing-repo-path',
				'GitHub branch or file address needs a path to the .miyaplugin archive',
			);
		}
		const ref = decodeURIComponent(parts[3]);
		const path = parts.slice(4).map(decodeURIComponent).join('/');
		const encodedRest = parts.slice(3).map(seg => encodeURIComponent(decodeURIComponent(seg))).join('/');
		const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodedRest}`;
		if (COMMIT_SHA_REGEX.test(ref)) {
			return { mode: 'github-commit', source, owner, repo, sha: ref, path, url };
		}
		return { mode: 'github-branch', source, owner, repo, branch: ref, path, url };
	}

	if (section === 'raw' && parts.length >= 5) {
		return { mode: 'direct', source, url: source };
	}

	throw new PluginSourceError('invalid-github-url', 'Unsupported GitHub address');
}

/** Picks the first `.miyaplugin` asset from a GitHub release's `assets` list, falling back to `.zip`. */
export function selectReleaseAsset(assets: unknown): string {
	if (!Array.isArray(assets)) {
		throw new PluginSourceError('no-release-asset', 'Release has no .miyaplugin or .zip asset');
	}
	const names = assets
		.map(item => (item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined))
		.filter((name): name is string => typeof name === 'string' && name.length > 0);

	const miyaAsset = names.find(name => name.toLowerCase().endsWith('.miyaplugin'));
	if (miyaAsset) return miyaAsset;

	const zipAsset = names.find(name => name.toLowerCase().endsWith('.zip'));
	if (zipAsset) return zipAsset;

	throw new PluginSourceError('no-release-asset', 'Release has no .miyaplugin or .zip asset');
}

export interface ResolvePluginSourceOptions {
	/** Optional GitHub Personal Access Token sent only to `api.github.com` release endpoints. */
	token?: string;
}

/**
 * Resolves any supported plugin address into a concrete download URL.
 * Latest-release and tag addresses make one GitHub API call to find the asset name;
 * latest-release stores `/releases/latest/download/<asset>` rather than `browser_download_url`
 * so later update checks follow new releases with no API call.
 */
export async function resolvePluginSource(
	rawInput: string,
	options?: ResolvePluginSourceOptions,
): Promise<ResolvedPluginSource> {
	const spec = parsePluginSource(rawInput);
	if (spec.mode === 'direct' || spec.mode === 'github-branch' || spec.mode === 'github-commit') {
		return { mode: spec.mode, source: spec.source, url: spec.url };
	}

	const encodedOwner = encodeURIComponent(spec.owner);
	const encodedRepo = encodeURIComponent(spec.repo);
	const apiUrl = spec.mode === 'github-latest'
		? `https://api.github.com/repos/${encodedOwner}/${encodedRepo}/releases/latest`
		: `https://api.github.com/repos/${encodedOwner}/${encodedRepo}/releases/tags/${spec.tag.split('/').map(encodeURIComponent).join('/')}`;

	const token = options?.token?.trim();
	const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
	if (token) headers.Authorization = `Bearer ${token}`;

	const res = await fetch(apiUrl, { headers });
	if (!res.ok) {
		if (res.status === 401) {
			throw new PluginSourceError('github-auth-failed', 'GitHub rejected the Personal Access Token');
		}
		if (res.status === 404) {
			throw new PluginSourceError('release-not-found', 'GitHub repository or release not found');
		}
		if (res.status === 403 || res.status === 429) {
			const remaining = res.headers.get('x-ratelimit-remaining');
			const body = await res.text().catch(() => '');
			if (res.status === 429 || remaining === '0' || /rate limit/i.test(body) || body.trim() === '') {
				throw new PluginSourceError(
					'github-rate-limit',
					'GitHub API rate limit exhausted; paste the direct archive address instead',
				);
			}
		}
		throw new PluginSourceError('github-api-error', `${res.status} ${res.statusText}`.trim());
	}

	const data = (await res.json()) as { assets?: unknown };
	const asset = encodeURIComponent(selectReleaseAsset(data?.assets));

	if (spec.mode === 'github-latest') {
		return {
			mode: 'github-latest',
			source: spec.source,
			url: `https://github.com/${encodedOwner}/${encodedRepo}/releases/latest/download/${asset}`,
		};
	}

	const encodedTag = spec.tag.split('/').map(encodeURIComponent).join('/');
	return {
		mode: 'github-tag',
		source: spec.source,
		url: `https://github.com/${encodedOwner}/${encodedRepo}/releases/download/${encodedTag}/${asset}`,
	};
}

/**
 * Extracts human-readable pin information from a saved `source` or `url` address for display on a plugin row.
 */
export function describePluginSource(sourceOrUrl: string): PluginSourceDescription {
	const trimmed = sourceOrUrl.trim();
	try {
		const parsed = new URL(trimmed);
		const host = parsed.hostname.toLowerCase();
		const parts = parsed.pathname.split('/').filter(Boolean);

		if (host === 'github.com' && parts.length >= 6 && parts[2] === 'releases') {
			const repo = `${decodeURIComponent(parts[0])}/${stripGitSuffix(decodeURIComponent(parts[1]))}`;
			if (parts[3] === 'latest' && parts[4] === 'download') {
				return { mode: 'github-latest', repo, label: `${repo} (latest release)` };
			}
			if (parts[3] === 'download') {
				const tag = parts.slice(4, -1).map(decodeURIComponent).join('/');
				return { mode: 'github-tag', repo, tag, label: `${repo} (release ${tag})` };
			}
		}

		if (host === 'raw.githubusercontent.com' && parts.length >= 4) {
			const repo = `${decodeURIComponent(parts[0])}/${stripGitSuffix(decodeURIComponent(parts[1]))}`;
			const ref = decodeURIComponent(parts[2]);
			const path = parts.slice(3).map(decodeURIComponent).join('/');
			if (COMMIT_SHA_REGEX.test(ref)) {
				const shortSha = ref.slice(0, 7);
				return { mode: 'github-commit', repo, sha: ref, shortSha, path, label: `${repo} (commit ${shortSha})` };
			}
			return { mode: 'github-branch', repo, branch: ref, path, label: `${repo} (branch ${ref})` };
		}

		const spec = parsePluginSource(trimmed);
		switch (spec.mode) {
			case 'github-latest': {
				const repo = `${spec.owner}/${spec.repo}`;
				return { mode: 'github-latest', repo, label: `${repo} (latest release)` };
			}
			case 'github-tag': {
				const repo = `${spec.owner}/${spec.repo}`;
				return { mode: 'github-tag', repo, tag: spec.tag, label: `${repo} (release ${spec.tag})` };
			}
			case 'github-branch': {
				const repo = `${spec.owner}/${spec.repo}`;
				return { mode: 'github-branch', repo, branch: spec.branch, path: spec.path, label: `${repo} (branch ${spec.branch})` };
			}
			case 'github-commit': {
				const repo = `${spec.owner}/${spec.repo}`;
				const shortSha = spec.sha.slice(0, 7);
				return { mode: 'github-commit', repo, sha: spec.sha, shortSha, path: spec.path, label: `${repo} (commit ${shortSha})` };
			}
			case 'direct':
				return { mode: 'direct', url: spec.url, label: spec.url };
		}
	} catch {
		return { mode: 'direct', url: trimmed, label: trimmed };
	}
}

import { useCallback, useState } from 'react';
import { APP_VERSION } from '../version';

const GITHUB_API = 'https://api.github.com/repos/lordfoogthe4rd/miyapad/releases/latest';
const RELEASE_PAGE = 'https://github.com/lordfoogthe4rd/miyapad/releases/latest';
const REPO_URL = 'https://github.com/lordfoogthe4rd/miyapad';

// ponytail: numeric semver only; non-semver tags parse as NaN.
// Add proper semver parsing (or the `semver` package) alongside a pre-release checkbox in the future.
function isNewer(latest: string, current: string): boolean {
	const a = latest.split('.').map(Number);
	const b = current.split('.').map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] || 0, y = b[i] || 0;
		if (x !== y) return x > y;
	}
	return false;
}

interface UpdateState {
	currentVersion: string;
	latestVersion: string | null;
	downloadUrl: string;
	repoUrl: string;
	updateAvailable: boolean;
	checking: boolean;
	error: string | null;
	check: () => Promise<void>;
}

export function useUpdateCheck(isMiyapadEndpoint: boolean): UpdateState {
	const [latestVersion, setLatestVersion] = useState<string | null>(null);
	const [downloadUrl, setDownloadUrl] = useState(RELEASE_PAGE);
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const check = useCallback(async () => {
		setChecking(true);
		setError(null);
		try {
			let latest: string | null = null;
			let url = RELEASE_PAGE;
			if (isMiyapadEndpoint) {
				const res = await fetch('/version', { signal: AbortSignal.timeout(10000) });
				if (!res.ok) throw new Error(`Server returned ${res.status}`);
				const data = await res.json();
				latest = data.latestVersion ?? null;
				if (data.downloadUrl) url = data.downloadUrl;
			} else {
				const res = await fetch(GITHUB_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
				if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
				const data = await res.json();
				latest = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : null;
				if (data.html_url) url = data.html_url;
			}
			if (!latest) throw new Error('Could not determine the latest version.');
			setLatestVersion(latest);
			setDownloadUrl(url);
		} catch (e: unknown) {
			setError(String(e instanceof Error ? e.message : e));
		} finally {
			setChecking(false);
		}
	}, [isMiyapadEndpoint]);

	return {
		currentVersion: APP_VERSION,
		latestVersion,
		downloadUrl,
		repoUrl: REPO_URL,
		updateAvailable: latestVersion !== null && isNewer(latestVersion, APP_VERSION),
		checking,
		error,
		check
	};
}

import axios from 'axios';

// ponytail: repo slug also lives in src/hooks/useUpdateCheck.ts and the
// miyapad-update scripts. Not shared config — spans 3 build contexts for a
// value that never changes; centralize via build-time injection if it does.
const RELEASE_URL = 'https://api.github.com/repos/lordfoogthe4rd/miyapad/releases/latest';
const TTL = 60 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;

interface UpdateInfo {
    latestVersion: string | null;
    downloadUrl: string | null;
}

let cache: { at: number; ttl: number; info: UpdateInfo } | null = null;
let inflight: Promise<UpdateInfo> | null = null;

const EMPTY: UpdateInfo = { latestVersion: null, downloadUrl: null };

async function fetchUpdate(): Promise<UpdateInfo> {
    try {
        const { data } = await axios.get(RELEASE_URL, {
            headers: { Accept: 'application/vnd.github+json' },
            timeout: 10000
        });
        const info: UpdateInfo = {
            latestVersion: typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : null,
            downloadUrl: typeof data.html_url === 'string' ? data.html_url : null
        };
        cache = { at: Date.now(), ttl: TTL, info };
        return info;
    } catch (err) {
        console.error('Update check failed:', (err as Error).message);
        cache = { at: Date.now(), ttl: FAIL_TTL, info: EMPTY };
        return EMPTY;
    } finally {
        inflight = null;
    }
}

// Coalesced fetch: concurrent cache misses share a single GitHub request.
export function checkForUpdate(): Promise<UpdateInfo> {
    if (cache && Date.now() - cache.at < cache.ttl) {
        return Promise.resolve(cache.info);
    }
    inflight ??= fetchUpdate();
    return inflight;
}

// Non-blocking: returns cached/stale data immediately and refreshes in the
// background. Keeps the /version hot path off the 10s GitHub round-trip.
export function getUpdateInfo(): UpdateInfo {
    if (!cache || Date.now() - cache.at >= cache.ttl) {
        void checkForUpdate();
    }
    return cache?.info ?? EMPTY;
}

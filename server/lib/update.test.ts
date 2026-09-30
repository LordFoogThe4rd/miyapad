// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { get } }));

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

let update: typeof import('./update.js');

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    get.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    update = await import('./update.js');
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const release = (data: unknown) => get.mockResolvedValue({ data });

describe('update check', () => {
    it('strips a leading v from the tag and keeps the release page', async () => {
        release({ tag_name: 'v1.2.3', html_url: 'https://example.com/r' });

        expect(await update.checkForUpdate()).toEqual({ latestVersion: '1.2.3', downloadUrl: 'https://example.com/r' });
    });

    it('gives null for fields that are not text', async () => {
        release({ tag_name: 5, html_url: null });

        expect(await update.checkForUpdate()).toEqual({ latestVersion: null, downloadUrl: null });
    });

    it('keeps a successful answer for an hour', async () => {
        release({ tag_name: 'v1.0.0' });
        await update.checkForUpdate();
        release({ tag_name: 'v2.0.0' });

        vi.advanceTimersByTime(HOUR - 1);
        expect((await update.checkForUpdate()).latestVersion).toBe('1.0.0');
        vi.advanceTimersByTime(1);
        expect((await update.checkForUpdate()).latestVersion).toBe('2.0.0');
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('retries a failed check after five minutes, not an hour', async () => {
        get.mockRejectedValue(new Error('offline'));
        expect(await update.checkForUpdate()).toEqual({ latestVersion: null, downloadUrl: null });
        release({ tag_name: 'v1.0.0' });

        vi.advanceTimersByTime(5 * MINUTE - 1);
        expect((await update.checkForUpdate()).latestVersion).toBeNull();
        vi.advanceTimersByTime(1);
        expect((await update.checkForUpdate()).latestVersion).toBe('1.0.0');
    });

    it('makes one request for checks that overlap', async () => {
        release({ tag_name: 'v1.0.0' });

        const results = await Promise.all([update.checkForUpdate(), update.checkForUpdate(), update.checkForUpdate()]);

        expect(get).toHaveBeenCalledTimes(1);
        expect(results.map(r => r.latestVersion)).toEqual(['1.0.0', '1.0.0', '1.0.0']);
    });

    it('answers at once with what it has and refreshes in the background', async () => {
        let answer!: (value: unknown) => void;
        get.mockReturnValue(new Promise(r => { answer = r; }));

        expect(update.getUpdateInfo()).toEqual({ latestVersion: null, downloadUrl: null });
        expect(get).toHaveBeenCalledTimes(1);
        answer({ data: { tag_name: 'v1.0.0' } });
        await vi.waitFor(() => expect(update.getUpdateInfo().latestVersion).toBe('1.0.0'));
        expect(get).toHaveBeenCalledTimes(1);

        release({ tag_name: 'v2.0.0' });
        vi.advanceTimersByTime(HOUR);
        expect(update.getUpdateInfo().latestVersion).toBe('1.0.0');
        await vi.waitFor(() => expect(update.getUpdateInfo().latestVersion).toBe('2.0.0'));
        expect(get).toHaveBeenCalledTimes(2);
    });
});

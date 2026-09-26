import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { isNewer, useUpdateCheck } from './useUpdateCheck';

vi.mock('../version', () => ({ APP_VERSION: '2.9.0' }));

const fetchMock = vi.fn();

function ok(body: unknown) {
	return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('isNewer', () => {
	it('compares each part as a number, not as text', () => {
		expect(isNewer('2.10.0', '2.9.0')).toBe(true);
		expect(isNewer('2.9.0', '2.10.0')).toBe(false);
	});

	it('is false for the same version', () => {
		expect(isNewer('2.9.0', '2.9.0')).toBe(false);
	});

	it('treats a missing part as zero', () => {
		expect(isNewer('3', '2.9.9')).toBe(true);
		expect(isNewer('2.9', '2.9.0')).toBe(false);
		expect(isNewer('2.9.0.1', '2.9')).toBe(true);
	});

	it('looks at the major part first', () => {
		expect(isNewer('3.0.0', '2.99.99')).toBe(true);
		expect(isNewer('1.99.99', '2.0.0')).toBe(false);
	});
});

describe('useUpdateCheck', () => {
	it('reads the latest release from GitHub and offers its page', async () => {
		fetchMock.mockResolvedValue(ok({ tag_name: 'v2.10.0', html_url: 'https://github.com/x/releases/tag/v2.10.0' }));
		const { result } = renderHook(() => useUpdateCheck(false));

		await act(() => result.current.check());

		expect(fetchMock.mock.calls[0][0]).toContain('api.github.com');
		expect(result.current.latestVersion).toBe('2.10.0');
		expect(result.current.updateAvailable).toBe(true);
		expect(result.current.downloadUrl).toBe('https://github.com/x/releases/tag/v2.10.0');
		expect(result.current.error).toBeNull();
		expect(result.current.checking).toBe(false);
	});

	it('asks the miyapad server instead when running on one', async () => {
		fetchMock.mockResolvedValue(ok({ latestVersion: '2.9.0', downloadUrl: 'https://example.com/dl' }));
		const { result } = renderHook(() => useUpdateCheck(true));

		await act(() => result.current.check());

		expect(fetchMock.mock.calls[0][0]).toBe('/version');
		expect(result.current.latestVersion).toBe('2.9.0');
		expect(result.current.updateAvailable).toBe(false);
		expect(result.current.downloadUrl).toBe('https://example.com/dl');
	});

	it('shows an error when the answer has no version', async () => {
		fetchMock.mockResolvedValue(ok({ tag_name: null }));
		const { result } = renderHook(() => useUpdateCheck(false));

		await act(() => result.current.check());

		expect(result.current.latestVersion).toBeNull();
		expect(result.current.updateAvailable).toBe(false);
		expect(result.current.error).toBe('Could not determine the latest version.');
	});

	it('shows the status of a failed request', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
		const { result } = renderHook(() => useUpdateCheck(false));

		await act(() => result.current.check());

		expect(result.current.error).toBe('GitHub API returned 403');
		expect(result.current.checking).toBe(false);
	});
});

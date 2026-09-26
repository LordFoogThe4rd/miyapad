import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerDBAdapter } from './ServerDBAdapter';

const fetchMock = vi.fn();
const endpoint = 'http://localhost:3000';

function ok(body: unknown) {
	return new Response(JSON.stringify(body), { status: 200 });
}

function status(code: number) {
	return new Response('{}', { status: code });
}

function lastCall() {
	const [url, init] = fetchMock.mock.calls.at(-1)!;
	return { url: String(url), init: init as RequestInit, body: JSON.parse(String((init as RequestInit).body)) };
}

let adapter: ServerDBAdapter;

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
	vi.stubGlobal('reportError', vi.fn());
	adapter = new ServerDBAdapter(endpoint);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('init', () => {
	it('accepts a server of version 3 or later', async () => {
		fetchMock.mockResolvedValue(ok({ version: 4 }));

		await expect(adapter.init()).resolves.toBeUndefined();
		expect(String(fetchMock.mock.calls[0][0])).toBe(`${endpoint}/version`);
	});

	it('refuses an older server', async () => {
		fetchMock.mockResolvedValue(ok({ version: 2 }));

		await expect(adapter.init()).rejects.toThrow('Miyapad server version mismatch.');
	});

	it('refuses something that is not a miyapad server', async () => {
		fetchMock.mockResolvedValue(status(404));

		await expect(adapter.init()).rejects.toThrow('Not a miyapad server');
	});
});

describe('requests', () => {
	it('posts each operation as JSON to its route', async () => {
		const db = await adapter.openDatabase();
		fetchMock.mockImplementation(async () => ok({ result: 'r' }));

		await expect(adapter.loadFromDatabase(db, 'Sessions', '3')).resolves.toBe('r');
		expect(lastCall()).toMatchObject({ url: `${endpoint}/load`, init: { method: 'POST' }, body: { storeName: 'Sessions', key: '3' } });

		await expect(adapter.loadAllFromDatabase(db, 'Themes')).resolves.toBe('r');
		expect(lastCall()).toMatchObject({ url: `${endpoint}/all`, body: { storeName: 'Themes' } });

		await expect(adapter.loadSessionInfoFromDatabase(db, 'Names')).resolves.toBe('r');
		expect(lastCall()).toMatchObject({ url: `${endpoint}/sessions`, body: { storeName: 'Names' } });

		await expect(adapter.saveToDatabase(db, 'Sessions', '3', { a: 1 })).resolves.toBe('r');
		expect(lastCall()).toMatchObject({ url: `${endpoint}/save`, body: { storeName: 'Sessions', key: '3', data: { a: 1 } } });

		await expect(adapter.renameSessionInDatabase(db, 'Names', '3', 'New')).resolves.toBe('r');
		expect(lastCall()).toMatchObject({ url: `${endpoint}/rename`, body: { storeName: 'Names', key: '3', newName: 'New' } });

		await adapter.deleteFromDatabase(db, 'Sessions', '3');
		expect(lastCall()).toMatchObject({ url: `${endpoint}/delete`, body: { storeName: 'Sessions', key: '3' } });

		const ops: BatchOp[] = [{ type: 'delete', key: 'a' }, { type: 'save', key: 'b', data: 1 }];
		await adapter.batchMutation(db, 'SamplerPresets', ops);
		expect(lastCall()).toMatchObject({ url: `${endpoint}/batch`, body: { storeName: 'SamplerPresets', ops } });
	});

	it('loads a missing record as undefined', async () => {
		const db = await adapter.openDatabase();
		fetchMock.mockResolvedValue(status(404));

		await expect(adapter.loadFromDatabase(db, 'Sessions', '9')).resolves.toBeUndefined();
	});

	it('throws the status of any other failure', async () => {
		const db = await adapter.openDatabase();
		fetchMock.mockImplementation(async () => status(500));

		await expect(adapter.loadFromDatabase(db, 'Sessions', '1')).rejects.toThrow('500');
		await expect(adapter.loadAllFromDatabase(db, 'Themes')).rejects.toThrow('500');
		await expect(adapter.loadSessionInfoFromDatabase(db, 'Names')).rejects.toThrow('500');
		await expect(adapter.saveToDatabase(db, 'Sessions', '1', {})).rejects.toThrow('500');
		await expect(adapter.renameSessionInDatabase(db, 'Names', '1', 'x')).rejects.toThrow('500');
		await expect(adapter.deleteFromDatabase(db, 'Sessions', '1')).rejects.toThrow('500');
		await expect(adapter.batchMutation(db, 'Themes', [])).rejects.toThrow('500');
	});

	it('reports a network failure and turns it into a failed response', async () => {
		const db = await adapter.openDatabase();
		const error = new TypeError('Failed to fetch');
		fetchMock.mockRejectedValue(error);

		await expect(adapter.loadFromDatabase(db, 'Sessions', '1')).rejects.toThrow('TypeError: Failed to fetch');
		expect(reportError).toHaveBeenCalledWith(error);
	});
});

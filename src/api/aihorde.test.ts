import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aiHordeModels, aiHordeCompletion, aiHordeAbortCompletion } from './aihorde';
import { ok, notOk, collect, callOf } from './testing';

const fetchMock = vi.fn();
const endpoint = 'https://aihorde.net/api';

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
	vi.stubGlobal('reportError', vi.fn());
	// The status poll waits a second between requests; don't.
	vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('aiHordeModels', () => {
	it('lists the names of the text models only', async () => {
		fetchMock.mockResolvedValue(ok([
			{ name: 'koboldcpp/Llama', type: 'text' },
			{ name: 'SDXL', type: 'image' },
			{ name: 'aphrodite/Mistral', type: 'text' },
		]));

		await expect(aiHordeModels({ endpoint })).resolves.toEqual(['koboldcpp/Llama', 'aphrodite/Mistral']);
		expect(callOf(fetchMock).url).toBe(`${endpoint}/v2/status/models?type=text`);
	});

	it('throws on a non-OK response', async () => {
		fetchMock.mockResolvedValue(notOk(429));

		await expect(aiHordeModels({ endpoint })).rejects.toThrow('HTTP 429');
	});
});

describe('aiHordeCompletion', () => {
	function hordeResponses(...statuses: Record<string, unknown>[]) {
		fetchMock.mockResolvedValueOnce(ok({ id: 'task-1' }));
		for (const status of statuses) fetchMock.mockResolvedValueOnce(ok(status));
	}

	it('submits the job, reports the queue while polling, and yields the text when done', async () => {
		hordeResponses(
			{ done: false, queue_position: 3, wait_time: 20, processing: 0 },
			{ done: false, queue_position: 0, wait_time: 2, processing: 1 },
			{ done: true, queue_position: 0, wait_time: 0, processing: 0, generations: [{ text: 'Once upon a time' }] },
		);

		const chunks = await collect(aiHordeCompletion({ endpoint, prompt: 'Tell me', n_predict: 64 }));

		expect(chunks).toEqual([
			{ status: 'queue_init', taskId: 'task-1' },
			{ status: 'queue_status', position: 3, waitTime: 20, processing: 0 },
			{ status: 'queue_status', position: 0, waitTime: 2, processing: 1 },
			{ status: 'queue_status', position: 0, waitTime: 0, processing: 0 },
			{ status: 'done', content: 'Once upon a time' },
		]);
		expect(callOf(fetchMock, 1).url).toBe(`${endpoint}/v2/generate/text/status/task-1`);
	});

	it('sends kobold-style params, the prompt, and each chosen model', async () => {
		hordeResponses({ done: true, generations: [] });

		await collect(aiHordeCompletion({ endpoint, endpointAPIKey: 'my-key', prompt: 'P', model: 'a, b', n_predict: 8 }));

		const { url, init, body } = callOf(fetchMock, 0);
		expect(url).toBe(`${endpoint}/v2/generate/text/async`);
		expect(init.headers['Apikey']).toBe('my-key');
		expect(body).toEqual({ models: ['a', 'b'], params: { max_length: 16 }, prompt: 'P' });
	});

	it('uses the anonymous key when none is set', async () => {
		hordeResponses({ done: true });

		await collect(aiHordeCompletion({ endpoint, endpointAPIKey: '  ' }));

		expect(callOf(fetchMock, 0).init.headers['Apikey']).toBe('0000000000');
		expect(callOf(fetchMock, 0).body).not.toHaveProperty('models');
	});

	it('yields no text for a finished job without generations', async () => {
		hordeResponses({ done: true, generations: [] });

		const chunks = await collect(aiHordeCompletion({ endpoint }));

		expect(chunks.map(c => c.status)).toEqual(['queue_init', 'queue_status']);
	});

	it('throws when the submit or a poll fails', async () => {
		fetchMock.mockResolvedValueOnce(notOk(401));
		await expect(collect(aiHordeCompletion({ endpoint }))).rejects.toThrow('HTTP 401');

		fetchMock.mockResolvedValueOnce(ok({ id: 't' })).mockResolvedValueOnce(notOk(404));
		await expect(collect(aiHordeCompletion({ endpoint }))).rejects.toThrow('HTTP 404');
	});
});

describe('aiHordeAbortCompletion', () => {
	it('deletes the job, through the proxy when there is one', async () => {
		fetchMock.mockResolvedValue(ok({}));

		await aiHordeAbortCompletion({ endpoint, proxyEndpoint: 'http://proxy.local', hordeTaskId: 'task-1' });

		const { url, init } = callOf(fetchMock);
		expect(url).toBe('http://proxy.local/v2/generate/text/status/task-1');
		expect(init.method).toBe('DELETE');
		expect(init.headers['X-Real-URL']).toBe(endpoint);
	});

	it('reports a failed abort instead of throwing', async () => {
		fetchMock.mockRejectedValue(new TypeError('offline'));

		await expect(aiHordeAbortCompletion({ endpoint, hordeTaskId: 'x' })).resolves.toBeUndefined();
		expect(reportError).toHaveBeenCalled();
	});
});

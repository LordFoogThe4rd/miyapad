// Helpers for the API provider tests. Not imported by the app.
import type { Mock } from 'vitest';

export function ok(body: unknown) {
	return { ok: true, status: 200, json: async () => body };
}

export function notOk(status: number, body: unknown = {}) {
	return { ok: false, status, json: async () => body };
}

/** An OK response whose body is an event stream carrying each value as a JSON `data:` event. */
export function sse(...events: unknown[]) {
	const text = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
	return { ok: true, status: 200, body: new Response(text).body };
}

export async function collect<T>(chunks: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const chunk of chunks) out.push(chunk);
	return out;
}

/** The URL, init and parsed JSON body of one fetch call, the last one by default. */
export function callOf(fetchMock: Mock, index = -1) {
	const [url, init] = fetchMock.mock.calls.at(index)!;
	const request = (init ?? {}) as RequestInit & { headers: Record<string, string> };
	return { url: String(url), init: request, body: request.body ? JSON.parse(String(request.body)) : undefined };
}

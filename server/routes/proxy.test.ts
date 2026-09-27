// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import proxyRoutes, { isValidProxyUrl, safeFinalUrl } from './proxy.js';
import { serve, type Served } from '../lib/testing.js';

describe('isValidProxyUrl', () => {
    it('accepts http and https, including local backends', () => {
        expect(isValidProxyUrl('http://127.0.0.1:5001')).toBe(true);
        expect(isValidProxyUrl('https://api.openai.com/v1')).toBe(true);
    });

    it('refuses other protocols', () => {
        expect(isValidProxyUrl('file:///etc/passwd')).toBe(false);
        expect(isValidProxyUrl('ftp://example.com')).toBe(false);
        expect(isValidProxyUrl('javascript:alert(1)')).toBe(false);
    });

    it('refuses something that is not a URL', () => {
        expect(isValidProxyUrl('')).toBe(false);
        expect(isValidProxyUrl('localhost:5001')).toBe(false);
    });
});

describe('safeFinalUrl', () => {
    it('returns the base itself when there is no path', () => {
        expect(safeFinalUrl('http://h:5001/v1', '')).toBe('http://h:5001/v1');
    });

    it('appends a path to a root base', () => {
        expect(safeFinalUrl('http://h:5001', 'v1/completions')).toBe('http://h:5001/v1/completions');
    });

    it('appends a path under a base that ends in a slash', () => {
        expect(safeFinalUrl('http://h/api/', 'v1/generate')).toBe('http://h/api/v1/generate');
    });

    it('keeps the path of a base that does not end in a slash', () => {
        expect(safeFinalUrl('https://aihorde.net/api', 'v2/status/models')).toBe('https://aihorde.net/api/v2/status/models');
        expect(safeFinalUrl('https://openrouter.ai/api', 'v1/chat/completions')).toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    it('refuses to climb out of the base path with ..', () => {
        expect(safeFinalUrl('http://h/api', '../admin')).toBeNull();
        expect(safeFinalUrl('http://h/api/', '../admin')).toBeNull();
        expect(safeFinalUrl('http://h/api/', 'v1/../../admin')).toBeNull();
    });

    it('refuses an encoded .. too, since URL parsing decodes it', () => {
        expect(safeFinalUrl('http://h/api/', '%2e%2e/admin')).toBeNull();
        expect(safeFinalUrl('http://h/api/', '.%2E/admin')).toBeNull();
    });

    it('refuses a path that switches to another host', () => {
        expect(safeFinalUrl('http://h/', '//evil.example/x')).toBeNull();
        expect(safeFinalUrl('http://h/', 'http://evil.example/x')).toBeNull();
    });

    it('refuses a path that only shares a prefix with the base directory', () => {
        expect(safeFinalUrl('http://h/v1/', '/v1x/models')).toBeNull();
    });

    it('allows an absolute path on the same origin when the base is the root', () => {
        expect(safeFinalUrl('http://h:5001', '/v1/models')).toBe('http://h:5001/v1/models');
    });
});

describe('proxy handlers', () => {
    let proxy: Served;
    let upstream: Served;
    let dead: string;
    let answer: (req: Request, res: Response) => void;
    let seen: Request[];

    beforeAll(async () => {
        proxy = await serve(proxyRoutes);
        upstream = await serve(app => app.use((req, res) => { seen.push(req); answer(req, res); }));
        const closed = await serve(() => {});
        await closed.close();
        dead = closed.url;
    });

    afterAll(async () => {
        await proxy.close();
        await upstream.close();
    });

    beforeEach(() => {
        seen = [];
        answer = (req, res) => { res.json({ ok: true }); };
    });

    function call(path: string, { method = 'GET', target = upstream.url + '/api', headers = {}, body, signal }: {
        method?: string; target?: string | null; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal;
    } = {}) {
        return fetch(proxy.url + path, {
            method,
            headers: {
                ...(target === null ? {} : { 'X-Real-URL': target }),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
        });
    }

    it('posts the body under the target path and streams the answer back', async () => {
        answer = (req, res) => {
            res.setHeader('X-Request-Id', 'abc');
            res.write('data: 1\n\n');
            res.end('data: 2\n\n');
        };
        const res = await call('/proxy/v1/completions', { method: 'POST', body: { prompt: 'hi' } });
        expect(res.status).toBe(200);
        expect(res.headers.get('x-request-id')).toBe('abc');
        expect(await res.text()).toBe('data: 1\n\ndata: 2\n\n');
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/v1/completions', body: { prompt: 'hi' } });
    });

    it('posts to the target itself when there is no path', async () => {
        await call('/proxy', { method: 'POST', target: upstream.url + '/api/v1/generate', body: {} });
        expect(seen[0].url).toBe('/api/v1/generate');
    });

    it('sends the key from X-Real-Authorization and strips its own and forwarding headers', async () => {
        await call('/proxy/v1/completions', {
            method: 'POST',
            body: {},
            headers: {
                'X-Real-Authorization': 'Bearer sk-test',
                'Authorization': 'Basic bWl5YTpwYWQ=',
                'X-Forwarded-For': '10.0.0.1',
                'CF-Connecting-IP': '10.0.0.2',
            },
        });
        const headers = seen[0].headers;
        expect(headers.authorization).toBe('Bearer sk-test');
        for (const name of ['x-real-url', 'x-real-authorization', 'x-forwarded-for', 'cf-connecting-ip']) {
            expect(headers[name]).toBeUndefined();
        }
    });

    it('does not pass miyapad\'s own login on when there is no key', async () => {
        for (const method of ['GET', 'POST', 'DELETE']) {
            await call('/proxy/v1/x', { method, headers: { 'Authorization': 'Basic bWl5YTpwYWQ=' } });
        }
        expect(seen.map(req => req.headers.authorization)).toEqual([undefined, undefined, undefined]);
    });

    it('refuses a missing or non-http target and a path that leaves it, without calling out', async () => {
        for (const method of ['GET', 'POST', 'DELETE']) {
            expect((await call('/proxy/v1/x', { method, target: null })).status).toBe(403);
            expect((await call('/proxy/v1/x', { method, target: 'file:///etc/passwd' })).status).toBe(403);
            const escaped = await call('/proxy//elsewhere', { method });
            expect(escaped.status).toBe(403);
            expect(await escaped.json()).toEqual({ error: { message: 'Path traversal detected' } });
        }
        expect(seen).toEqual([]);
    });

    it('passes an error answer on with its status and body', async () => {
        answer = (req, res) => { res.status(429).end('slow down'); };
        const post = await call('/proxy/v1/completions', { method: 'POST', body: {} });
        expect(post.status).toBe(429);
        expect(await post.json()).toEqual({ error: 'slow down' });

        answer = (req, res) => { res.status(404).json({ detail: 'no such job' }); };
        for (const method of ['GET', 'DELETE']) {
            const res = await call('/proxy/v1/jobs/7', { method });
            expect(res.status).toBe(404);
            expect(await res.json()).toEqual({ error: { detail: 'no such job' } });
        }
    });

    it('cuts off an error body over 10KB', async () => {
        answer = (req, res) => { res.status(500).end('x'.repeat(20_000)); };
        const res = await call('/proxy/v1/completions', { method: 'POST', body: {} });
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Error response body too large' });
    });

    it('answers 504 when the target does not answer', async () => {
        for (const method of ['GET', 'POST', 'DELETE']) {
            const res = await call('/proxy/v1/x', { method, target: dead, body: method === 'POST' ? {} : undefined });
            expect(res.status).toBe(504);
            expect(await res.json()).toEqual({ error: 'No response from target server.' });
        }
    });

    it('hangs up on the target when the client stops reading a stream', async () => {
        let hungUp = false;
        answer = (req, res) => {
            res.on('close', () => { hungUp = true; });
            res.write('data: 1\n\n');
        };
        const abort = new AbortController();
        const res = await call('/proxy/v1/completions', { method: 'POST', body: {}, signal: abort.signal });
        await res.body!.getReader().read();
        abort.abort();
        await vi.waitFor(() => expect(hungUp).toBe(true));
    });

    it('forwards a GET query and answers with the target\'s body', async () => {
        answer = (req, res) => { res.json({ models: ['a'] }); };
        const res = await call('/proxy/v1/models?limit=5');
        expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/v1/models?limit=5' });
        expect(await res.json()).toEqual({ models: ['a'] });
    });

    it('forwards a DELETE', async () => {
        answer = (req, res) => { res.json({ cancelled: true }); };
        const res = await call('/proxy/v1/jobs/7', { method: 'DELETE' });
        expect(seen[0]).toMatchObject({ method: 'DELETE', url: '/api/v1/jobs/7' });
        expect(await res.json()).toEqual({ cancelled: true });
    });

    describe('/proxy-image', () => {
        const image = (url: string) => fetch(`${proxy.url}/proxy-image?url=${encodeURIComponent(url)}`, { redirect: 'manual' });

        it('fetches an image and lets any page cache it for a day', async () => {
            answer = (req, res) => { res.type('png').end(Buffer.from([1, 2, 3])); };
            const res = await image(upstream.url + '/cat.png');
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('image/png');
            expect(res.headers.get('access-control-allow-origin')).toBe('*');
            expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
            expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
        });

        it('refuses a missing or non-http url', async () => {
            expect((await fetch(`${proxy.url}/proxy-image`)).status).toBe(400);
            expect((await image('file:///etc/passwd')).status).toBe(403);
        });

        it('passes on the target\'s error status', async () => {
            answer = (req, res) => { res.status(404).end(); };
            expect((await image(upstream.url + '/gone.png')).status).toBe(404);
        });

        it('does not follow a redirect', async () => {
            answer = (req, res) => { res.redirect(302, '/elsewhere.png'); };
            const res = await image(upstream.url + '/cat.png');
            expect(res.status).toBe(302);
            expect(seen.map(req => req.url)).toEqual(['/cat.png']);
        });
    });
});

// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createHostCheckMiddleware } from './hostcheck.js';

function run(middleware: ReturnType<typeof createHostCheckMiddleware>, host?: string) {
    const req = { headers: host === undefined ? {} : { host } } as Request;
    const res = { status: vi.fn(), send: vi.fn() };
    res.status.mockReturnValue(res);
    const next = vi.fn();
    middleware(req, res as unknown as Response, next);
    return { res, next };
}

describe('createHostCheckMiddleware', () => {
    it('lets localhost and loopback through, with or without a port', () => {
        const middleware = createHostCheckMiddleware([]);
        for (const host of ['localhost:3000', 'localhost', '127.0.0.1:3000', '[::1]:3000']) {
            expect(run(middleware, host).next).toHaveBeenCalledOnce();
        }
    });

    it('lets an allowed host through whatever its case or port', () => {
        const middleware = createHostCheckMiddleware(['miyapad.example.com']);
        expect(run(middleware, 'Miyapad.Example.com:8080').next).toHaveBeenCalledOnce();
    });

    it('refuses every other host, a missing one included', () => {
        const middleware = createHostCheckMiddleware(['miyapad.example.com']);
        for (const host of [undefined, '', 'evil.example', 'evil.example:3000', '192.168.1.5:3000', 'localhost.evil.example']) {
            const { res, next } = run(middleware, host);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.send).toHaveBeenCalledWith(expect.stringContaining('--allowedHosts'));
        }
    });
});

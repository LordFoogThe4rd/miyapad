// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createAuthMiddleware } from './auth.js';

function run(middleware: ReturnType<typeof createAuthMiddleware>, authorization?: string) {
    const req = { headers: authorization === undefined ? {} : { authorization } } as Request;
    const res = { set: vi.fn(), status: vi.fn(), send: vi.fn() };
    res.status.mockReturnValue(res);
    const next = vi.fn();
    middleware(req, res as unknown as Response, next);
    return { res, next };
}

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString('base64')}`;

describe('createAuthMiddleware', () => {
    it('lets every request through when no password is set', () => {
        expect(run(createAuthMiddleware('admin')).next).toHaveBeenCalledOnce();
    });

    it('lets the right login and password through', () => {
        expect(run(createAuthMiddleware('admin', 'secret'), basic('admin:secret')).next).toHaveBeenCalledOnce();
    });

    it('accepts a password that contains a colon', () => {
        expect(run(createAuthMiddleware('admin', 'se:cr:et'), basic('admin:se:cr:et')).next).toHaveBeenCalledOnce();
    });

    it('asks for credentials with a 401 when they are wrong or missing', () => {
        const middleware = createAuthMiddleware('admin', 'secret');
        for (const header of [undefined, basic('admin:wrong'), basic('other:secret'), 'Basic', 'garbage']) {
            const { res, next } = run(middleware, header);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.set).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="401"');
        }
    });

    it('does not let a password prefix through', () => {
        expect(run(createAuthMiddleware('admin', 'secret'), basic('admin:sec')).next).not.toHaveBeenCalled();
    });
});

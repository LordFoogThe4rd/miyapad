import type { Request, Response, NextFunction } from 'express';

/** Hosts that reach a server bound to loopback, whatever a caller types. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** `example.com:3000` → `example.com`, `[::1]:3000` → `[::1]`. */
const hostname = (host: string) => {
    const end = host.startsWith('[') ? host.indexOf(']') + 1 : host.indexOf(':');
    return (end === -1 ? host : end > 0 ? host.slice(0, end) : '').toLowerCase();
};

/**
 * Rejects a request whose Host is neither a loopback name nor one of `allowedHosts`.
 * A page on another site can point its own domain at 127.0.0.1, so the Host it sends is
 * the only thing that tells it apart from a browser talking to Miyapad directly.
 */
const createHostCheckMiddleware = (allowedHosts: string[]) => {
    const allowed = new Set(allowedHosts.map((h) => hostname(h)));

    return (req: Request, res: Response, next: NextFunction) => {
        const name = hostname(req.headers.host || '');

        if (LOOPBACK_HOSTS.has(name) || allowed.has(name)) {
            return next();
        }

        res.status(403).send(`Host "${req.headers.host || ''}" is not allowed. Add it to --allowedHosts or MIYAPAD_ALLOWED_HOSTS.`);
    };
};

export { createHostCheckMiddleware };

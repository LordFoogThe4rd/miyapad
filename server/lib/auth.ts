import type { Request, Response, NextFunction } from 'express';

const createAuthMiddleware = (login: string, password?: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!password) {
            return next();
        }

        const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        // Split at the first colon only: a login can't contain one, but a password can.
        const credentials = Buffer.from(b64auth, 'base64').toString();
        const colon = credentials.indexOf(':');

        if (colon !== -1 && credentials.slice(0, colon) == login && credentials.slice(colon + 1) == password) {
            return next();
        }

        res.set('WWW-Authenticate', 'Basic realm="401"');
        res.status(401).send('Authentication required.');
    };
};

export { createAuthMiddleware };

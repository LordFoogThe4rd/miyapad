// Helpers for the server tests. Not imported by the server.
import fs from 'fs';
import path from 'path';
import express from 'express';
import type { Express } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { basedir } from './paths.js';

const zstdLibName = ({ win32: 'sqlite_zstd.dll', darwin: 'libsqlite_zstd.dylib' } as Record<string, string | undefined>)[process.platform]
    ?? 'libsqlite_zstd.so';

/** The sqlite-zstd build initDatabase loads. It is gitignored and built by hand, so tests that need it skip without it. */
export const zstdExtension = path.join(basedir, '..', zstdLibName);
export const hasZstd = fs.existsSync(zstdExtension);

export interface Served {
    url: string;
    close: () => Promise<void>;
}

/** Listens on a free local port with the same JSON parser as server.ts, after `mount` adds the routes. */
export async function serve(mount: (app: Express) => void): Promise<Served> {
    const app = express();
    app.use(express.json({ limit: '100mb' }));
    mount(app);
    const server = await new Promise<Server>(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => new Promise(resolve => {
            server.closeAllConnections();
            server.close(() => resolve());
        }),
    };
}

/** POSTs a JSON body and returns the status and parsed answer. */
export async function postJson(url: string, body: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
}

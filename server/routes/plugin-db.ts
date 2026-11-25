import type { Express, Request, Response } from 'express';
import { isValidNamespace, isValidPluginId, PluginContainerError, type PluginDbManager } from '../lib/plugin-db.js';
import { toKey } from './data.js';

function handleError(res: Response, err: unknown): void {
    if (err instanceof PluginContainerError) {
        res.status(500).json({ ok: false, unreadable: true, message: err.message });
        return;
    }
    res.status(500).json({ ok: false, message: (err as Error).message || 'Plugin database error' });
}

export default function pluginDbRoutes(app: Express, pluginDb: PluginDbManager): void {
    app.post('/plugin-db/get', (req: Request, res: Response) => {
        const { id, ns } = req.body as { id?: unknown; ns?: unknown; key?: unknown };
        const key = toKey(req.body?.key);
        if (!isValidPluginId(id)) {
            return res.status(400).json({ ok: false, message: 'Invalid plugin id' });
        }
        if (!isValidNamespace(ns)) {
            return res.status(400).json({ ok: false, message: 'Invalid namespace' });
        }
        if (key === null) {
            return res.status(400).json({ ok: false, message: 'Missing key' });
        }
        try {
            const value = pluginDb.get(id, ns, key);
            res.json({ ok: true, ...(value !== undefined ? { value } : {}) });
        } catch (err) {
            handleError(res, err);
        }
    });

    app.post('/plugin-db/set', (req: Request, res: Response) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const { id, ns } = body;
        const key = toKey(body.key);
        if (!isValidPluginId(id)) {
            return res.status(400).json({ ok: false, message: 'Invalid plugin id' });
        }
        if (!isValidNamespace(ns)) {
            return res.status(400).json({ ok: false, message: 'Invalid namespace' });
        }
        if (key === null) {
            return res.status(400).json({ ok: false, message: 'Missing key' });
        }
        if (!Object.hasOwn(body, 'value') || body.value === undefined) {
            return res.status(400).json({ ok: false, message: 'Missing value' });
        }
        try {
            pluginDb.set(id, ns, key, body.value);
            res.json({ ok: true });
        } catch (err) {
            handleError(res, err);
        }
    });

    app.post('/plugin-db/delete', (req: Request, res: Response) => {
        const { id, ns } = req.body as { id?: unknown; ns?: unknown; key?: unknown };
        const key = toKey(req.body?.key);
        if (!isValidPluginId(id)) {
            return res.status(400).json({ ok: false, message: 'Invalid plugin id' });
        }
        if (!isValidNamespace(ns)) {
            return res.status(400).json({ ok: false, message: 'Invalid namespace' });
        }
        if (key === null) {
            return res.status(400).json({ ok: false, message: 'Missing key' });
        }
        try {
            pluginDb.delete(id, ns, key);
            res.json({ ok: true });
        } catch (err) {
            handleError(res, err);
        }
    });

    app.post('/plugin-db/keys', (req: Request, res: Response) => {
        const { id, ns, prefix } = req.body as { id?: unknown; ns?: unknown; prefix?: unknown };
        if (!isValidPluginId(id)) {
            return res.status(400).json({ ok: false, message: 'Invalid plugin id' });
        }
        if (!isValidNamespace(ns)) {
            return res.status(400).json({ ok: false, message: 'Invalid namespace' });
        }
        const normPrefix = prefix === undefined ? '' : toKey(prefix);
        if (normPrefix === null) {
            return res.status(400).json({ ok: false, message: 'Invalid prefix' });
        }
        try {
            const keys = pluginDb.keys(id, ns, normPrefix);
            res.json({ ok: true, keys });
        } catch (err) {
            handleError(res, err);
        }
    });

    app.post('/plugin-db/clear', (req: Request, res: Response) => {
        const { id, ns } = req.body as { id?: unknown; ns?: unknown };
        if (!isValidPluginId(id)) {
            return res.status(400).json({ ok: false, message: 'Invalid plugin id' });
        }
        if (!isValidNamespace(ns)) {
            return res.status(400).json({ ok: false, message: 'Invalid namespace' });
        }
        try {
            pluginDb.clear(id, ns);
            res.json({ ok: true });
        } catch (err) {
            handleError(res, err);
        }
    });

    app.post('/plugin-db/drop', (req: Request, res: Response) => {
        const { id } = req.body as { id?: unknown };
        if (!isValidPluginId(id)) {
            return res.status(400).json({ ok: false, message: 'Invalid plugin id' });
        }
        try {
            pluginDb.deleteContainer(id);
            res.json({ ok: true });
        } catch (err) {
            handleError(res, err);
        }
    });
}

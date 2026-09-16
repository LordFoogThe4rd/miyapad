import type { Express, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import { getColumnName } from '../lib/utils.js';

export default function(app: Express, db: Database): void {
    app.get('/zstd_get_configs', (req: Request, res: Response) => {
        let rows: { id: number; config: string }[];
        try {
            rows = db.prepare('SELECT id, config FROM _zstd_configs').all() as typeof rows;
        } catch (err) {
            return res.status(500).json({ ok: false, message: 'Error querying zstd configs: ' + (err as Error).message });
        }
        const configs: Record<string, any> = {};
        rows.forEach((row) => {
            try {
                configs[row.id] = JSON.parse(row.config);
            } catch (_) {
                configs[row.id] = row.config;
            }
        });
        res.json({ ok: true, configs });
    });

    app.post('/zstd_enable_transparent', (req: Request, res: Response) => {
        const { table, column, compression_level, train_dict_samples_ratio } = req.body as { table?: string; column?: string; compression_level?: number; train_dict_samples_ratio?: number };
        const config = JSON.stringify({
            table: table || 'sessions',
            column: column || getColumnName(table || 'sessions'),
            compression_level: compression_level || 3,
            dict_chooser: "'a'",
            ...(train_dict_samples_ratio ? { train_dict_samples_ratio } : {})
        });
        try {
            db.prepare('SELECT zstd_enable_transparent(?)').run(config);
            res.json({ ok: true, message: 'Transparent compression enabled' });
        } catch (err) {
            res.status(500).json({ ok: false, message: 'Error enabling transparent compression: ' + (err as Error).message });
        }
    });

    app.post('/zstd_update_transparent', (req: Request, res: Response) => {
        const { compression_level, train_dict_samples_ratio } = req.body as { compression_level?: number; train_dict_samples_ratio?: number };
        const patch: Record<string, any> = {};
        if (compression_level !== undefined) patch.compression_level = compression_level;
        if (train_dict_samples_ratio !== undefined) patch.train_dict_samples_ratio = train_dict_samples_ratio;
        try {
            const { changes } = db.prepare('UPDATE _zstd_configs SET config = json_patch(config, ?)').run(JSON.stringify(patch));
            res.json({ ok: true, message: 'Compression config updated', changes });
        } catch (err) {
            res.status(500).json({ ok: false, message: 'Error updating compression config: ' + (err as Error).message });
        }
    });

    app.post('/zstd_incremental_maintenance', (req: Request, res: Response) => {
        const { duration, db_load } = req.body as { duration?: number; db_load?: number };
        const durationArg = duration !== undefined && duration !== null ? duration : null;
        const dbLoadArg = db_load !== undefined ? db_load : 1.0;
        try {
            db.prepare('SELECT zstd_incremental_maintenance(?, ?)').run(durationArg, dbLoadArg);
            res.json({ ok: true, message: 'Maintenance completed' });
        } catch (err) {
            res.status(500).json({ ok: false, message: 'Error running maintenance: ' + (err as Error).message });
        }
    });
};

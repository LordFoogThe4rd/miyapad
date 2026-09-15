import type { Express, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import * as tokenizer from '../tokenizer.js';
import { runZstdMaintenance, configureWAL, getMaintenanceConfig, saveMaintenanceConfig, clearMaintenanceScheduler, scheduleZstdMaintenance } from '../lib/database.js';
import { getUpdateInfo } from '../lib/update.js';

const SERVER_VERSION = 4;

export default function(app: Express, db: Database): void {
    app.get('/version', (req: Request, res: Response) => {
        const update = getUpdateInfo();
        res.json({
            version: SERVER_VERSION,
            features: { zstd_compression: true, server_tokenizer: true },
            tokenizers: tokenizer.getAvailableTokenizers(),
            latestVersion: update.latestVersion,
            downloadUrl: update.downloadUrl
        });
    });

    app.get('/vacuum', (req: Request, res: Response) => {
        try {
            db.exec('VACUUM');
            res.json({ ok: true, message: 'VACUUM completed successfully' });
        } catch (err) {
            res.status(500).json({ ok: false, message: 'Error running VACUUM: ' + (err as Error).message });
        }
    });

    app.post('/zstd_maintenance', (req: Request, res: Response) => {
        const { duration, dbLoad } = req.body as { duration?: number; dbLoad?: number };
        if (duration !== undefined && (typeof duration !== 'number' || duration < 0 || !Number.isFinite(duration))) {
            return res.status(400).json({ ok: false, message: 'duration must be a non-negative number or null' });
        }
        if (dbLoad !== undefined && (typeof dbLoad !== 'number' || dbLoad < 0 || dbLoad > 1)) {
            return res.status(400).json({ ok: false, message: 'dbLoad must be a number between 0 and 1' });
        }
        const result = runZstdMaintenance(db, duration, dbLoad);
        res.json(result);
    });

    app.get('/maintenance_config', (req: Request, res: Response) => {
        const config = getMaintenanceConfig(db);
        res.json(config);
    });

    app.post('/maintenance_config', (req: Request, res: Response) => {
        const { duration, dbLoad, mode, interval, walEnabled } = req.body as { duration?: number; dbLoad?: number; mode?: string; interval?: number; walEnabled?: boolean };
        const prevConfig = getMaintenanceConfig(db);
        const result = saveMaintenanceConfig(db, { duration, dbLoad, mode, interval, walEnabled });

        if (result.ok) {
            if (walEnabled !== undefined && walEnabled !== prevConfig.walEnabled) {
                configureWAL(db, walEnabled);
            }
            clearMaintenanceScheduler();
            scheduleZstdMaintenance(db, result.config!);
        }

        res.json(result);
    });

    app.post('/log', (req: Request, res: Response) => {
        console.log('[CLIENT LOG]', req.body);
        res.json({ ok: true });
    });
};

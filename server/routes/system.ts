import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request, Response } from 'express';
import type { Database } from 'sqlite3';
import * as tokenizer from '../tokenizer.js';
import { runZstdMaintenance, configureWAL, getMaintenanceConfig, saveMaintenanceConfig, clearMaintenanceScheduler, scheduleZstdMaintenance } from '../lib/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_VERSION = 4;

export default function(app: Express, db: Database): void {
    app.get('/', (req: Request, res: Response) => {
        res.sendFile(path.join(__dirname, '..', '..', 'dist', 'miyapad.html'));
    });

    app.get('/version', (req: Request, res: Response) => {
        res.json({
            version: SERVER_VERSION,
            features: { zstd_compression: true, server_tokenizer: true },
            tokenizers: tokenizer.getAvailableTokenizers()
        });
    });

    app.get('/vacuum', (req: Request, res: Response) => {
        db.run('VACUUM', (err) => {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error running VACUUM: ' + err.message });
            } else {
                res.json({ ok: true, message: 'VACUUM completed successfully' });
            }
        });
    });

    app.post('/zstd_maintenance', async (req: Request, res: Response) => {
        const { duration, dbLoad } = req.body as { duration?: number; dbLoad?: number };
        if (duration !== undefined && (typeof duration !== 'number' || duration < 0 || !Number.isFinite(duration))) {
            return res.status(400).json({ ok: false, message: 'duration must be a non-negative number or null' });
        }
        if (dbLoad !== undefined && (typeof dbLoad !== 'number' || dbLoad < 0 || dbLoad > 1)) {
            return res.status(400).json({ ok: false, message: 'dbLoad must be a number between 0 and 1' });
        }
        const result = await runZstdMaintenance(db, duration, dbLoad);
        res.json(result);
    });

    app.get('/maintenance_config', async (req: Request, res: Response) => {
        const config = await getMaintenanceConfig(db);
        res.json(config);
    });

    app.post('/maintenance_config', async (req: Request, res: Response) => {
        const { duration, dbLoad, mode, interval, walEnabled } = req.body as { duration?: number; dbLoad?: number; mode?: string; interval?: number; walEnabled?: boolean };
        const prevConfig = await getMaintenanceConfig(db);
        const result = await saveMaintenanceConfig(db, { duration, dbLoad, mode, interval, walEnabled });

        if (result.ok) {
            if (walEnabled !== undefined && walEnabled !== prevConfig.walEnabled) {
                await configureWAL(db, walEnabled);
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

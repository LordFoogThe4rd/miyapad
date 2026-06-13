import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import minimist from 'minimist';
import open from 'open';
import { fileURLToPath } from 'url';

import { initDatabase, getMaintenanceConfig, runZstdMaintenance, clearMaintenanceScheduler } from './lib/database.js';
import { createAuthMiddleware } from './lib/auth.js';
import { startAutoBackup, stopAutoBackup } from './lib/backup.js';
import systemRoutes from './routes/system.js';
import dataRoutes from './routes/data.js';
import proxyRoutes from './routes/proxy.js';
import zstdRoutes from './routes/zstd.js';
import tokenizerRoutes from './routes/tokenizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = minimist(process.argv.slice(2)) as Record<string, any>;
const port = args.port || process.env.MIYAPAD_PORT || 3000;
const host = args.host || process.env.MIYAPAD_HOST || '0.0.0.0';
const noOpen = (args.open !== undefined && !args.open) || process.env.MIYAPAD_NO_OPEN;
const login = args.login || process.env.MIYAPAD_LOGIN || 'anon';
const password = args.password || process.env.MIYAPAD_PASSWORD || undefined;
const storagePath = args.storagePath || process.env.MIYAPAD_STORAGE_PATH || './web-session-storage.db';

const parseEnvBool = (val: string | undefined | null) => val && val !== 'false' && val !== '0';

const noBackup = (args.noBackup !== undefined && args.noBackup)
    || (process.env.MIYAPAD_NO_BACKUP && parseEnvBool(process.env.MIYAPAD_NO_BACKUP));

const rawInterval = args.backupInterval !== undefined
    ? args.backupInterval
    : process.env.MIYAPAD_BACKUP_INTERVAL;
const backupInterval = rawInterval !== undefined ? parseInt(rawInterval, 10) : 30;

const backupDir = args.backupDir || process.env.MIYAPAD_BACKUP_DIR || './backups';

const rawKeep = args.backupKeep !== undefined
    ? args.backupKeep
    : process.env.MIYAPAD_BACKUP_KEEP;
const backupKeep = rawKeep !== undefined ? parseInt(rawKeep, 10) : 10;

const app = express();

app.use(cors(), bodyParser.json({limit: "100mb"}));

app.use(createAuthMiddleware(login, password));

app.use(express.static(path.join(__dirname, '..', 'dist')));

initDatabase(storagePath).then((db) => {
    systemRoutes(app, db);
    dataRoutes(app, db);
    proxyRoutes(app);
    zstdRoutes(app, db);
    tokenizerRoutes(app, db);

    if (!noBackup) {
        startAutoBackup(db, path.resolve(storagePath), {
            interval: backupInterval,
            dir: backupDir,
            keep: backupKeep
        });
    }

    app.listen(port, host, () => {
        console.log(`Server listening at http://${host}:${port}`);
        if (!noOpen) {
            open(`http://127.0.0.1:${port}/`);
        }
    });

    let shuttingDown = false;
    process.on('SIGINT', async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        stopAutoBackup();
        clearMaintenanceScheduler();
        const maintConfig = await getMaintenanceConfig(db);
        if (maintConfig.mode === 'shutdown') {
            await runZstdMaintenance(db, maintConfig.duration, maintConfig.dbLoad);
        }
        db.close(() => {
            process.exit(0);
        });
    });
}).catch((err: Error) => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
});

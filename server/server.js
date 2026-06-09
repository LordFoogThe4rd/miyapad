const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const minimist = require('minimist');
const open = require('open');

const { initDatabase, getMaintenanceConfig, runZstdMaintenance, clearMaintenanceScheduler } = require('./lib/database');
const { createAuthMiddleware } = require('./lib/auth');
const { startAutoBackup, stopAutoBackup } = require('./lib/backup');

const args = minimist(process.argv.slice(2));
const port = args.port || process.env.MIYAPAD_PORT || 3000;
const host = args.host || process.env.MIYAPAD_HOST || '0.0.0.0';
const noOpen = (args.open !== undefined && !args.open) || process.env.MIYAPAD_NO_OPEN;
const login = args.login || process.env.MIYAPAD_LOGIN || 'anon';
const password = args.password || process.env.MIYAPAD_PASSWORD || undefined;
const storagePath = args.storagePath || process.env.MIYAPAD_STORAGE_PATH || './web-session-storage.db';

const parseEnvBool = (val) => val && val !== 'false' && val !== '0';

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
    require('./routes/system')(app, db);
    require('./routes/data')(app, db);
    require('./routes/proxy')(app);
    require('./routes/zstd')(app, db);
    require('./routes/tokenizer')(app, db);

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
}).catch((err) => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
});

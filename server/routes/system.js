const path = require('path');
const { getColumnName, normalizeStoreName } = require('../lib/utils');
const tokenizer = require('../tokenizer');
const { runZstdMaintenance, configureWAL, getMaintenanceConfig, saveMaintenanceConfig, clearMaintenanceScheduler, scheduleZstdMaintenance } = require('../lib/database');

const SERVER_VERSION = 4;

module.exports = function(app, db) {
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', '..', 'dist', 'miyapad.html'));
    });

    app.get('/version', (req, res) => {
        res.json({
            version: SERVER_VERSION,
            features: { zstd_compression: true, server_tokenizer: true },
            tokenizers: tokenizer.getAvailableTokenizers()
        });
    });

    app.get('/vacuum', (req, res) => {
        db.run('VACUUM', (err) => {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error running VACUUM: ' + err.message });
            } else {
                res.json({ ok: true, message: 'VACUUM completed successfully' });
            }
        });
    });

    app.post('/zstd_maintenance', async (req, res) => {
        const { duration, dbLoad } = req.body;
        if (duration !== undefined && (typeof duration !== 'number' || duration < 0 || !Number.isFinite(duration))) {
            return res.status(400).json({ ok: false, message: 'duration must be a non-negative number or null' });
        }
        if (dbLoad !== undefined && (typeof dbLoad !== 'number' || dbLoad < 0 || dbLoad > 1)) {
            return res.status(400).json({ ok: false, message: 'dbLoad must be a number between 0 and 1' });
        }
        const result = await runZstdMaintenance(db, duration, dbLoad);
        res.json(result);
    });

    app.get('/maintenance_config', async (req, res) => {
        const config = await getMaintenanceConfig(db);
        res.json(config);
    });

    app.post('/maintenance_config', async (req, res) => {
        const { duration, dbLoad, mode, interval, walEnabled } = req.body;
        const prevConfig = await getMaintenanceConfig(db);
        const result = await saveMaintenanceConfig(db, { duration, dbLoad, mode, interval, walEnabled });

        if (result.ok) {
            if (walEnabled !== undefined && walEnabled !== prevConfig.walEnabled) {
                await configureWAL(db, walEnabled);
            }
            clearMaintenanceScheduler();
            scheduleZstdMaintenance(db, result.config);
        }

        res.json(result);
    });

    app.post('/log', (req, res) => {
        console.log('[CLIENT LOG]', req.body);
        res.json({ ok: true });
    });
};

const { getColumnName } = require('../lib/utils');

module.exports = function(app, db) {
    app.get('/zstd_get_configs', (req, res) => {
        db.all('SELECT id, config FROM _zstd_configs', [], (err, rows) => {
            if (err) {
                return res.status(500).json({ ok: false, message: 'Error querying zstd configs: ' + err.message });
            }
            const configs = {};
            rows.forEach((row) => {
                try {
                    configs[row.id] = JSON.parse(row.config);
                } catch (_) {
                    configs[row.id] = row.config;
                }
            });
            res.json({ ok: true, configs });
        });
    });

    app.post('/zstd_enable_transparent', (req, res) => {
        const { table, column, compression_level, train_dict_samples_ratio } = req.body;
        const config = JSON.stringify({
            table: table || 'sessions',
            column: column || getColumnName(table || 'sessions'),
            compression_level: compression_level || 3,
            dict_chooser: "'a'",
            ...(train_dict_samples_ratio ? { train_dict_samples_ratio } : {})
        });
        db.run('SELECT zstd_enable_transparent(?)', [config], (err) => {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error enabling transparent compression: ' + err.message });
            } else {
                res.json({ ok: true, message: 'Transparent compression enabled' });
            }
        });
    });

    app.post('/zstd_update_transparent', (req, res) => {
        const { compression_level, train_dict_samples_ratio } = req.body;
        const patch = {};
        if (compression_level !== undefined) patch.compression_level = compression_level;
        if (train_dict_samples_ratio !== undefined) patch.train_dict_samples_ratio = train_dict_samples_ratio;
        db.run('UPDATE _zstd_configs SET config = json_patch(config, ?)', [JSON.stringify(patch)], function(err) {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error updating compression config: ' + err.message });
            } else {
                res.json({ ok: true, message: 'Compression config updated', changes: this.changes });
            }
        });
    });

    app.post('/zstd_incremental_maintenance', (req, res) => {
        const { duration, db_load } = req.body;
        const durationArg = duration !== undefined && duration !== null ? duration : 'null';
        const dbLoadArg = db_load !== undefined ? db_load : 1.0;
        db.run(`SELECT zstd_incremental_maintenance(${durationArg}, ${dbLoadArg})`, (err) => {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error running maintenance: ' + err.message });
            } else {
                res.json({ ok: true, message: 'Maintenance completed' });
            }
        });
    });
};

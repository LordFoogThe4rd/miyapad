const path = require('path');
const { getColumnName, normalizeStoreName } = require('../lib/utils');
const tokenizer = require('../tokenizer');

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

    app.post('/log', (req, res) => {
        console.log('[CLIENT LOG]', req.body);
        res.json({ ok: true });
    });
};

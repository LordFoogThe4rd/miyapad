const tokenizer = require('../tokenizer');

module.exports = function(app, db) {
    app.get('/api/v1/tokenizers', (req, res) => {
        try {
            const available = tokenizer.getAvailableTokenizers();
            res.json({ ok: true, tokenizers: available, loaded: tokenizer.getLoadedModel() });
        } catch (e) {
            res.status(500).json({ ok: false, message: e.message });
        }
    });

    app.post('/api/v1/tokenizer/load', async (req, res) => {
        const { model } = req.body;
        if (!model) {
            return res.status(400).json({ ok: false, message: 'Missing model parameter' });
        }
        try {
            await tokenizer.loadTokenizer(model);
            db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('tokenizer_model', ?)`, [model]);
            res.json({ ok: true, model });
        } catch (e) {
            res.status(500).json({ ok: false, message: e.message });
        }
    });

    app.post('/api/v1/token-count', async (req, res) => {
        const { content } = req.body;
        if (content === undefined || content === null) {
            return res.status(400).json({ ok: false, message: 'Missing content parameter' });
        }
        if (!tokenizer.isLoaded()) {
            return res.json({ ok: true, count: 0, error: 'No tokenizer loaded' });
        }
        try {
            const count = await tokenizer.tokenCount(content);
            res.json({ ok: true, count });
        } catch (e) {
            res.status(500).json({ ok: false, message: e.message });
        }
    });

    app.post('/api/v1/tokenize', async (req, res) => {
        const { content } = req.body;
        if (content === undefined || content === null) {
            return res.status(400).json({ ok: false, message: 'Missing content parameter' });
        }
        if (!tokenizer.isLoaded()) {
            return res.json({ ok: true, ids: [], strings: [], error: 'No tokenizer loaded' });
        }
        try {
            const { ids, tokens } = await tokenizer.tokenize(content);
            res.json({ ok: true, ids, strings: tokens });
        } catch (e) {
            res.status(500).json({ ok: false, message: e.message });
        }
    });

    app.post('/api/v1/detokenize', async (req, res) => {
        const { tokens: tokenIds } = req.body;
        if (!tokenIds || !Array.isArray(tokenIds) || tokenIds.length === 0) {
            return res.status(400).json({ ok: false, message: 'Missing or invalid tokens parameter' });
        }
        if (!tokenizer.isLoaded()) {
            return res.json({ ok: true, content: '', error: 'No tokenizer loaded' });
        }
        try {
            const content = await tokenizer.detokenize(tokenIds);
            res.json({ ok: true, content });
        } catch (e) {
            res.status(500).json({ ok: false, message: e.message });
        }
    });
};

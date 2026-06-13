import type { Express, Request, Response } from 'express';
import type { Database } from 'sqlite3';
import * as tokenizer from '../tokenizer.js';

export default function(app: Express, db: Database): void {
    app.get('/api/v1/tokenizers', (req: Request, res: Response) => {
        try {
            const available = tokenizer.getAvailableTokenizers();
            res.json({ ok: true, tokenizers: available, loaded: tokenizer.getLoadedModel() });
        } catch (e) {
            res.status(500).json({ ok: false, message: (e as Error).message });
        }
    });

    app.post('/api/v1/tokenizer/load', async (req: Request, res: Response) => {
        const { model } = req.body as { model: string };
        if (typeof model !== 'string' || !model) {
            return res.status(400).json({ ok: false, message: 'Missing or invalid model parameter' });
        }
        try {
            await tokenizer.loadTokenizer(model);
            db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('tokenizer_model', ?)`, [model]);
            res.json({ ok: true, model });
        } catch (e) {
            res.status(500).json({ ok: false, message: (e as Error).message });
        }
    });

    app.post('/api/v1/token-count', async (req: Request, res: Response) => {
        const { content } = req.body as { content: string };
        if (typeof content !== 'string') {
            return res.status(400).json({ ok: false, message: 'Missing or invalid content parameter' });
        }
        if (!tokenizer.isLoaded()) {
            return res.json({ ok: true, count: 0, error: 'No tokenizer loaded' });
        }
        try {
            const count = await tokenizer.tokenCount(content);
            res.json({ ok: true, count });
        } catch (e) {
            res.status(500).json({ ok: false, message: (e as Error).message });
        }
    });

    app.post('/api/v1/tokenize', async (req: Request, res: Response) => {
        const { content } = req.body as { content: string };
        if (typeof content !== 'string') {
            return res.status(400).json({ ok: false, message: 'Missing or invalid content parameter' });
        }
        if (!tokenizer.isLoaded()) {
            return res.json({ ok: true, ids: [], strings: [], error: 'No tokenizer loaded' });
        }
        try {
            const { ids, tokens } = await tokenizer.tokenize(content);
            res.json({ ok: true, ids, strings: tokens });
        } catch (e) {
            res.status(500).json({ ok: false, message: (e as Error).message });
        }
    });

    app.post('/api/v1/detokenize', async (req: Request, res: Response) => {
        const { tokens: tokenIds } = req.body as { tokens: number[] };
        if (!Array.isArray(tokenIds) || tokenIds.length === 0 || tokenIds.some(t => typeof t !== 'number')) {
            return res.status(400).json({ ok: false, message: 'Missing or invalid tokens parameter' });
        }
        if (!tokenizer.isLoaded()) {
            return res.json({ ok: true, content: '', error: 'No tokenizer loaded' });
        }
        try {
            const content = await tokenizer.detokenize(tokenIds);
            res.json({ ok: true, content });
        } catch (e) {
            res.status(500).json({ ok: false, message: (e as Error).message });
        }
    });
};

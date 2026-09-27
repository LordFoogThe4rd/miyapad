// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import tokenizerRoutes from './tokenizer.js';
import { serve, postJson, type Served } from '../lib/testing.js';

// The tokenizer module itself is covered in tokenizer.test.ts; stubbing it here reaches the routes' error paths.
const tokenizer = vi.hoisted(() => ({
    getAvailableTokenizers: vi.fn(() => ['tiny']),
    getLoadedModel: vi.fn((): string | null => 'tiny'),
    loadTokenizer: vi.fn(async (model: string) => {}),
    isLoaded: vi.fn(() => true),
    tokenCount: vi.fn((content: string) => 2),
    tokenize: vi.fn((content: string) => ({ ids: [1, 2], tokens: ['hello', 'world'] })),
    detokenize: vi.fn((ids: number[]) => 'hello world'),
}));
vi.mock('../tokenizer.js', () => tokenizer);

let db: Database.Database;
let server: Served;

beforeEach(async () => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
    server = await serve(app => tokenizerRoutes(app, db));
});

afterEach(async () => {
    await server.close();
    db.close();
    vi.clearAllMocks();
});

const post = (route: string, body: unknown) => postJson(server.url + '/api/v1' + route, body);
const savedModel = () => db.prepare("SELECT value FROM meta WHERE key = 'tokenizer_model'").pluck().get();
const fail = () => { throw new Error('boom'); };

describe('GET /api/v1/tokenizers', () => {
    it('lists the tokenizers and the loaded one', async () => {
        const res = await fetch(server.url + '/api/v1/tokenizers');
        expect(await res.json()).toEqual({ ok: true, tokenizers: ['tiny'], loaded: 'tiny' });
    });

    it('answers 500 when the folder cannot be read', async () => {
        tokenizer.getAvailableTokenizers.mockImplementationOnce(fail);
        const res = await fetch(server.url + '/api/v1/tokenizers');
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ ok: false, message: 'boom' });
    });
});

describe('/tokenizer/load', () => {
    it('loads a model and remembers it for the next start', async () => {
        expect((await post('/tokenizer/load', { model: 'tiny' })).body).toEqual({ ok: true, model: 'tiny' });
        expect(tokenizer.loadTokenizer).toHaveBeenCalledWith('tiny');
        expect(savedModel()).toBe('tiny');
        await post('/tokenizer/load', { model: 'other' });
        expect(savedModel()).toBe('other');
    });

    it('refuses a missing or non-string model with 400', async () => {
        for (const body of [{}, { model: '' }, { model: 5 }]) {
            expect((await post('/tokenizer/load', body)).status).toBe(400);
        }
        expect(tokenizer.loadTokenizer).not.toHaveBeenCalled();
    });

    it('answers 500 and remembers nothing when loading fails', async () => {
        tokenizer.loadTokenizer.mockRejectedValueOnce(new Error('Tokenizer model "nope" not found'));
        const res = await post('/tokenizer/load', { model: 'nope' });
        expect(res).toEqual({ status: 500, body: { ok: false, message: 'Tokenizer model "nope" not found' } });
        expect(savedModel()).toBeUndefined();
    });
});

describe('/token-count, /tokenize and /detokenize', () => {
    it('answer with the tokenizer\'s results', async () => {
        expect((await post('/token-count', { content: 'hello world' })).body).toEqual({ ok: true, count: 2 });
        expect((await post('/tokenize', { content: 'hello world' })).body).toEqual({ ok: true, ids: [1, 2], strings: ['hello', 'world'] });
        expect((await post('/detokenize', { tokens: [1, 2] })).body).toEqual({ ok: true, content: 'hello world' });
        expect(tokenizer.detokenize).toHaveBeenCalledWith([1, 2]);
    });

    it('answer with an empty result and a note when no tokenizer is loaded', async () => {
        tokenizer.isLoaded.mockReturnValue(false);
        const error = 'No tokenizer loaded';
        expect((await post('/token-count', { content: 'hi' })).body).toEqual({ ok: true, count: 0, error });
        expect((await post('/tokenize', { content: 'hi' })).body).toEqual({ ok: true, ids: [], strings: [], error });
        expect((await post('/detokenize', { tokens: [1] })).body).toEqual({ ok: true, content: '', error });
        tokenizer.isLoaded.mockReturnValue(true);
    });

    it('refuse bad input with 400', async () => {
        for (const body of [{}, { content: 5 }]) {
            expect((await post('/token-count', body)).status).toBe(400);
            expect((await post('/tokenize', body)).status).toBe(400);
        }
        for (const body of [{}, { tokens: [] }, { tokens: 'hi' }, { tokens: [1, '2'] }]) {
            expect((await post('/detokenize', body)).status).toBe(400);
        }
    });

    it('answer 500 when the tokenizer throws', async () => {
        tokenizer.tokenCount.mockImplementationOnce(fail);
        tokenizer.tokenize.mockImplementationOnce(fail);
        tokenizer.detokenize.mockImplementationOnce(fail);
        expect(await post('/token-count', { content: 'hi' })).toEqual({ status: 500, body: { ok: false, message: 'boom' } });
        expect(await post('/tokenize', { content: 'hi' })).toEqual({ status: 500, body: { ok: false, message: 'boom' } });
        expect(await post('/detokenize', { tokens: [1] })).toEqual({ status: 500, body: { ok: false, message: 'boom' } });
    });
});

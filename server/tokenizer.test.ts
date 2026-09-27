// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A word-level vocabulary is enough to exercise loading, encoding and decoding.
const tinyTokenizer = {
    version: '1.0',
    added_tokens: [],
    normalizer: null,
    pre_tokenizer: { type: 'Whitespace' },
    post_processor: null,
    decoder: null,
    model: { type: 'WordLevel', vocab: { '[UNK]': 0, hello: 1, world: 2 }, unk_token: '[UNK]' },
};

let dir: string;
let tokenizer: typeof import('./tokenizer.js');

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyapad-tokenizer-'));
    const tokenizers = path.join(dir, 'tokenizers');
    fs.mkdirSync(path.join(tokenizers, 'tiny'), { recursive: true });
    fs.writeFileSync(path.join(tokenizers, 'tiny', 'tokenizer.json'), JSON.stringify(tinyTokenizer));
    fs.mkdirSync(path.join(tokenizers, 'empty'));
    fs.writeFileSync(path.join(tokenizers, 'stray.json'), '{}');
    fs.mkdirSync(path.join(dir, 'outside'));
    fs.writeFileSync(path.join(dir, 'outside', 'tokenizer.json'), JSON.stringify(tinyTokenizer));

    // The module picks its folder when imported, trying `tokenizers` next to the Node binary first,
    // as in a release archive. Point that at the temp folder for the import only.
    const execPath = process.execPath;
    process.execPath = path.join(dir, 'node');
    try {
        tokenizer = await import('./tokenizer.js');
    } finally {
        process.execPath = execPath;
    }
});

afterEach(() => tokenizer.unload());

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('getAvailableTokenizers', () => {
    it('lists the folders that hold a tokenizer.json', () => {
        expect(tokenizer.getAvailableTokenizers()).toEqual(['tiny']);
    });
});

describe('before anything is loaded', () => {
    it('reports nothing loaded and refuses to tokenize', () => {
        expect(tokenizer.isLoaded()).toBe(false);
        expect(tokenizer.getLoadedModel()).toBeNull();
        expect(() => tokenizer.tokenCount('hello')).toThrow('No tokenizer loaded');
        expect(() => tokenizer.tokenize('hello')).toThrow('No tokenizer loaded');
        expect(() => tokenizer.detokenize([1])).toThrow('No tokenizer loaded');
    });
});

describe('loadTokenizer', () => {
    it('loads a model that counts, tokenizes and detokenizes', async () => {
        await tokenizer.loadTokenizer('tiny');
        expect(tokenizer.isLoaded()).toBe(true);
        expect(tokenizer.getLoadedModel()).toBe('tiny');
        expect(tokenizer.tokenCount('hello world hello')).toBe(3);
        expect(tokenizer.tokenize('hello world')).toEqual({ ids: [1, 2], tokens: ['hello', 'world'] });
        expect(tokenizer.detokenize([2, 1])).toBe('world hello');
    });

    it('forgets the model on unload', async () => {
        await tokenizer.loadTokenizer('tiny');
        tokenizer.unload();
        expect(tokenizer.isLoaded()).toBe(false);
        expect(tokenizer.getLoadedModel()).toBeNull();
    });

    it('refuses a name that points outside the tokenizers folder', async () => {
        for (const model of ['.', '..', '../outside', path.join(dir, 'outside')]) {
            await expect(tokenizer.loadTokenizer(model)).rejects.toThrow('Invalid tokenizer model path');
        }
    });

    it('refuses a model that is missing or has no tokenizer.json', async () => {
        await expect(tokenizer.loadTokenizer('nope')).rejects.toThrow('Tokenizer model "nope" not found');
        await expect(tokenizer.loadTokenizer('empty')).rejects.toThrow('tokenizer.json not found for model "empty"');
    });

    it('keeps the loaded model when loading another one fails', async () => {
        await tokenizer.loadTokenizer('tiny');
        await expect(tokenizer.loadTokenizer('empty')).rejects.toThrow();
        expect(tokenizer.getLoadedModel()).toBe('tiny');
        expect(tokenizer.tokenCount('hello')).toBe(1);
    });
});

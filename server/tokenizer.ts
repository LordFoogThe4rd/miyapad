import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Tokenizer } from '@huggingface/tokenizers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let TokenizerClass: typeof Tokenizer | null = null;
let loadedTokenizer: Tokenizer | null = null;
let loadedModel: string | null = null;

const TOKENIZERS_DIR = path.join(__dirname, 'tokenizers');

function getAvailableTokenizers(): string[] {
	if (!fs.existsSync(TOKENIZERS_DIR)) {
		fs.mkdirSync(TOKENIZERS_DIR, { recursive: true });
		return [];
	}
	return fs.readdirSync(TOKENIZERS_DIR, { withFileTypes: true })
		.filter(dirent => dirent.isDirectory())
		.filter(dir => fs.existsSync(path.join(TOKENIZERS_DIR, dir.name, 'tokenizer.json')))
		.map(dir => dir.name);
}

async function ensureTokenizerModule() {
	if (!TokenizerClass) {
		const mod = await import('@huggingface/tokenizers');
		TokenizerClass = mod.Tokenizer;
	}
}

async function loadTokenizer(model: string) {
	await ensureTokenizerModule();

	const modelDir = path.resolve(TOKENIZERS_DIR, model);
	if (!modelDir.startsWith(TOKENIZERS_DIR + path.sep)) {
		throw new Error(`Invalid tokenizer model path`);
	}
	if (!fs.existsSync(modelDir)) {
		throw new Error(`Tokenizer model "${model}" not found in ${TOKENIZERS_DIR}`);
	}

	const tokenizerJsonPath = path.join(modelDir, 'tokenizer.json');
	if (!fs.existsSync(tokenizerJsonPath)) {
		throw new Error(`tokenizer.json not found for model "${model}"`);
	}

	const tokenizerJson = JSON.parse(fs.readFileSync(tokenizerJsonPath, 'utf-8'));

	loadedTokenizer = new TokenizerClass(tokenizerJson, {});
	loadedModel = model;
}

function isLoaded(): boolean {
	return loadedTokenizer !== null;
}

function getLoadedModel(): string | null {
	return loadedModel;
}

function tokenCount(content: string): number {
	if (!loadedTokenizer) {
		throw new Error('No tokenizer loaded');
	}
	const encoded = loadedTokenizer.encode(content);
	return encoded.ids.length;
}

function tokenize(content: string): { ids: number[]; tokens: string[] } {
	if (!loadedTokenizer) {
		throw new Error('No tokenizer loaded');
	}
	const tokens = loadedTokenizer.tokenize(content);
	const encoded = loadedTokenizer.encode(content);
	return { ids: encoded.ids, tokens };
}

function detokenize(tokenIds: number[]): string {
	if (!loadedTokenizer) {
		throw new Error('No tokenizer loaded');
	}
	return loadedTokenizer.decode(tokenIds);
}

function unload() {
	loadedTokenizer = null;
	loadedModel = null;
}

export {
	getAvailableTokenizers,
	loadTokenizer,
	isLoaded,
	getLoadedModel,
	tokenCount,
	tokenize,
	detokenize,
	unload,
};

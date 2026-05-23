const path = require('path');
const fs = require('fs');

let TokenizerClass;
let loadedTokenizer = null;
let loadedModel = null;

const TOKENIZERS_DIR = path.join(__dirname, 'tokenizers');

function getAvailableTokenizers() {
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

async function loadTokenizer(model) {
	await ensureTokenizerModule();

	const modelDir = path.join(TOKENIZERS_DIR, model);
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

function isLoaded() {
	return loadedTokenizer !== null;
}

function getLoadedModel() {
	return loadedModel;
}

function tokenCount(content) {
	if (!loadedTokenizer) {
		throw new Error('No tokenizer loaded');
	}
	const encoded = loadedTokenizer.encode(content);
	return encoded.ids.length;
}

function tokenize(content) {
	if (!loadedTokenizer) {
		throw new Error('No tokenizer loaded');
	}
	const tokens = loadedTokenizer.tokenize(content);
	const encoded = loadedTokenizer.encode(content);
	return { ids: encoded.ids, tokens };
}

function detokenize(tokenIds) {
	if (!loadedTokenizer) {
		throw new Error('No tokenizer loaded');
	}
	return loadedTokenizer.decode(tokenIds);
}

function unload() {
	loadedTokenizer = null;
	loadedModel = null;
}

module.exports = {
	getAvailableTokenizers,
	loadTokenizer,
	isLoaded,
	getLoadedModel,
	tokenCount,
	tokenize,
	detokenize,
	unload,
};

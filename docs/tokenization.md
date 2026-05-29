# Server-Side Tokenization

Miyapad supports an optional server-side tokenization engine using HuggingFace tokenizers via the `@huggingface/tokenizers` npm package. When enabled, all token counting, tokenization, and detokenization operations are delegated to the backend server instead of using client-side estimators.

## Key Files

- `server/tokenizer.js` — Core module: scans `server/tokenizers/` for subdirectories containing `tokenizer.json`, loads a HuggingFace `Tokenizer` from the JSON definition, provides `tokenCount()`, `tokenize()`, and `detokenize()` methods.
- `server/routes/tokenizer.js` — Serves API endpoints and reports `server_tokenizer: true` in the `/version` response.
- `src/api/index.js` — Client API functions: `serverTokenCount()`, `serverTokenize()`, `serverDetokenize()`, `getServerTokenizers()`, `loadServerTokenizer()`.
- `src/components/modals/PreferencesModal.js` — UI: checkbox to enable/disable ("Use server-side tokenization") and a dropdown to select which tokenizer model to load, with a refresh button and status display.

## Architecture

```
User clicks "Use server-side tokenization"
  → PreferencesModal toggles useServerTokenization flag
  → GET /api/v1/tokenizers returns { tokenizers: [...], loaded: "..." }
  → User picks a model from the dropdown
  → POST /api/v1/tokenizer/load { model } loads the tokenizer on the server
  → useTokenCounters, useGenerationLogic, AppLayout, LogitBiasModal
    check useServerTokenization && isMiyapadEndpoint
    → POST /api/v1/token-count | /api/v1/tokenize | /api/v1/detokenize
```

## Adding New Tokenizers

Drop a directory containing `tokenizer.json` into `server/tokenizers/<model name>/`. The server scans for subdirectories with `tokenizer.json` on every GET `/api/v1/tokenizers` call — no restart needed if the directory already existed before the first call (the scan is dynamic, but newly added files are picked up on the next request).

## Tokenizer Licenses

Each tokenizer directory should include a `LICENSE` file for the redistributed tokenizer. The project is AGPL-3.0, but permissively-licensed tokenizers (MIT, Apache 2.0) can be bundled — just ensure their license notice is included.

## Server Dependency

`@huggingface/tokenizers` must be installed (`npm install` in `server/`), otherwise tokenizer operations will throw a module-load error. The `tokenizer.js` module uses dynamic `import()` to lazily load the package.

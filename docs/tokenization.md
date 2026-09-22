# Server-Side Tokenization

The backend can tokenize with HuggingFace tokenizers through the `@huggingface/tokenizers` package. Turn it on and the server handles token counting, tokenizing and detokenizing, which the client-side estimators would otherwise do. It's optional. Without it, the frontend falls back to its own estimates.

## Key Files

- `server/tokenizer.ts` is the core module. It scans `server/tokenizers/` for subdirectories holding a `tokenizer.json`, builds a HuggingFace `Tokenizer` from that file, and exposes `tokenCount()`, `tokenize()` and `detokenize()`.
- `server/routes/tokenizer.ts` has the API endpoints, and adds `server_tokenizer: true` to the `/version` response.
- `src/api/index.ts` is the client side: `serverTokenCount()`, `serverTokenize()`, `serverDetokenize()`, `getServerTokenizers()`, `loadServerTokenizer()`.
- `src/components/modals/PreferencesModal.tsx` has the UI: a "Use server-side tokenization" checkbox, a dropdown of available models, a refresh button and a status line.

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

Drop a directory containing `tokenizer.json` into `server/tokenizers/<model name>/`. Every `GET /api/v1/tokenizers` re-reads that directory, so a tokenizer you add while the server is running shows up the next time the list is fetched. You never need to restart the server. If `server/tokenizers/` doesn't exist yet, the server creates it on the first call.

## Tokenizer Licenses

Each tokenizer directory should carry a `LICENSE` file for the tokenizer it redistributes. Miyapad is AGPL-3.0, so permissively licensed tokenizers (MIT, Apache 2.0) can be bundled as long as their license notice travels with them.

## Server Dependency

`@huggingface/tokenizers` has to be installed (`npm install` in `server/`), or tokenizer calls fail with a module-load error. `tokenizer.ts` pulls it in with a dynamic `import()`, so nothing loads until you use the feature.

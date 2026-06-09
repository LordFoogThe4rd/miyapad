# Server REST API Endpoints

| Route | Method | Description |
| :--- | :--- | :--- |
| `/version` | GET | Returns backend API version (`4`) and features. |
| `/vacuum` | GET | Runs a full SQLite `VACUUM` to compact database storage. |
| `/zstd_maintenance` | POST | Runs `SELECT zstd_incremental_maintenance(duration, db_load)` with optional `duration` (sec, ≥0 or null) and `dbLoad` (0.0–1.0) from body. Validates both before passing to SQLite. Manually triggers zstd dictionary maintenance. |
| `/maintenance_config` | GET | Returns the current scheduler/WAL configuration `{ duration, dbLoad, mode, interval, walEnabled }`. |
| `/maintenance_config` | POST | Saves scheduler/WAL configuration, applies WAL mode change only when `walEnabled` differs from the previous setting, and re-schedules the interval-based zstd maintenance. |
| `/load` | POST | Loads record contents for a store name and key. |
| `/save` | POST | Saves or updates record contents for a store name and key. |
| `/rename` | POST | Updates a session's entry in the `names` table (merges the new name and updated `modified` timestamp). |
| `/delete` | POST | Deletes a record from its store table (and deletes name index if session). |
| `/all` | POST | Fetches all rows from the specified table. |
| `/sessions` | POST | Fetches all session key-to-metadata pairs from the `names` table. |
| `/proxy` | POST/GET/DELETE | Proxies LLM API request directly to the URL in the `X-Real-URL` header. Used when the frontend determines the user's endpoint already includes a full API path. |
| `/proxy/*` | POST/GET/DELETE | Appends the wildcard path to the `X-Real-URL` base URL. Used when the frontend fills in a standard API path (e.g., `/v1/completions`). Both routes bypass CORS and support token streaming. |
| `/zstd_get_configs` | GET | Queries active `sqlite-zstd` table configs. |
| `/zstd_enable_transparent`| POST | Enables transparent compression on a table. |
| `/zstd_update_transparent`| POST | Modifies compression configuration parameters. |
| `/zstd_incremental_maintenance`| POST | Manually kicks off zstd incremental maintenance. |
| `/api/v1/tokenizers` | GET | Lists available tokenizer models in `server/tokenizers/` and reports which one is loaded. |
| `/api/v1/tokenizer/load` | POST | Loads a tokenizer model by name from `server/tokenizers/<model>/tokenizer.json`. |
| `/api/v1/token-count` | POST | Returns token count for a given string using the loaded tokenizer. |
| `/api/v1/tokenize` | POST | Tokenizes content into token IDs and strings. |
| `/api/v1/detokenize` | POST | Decodes token IDs back into a string. |

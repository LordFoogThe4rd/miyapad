# Server REST API Endpoints

| Route | Method | Description |
| :--- | :--- | :--- |
| `/version` | GET | Returns the backend API version (`4`), features, available tokenizers, and update info (`latestVersion`, `downloadUrl`) from a cached check of the latest GitHub release. |
| `/vacuum` | GET | Runs a full SQLite `VACUUM` to compact the database. |
| `/zstd_maintenance` | POST | Starts zstd dictionary maintenance by hand. Runs `SELECT zstd_incremental_maintenance(duration, db_load)` with the optional `duration` (seconds, ≥0 or null) and `dbLoad` (0.0 to 1.0) from the body, after checking both. |
| `/maintenance_config` | GET | Returns the current scheduler and WAL config `{ duration, dbLoad, mode, interval, walEnabled }`. |
| `/maintenance_config` | POST | Saves the scheduler and WAL config, switches WAL mode only when `walEnabled` differs from the previous setting, and reschedules the interval-based zstd maintenance. |
| `/load` | POST | Loads a record's contents by store name and key. |
| `/save` | POST | Saves or updates a record's contents by store name and key. |
| `/rename` | POST | Updates a session's entry in the `names` table, merging in the new name and an updated `modified` timestamp. |
| `/delete` | POST | Deletes a record from its store table, and the session's `names` entry if it's a session. |
| `/all` | POST | Fetches every row from the given table. |
| `/sessions` | POST | Fetches every session's key and metadata from the `names` table. |
| `/proxy` | POST/GET/DELETE | Sends the LLM API request straight to the URL in the `X-Real-URL` header. Used when the frontend decides your endpoint already includes a full API path. |
| `/proxy/*` | POST/GET/DELETE | Appends the wildcard path to the `X-Real-URL` base URL. Used when the frontend fills in a standard API path (e.g. `/v1/completions`). Both proxy routes get around CORS and support token streaming. |
| `/zstd_get_configs` | GET | Lists the active `sqlite-zstd` table configs. |
| `/zstd_enable_transparent`| POST | Turns on transparent compression for a table. |
| `/zstd_update_transparent`| POST | Changes compression config parameters. |
| `/zstd_incremental_maintenance`| POST | Starts zstd incremental maintenance by hand. |
| `/api/v1/tokenizers` | GET | Lists the tokenizer models in `server/tokenizers/` and says which one is loaded. |
| `/api/v1/tokenizer/load` | POST | Loads a tokenizer model by name from `server/tokenizers/<model>/tokenizer.json`. |
| `/api/v1/token-count` | POST | Returns the token count of a string, using the loaded tokenizer. |
| `/api/v1/tokenize` | POST | Splits content into token IDs and strings. |
| `/api/v1/detokenize` | POST | Decodes token IDs back into a string. |

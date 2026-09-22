# Backend Server & Database

The server entrypoint is `server/server.ts`. It loads its modules from `lib/` and `routes/` and runs through `tsx`. Everything is stored in SQLite through better-sqlite3's synchronous API, and the precompiled `sqlite-zstd` extension compresses rows transparently with Zstandard.

Record keys are always bound as strings (`toKey` in `routes/data.ts`). better-sqlite3 binds JS numbers as REAL, so a numeric session id would otherwise be stored and looked up as `"81.0"` instead of `"81"`. The server's environment variables are typed in `server/types/env.d.ts`.

## Database Schema (v4)

Eight tables:

1. `meta`: metadata, including the database schema `version = 4`.
2. `sessions`: the session data blobs. Column `session_data`.
3. `templates`: template configuration data. Column `template_data`.
4. `themes`: custom user CSS themes. Column `theme_data`.
5. `connections`: connection presets (endpoint, API type, API key, model, per-API options). Column `connection_data`.
6. `samplerpresets`: sampler presets, meaning all generation parameters. Column `sampler_preset_data`.
7. `sessionhistory`: saved session versions and each session's version index. Column `history_data`. It's created on every start with `CREATE TABLE IF NOT EXISTS`, so adding it didn't need a schema version bump.
8. `names`: the lightweight key-to-metadata mapping `{name, created, modified, pinned, tags, folder, stats}`, stored as JSON. Used for listing, searching, sorting, pinning and folders.

### Schema Column Constraints

`sqlite-zstd` runs into index name collisions when several tables share a column name such as `data`. So every table gets its own, handed out by the server's `getColumnName(storeName)` helper in `lib/utils.ts`:

- `sessions` → `session_data`
- `templates` → `template_data`
- `themes` → `theme_data`
- `connections` → `connection_data`
- `samplerpresets` → `sampler_preset_data`
- `sessionhistory` → `history_data`

## Database Compaction & Compression Settings

- **Auto-Vacuum**: The database is created with `PRAGMA auto_vacuum = FULL`, the mode `sqlite-zstd` recommends. Deleted records give their pages straight back to the operating system instead of leaving the file bloated.
- **Scheduled zstd Maintenance**: A scheduler calls `SELECT zstd_incremental_maintenance(duration, db_load)` to train compression dictionaries and tidy up storage. It only runs with the config you set, stored in the `meta` table as `maintenance_config`:
  - **Duration** (seconds): how long one maintenance cycle runs, or `null` for no limit (until idle). Default `5`.
  - **DB Load** (0.0 to 1.0): the CPU load target for that call. Default `0.5`.
  - **Mode**: `interval` (periodic timer), `startup` (once when the server starts) or `shutdown` (once when it stops).
  - **Interval**: minutes between cycles in `interval` mode. Default `60`.
- **WAL Mode**: Optional, through the `walEnabled` config flag. On sets `PRAGMA journal_mode=WAL`, which handles concurrent reads better. Off sets `PRAGMA journal_mode=DELETE`. The mode is only switched when `walEnabled` differs from the previously saved setting.
- **Transparent Compression**: Set up through `zstd_enable_transparent(config)`.
- **Manual Maintenance**: `GET /vacuum` runs a full `VACUUM`. `POST /zstd_maintenance` runs zstd maintenance after checking that `duration ≥ 0` and that `dbLoad` is in `[0, 1]`. The scheduler config is read and written through `GET` and `POST /maintenance_config`.
- **Shutdown Guard**: On SIGINT, a `shuttingDown` flag stops a second SIGINT from starting shutdown maintenance while the first is still running.

## Server CLI Options & Environment Variables

- `--port` or `MIYAPAD_PORT`: port to bind (default: `3000`).
- `--host` or `MIYAPAD_HOST`: host to bind (default: `127.0.0.1`).
- `--login` / `--password`: login and password for HTTP Basic Auth. If a password is set, requests get the standard Basic Auth prompt.
- `--storagePath`: path to the SQLite file (default: `./web-session-storage.db`).
- `--open` / `MIYAPAD_NO_OPEN`: whether your default browser opens the UI when the server starts.
- `--noBackup` / `MIYAPAD_NO_BACKUP`: turns off automatic database backups.
- `--backupInterval` / `MIYAPAD_BACKUP_INTERVAL`: minutes between backups (default: `30`).
- `--backupDir` / `MIYAPAD_BACKUP_DIR`: directory for backup files (default: `./backups`).
- `--backupKeep` / `MIYAPAD_BACKUP_KEEP`: how many backups to keep (default: `10`).
- `MIYAPAD_7Z_PATH`: path to a 7-Zip executable to compress backups with, instead of the bundled one.

## Automatic Database Backups

The server can back up the database on a timer with SQLite's `VACUUM INTO`, which writes a clean, compacted copy without taking the database offline.

- A backup is skipped if the database file's mtime hasn't changed since the last one.
- Backup files are named `web-session-storage.db.<YYYYMMDDHHmmss>.backup.7z` and are LZMA-compressed 7-Zip archives. Any tool that reads `.7z` will open them (7-Zip, Ark and so on).
- The 7-Zip binary ships with the server in the `7zip-bin` package, so you don't need to install anything on the host. Set `MIYAPAD_7Z_PATH` to use a different executable, for example on a platform the bundled binary doesn't cover.
- Backups beyond the configured keep count are deleted.

# Backend Server & Database

The server (`server/server.js` — entrypoint that loads modules from `lib/` and `routes/`) uses **SQLite3** combined with the precompiled **`sqlite-zstd` extension** to perform transparent, row-level Zstandard compression on database records.

## Database Schema (v5)

The database has six main tables:

1. **`meta`**: Stores metadata (e.g., database schema `version = 5`).
2. **`sessions`**: Stores main session data blobs. Uses column `session_data`.
3. **`templates`**: Stores template configuration data. Uses column `template_data`.
4. **`themes`**: Stores custom user CSS themes. Uses column `theme_data`.
5. **`connections`**: Stores connection preset data (endpoint, API type, API key, model, per-API options). Uses column `connection_data`.
6. **`names`**: Stores lightweight key-to-metadata mapping `{name, created, modified, pinned}` (as JSON) for session listing, searching, sorting, and pinning.

### Schema Column Constraints

The `sqlite-zstd` extension can experience index naming collisions if multiple tables use identical column names (e.g., `data`). To avoid this, each table maps to a unique column name managed dynamically via the server's `getColumnName(storeName)` helper (in `lib/utils.js`):

- `sessions` table uses **`session_data`**
- `templates` table uses **`template_data`**
- `themes` table uses **`theme_data`**
- `connections` table uses **`connection_data`**

## Database Compaction & Compression Settings

- **Auto-Vacuum**: The database is initialized with `PRAGMA auto_vacuum = FULL`. Deleted records automatically release database pages back to the operating system, preventing storage inflation. (The `sqlite-zstd` extension recommends this mode.)
- **Scheduled zstd Maintenance**: An additional maintenance scheduler calls `SELECT zstd_incremental_maintenance(duration, db_load)` on a configurable schedule to train compression dictionaries and optimize storage. Controlled by config stored in the `meta` table (`maintenance_config`):
  - **Duration** (seconds): How long each maintenance cycle should run (`null` = unlimited / until idle). Default: `5`.
  - **DB Load** (0.0–1.0): CPU load target for the maintenance call. Default: `0.5`.
  - **Mode**: `interval` (periodic timer), `startup` (once on server start), or `shutdown` (once on server stop).
  - **Interval**: Minutes between cycles when mode is `interval` (default: `60`).
- **WAL Mode**: Optionally enabled via the `walEnabled` config flag. When on, `PRAGMA journal_mode=WAL` improves concurrent read performance. When off, `PRAGMA journal_mode=DELETE` is used. The mode switch is only applied when `walEnabled` differs from the previously saved setting.
- **Transparent Compression**: Managed via `zstd_enable_transparent(config)`.
- **Incremental Maintenance**: Periodic maintenance runs only according to the user's scheduler config (mode `interval`).
- **Manual Maintenance**: Full `VACUUM` can be triggered via `GET /vacuum`, zstd maintenance via `POST /zstd_maintenance` (validates `duration ≥ 0` and `dbLoad` in `[0, 1]`). Scheduler config can be read/written via `GET`/`POST /maintenance_config`.
- **Shutdown Guard**: On SIGINT, a `shuttingDown` flag prevents concurrent execution of shutdown maintenance if a second SIGINT is received before cleanup completes.

## Server CLI Options & Environment Variables

- `--port` or `MIYAPAD_PORT`: Port to bind (default: `3000`).
- `--host` or `MIYAPAD_HOST`: Host to bind (default: `0.0.0.0`).
- `--login` / `--password`: Basic authentication login/password. If password is set, prompts standard HTTP Basic Auth on requests.
- `--storagePath`: Path to the SQLite file (default: `./web-session-storage.db`).
- `--open` / `MIYAPAD_NO_OPEN`: Controls whether the default web browser auto-opens the UI on server start.
- `--noBackup` / `MIYAPAD_NO_BACKUP`: Disables automatic database backups.
- `--backupInterval` / `MIYAPAD_BACKUP_INTERVAL`: Minutes between backups (default: `30`).
- `--backupDir` / `MIYAPAD_BACKUP_DIR`: Directory for backup files (default: `./backups`).
- `--backupKeep` / `MIYAPAD_BACKUP_KEEP`: Number of backups to retain (default: `10`).

## Automatic Database Backups

The server can automatically create periodic backups of the SQLite database using SQLite's `VACUUM INTO` command, which produces a clean, compacted copy without downtime.

- Backups are skipped if the database file's mtime hasn't changed since the last backup.
- Backup files are named `web-session-storage.db.<YYYYMMDDHHmmss>.backup.gz` and are gzip-compressed. They can be extracted with any archive tool (7-Zip, Ark, etc.).
- Old backups beyond the configured keep count are automatically removed.

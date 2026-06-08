# Backend Server & Database

The server (`server/server.js` — entrypoint that loads modules from `lib/` and `routes/`) uses **SQLite3** combined with the precompiled **`sqlite-zstd` extension** to perform transparent, row-level Zstandard compression on database records.

## Database Schema (v4)

The database has five main tables:

1. **`meta`**: Stores metadata (e.g., database schema `version = 4`).
2. **`sessions`**: Stores main session data blobs. Uses column `session_data`.
3. **`templates`**: Stores template configuration data. Uses column `template_data`.
4. **`themes`**: Stores custom user CSS themes. Uses column `theme_data`.
5. **`names`**: Stores lightweight key-to-metadata mapping `{name, created, modified, pinned}` (as JSON) for session listing, searching, sorting, and pinning.

### Schema Column Constraints

The `sqlite-zstd` extension can experience index naming collisions if multiple tables use identical column names (e.g., `data`). To avoid this, each table maps to a unique column name managed dynamically via the server's `getColumnName(storeName)` helper (in `lib/utils.js`):

- `sessions` table uses **`session_data`**
- `templates` table uses **`template_data`**
- `themes` table uses **`theme_data`**

## Database Compaction & Compression Settings

- **Auto-Vacuum**: The database is initialized with `PRAGMA auto_vacuum = FULL`. Deleted records automatically release database pages back to the operating system, preventing storage inflation.
- **Transparent Compression**: Managed via `zstd_enable_transparent(config)`.
- **Incremental Maintenance**: A background maintenance task runs every 5 minutes (`zstd_incremental_maintenance(null, 1)`) to train compression dictionaries on table data and optimize storage.
- **Manual Vacuuming**: Can be triggered via the `/vacuum` endpoint.

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

- Backups are skipped if the database hasn't changed since the last backup (checked via `PRAGMA data_version`).
- Backup files are named `web-session-storage.db.<YYYYMMDDHHmmss>.backup`.
- Old backups beyond the configured keep count are automatically removed.

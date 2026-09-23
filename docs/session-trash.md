# Session Trash

## Overview

Deleting a session in the Sessions modal moves it to the trash instead of deleting it. Its content and version history stay in the database. *Trash (N)* in the toolbar opens the trash, where each session can be restored or deleted for good, and *Empty trash* deletes every one of them for good. Only deleting for good asks for confirmation.

## Data Model

A trashed session carries `trashed`, the time it was trashed, in its metadata (the `Names` store, next to `pinned`, `tags` and `folder`). Its content record in the `Sessions` store is not touched. No schema migration is needed, for the same reason as tags: the `Names` store is a loose key-value store in both IndexedDB and SQLite. An older miyapad reading the database lists trashed sessions as ordinary ones, and drops the field the next time it saves one, so nothing is lost either way.

On load, `SessionStorage` puts trashed sessions in `sessionStorage.trash` and the rest in `sessionStorage.sessions`. Because trashed sessions are not in `sessions`, the list, the Quick Switcher, the statistics totals, Export All and every save skip them without checking for the flag.

## Storage API

| Method | Does |
|---|---|
| `trashSessions(ids)` | Moves sessions to the trash. The last session in `sessions` is never trashed, since there would be nothing left to open. Trashing the open session opens its neighbour first |
| `restoreSessions(ids)` | Moves sessions back, with their folder, tags and pin as they were |
| `purgeSessions(ids)` | Deletes trashed sessions for good: versions first, then content and metadata. A session whose versions cannot be deleted stays in the trash |

The three run one at a time through one queue, so two batches started back to back cannot both pass the last-session check, and a restore cannot land in the middle of a trash. `trashSessions` takes the session out of `sessions` before it awaits anything, so no save started afterwards can write it back without the flag, and it waits for any save already running before writing the flag itself.

Nothing is purged automatically. The trash keeps sessions until you empty it.

# Session Folders

## Overview

Sessions can be grouped into folders in the Sessions modal. There is one level of folders; folders do not nest.

## Data Model

A folder is only a name its sessions share: the optional `folder` string in the session metadata (the `Names` store, next to `pinned` and `tags`). There is no folder table, so a folder appears with its first session and disappears with its last. No schema migration is needed, for the same reason as tags.

`folderName()` in `SessionStorage.ts` normalizes a name: trimmed, whitespace collapsed, and `undefined` (no folder) when blank.

`sessionStorage.setFolder(ids, name)` moves sessions into a folder, or out of their folder when `name` is blank. It does not bump `modified` (moving a session is not an edit, like pinning), and it writes each record directly rather than through `enqueueSave`, which only remembers one key.

## Interactions

| Action | Result |
|---|---|
| Drag a session onto a session in no folder | Both go into a new folder (`New folder`, `New folder 2`, …), whose name opens for editing |
| Drag a session onto a folder row, or onto a session in a folder | The session joins that folder |
| Drag a session in a folder onto the drop zone above the list | The session leaves its folder (the zone only shows while such a session is dragged) |
| Folder button on a session row | Opens the folder box above the list, filled in with the session's folder; blank takes the session out. The way in and out for touch screens and keyboards, where HTML5 drag and drop is unreliable |
| Click a folder row | Collapses or expands it. Collapsed folder names are kept in `localStorage` (`miyapad-sessions-collapsedFolders`) |
| Rename a folder | Renames it on all its sessions. Renaming onto another folder's name merges the two |
| Remove a folder (×) | Takes all its sessions out of the folder; no session is deleted |

## Selection

Ctrl-click picks a session out of the list, shift-click extends the run from the last one picked over the rows as they are shown (a collapsed folder's sessions are not among them), and *Select* in a row's ⋯ menu does the same where those keys are not available. A bar above the list says how many are picked and moves or deletes them together, and a row's own folder or delete button covers the whole selection when that row is part of it. *History* in the row menu is disabled while more than one is picked, since a version history is one session's. `selectedIds` drops ids whose session is gone, so a deleted session cannot linger in a count or an action.

## Folder Names

The folder box (`folderEdit`) is one input above the list, used by the folder button and by the selection bar. Its `<datalist>` suggests every folder that exists. `resolveFolder()` matches what is typed against those names without regard to case and keeps the existing spelling, so "drafts" joins *Drafts* instead of making a second folder; renaming a folder resolves the same way, minus the folder being renamed, so it can still be recapitalised.

## Listing

Sessions are filtered and sorted as before (pinned first, then the chosen sort), then `groupByFolder()` walks that order and places each folder where its first session falls, with its sessions in their sorted order beneath it. So a folder with a pinned session floats with the pinned ones, and under *Last Modified* the folder you worked in last is on top.

The name search also matches folder names. While the name or tag filter is active, every folder with a match is shown expanded, and its count shows only the matching sessions.

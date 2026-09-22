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
| Click a folder row | Collapses or expands it. Collapsed folder names are kept in `localStorage` (`miyapad-sessions-collapsedFolders`). While a filter is on, folders stay open and the arrow is greyed out |
| Rename a folder | Renames it on all its sessions. Renaming onto another folder's name merges the two |
| Remove a folder (×) | Asks first, giving the number of sessions, then takes them all out of the folder; no session is deleted |

## Selection

Ctrl-click picks a session out of the list, and shift-click extends the run from the last one picked over the rows as they are shown. A collapsed folder's sessions are not among them. *Select* in a row's ⋯ menu does the same where those keys are not available. *Select all* in the toolbar adds every row on screen to the selection, skipping collapsed folders the same way.

The selection bar says how many sessions are picked, and how many of those the search or tag filter hides ("5 selected (3 hidden by filter)"), because its buttons act on the hidden ones too. It pins, exports, moves or deletes them together. Pin becomes Unpin when every picked session is already pinned. When a row is part of the selection, its folder and delete buttons and the Export and Clone items in its ⋯ menu cover the whole selection, and *History* is disabled, since a version history belongs to one session. `selectedIds` drops ids whose session is gone, so a trashed session cannot linger in a count or an action.

`sessionStorage.setPinned(ids, pinned)` writes each record directly, for the same reason as `setFolder`, and `togglePinSession` goes through it. Delete moves the sessions to the [trash](session-trash.md) without asking.

The drop zone, the folder box and the selection bar share one slot above the list (`.sessions-modal-bar-slot`). The slot is always there, so a bar appearing never pushes the rows down under the pointer. The drop zone takes it while a session in a folder is being dragged, then the folder box, then the selection bar. When none of them is up, it shows a hint about ctrl-click and shift-click.

## Folder Names

The folder box (`folderEdit`) is one input in the slot above the list, used by the folder button and by the selection bar. Its `<datalist>` suggests every folder that exists. `resolveFolder()` matches what is typed against those names without regard to case and keeps the existing spelling, so "drafts" joins *Drafts* instead of making a second folder; renaming a folder resolves the same way, minus the folder being renamed, so it can still be recapitalised.

## Listing

Sessions are filtered and sorted as before (pinned first, then the chosen sort), then `groupByFolder()` walks that order and places each folder where its first session falls, with its sessions in their sorted order beneath it. So a folder with a pinned session floats with the pinned ones, and under *Last Modified* the folder you worked in last is on top.

Clicking the Name, Modified or Created header sorts by that column, and clicking it again reverses the order. A newly clicked column starts at A for names and at the newest date for dates, and the sorted header has `aria-sort`. The sort is kept in `localStorage` (`miyapad-sessions-sortBy`, `miyapad-sessions-sortAsc`). Below 600px the date columns are hidden, so the toolbar shows the *Sort By* box and its direction button instead.

The name search also matches folder names. While the name or tag filter is active, every folder with a match is shown expanded, and its count shows only the matching sessions. When nothing matches, the list says so. Creating or importing a session clears both filters, since the new session would rarely match them and would not show up.

Tab reaches each session row, and Enter or Space opens it. The open session's name is bold, and its row has `aria-current` for screen readers.

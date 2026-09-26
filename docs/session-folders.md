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
| *Move to folder* in the details pane | Opens the folder box above the list, filled in with the session's folder; blank takes the session out. The way in and out for touch screens and keyboards, where HTML5 drag and drop is unreliable |
| Click a folder row | Collapses or expands it, and shows the folder in the details pane. Collapsed folder names are kept in `localStorage` (`miyapad-sessions-collapsedFolders`). While a filter is on, folders stay open and the arrow is greyed out |
| *Rename* in a folder's details pane | Renames it on all its sessions. Renaming onto another folder's name merges the two. A new folder made by dragging opens here with its name ready to edit |
| *Remove folder* in a folder's details pane | Asks first, giving the number of sessions, then takes them all out of the folder; no session is deleted |

## Selection

Ctrl-click picks a session out of the list, and shift-click extends the run from the last one picked over the rows as they are shown. A collapsed folder's sessions are not among them. *Select* in the details pane or a row's right-click menu does the same where those keys are not available. *Select all* in the toolbar adds every row on screen to the selection, skipping collapsed folders the same way.

The selection bar says how many sessions are picked, and how many of those the search or tag filter hides ("5 selected (3 hidden by filter)"), because its buttons act on the hidden ones too. It pins, exports, moves or deletes them together. Pin becomes Unpin when every picked session is already pinned. When a row is part of the selection, the Export and Clone items in its right-click menu cover the whole selection, and *History* is disabled, since a version history belongs to one session. The details pane of a picked session lists the whole selection instead of that one session. `selectedIds` drops ids whose session is gone, so a trashed session cannot linger in a count or an action.

`sessionStorage.setPinned(ids, pinned)` writes each record directly, for the same reason as `setFolder`, and `togglePinSession` goes through it. Delete moves the sessions to the [trash](session-trash.md) without asking.

The drop zone, the folder box and the selection bar share one slot above the list (`.sessions-modal-bar-slot`). The slot is always there, so a bar appearing never pushes the rows down under the pointer. The drop zone takes it while a session in a folder is being dragged, then the folder box, then the name box of *Create*, then the selection bar. When none of them is up, it shows a hint about clicking, ctrl-click and shift-click.

## Folder Names

The folder box (`folderEdit`) is one input in the slot above the list, used by the folder button and by the selection bar. Its `<datalist>` suggests every folder that exists. `resolveFolder()` matches what is typed against those names without regard to case and keeps the existing spelling, so "drafts" joins *Drafts* instead of making a second folder; renaming a folder resolves the same way, minus the folder being renamed, so it can still be recapitalised.

## Listing

Sessions are filtered and sorted as before (pinned first, then the chosen sort), then `groupByFolder()` walks that order and places each folder where its first session falls, with its sessions in their sorted order beneath it. So a folder with a pinned session floats with the pinned ones, and under *Last Modified* the folder you worked in last is on top.

Clicking the Name or Modified header sorts by that column, and clicking it again reverses the order. A newly clicked column starts at A for names and at the newest date for dates, and the sorted header has `aria-sort`. The sort is kept in `localStorage` (`miyapad-sessions-sortBy`, `miyapad-sessions-sortAsc`). The creation date is in the details pane, and the icon view has no headers, so the toolbar always has the *Sort By* box and its direction button too. Picking a column there starts it in the same direction as clicking its header. Below 480px the Modified column is hidden.

The name search also matches folder names. While the name or tag filter is active, every folder with a match is shown expanded, and its count shows only the matching sessions. When nothing matches, the list says so. Creating or importing a session clears both filters, since the new session would rarely match them and would not show up.

A click on a session shows it in the details pane, and a second click opens it. `previewedOnPress` notes on mousedown whether the item was already in the pane, since the focus the press gives it puts it there before `click` fires. Tab reaches each session row, focusing a row shows it in the pane, and Enter or Space opens it. The arrow keys, Home and End move between the rows on screen, and with Shift they pick out the run from the anchor, like shift-click; a plain move puts the anchor on the row it lands on. Typing the start of a name jumps to the next row with that name (`typeAheadMatch()`); letters typed less than 500 ms apart count as one search, the same letter repeated steps through the names starting with it, and a space counts as part of the name only in the middle of one. Down in the search box focuses the first row. The open session's name is bold, and its row has `aria-current` for screen readers.

## Details Pane

The pane beside the list (`.sessions-pane`, under it below 800px) can be made wider or narrower by dragging the divider between them, or by focusing it and pressing Left or Right. The width is kept in `localStorage` (`miyapad-sessions-paneWidth`) and set as `--pane-width`; the CSS keeps the pane at least 12em wide and leaves the list at least 15em. The pane shows the item clicked or focused last, held in `previewKey`: a session's id, or `folder:<name>` for a folder. Unset, or pointing at something that has gone, it shows the open session. Creating, importing or cloning a session resets it, so the pane follows the session just opened.

For a session it shows the name, the tags as chips (click to edit), the last 300 characters of the text, the folder, when it was modified and created, and the generations and tokens from its statistics. Below that are *Open*, left out for the open session, and buttons for pin, rename, move to folder, select, history, statistics, export, clone and delete. Renaming happens in the pane. The open session's text is in memory; any other session's is read from the database with `loadRecord()`, after the session has been in the pane for 150 ms, so holding an arrow key down the list reads nothing on the way.

For a folder it shows the name (renamed in place), *Rename* and *Remove folder*, and in the icon view *Open folder*. For a session that is part of a larger selection, it lists the picked sessions instead; the selection bar above the list acts on them.

## Icon View

The *List* and *Icons* buttons in the toolbar switch views; the choice is kept in `localStorage` (`miyapad-sessions-view`). The icon view shows each session as a tile with a document icon and its name, with a small star when it is pinned, in a grid (`.sessions-grid`) that fits as many columns as the width allows. Tiles take the row classes too, so they look open, picked, dragged or dropped on like rows, and they drag and take drops the same way.

A folder is a tile of its own. Clicking it shows the folder in the pane, and a second click (or Enter, or *Open folder*) goes into it, which shows its sessions with a *Sessions › folder* path above them. The *Sessions* link or Backspace goes back up, to the folder's tile. A search or tag filter shows every match side by side, folders or not. `openFolder` remembers the folder, and `inFolder` drops it while a filter is on or once the folder has emptied.

The arrow keys move a tile at a time left and right, and a grid row at a time up and down; the number of columns is read from the grid's computed `grid-template-columns`. `navKeys` is what the keys step through in either view, folder tiles included; `visibleIds` is the sessions among them, for shift-click runs and *Select all*.

# Session Tags

## Overview

Freeform tags (e.g. `"wip"`, `"archived"`, `"rp"`, `"writing"`) can be attached to sessions. Tags are displayed in the Sessions modal below the session name, filterable via a dedicated tag filter input.

## Data Model

Tags are stored as `string[]` in the session metadata (the `Names` store):

| Field | Type | Default |
|---|---|---|
| `name` | `string` | `'Untitled'` |
| `created` | `number\|null` | `null` |
| `modified` | `number\|null` | `null` |
| `pinned` | `boolean` | `false` |
| `tags` | `string[]` | `[]` |

No DB schema migration is needed — the `Names` store is a flexible key-value store in both IndexedDB and SQLite.

## Tag Editor

In the Sessions modal, tags appear as muted comma-separated text below the session name. Click the tag text to enter inline edit mode. Enter or blur to save; Escape to cancel. Tags are entered as a comma-separated string.

### Normalization

On save, each tag is:
- Trimmed of whitespace
- Lowercased
- Whitespace-collapsed (internal whitespace sequences collapsed to single space)
- De-duplicated (duplicates removed)
- Empty strings stripped

## Tag Filter Syntax

A dedicated `InputBox` between the name search and sort dropdown in the toolbar.

### Grammar

```
Filter:      group ("OR" group)*
OR group:    term+
term:        "NOT"? pattern
pattern:     tag_fragment (wildcard pattern with `*`)
```

- **`AND`** — implicit between consecutive terms within a group (the keyword `AND` is accepted but skipped during parsing)
- **`OR`** — starts a new OR group; a session must match **any** OR group
- **`NOT`** — negates the immediately following pattern
- **`*`** — wildcard matching any substring (translated to `.*` in a generated regex)

### Examples

| Input | Meaning |
|---|---|
| `wip` | tag exactly equals "wip" |
| `wip writing` | tag equals "wip" **AND** another tag equals "writing" |
| `wip AND writing` | same (AND implicit or explicit) |
| `wip OR archived` | tag equals "wip" **OR** another tag equals "archived" |
| `NOT archived` | no tag equals "archived" |
| `wip*` | tag starts with "wip" (wildcard) |
| `*ing` | tag ends with "ing" (wildcard) |
| `wip* OR NOT *archived` | starts with "wip" **OR** no tag ends with "archived" |
| `writing NOT wip` | has tag "writing" **AND** no tag "wip" |

### Tooltip

The filter input has a tooltip:
> Filter tags. Use AND (implicit), OR, NOT, and * wildcards. Examples: wip OR writing, NOT archived, wip*

### Wildcard Resolution

If a pattern contains `*`, it is converted to a case-insensitive regex via `compileTagRegex()` (compiled once during `parseTagFilter`). If no `*` is present, an exact case-insensitive match (`===`) is used.

## Parsing Algorithm

The filter string is parsed into Disjunctive Normal Form (DNF): an array of OR groups, where each group is an array of AND conditions. Each condition is `{ pattern: string, negate: boolean }`.

```
parseTagFilter(input) → groups[] | null
sessionMatches(session, groups) → boolean
```

## Combined Filter

Name search and tag filter are **AND-ed** together in `sortedSessions`. Both must match for a session to appear.

## Implementation

### `src/storage/SessionStorage.js`

- Tags are included in session metadata at all construction points: `saveToDatabase()`, `loadFromDatabase()`, `loadSessions()`, `switchSession()`, `createSession()`, `createSessionFromObject()`
- The `tags` property is destructured out of session data (not saved into the session body)
- `setTags(sessionId, rawInput)` — parses comma-separated string, normalizes, deduplicates, sets on session, enqueues save, dispatches change event

### `src/components/modals/SessionsModal.js`

- `tagFilterQuery` state — bound to the filter input
- `editingTagsId` / `editTagsValue` state — inline tag editor management
- `parsedTagFilter` — `useMemo` memoizing `parseTagFilter(tagFilterQuery)`
- `compileTagRegex()` — extracted regex compilation for wildcard patterns
- Tag display in Name column below session name (muted, smaller text)
- Inline tag editor — `<input>` with comma-separated value
- Empty OR groups are filtered out during parsing to avoid matching all sessions

### `src/css/_sessions.css`

- `.sessions-modal-tags` — smaller muted text below session name
- `.sessions-modal-tag-input` — inline input styling for tag editing

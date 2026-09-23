# Session Tags

## Overview

You can put freeform tags on sessions: `"wip"`, `"archived"`, `"rp"`, `"writing"`, whatever you like. The Sessions modal shows them under the session name, and a filter box in the toolbar narrows the list down to the sessions that match.

## Data Model

Tags are a `string[]` in the session metadata (the `Names` store):

| Field | Type | Default |
|---|---|---|
| `name` | `string` | `'Untitled'` |
| `created` | `number\|null` | `null` |
| `modified` | `number\|null` | `null` |
| `pinned` | `boolean` | `false` |
| `tags` | `string[]` | `[]` |
| `folder` | `string\|undefined` | `undefined` (see [Session Folders](session-folders.md)) |
| `trashed` | `number\|undefined` | `undefined` (see [Session Trash](session-trash.md)) |

No schema migration is needed: the `Names` store is a loose key-value store in both IndexedDB and SQLite.

## Tag Editor

Tags sit below the session name as muted comma-separated text. Click them to edit in place. Enter or clicking away saves, Escape cancels. What you type is one comma-separated string.

While you type, the box suggests the tags your sessions already use, most used first, from a `<datalist>`. A datalist matches against the whole value, so `tagSuggestions()` starts each suggestion with what is typed up to the last comma: typing `wip, ar` offers `wip, archived`. Tags already in the box are left out.

On save each tag is trimmed, lowercased, and has internal runs of whitespace collapsed to one space. Empty strings and duplicates are dropped.

## Tag Filter Syntax

The filter is an `InputBox` between the name search and the sort dropdown.

### Grammar

```
Filter:      group ("OR" group)*
OR group:    term+
term:        "NOT"? pattern
pattern:     tag_fragment (wildcard pattern with `*`)
```

- `AND` is implicit between consecutive terms in a group. The keyword itself is accepted, and skipped during parsing.
- `OR` starts a new group. A session matches if it matches any group.
- `NOT` negates the pattern right after it.
- `*` matches any substring, becoming `.*` in the generated regex.

### Examples

| Input | Meaning |
|---|---|
| `wip` | tag exactly equals "wip" |
| `wip writing` | one tag equals "wip" and another equals "writing" |
| `wip AND writing` | the same, written out |
| `wip OR archived` | a tag equals "wip", or one equals "archived" |
| `NOT archived` | no tag equals "archived" |
| `wip*` | a tag starts with "wip" |
| `*ing` | a tag ends with "ing" |
| `wip* OR NOT *archived` | a tag starts with "wip", or no tag ends with "archived" |
| `writing NOT wip` | has "writing" and does not have "wip" |

### Tooltip

The filter input has a tooltip:
> Filter tags. Use AND (implicit), OR, NOT, and * wildcards. Examples: wip OR writing, NOT archived, wip*

### Wildcard Resolution

A pattern containing `*` becomes a case-insensitive regex through `compileTagRegex()`, compiled once inside `parseTagFilter` rather than per session. Without a `*` the comparison is a case-insensitive `===`.

## Parsing Algorithm

The filter string is parsed into disjunctive normal form: an array of OR groups, each an array of AND conditions, each condition `{ pattern, negate, regex }`.

```
parseTagFilter(input) → groups[] | null
sessionMatches(session, groups) → boolean
```

Empty OR groups are thrown away during parsing. Left in, they would match every session.

## Combined Filter

`sortedSessions` ANDs the name search and the tag filter together. A session has to satisfy both to appear.

## Implementation

`src/storage/SessionStorage.ts` carries tags in session metadata everywhere metadata is built: `saveToDatabase()`, `loadFromDatabase()`, `loadSessions()`, `switchSession()`, `createSession()` and `createSessionFromObject()`. The `tags` property is destructured out of the session data, so it never lands in the session body. `setTags(sessionId, rawInput)` splits the comma-separated string, normalizes and deduplicates it, sets it on the session, bumps `modified` (unlike pinning or moving to a folder, tagging counts as an edit), enqueues the save and dispatches the change event.

`src/components/modals/SessionsModal.tsx` holds the filter box's `tagFilterQuery`, the inline editor's `editingTagsId` and `editTagsValue`, and memoizes the parse as `parsedTagFilter` and the suggestion list as `tagNames`.

`src/css/_sessions.css` styles them: `.sessions-modal-tags` for the smaller muted line under the name, truncated with an ellipsis when it overflows the column, `.sessions-modal-tag-input` for the inline editor.

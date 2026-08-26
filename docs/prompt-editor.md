# Prompt Editor

The main prompt area is a **ProseMirror** view, not a textarea. `src/components/PromptContainer.tsx` mounts the view and wires it to React state; `src/editor/` holds the schema, the text-sync layer, and the decoration plugins.

## Key Files

| File | Purpose |
| :--- | :------ |
| `src/editor/schema.ts` | Minimal schema: `doc` → `paragraph+` → `text*`. One paragraph per line, no block nesting. |
| `src/editor/syncReactToPM.ts` | `diffPromptChunks` / `diffPromptChunksWithMeta` (React chunks ← editor text), `applyChunksToPM` (editor doc ← chunks), `textToDoc`. |
| `src/editor/EditorAdapter.ts` | `ProseMirrorAdapter` — the flat-offset API (`getText`, `getSelection`, `replaceRange`, `posAtCoords`, …) every consumer outside `src/editor/` uses. |
| `src/editor/docText.ts` | `docText(doc)` (memoised flat text) and `flatTextLength(doc)` (its length without building the string). |
| `src/editor/changedRange.ts` | `changedRange(tr)` — the span of `tr.doc` a transaction's steps actually touched. |
| `src/editor/chunkDecorations.ts` | `chunkDecorationPlugin` (per-chunk highlighting) and `chunkHoverPlugin` (hover/erase overlays). |
| `src/editor/markdownDecorations.ts` | `markdownDecorationPlugin` — in-place markdown styling for wysiwyg mode. |

## Text Contract

Every offset exchanged with the editor is a **flat text offset** into `docText(doc)` — the document with a `\n` between paragraphs — never a ProseMirror position. `textOffsetToPMPos` / `pmPosToTextOffset` (in `chunkDecorations.ts`) convert at the boundary.

`docText` memoises per doc node in a `WeakMap` (PM docs are immutable, so this is safe and old docs stay collectable). Prefer `flatTextLength(doc)` for length-only checks — it is arithmetic on `content.size`, no string built.

## Decoration Plugins

Three plugins render into the same view; ProseMirror merges overlapping inline decorations into one DOM element, so the rendered markup is unaffected by the split.

| Plugin | Meta key | Rebuilt when |
| :--- | :--- | :--- |
| `chunkDecorationPlugin` | `chunkDecorationKey` | Chunks, `tokenColorMode` or `tokenHighlightMode` change. |
| `chunkHoverPlugin` | `chunkHoverKey` | The hovered chunk index or the undo-erase range changes; also re-derived when a base-chunk rebuild would map its decorations away. |
| `markdownDecorationPlugin` | `markdownDecorationKey` | The doc changes in wysiwyg mode, or the mode itself is toggled. |

Hover state lives in its own plugin so moving the mouse never rebuilds the O(N) chunk set. `PromptContainer` also drops hover dispatches whose `(chunk index, erase index, highlight mode)` tuple is unchanged, since `currentPromptChunk` gets a new object identity on every mouse move.

## Markdown Mode (wysiwyg)

The toolbar's split-view button toggles `editorMode` between `'source'` and `'wysiwyg'` (`SettingsContext`, persisted to `localStorage` via `usePersistentState`; type `EditorMode` in `src/types/contexts.d.ts`). The button gets `textAreaSettings-markdown-active` while wysiwyg is on.

In wysiwyg mode the document is still plain markdown source — nothing is hidden or rewritten. `marked.lexer` (GFM, `breaks: true`) tokenizes the flat text and the plugin emits decorations that style the source in place: node decorations for block constructs, inline decorations for the content between markers. **Markers stay visible**, so caret positions and offsets are identical in both modes.

Styled constructs: headings (`h1`–`h6`), `strong` / `em` / `del`, blockquotes, lists and list items, tables (header row and body rows), horizontal rules. Anything else (code fences, links, inline code) lexes normally but is left unstyled. Classes are `.pm-md-*` and live in `src/css/_markdown-decorations.css`.

Mapping token offsets back to the source is done per line (`buildLineMap`), because `marked` strips per-line markers (`> `, `- `, indentation) from `raw` when building `text`, and one token can span several PM paragraphs.

## Incremental Rebuilds

`DecorationSet.create` is O(paragraphs × decorations), and every line is its own paragraph — a full rebuild costs tens of milliseconds on a long prompt, on every keystroke and every streamed token. Both content plugins therefore rebuild only what changed:

- **Chunks**: `reusablePrefix` counts leading chunks that are reference-identical to the last build (streaming appends and `diffPromptChunksWithMeta` reuse chunk objects, so identity is exact). The previous set is mapped forward, the stale tail removed, and only the new tail added. A mode change returns 0 and forces a full rebuild.
- **Markdown**: lexing stays whole-document (it is the cheap half, and re-lexing a slice is unsound — a code fence or `> ` changes how later lines parse), but the top-level token list is diffed by `raw` against the previous build, then widened to cover `changedRange(tr)`, since only decorations outside the touched span survived `map()` intact.

Both plugins track their own state (`built` / `tokens`) so the next transaction can diff against it.

## Invariants

- Keep text sync and decoration state in lockstep — dispatch the chunk state as `chunkDecorationKey` meta on the same transaction that changes the text.
- Never mutate chunk objects when re-deriving chunks; the reuse check relies on reference identity.
- Guard React→PM writes with the sync suppression flag so `dispatchTransaction` does not feed the change back into `promptChunks`.
- Meta-only transactions (`hover`, mode toggle) leave `docChanged` false and need no suppression.
- Known soft edge, left deliberately: if chunk indices shift under a stationary pointer, the hover tuple can hold a stale index until the pointer moves. It self-heals on the next base meta and never leaves decorations wiped.

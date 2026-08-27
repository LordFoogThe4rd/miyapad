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
| `src/editor/markdownDecorations.ts` | `markdownDecorationPlugin` — in-place markdown styling for wysiwyg mode, restricted to a viewport window. |

## Text Contract

Every offset exchanged with the editor is a **flat text offset** into `docText(doc)` — the document with a `\n` between paragraphs — never a ProseMirror position. `textOffsetToPMPos` / `pmPosToTextOffset` (in `chunkDecorations.ts`) convert at the boundary.

`docText` memoises per doc node in a `WeakMap` (PM docs are immutable, so this is safe and old docs stay collectable). Prefer `flatTextLength(doc)` for length-only checks — it is arithmetic on `content.size`, no string built.

## Decoration Plugins

Three plugins render into the same view; ProseMirror merges overlapping inline decorations into one DOM element, so the rendered markup is unaffected by the split.

| Plugin | Meta key | Rebuilt when |
| :--- | :--- | :--- |
| `chunkDecorationPlugin` | `chunkDecorationKey` | Chunks, `tokenColorMode` or `tokenHighlightMode` change. |
| `chunkHoverPlugin` | `chunkHoverKey` | The hovered chunk index or the undo-erase range changes; also re-derived when a base-chunk rebuild would map its decorations away. |
| `markdownDecorationPlugin` | `markdownDecorationKey` | The mode is toggled, the viewport window moves, or an idle callback flushes the edits since the last rebuild. |

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

Every span a build emits is clamped to the source range of the top-level token
that produced it. Nothing correct ever lands outside it, but half-typed markdown
can throw the text-to-source mapping off, and a span that escaped its own block
would be re-emitted on the next build without the stale copy being cleared —
the splice removes exactly the token range it rebuilt.

## Viewport Window

The markdown plugin decorates only the paragraphs on screen plus 60 either side
(`MarkdownPluginState.window`, a PM range; `null` means the whole document).
That caps both `DecorationSet.create` and `DecorationSet.map`, which are
O(paragraphs × decorations) and O(paragraphs × node decorations) — the second is
what dominates a keystroke once the first is incremental.

A plugin `view()` keeps the window aimed:

- `props.decorations` is a pure function of state, so scrolling has to dispatch.
  Scroll (a capturing listener on the window — scroll events do not bubble),
  resize, a `ResizeObserver` on the editor, and plugin updates all funnel into
  one `requestAnimationFrame` callback.
- The visible range comes from `posAtCoords` at the top and bottom of the
  editor's visible band, clipped to the browser viewport on **both** axes — the
  editor overflows it vertically by design and horizontally whenever the prompt
  pane is dragged wider than the window, and a point outside it hit-tests
  nothing.
- The window is only re-aimed when the viewport comes within 20 paragraphs of an
  edge, or when edits have stretched it past twice a fresh one (mapping biases
  the edges outwards so streamed text lands inside, which would otherwise widen
  it back to the whole document over a long generation).
- Undecorating what is above the viewport shrinks it — headings are larger,
  blockquotes and lists are indented — so the topmost visible position is
  measured with `coordsAtPos` before and after the swap and the difference is
  added to the scroller's `scrollTop`. Without it, scrolling a long document
  slides by hundreds of pixels per re-aim.

Both window changes and the mode toggle ride a transaction that leaves the text
alone, so they reuse the token list from the last build instead of re-lexing —
unless a rebuild is pending (see below), in which case that list describes an
older document and they lex again.

Measured in jsdom on 100k chars / 6000 paragraphs of heavy markdown, per
keystroke: 95 ms whole-document (57 ms of it `map`) against 38 ms windowed
(1 ms of it `map`, 32 ms the lex). Re-aiming the window on scroll costs 5 ms.

## Deferred Rebuilds

The lex is whole-document — it has to be, since a code fence or a `> ` changes
how every later line parses — so after the window landed it was the only thing
left on the keystroke path, and it is O(document). An edit therefore does not
rebuild at all: `apply` maps the set forward (positions stay correct, styling
lags) and records the changed range in `MarkdownPluginState.pending`. The plugin's
`view()` books a `requestIdleCallback` (`{ timeout: 100 }`; `setTimeout` where
there is none) that dispatches `'flush'` meta, and *that* transaction lexes and
splices.

- **One callback stays in flight at a time.** That is the debounce. Restarting a
  timer on every edit — the usual shape — would never expire during a
  generation, and markdown would stay unstyled for the whole run.
- **`pending` is a union, not the last transaction's range**: it is mapped
  forward on each deferred edit and merged with the new one, because a flush
  stands in for every edit since the last rebuild.
- Chrome does not run idle callbacks for a hidden document, timeout or not, so a
  backgrounded tab catches up when it is looked at again.

Measured in jsdom on 107k chars / 6300 paragraphs, per keystroke: 42 ms before,
1.2 ms after, with the 38 ms flush off the critical path — and 3.3 ms per
keystroke amortised when a burst of 20 shares one flush.

## Invariants

- Keep text sync and decoration state in lockstep — dispatch the chunk state as `chunkDecorationKey` meta on the same transaction that changes the text.
- Never mutate chunk objects when re-deriving chunks; the reuse check relies on reference identity.
- Guard React→PM writes with the sync suppression flag so `dispatchTransaction` does not feed the change back into `promptChunks`.
- Meta-only transactions (`hover`, mode toggle) leave `docChanged` false and need no suppression.
- Known soft edge, left deliberately: if chunk indices shift under a stationary pointer, the hover tuple can hold a stale index until the pointer moves. It self-heals on the next base meta and never leaves decorations wiped.

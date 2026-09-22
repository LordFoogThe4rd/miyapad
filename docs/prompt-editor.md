# Prompt Editor

The main prompt area is a ProseMirror view, not a textarea. `src/components/PromptContainer.tsx` mounts the view and connects it to React state. `src/editor/` holds the schema, the text-sync layer and the decoration plugins.

## Key Files

| File | Purpose |
| :--- | :------ |
| `src/editor/schema.ts` | Minimal schema: `doc` → `paragraph+` → `text*`. One paragraph per line, no block nesting. |
| `src/editor/syncReactToPM.ts` | `diffPromptChunks` / `diffPromptChunksWithMeta` (React chunks ← editor text), `applyChunksToPM` (editor doc ← chunks), `textToDoc`. |
| `src/editor/EditorAdapter.ts` | `ProseMirrorAdapter`: the flat-offset API (`getText`, `getSelection`, `replaceRange`, `posAtCoords`, …) that all code outside `src/editor/` uses. |
| `src/editor/docText.ts` | `docText(doc)` (memoised flat text) and `flatTextLength(doc)` (its length without building the string). |
| `src/editor/changedRange.ts` | `changedRange(tr)`: the span of `tr.doc` that a transaction's steps actually touched. |
| `src/editor/chunkDecorations.ts` | `chunkDecorationPlugin` (chunk highlighting) and `chunkHoverPlugin` (hover/erase overlays). |
| `src/editor/markdownDecorations.ts` | `markdownDecorationPlugin`: in-place markdown styling for wysiwyg mode, limited to a viewport window. |
| `src/editor/markdownCaret.ts` | `markdownCaretPlugin`: shows the markers `markdownDecorationPlugin` hides, for the construct the caret is in. |
| `src/editor/chunkDecorations.bench.ts`, `src/editor/markdownDecorations.bench.ts` | `npm run bench` (Vitest benchmarks). Each ratio compares an optimisation against running without it: the reuse prefix, the viewport window, the deferred flush. They run in jsdom, so only the ratios mean anything, not the absolute milliseconds. There's no stored baseline, so you read the output by hand. |

## Text Contract

Every offset exchanged with the editor is a flat text offset into `docText(doc)`, which is the document with a `\n` between paragraphs. It is never a ProseMirror position. `textOffsetToPMPos` / `pmPosToTextOffset` (in `chunkDecorations.ts`) convert between the two at the boundary.

`docText` memoises per doc node in a `WeakMap`. PM docs are immutable, so this is safe, and old docs can still be garbage-collected. For length-only checks, use `flatTextLength(doc)`: it's arithmetic on `content.size` and builds no string.

## Decoration Plugins

Four plugins render into the same view. ProseMirror merges overlapping inline decorations into one DOM element, so splitting them up doesn't change the rendered markup.

| Plugin | Meta key | Rebuilt when |
| :--- | :--- | :--- |
| `chunkDecorationPlugin` | `chunkDecorationKey` | Chunks, `tokenColorMode` or `tokenHighlightMode` change. |
| `chunkHoverPlugin` | `chunkHoverKey` | The hovered chunk index or the undo-erase range changes. Also re-derived when a base-chunk rebuild would map its decorations away. |
| `markdownDecorationPlugin` | `markdownDecorationKey` | The mode is toggled, the viewport window moves, or an idle callback flushes the edits made since the last rebuild. |
| `markdownCaretPlugin` | — (reads the selection) | The selection moves, the doc changes, or the markdown plugin rebuilds. |

Hover state has its own plugin so that moving the mouse never rebuilds the O(N) chunk set. `PromptContainer` also drops hover dispatches whose `(chunk index, erase index, highlight mode)` tuple hasn't changed, because `currentPromptChunk` gets a new object identity on every mouse move.

## Markdown Mode (wysiwyg)

The toolbar's split-view button switches `editorMode` between `'source'` and `'wysiwyg'`. The setting lives in `SettingsContext` and is saved to `localStorage` via `usePersistentState`; its type is `EditorMode` in `src/types/contexts.d.ts`. The button gets `textAreaSettings-markdown-active` while wysiwyg is on.

In wysiwyg mode the document is still plain markdown source. Nothing is removed from the document, rewritten, or replaced with a widget. `marked.lexer` (GFM, `breaks: true`) tokenizes the flat text, and the plugin emits decorations that style the source in place. Markers get decorations too, and are hidden with CSS `display: none`. The characters stay in the doc, so flat offsets, chunk highlighting, undo and the clipboard all behave the same in both modes. That's why this approach is cheap.

Styled constructs: headings (`h1`–`h6`), `strong` / `em` / `del`, blockquotes, lists and list items, tables (header row and body rows), horizontal rules, inline code and links. Anything else (code fences, images) is lexed normally but left unstyled. The classes are `.pm-md-*` and live in `src/css/_markdown-decorations.css`.

Token offsets are mapped back to the source line by line (`buildLineMap`), because `marked` strips per-line markers (`> `, `- `, indentation) from `raw` when it builds `text`, and one token can span several PM paragraphs.

## Hidden Markers and the Caret

There are two kinds of marker, matching what Obsidian's live preview does:

| Class | Covers | Revealed by |
| :--- | :--- | :--- |
| `pm-md-marker-line` | `#{1,6} `, `> `, unordered `- `, the `---` of an hr | `.pm-md-active` on that paragraph, when no inline construct is revealed |
| `pm-md-marker` | `**` `*` `~~`, backticks, a link's `[` and `](url)` | `.pm-md-reveal` on that construct's markers |

So with the caret in `bold` of `# H **bold** tail`, the asterisks come back, but the `#` stays hidden and the line stays large. Move the caret to `tail` and it's the other way round.

`markdownCaretPlugin` emits both classes. It's registered after `markdownDecorationPlugin`, because PM applies plugins in array order and `apply` only sees the new state of the ones before it.

- For line markers, it adds one `Decoration.node` with `pm-md-active` on the paragraph holding `selection.$head`, found with `$head.before(1)`. A CSS descendant selector does the rest. It only does this when no inline construct was revealed, so being inside a word doesn't also expose the heading marker for the whole line. (Obsidian, by contrast, shows a heading's `#` whenever the caret is anywhere on the line.) That precedence only applies between the two kinds. Nested inline constructs all reveal together, so a caret in the italic of `**bold *and italic***` shows both pairs.
- For inline markers, the build tags every decoration of one construct, meaning both markers and the content span, with a shared `spec.md` group id. The plugin reads the markdown set over the caret's paragraph, groups it by that id, and reveals any group whose `[min(from), max(to)]` the selection overlaps. The overlap check is inclusive, because the caret has to be able to sit just past a closing `**` to delete it.

So a construct's extent always comes from the mapped decoration positions, never from offsets stored at build time. The markdown rebuild is deferred, so a stored number could be up to 100 ms stale. Group ids only have to be unique within one paragraph, and they are: a splice rebuilds whole top-level tokens, and a paragraph belongs to exactly one of them, so every decoration in a paragraph comes from the same build.

None of this re-lexes or rebuilds the markdown set. A cursor move costs one `DecorationSet.create` over a handful of decorations. That's still O(paragraphs) inside ProseMirror's `buildTree`, however few decorations it gets. Measured cost: +0.10 ms per keystroke on 400 blocks, against 0.50 ms without the plugin.

Because markers are hidden and still in the document, ProseMirror still serializes them. Copying a selection that spans a hidden `**` gives you markdown.

Known gaps, left on purpose:

- Setext headings (`Title` / `=====`): the underline line stays visible. `display: none` on a whole paragraph makes it unreachable by click or arrow key, so it could never be revealed for editing.
- Caret column on vertical movement: when you arrow into a line whose markers are hidden, the target column is picked against the collapsed text, and then the line expands. Obsidian behaves the same way.
- A construct whose `text` isn't a substring of its `raw` (marked escapes HTML entities into `codespan.text`, among others) keeps its markers visible, so the wrong characters never get hidden. `codespan` avoids this by counting the backtick run from `raw`.

## Incremental Rebuilds

`DecorationSet.create` is O(paragraphs × decorations), and every line is its own paragraph. A full rebuild costs tens of milliseconds on a long prompt, on every keystroke and every streamed token. So both content plugins only rebuild what changed:

- Chunks: `reusablePrefix` counts the leading chunks that are reference-identical to the last build. Streaming appends and `diffPromptChunksWithMeta` reuse chunk objects, so identity is exact. The previous set is mapped forward, the stale tail removed, and only the new tail added. A mode change returns 0 and forces a full rebuild.
- Markdown: lexing still covers the whole document. It's the cheap half, and re-lexing a slice gives wrong results, since a code fence or `> ` changes how later lines parse. The top-level token list is diffed by `raw` against the previous build, and the diff is widened to cover `changedRange(tr)`, since only the decorations outside the touched span came through `map()` intact.

Both plugins keep their own state (`built` / `tokens`) so the next transaction can diff against it.

Every span a build emits is clamped to the source range of the top-level token that produced it. Correct output never lands outside that range, but half-typed markdown can throw off the text-to-source mapping. A span that escaped its own block would be emitted again on the next build without the stale copy being cleared, because the splice only removes the token range it rebuilt.

## Merged Chunk Spans

Adjacent chunks that render identically (same base class, same `--bg-color`) share one inline decoration, so a prompt with no per-token colouring is a handful of spans instead of one per chunk. `data-promptchunk` names the first chunk of a span, not every chunk. Only the tests read it.

For the splice, this means reuse can only start on a decoration boundary. `runStarts` (the first chunk index of each decoration) maps a chunk boundary back to one. The rebuild starts one decoration earlier than reuse would allow, so a tail that now renders like the span in front of it merges into that span. Without this, an incremental set stays correct but drifts from what a fresh build would produce. The trailing decoration is left open in the build cursor so a streamed chunk extends it in O(1), and it's only emitted again if it actually grew.

## Viewport Window

The markdown plugin only decorates the paragraphs on screen, plus 60 on either side (`MarkdownPluginState.window`, a PM range; `null` means the whole document). That limits both `DecorationSet.create` and `DecorationSet.map`, which are O(paragraphs × decorations) and O(paragraphs × node decorations). Once `create` is incremental, `map` is what dominates a keystroke.

A plugin `view()` keeps the window aimed:

- `props.decorations` is a pure function of state, so scrolling has to dispatch a transaction. Scroll (a capturing listener on the window, since scroll events don't bubble), resize, a `ResizeObserver` on the editor and plugin updates all feed into one `requestAnimationFrame` callback.
- The visible range comes from `posAtCoords` at the top and bottom of the editor's visible band, clipped to the browser viewport on both axes. The editor overflows the viewport vertically by design, and horizontally whenever the prompt pane is dragged wider than the window. A point outside the viewport hit-tests nothing.
- The window is only re-aimed when the viewport gets within 20 paragraphs of an edge, or when edits have stretched it to more than twice the size of a fresh one. (Mapping pushes the edges outwards so streamed text lands inside, which over a long generation would otherwise widen it back to the whole document.)
- Removing decorations above the viewport makes that content shorter, because headings are larger and blockquotes and lists are indented. So the topmost visible position is measured with `coordsAtPos` before and after the swap, and the difference is added to the scroller's `scrollTop`. Without that, scrolling a long document jumps by hundreds of pixels every time the window is re-aimed.

Window changes and the mode toggle both ride a transaction that leaves the text alone, so they reuse the token list from the last build instead of lexing again. The exception is when a rebuild is pending (see below). Then that list describes an older document, and they lex again.

Measured in jsdom on 100k chars / 6000 paragraphs of heavy markdown, per keystroke: 95 ms for the whole document (57 ms of it `map`), against 38 ms windowed (1 ms of it `map`, 32 ms the lex). Re-aiming the window on scroll costs 5 ms.

## Deferred Rebuilds

The lex has to cover the whole document, since a code fence or a `> ` changes how every later line parses. Once the viewport window was in place, the lex was the only thing left on the keystroke path, and it's O(document). So an edit doesn't rebuild at all. `apply` maps the set forward (positions stay right, styling lags behind) and records the changed range in `MarkdownPluginState.pending`. The plugin's `view()` schedules a `requestIdleCallback` (`{ timeout: 100 }`, or `setTimeout` where that's unavailable) that dispatches `'flush'` meta, and that transaction does the lexing and splicing.

- Only one callback is in flight at a time, and that is the debounce. The usual approach of restarting a timer on every edit would never fire during a generation, and markdown would stay unstyled for the whole run.
- `pending` is the union of every edit since the last rebuild, because a flush stands in for all of them. On each deferred edit it's mapped forward and merged with the new range.
- Chrome doesn't run idle callbacks for a hidden document, timeout or not, so a background tab catches up when you look at it again.

Measured in jsdom on 107k chars / 6300 paragraphs, per keystroke: 42 ms before, 1.2 ms after, with the 38 ms flush moved off the critical path. When a burst of 20 keystrokes shares one flush, that works out to 3.3 ms per keystroke.

## Invariants

- Keep text sync and decoration state in lockstep: dispatch the chunk state as `chunkDecorationKey` meta on the same transaction that changes the text.
- Never mutate chunk objects when re-deriving chunks. The reuse check relies on reference identity.
- Guard React→PM writes with the sync suppression flag, so `dispatchTransaction` doesn't feed the change back into `promptChunks`.
- Meta-only transactions (`hover`, mode toggle) leave `docChanged` false and need no suppression.
- `markdownCaretPlugin` must stay after `markdownDecorationPlugin` in the plugin array. It reads that plugin's decorations, and a plugin's `apply` only sees the new state of the plugins declared before it.
- A known rough edge, left on purpose: if chunk indices shift under a pointer that isn't moving, the hover tuple can hold a stale index until the pointer moves. It fixes itself on the next base meta, and it never leaves decorations wiped.

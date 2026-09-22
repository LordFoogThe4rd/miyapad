# Development Conventions

## JSX-less Component Trees

All UI files use tagged template literals through `htm`. Never write XML/JSX-style code.

```tsx
import { html } from 'htm/react';

interface WidgetProps {
  title: string;
}

export function Widget({ title }: WidgetProps) {
  return html`<div className="widget"><h3>${title}</h3></div>`;
}
```

## ProseMirror Prompt Editor

The main prompt editor is a ProseMirror view (`src/components/PromptContainer.tsx` and `src/editor/`), not an uncontrolled textarea. Streaming chunks are applied to the doc through `EditorAdapter` / `applyChunksToPM`, and your edits flow back to React state through the view's `dispatchTransaction`. When you touch it, keep to these rules:

- Every text offset exchanged with the editor is a flat offset that counts the `\n` paragraph separators (`getText`, `getSelection`, `replaceRange`). Read the doc's text with `docText(doc)`, which is memoised per doc node, and use `flatTextLength(doc)` when you only need the length.
- Keep text sync and decoration state in lockstep: pass the chunk state as `chunkDecorationKey` meta on the same transaction that changes the text.
- Never mutate chunk objects when re-deriving chunks (`diffPromptChunks`). The decoration plugins reuse work by reference identity, so a mutated chunk silently keeps stale highlighting.
- Decorations are rebuilt incrementally. New decoration work must stay within `changedRange(tr)` and the plugin's own previous build. The whole design exists to avoid a full `DecorationSet.create` on every keystroke.
- Markdown decorations only cover the viewport window, and the plugin's `view()` re-aims it from a `requestAnimationFrame` on scroll. Anything that changes the height of styled text has to keep the topmost visible position pinned, or scrolling a long prompt jumps.
- Markdown rebuilds are deferred. An edit only maps the set forward, and the plugin's `view()` does the real work later in a `requestIdleCallback`. Nothing on the keystroke path may lex or call `DecorationSet.create`. Anything that reuses the stored token list has to check `pending` first, because while it's set, that list describes an older document.
- Hover-only state (`chunkHoverPlugin`), markdown styling (`markdownDecorationPlugin`) and marker reveal (`markdownCaretPlugin`) are separate plugins. Anything that changes on mouse move, caret move or a mode toggle goes in those, never in the base chunk plugin.
- `markdownCaretPlugin` is registered after `markdownDecorationPlugin` and reads its decorations. ProseMirror applies plugins in array order, and `apply` only sees the new state of the plugins before it, so the order matters. Don't reshuffle the array.

See [Prompt Editor](prompt-editor.md) for the full reference.

## UI Strings (Localization)

Don't hardcode user-facing text. Get strings through the `useT()` hook from `src/i18n`, and add the key to `src/i18n/en.json`. Keys are dot-namespaced by feature (e.g. `preferences.language`) and kept in alphabetical order.

```tsx
import { useT } from '../i18n';

export function Widget() {
  const t = useT();
  return html`<button>${t('preferences.language')}</button>`;
}
```

Build dynamic text in the component (e.g. `` `${t('sidebar.depth')}: ${n}` ``), since `useT` returns plain strings with no interpolation. See [Localization](architecture.md#6-localization-i18n) for how locales are loaded and added.

## Storage Modifications

When you change session storage columns or tables, keep the adapter architecture intact so the change applies to both IndexedDB and the SQLite server. A migration also has to leave an older database readable and lose nothing along the way. That means four things: create the table when it's missing, accept the old column name as well as the new one, fall back to the raw value when decompression fails, and rebuild inside a single transaction so a crash can't leave the table dropped. The v3-to-v4 step in `server/lib/database.ts` does all four.

## Build After Editing

Always run `npm run build` after editing any source file and before calling the work done. The build catches broken imports, missing exports and syntax errors in the frontend. Frontend changes also have `npm test` (Vitest unit tests) and `npm run typecheck`, so run whichever apply too. There is no linter. Server changes (`server/`) have no automated checks at all; its own `npm test` is a stub.

## Changelog Maintenance

CHANGELOG.md is written by hand. After each commit that isn't `docs` or `ci`, add an entry under the `[???]` unreleased heading in `CHANGELOG.md`, under the right type subheading (`### Added`, `### Fixed`, `### Changed`, `### Removed`). The `[???]` placeholder gets the real version number at release time. Only include changes that affect the end user and leave out internal ones. Write each entry the way a user would read it: say what changed for them, and leave out how it was implemented.

```markdown
## [???] - unreleased

### Added
- New feature that the user can interact with

### Fixed
- Problem that was affecting the user's experience
```

## Release Process

1. Check that every user-facing change has an entry under `## [???] - unreleased` in `CHANGELOG.md`.
2. Pick the new version using semver.
3. Bump `version` in `package.json`. `scripts/write-version.mjs` writes it into `src/version.ts` at build time, where the About dialog shows it and the update checker uses it.
4. Replace `[???] - unreleased` with `[<version>] - <YYYY-MM-DD>` at the top of `CHANGELOG.md`.
5. Stage, commit, tag and push in one go:

```bash
git add CHANGELOG.md package.json <other changed files> &&
git commit -m "chore: release v<version>" &&
git tag -a v<version> -m "v<version>" &&
git push &&
git push origin v<version>
```

6. Pushing the tag starts `.github/workflows/release.yml`. It builds the standalone `dist/miyapad.html` and the platform archives, and creates the GitHub Release with the new changelog section as its release notes. Check that the release was created with all its assets.
7. After the release, add a fresh `## [???] - unreleased` heading to `CHANGELOG.md` for the next cycle.

## Safe Property Checks

Use `Object.hasOwn(obj, prop)` (ES2022+) instead of `obj.hasOwnProperty(prop)`. The latter breaks if the object has its own property named `hasOwnProperty`.

## Deep Cloning

Use `structuredClone` to deep-copy plain data objects, instead of a shallow spread or `JSON.parse(JSON.stringify(...))`.

## TypeScript Conventions

### Component Typing

Use plain function components with an explicit props interface. Never use `React.FC`.

```tsx
export function Sidebar({ sidebarRef, toggleModal }: SidebarProps) { ... }
```

### `interface` vs `type`

Prefer `interface` for objects, props and configuration shapes. Use `type` only for aliases, unions, tuples and function signatures.

```tsx
interface WidgetProps { title: string; }
type PredictionCallback = (chunk: CompletionChunk) => boolean;
```

### Imports

Leave `.ts`/`.tsx` extensions off local import paths; Parcel's bundler module resolution finds them. Use `import type` for type-only imports.

```tsx
import { useSettings } from '../contexts/SettingsContext';
import type { ModalProps } from '../types/components';
```

### Type Locations

- Global ambient types, usable anywhere without an import, live in `src/types/*.d.ts`. Domain models like `SessionData`, `CompletionChunk` and `ApiEndpointConfig` go there.
- Exported interfaces in `src/types/components.d.ts` and `src/types/contexts.d.ts` have to be imported explicitly.
- Props for a single component can be defined inline above the component function.
- Server environment variables are typed in `server/types/env.d.ts` by augmenting `NodeJS.ProcessEnv`.

### Casting

Use `as` sparingly. It's fine in API stream parsing, where the type is known at runtime. Otherwise prefer type guards (`isAbortError`) for error handling, and `as const` for literal types.

```tsx
const tokens = logprobs.tokens as string[];
if (!isAbortError(e)) { throw e; }
```

### Generics

Custom hooks take a single `<T>` parameter. Always annotate the return type explicitly.

```tsx
export function useSessionState<T>(
  sessionStorage: any, name: string, initialState: T
): [T, Dispatch<SetStateAction<T>>] { ... }
```

## CSS Conventions

See [CSS Architecture](css.md) for the full details. In short:

- Styles are split into 22 partial files under `src/css/`, pulled into `src/styles.css` with `@import`.
- A component's own media queries live in that component's partial. Global layout media queries go in `_responsive.css`.
- New styles go in the matching partial. If none fits, create a new one.

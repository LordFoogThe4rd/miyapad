# Development Conventions

## JSX-less Component Trees

All UI files use tagged template literals via `htm`. Never write XML/JSX style code.

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

The main prompt editor is a ProseMirror view (see `src/components/PromptContainer.tsx` and `src/editor/`). It is not an uncontrolled textarea: streaming chunks are applied to the doc via `EditorAdapter` / `applyChunksToPM`, and user edits flow back to React state through the view's `dispatchTransaction`. Chunk highlighting is rendered by `chunkDecorationPlugin` as inline decorations — keep text sync and decoration state in lockstep (pass the same `chunkDecorationKey` meta), rebuild decorations on every state change that alters chunks, and never mutate chunk objects when re-deriving chunks (`diffPromptChunks`). All text offsets exchanged with the editor are flat offsets including `\n` paragraph separators (`getText`, `getSelection`, `replaceRange`).

## UI Strings (Localization)

User-facing text must not be hardcoded. Pull strings through the `useT()` hook from `src/i18n` and add the key to `src/i18n/en.json` (keys are dot-namespaced by feature, e.g. `preferences.language`, and kept alphabetically sorted).

```tsx
import { useT } from '../i18n';

export function Widget() {
  const t = useT();
  return html`<button>${t('preferences.language')}</button>`;
}
```

Compose dynamic text in the component (e.g. `` `${t('sidebar.depth')}: ${n}` ``) — `useT` returns plain strings with no interpolation. See [Localization](architecture.md#6-localization-i18n) for how locales are loaded and added.

## Storage Modifications

When modifying session storage columns or tables, preserve the adapter architecture so changes apply to both IndexedDB and the SQLite server implementation. Always ensure schema migrations are coded gracefully (such as the database V3-to-V4 migration step).

## Build After Editing

Always run `npm run build` after editing any source file and before declaring work complete. The build catches broken imports, missing exports, and syntax errors in the frontend. Server changes (`server/`) have no automated validation — there are no tests or linters in this repo.

## Changelog Maintenance

CHANGELOG.md is manually curated. After each non-`docs` or `ci` commit, add an entry under the `[???]` unreleased heading in `CHANGELOG.md` with the appropriate type subheading (`### Added`, `### Fixed`, `### Changed`, `### Removed`). The `[???]` placeholder is replaced with the actual version number at release time. Only include changes that affect the end user — omit internal changes. Entries should be written in user-friendly language, describing the feature or fix from the user's perspective without technical implementation details.

```markdown
## [???] - unreleased

### Added
- New feature that the user can interact with

### Fixed
- Problem that was affecting the user's experience
```

## Release Process

1. Verify all user-facing changes have entries under `## [???] - unreleased` in `CHANGELOG.md`.
2. Determine the new version using semver.
3. Bump `version` in `package.json` — `scripts/write-version.mjs` embeds it into `src/version.ts` at build time (shown in the About dialog and used by the update checker).
4. Replace `[???] - unreleased` with `[<version>] - <YYYY-MM-DD>` at the top of `CHANGELOG.md`.
5. Stage, commit, tag, and push in one shot:

```bash
git add CHANGELOG.md package.json <other changed files> &&
git commit -m "chore: release v<version>" &&
git tag -a v<version> -m "v<version>" &&
git push &&
git push origin v<version>
```

6. Pushing the tag triggers `.github/workflows/release.yml`, which builds the standalone `dist/miyapad.html` and the platform archives and creates the GitHub Release automatically, using the new changelog section as release notes. Verify the release was created with all assets.
7. After the release, add a fresh `## [???] - unreleased` heading to `CHANGELOG.md` for the next cycle.

## Safe Property Checks

Use `Object.hasOwn(obj, prop)` (ES2022+) instead of `obj.hasOwnProperty(prop)` to avoid breakage if the object contains an own property named `hasOwnProperty`.

## Deep Cloning

Use `structuredClone` for deep copying plain data objects instead of shallow spread or `JSON.parse(JSON.stringify(...))`.

## TypeScript Conventions

### Component Typing

Use plain function components with an explicit props interface. Never use `React.FC`.

```tsx
export function Sidebar({ sidebarRef, toggleModal }: SidebarProps) { ... }
```

### `interface` vs `type`

Prefer `interface` for objects, props, and configuration shapes. Use `type` only for aliases, unions, tuples, and function signatures.

```tsx
interface WidgetProps { title: string; }
type PredictionCallback = (chunk: CompletionChunk) => boolean;
```

### Imports

Omit `.ts`/`.tsx` extensions from local import paths (resolved by Parcel's bundler module resolution). Use `import type` for type-only imports.

```tsx
import { useSettings } from '../contexts/SettingsContext';
import type { ModalProps } from '../types/components';
```

### Type Locations

- **Global ambient types** (available project-wide without imports) live in `src/types/*.d.ts` — used for domain models like `SessionData`, `CompletionChunk`, `ApiEndpointConfig`.
- **Exported interfaces** in `src/types/components.d.ts` and `src/types/contexts.d.ts` must be explicitly imported.
- **Component-specific props** can be defined inline above the component function.
- **Server environment variables** are typed in `server/types/env.d.ts` via `NodeJS.ProcessEnv` augmentation.

### Casting

Use `as` sparingly — acceptable in API stream parsing where the type is known at runtime. Prefer type guards (`isAbortError`) for error handling and `as const` for literal types.

```tsx
const tokens = logprobs.tokens as string[];
if (!isAbortError(e)) { throw e; }
```

### Generics

Custom hooks accept a single `<T>` parameter. Always annotate the return type explicitly.

```tsx
export function useSessionState<T>(
  sessionStorage: any, name: string, initialState: T
): [T, Dispatch<SetStateAction<T>>] { ... }
```

## CSS Conventions

See [CSS Architecture](css.md) for full documentation. Key points:

- Styles are organized into 20 partial files under `src/css/`, imported by `src/styles.css` via `@import`.
- Component-specific media queries live inside that component's partial; global layout media queries go in `_responsive.css`.
- When adding new styles, put them in the matching partial or create a new one if none fits.

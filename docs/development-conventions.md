# Development Conventions

## JSX-less Component Trees

All UI files use tagged template literals via `htm`. Never write XML/JSX style code.

```javascript
import { html } from 'htm/react';
export function Widget({ title }) {
    return html`<div className="widget"><h3>${title}</h3></div>`;
}
```

## Uncontrolled Textarea Scroll Preservation

In `AppLayout.js`, the main prompt textarea updates in an uncontrolled manner during prediction. This ensures the user does not lose cursor positions, highlights, or scrolling alignments when text chunks stream in at high frequencies. Always maintain this pattern when updating prompt-related text structures.

## Storage Modifications

When modifying session storage columns or tables, preserve the adapter architecture so changes apply to both IndexedDB and the SQLite server implementation. Always ensure schema migrations are coded gracefully (such as the database V3-to-V4 migration step).

## Build After Editing

Always run `npm run build` after editing any source file (`src/` or `server/`) and before declaring work complete. The build catches broken imports, missing exports, and syntax errors.

## Changelog Maintenance

CHANGELOG.md is manually curated. After each non-`docs` commit, add an entry under the `[???]` unreleased heading in `CHANGELOG.md` with the appropriate type subheading (`### Added`, `### Fixed`, `### Changed`, `### Removed`). The `[???]` placeholder is replaced with the actual version number at release time.

```markdown
## [???] - unreleased

### Added
- New feature description

### Fixed
- Bug fix description
```

## CSS Conventions

See [CSS Architecture](css.md) for full documentation. Key points:

- Styles are organized into 18 partial files under `src/css/`, imported by `src/styles.css` via `@import`.
- Component-specific media queries live inside that component's partial; global layout media queries go in `_responsive.css`.
- When adding new styles, put them in the matching partial or create a new one if none fits.

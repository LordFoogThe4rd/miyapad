# Technology Stack

## Frontend

- **Framework**: React 19.
- **Type System**: TypeScript 7 with `strict: true`. Nothing is emitted (`noEmit`). Parcel transpiles during bundling, and `tsc --noEmit` only type-checks.
- **JSX-less Templates**: Components are written with `htm/react` (`import { html } from 'htm/react'`), so React elements come from tagged template literals instead of JSX. The files still end in `.tsx`, since that's the convention for files holding React components, but none of them contain JSX.
- **Type Definitions**: `@types/react`, `@types/react-dom`.
- **Bundler & Dev Server**: Parcel. It also transpiles the frontend TypeScript, so there is no separate compile step.
- **Prompt Editor**: ProseMirror (`prosemirror-view`, `-state`, `-model`, `-keymap`, `-commands`). The prompt area is an editor view with decoration plugins, not a textarea. See [Prompt Editor](prompt-editor.md).
- **Markdown Lexer**: `marked` tokenizes the prompt source so the editor can style it in place in wysiwyg mode. It never renders HTML.
- **State Management**: React Context (`SettingsContext` and `GenerationContext`).
- **Styling**: Plain CSS split into 22 partial files under `src/css/`, imported by `src/styles.css`. Themes are swapped at runtime through a custom CSS injector element.
- **tsconfig Layout**: Three files: `tsconfig.base.json` (shared strict settings), `tsconfig.json` (frontend, ESNext modules and bundler resolution) and `server/tsconfig.json` (server, NodeNext modules).

## Backend (Optional)

- **Runtime**: Node.js and Express, run through `tsx` rather than `node`.
- **Type Definitions**: `@types/express`, `@types/cors`, `@types/minimist`.
- **Database**: SQLite (better-sqlite3) with the `sqlite-zstd` extension, which compresses rows transparently.
- **HTTP Client**: Axios, for the server-side proxy requests.

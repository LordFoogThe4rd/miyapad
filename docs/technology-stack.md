# Technology Stack

## Frontend

- **Core Framework**: React 19.
- **Type System**: TypeScript 7 with `strict: true` enabled. Uses `noEmit` mode — Parcel handles transpilation during bundling; standalone `tsc --noEmit` is used only for type checking.
- **JSX-less Templates**: Built using `htm/react` (`import { html } from 'htm/react'`) to define React components using tagged template literals instead of JSX. Despite using `.tsx` extensions, no JSX syntax is used — the extensions reflect that these files contain React components (the typical convention).
- **Type Definitions**: `@types/react`, `@types/react-dom`, `@types/dompurify`.
- **Bundler & Dev Server**: Parcel (handles TypeScript transpilation for the frontend — no separate compile step).
- **Markdown Renderer**: `marked`.
- **State Management**: React Context (`SettingsContext` & `GenerationContext`).
- **Styling**: Standard vanilla CSS split into 21 partial files under `src/css/` (imported via `src/styles.css`), with dynamic theme swapping via a custom CSS injector element.
- **tsconfig Architecture**: Three-file setup — `tsconfig.base.json` (shared strict settings), `tsconfig.json` (frontend, extends base, uses ESNext modules + bundler resolution), and `server/tsconfig.json` (server, extends base, uses NodeNext modules).

## Backend (Optional)

- **Runtime**: Node.js & Express, executed via `tsx` (TypeScript runtime) which replaces direct `node` usage.
- **Type Definitions**: `@types/express`, `@types/cors`, `@types/minimist`.
- **Database**: SQLite3 with the `sqlite-zstd` extension for transparent row-level compression.
- **HTTP Client**: Axios (used for server-side proxy requests).

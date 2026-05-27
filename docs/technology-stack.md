# Technology Stack

## Frontend

- **Core Framework**: React 19.
- **JSX-less Templates**: Built using `htm/react` (`import { html } from 'htm/react'`) to define React components using tagged template literals instead of a JSX build step.
- **Bundler & Dev Server**: Parcel.
- **Markdown Renderer**: `marked`.
- **State Management**: React Context (`SettingsContext` & `GenerationContext`).
- **Styling**: Standard vanilla CSS split into 18 partial files under `src/css/` (imported via `src/styles.css`), with dynamic theme swapping via a custom CSS injector element.

## Backend (Optional)

- **Runtime**: Node.js & Express.
- **Database**: SQLite3 with the `sqlite-zstd` extension for transparent row-level compression.
- **HTTP Client**: Axios (used for server-side proxy requests).

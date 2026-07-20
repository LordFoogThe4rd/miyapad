# TypeScript Type System

## tsconfig Architecture

Three-file inheritance chain:

| File | Role | Key Settings |
|------|------|-------------|
| `tsconfig.base.json` | Shared base | `target: ES2022`, `strict: true`, `noEmit: true`, `esModuleInterop: true`, `skipLibCheck: true`, `isolatedModules: true` |
| `tsconfig.json` (root) | Frontend (Parcel) | `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `jsxImportSource: react` |
| `server/tsconfig.json` | Backend (tsx) | `module: NodeNext`, `moduleResolution: NodeNext` |

### Base Config (`tsconfig.base.json`)

- **`strict: true`** — Full strictness: `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc. all enabled.
- **`noEmit: true`** — No JS output generated. The frontend relies on Parcel for transpilation; the server uses `tsx` as a runtime.
- **`isolatedModules: true`** — Each file is transpiled independently, which means:
  - Re-export types using `export type` (isolatedModules enforces this with `verbatimModuleSyntax` style behavior).
  - Const enums are disallowed.

### Frontend Config (`tsconfig.json`)

- **`moduleResolution: "bundler"`** — Allows extensionless imports (Parcel resolves them at build time).
- **`jsx: "react-jsx"`** — Automatic JSX runtime. Combined with `htm/react`, tagged templates produce React elements.

### Server Config (`server/tsconfig.json`)

- **`moduleResolution: "NodeNext"`** — Requires explicit `.js` extensions in import paths (Node ESM style). The `tsx` runtime handles resolution at runtime.
- **Includes:** `**/*.ts`
- **Excludes:** `node_modules`, `tokenizers`, `backups`, `logs`, `dist`

## Ambient Type Declarations (`*.d.ts`)

Shared domain types are declared as global ambient declarations in `src/types/*.d.ts`. These are available project-wide without explicit imports.

| File | Contents |
|------|----------|
| `src/types/api.d.ts` | `CompletionChunk`, `ApiEndpointConfig`, `CompletionOptions`, `SamplerOptions`, `TokenCounterParams`, `LogprobToken` |
| `src/types/storage.d.ts` | `SessionData`, `ChatMessage`, `InstructTemplate`, `ThemeData`, `ConnectionData`, `SamplerPresetData`, `WorldInfoData`, `DatabaseAdapter` |
| `src/types/defaults.d.ts` | `DefaultPresets` interface |
| `src/types/global.d.ts` | Ambient module declarations (`*.css`, `html-to-image`), global interface augmentations (`Window`, `Document`, `HTMLTextAreaElement`, `ViewTransition`) |

### Exported Type Modules

Types that need explicit imports live in:

- `src/types/components.d.ts` — Reusable component prop interfaces (`ModalProps`, `SidebarProps`, `AppProps`, etc.)
- `src/types/contexts.d.ts` — Context value shapes (`SettingsState`, `GenerationState`)

### Server Types

- `server/types/env.d.ts` — Augments `NodeJS.ProcessEnv` with `MIYAPAD_*` environment variables
- `server/types/zstd.d.ts` — `ZstdConfigRow` interface and `sqlite3.Database` augmentation for zstd extension methods

## Conventions

- **`interface`** for objects, props, configuration shapes
- **`type`** for aliases, unions, tuples, function signatures
- **`import type`** for type-only imports (enforced by `isolatedModules`)
- **Plain function components** with explicit props interface — never `React.FC`
- **`as` casting** only in API stream parsing; prefer type guards (`isAbortError`) for error handling
- **Generic `<T>`** on custom hooks with explicit return type annotations

# TypeScript Type System

## tsconfig Layout

Three files, each inheriting from the base:

| File | Role | Key Settings |
|------|------|-------------|
| `tsconfig.base.json` | Shared base | `target: ES2022`, `strict: true`, `noEmit: true`, `esModuleInterop: true`, `skipLibCheck: true`, `isolatedModules: true` |
| `tsconfig.json` (root) | Frontend (Parcel) | `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `jsxImportSource: react` |
| `server/tsconfig.json` | Backend (tsx) | `module: NodeNext`, `moduleResolution: NodeNext` |

### Base Config (`tsconfig.base.json`)

- `strict: true` turns on the full set: `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` and the rest.
- `noEmit: true` means `tsc` never writes JS. Parcel transpiles the frontend and the server runs through `tsx`.
- `isolatedModules: true` transpiles each file on its own. Because of that, re-exported types need `export type`, and const enums are not allowed.

### Frontend Config (`tsconfig.json`)

- `moduleResolution: "bundler"` allows extensionless imports, which Parcel resolves at build time.
- `jsx: "react-jsx"` selects the automatic JSX runtime. `htm/react` tagged templates produce React elements through it.

### Server Config (`server/tsconfig.json`)

- `moduleResolution: "NodeNext"` requires explicit `.js` extensions in import paths, Node ESM style. The `tsx` runtime resolves them.
- Includes `**/*.ts`.
- Excludes `node_modules`, `tokenizers`, `backups`, `logs`, `dist`.

## Ambient Type Declarations (`*.d.ts`)

Shared domain types are global ambient declarations in `src/types/*.d.ts`, so you can use them anywhere without importing them.

| File | Contents |
|------|----------|
| `src/types/api.d.ts` | `CompletionChunk`, `ApiEndpointConfig`, `CompletionOptions`, `SamplerOptions`, `TokenCounterParams`, `LogprobToken` |
| `src/types/storage.d.ts` | `SessionData`, `ChatMessage`, `InstructTemplate`, `ThemeData`, `ConnectionData`, `SamplerPresetData`, `WorldInfoData`, `DatabaseAdapter` |
| `src/types/defaults.d.ts` | `DefaultPresets` interface |
| `src/types/global.d.ts` | Ambient module declarations (`*.css`, `html-to-image`) and global interface augmentations (`Window`, `Document`, `HTMLTextAreaElement`, `ViewTransition`) |

### Exported Type Modules

These types have to be imported explicitly:

- `src/types/components.d.ts`: reusable component prop interfaces (`ModalProps`, `SidebarProps`, `AppProps` and so on)
- `src/types/contexts.d.ts`: context value shapes (`SettingsState`, `GenerationState`)

### Server Types

- `server/types/env.d.ts` augments `NodeJS.ProcessEnv` with the `MIYAPAD_*` environment variables.

## Conventions

- `interface` for objects, props and configuration shapes.
- `type` for aliases, unions, tuples and function signatures.
- `import type` for type-only imports, which `isolatedModules` enforces.
- Plain function components with an explicit props interface. Never `React.FC`.
- `as` casts only in API stream parsing. Everywhere else, use a type guard, such as `isAbortError` for error handling.
- Custom hooks take a single generic `<T>` and annotate their return type explicitly.

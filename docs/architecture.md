# Architecture

## 1. Storage Abstraction Layer

Miyapad is designed to run seamlessly as a fully self-contained local web app (storing data in the browser) or as a client connected to the Miyapad Node.js server. This is achieved via a pluggable database adapter interface:

```mermaid
graph TD
    App[src/main.tsx] -->|detects environment| DBAdapter[dbAdapter]
    DBAdapter -->|local file:// or dev| IndexedDBAdapter[IndexedDBAdapter.ts]
    DBAdapter -->|server http://| ServerDBAdapter[ServerDBAdapter.ts]
    SessionStorage[SessionStorage.ts] --> AbstractStorage[AbstractStorage.ts]
    TemplateStorage[TemplateStorage.ts] --> AbstractStorage
    ThemeStorage[ThemeStorage.ts] --> AbstractStorage
    ConnectionStorage[ConnectionStorage.ts] --> AbstractStorage
    AbstractStorage -->|calls| DBAdapter
```

- **`AbstractStorage` (`src/storage/AbstractStorage.ts`)**: Base class that coordinates database requests. It implements a **500ms debounced save queue** (`enqueueSave`) to avoid excessive disk/DB writes during rapid user editing.
- **`IndexedDBAdapter` (`src/storage/IndexedDBAdapter.ts`)**: Communicates with the browser's IndexedDB engine (Database `MiyaPad`, version 5). Handles database upgrades, persistence requests, exports, and imports.
- **`ServerDBAdapter` (`src/storage/ServerDBAdapter.ts`)**: Converts database calls to HTTP POST requests hitting the Express server REST endpoints.
- **`ConnectionStorage` (`src/storage/ConnectionStorage.ts`)**: Extends `AbstractStorage` to persist named connection presets (endpoint, API type, API key, model, per-API options). Follows the same pattern as `ThemeStorage` — `performFullSave` replaces the entire connections object (wrapped in try-catch with error dispatch), and `loadConnections` loads all records on init. The `Connections` store is available in both IndexedDB (v5) and SQLite server-side.
- **Named Storage Optimization**: To prevent massive performance degradation, session titles and metadata are indexed separately in a `names` table/store as a JSON object `{name, created, modified, pinned, tags}`. This allows the dedicated Sessions Modal to quickly search, list, and sort sessions by creation or modification timestamps (and to float pinned sessions to the top) without pulling heavy compressed session history from the database.

## 2. Context APIs & State Management

- **`SettingsContext` (`src/contexts/SettingsContext.tsx`)**: Holds global settings and generation hyperparameters (e.g., Temperature, Top-K, Min-P, Mirostat, Dry Sampler options, selected model endpoints, OpenAI keys, instruction templates, active themes, TTS voice settings). Also manages connection presets (`connections` via `useDBConnections`) and per-session connection binding (`selectedConnectionId` via `useSessionState`).
- **`GenerationContext` (`src/contexts/GenerationContext.tsx`)**: Manages runtime generation and prompt state (e.g., prompt text chunks, total token count, generation speed, active abort controllers, undo/redo stacks, open modal states, and UI view toggles).

## 3. Type System

The project uses a **triple-tsconfig architecture**:

| Config | Location | Target | Module | Key Flags |
| :--- | :--- | :--- | :--- | :--- |
| **base** | `tsconfig.base.json` | ES2022 | — | `strict: true`, `noEmit: true` |
| **frontend** | `tsconfig.json` | ESNext | `bundler` resolution | `jsx: react-jsx` |
| **server** | `server/tsconfig.json` | ES2022 | `NodeNext` | `moduleResolution: NodeNext` |

All three configs enforce `strict: true`, disabling implicit `any`, enabling strict null checks, and requiring explicit return types on public API boundaries.

**Ambient type declarations** are organized in two `types/` directories:

- `src/types/` — Frontend-only declarations (`api.d.ts`, `components.d.ts`, `contexts.d.ts`, `defaults.d.ts`, `global.d.ts`, `storage.d.ts`)
- `server/types/` — Server-only declarations (`env.d.ts` for environment variable augmentation, `zstd.d.ts` for the native sqlite-zstd addon)

There is **no runtime validation library** (no zod, io-ts, or similar). TypeScript types are used purely for compile-time checking; no schema-based validation occurs at runtime.

## 4. LLM Provider API Layer

The `src/api/` directory implements a provider dispatch pattern for interfacing with different LLM backends. Each provider is a dedicated module exporting a consistent set of functions:

| Provider | Module | Completion | Chat Completion | Models | Token Count |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **llama.cpp** | `llamacpp.ts` | `llamaCppCompletion` | — | — | `llamaCppTokenCount` |
| **KoboldCPP** | `koboldcpp.ts` | `koboldCppCompletion` | — | — | `koboldCppTokenCount` |
| **OpenAI Compatible** | `openai.ts` | `openaiCompletion` | `openaiChatCompletion` | `openaiModels` | host-aware |
| **DeepSeek** | `deepseek.ts` | `deepseekCompletion` | `deepseekChatCompletion` | `deepseekModels` | — |
| **AI Horde** | `aihorde.ts` | `aiHordeCompletion` | — | `aiHordeModels` | — |

The router in `src/api/index.ts` dispatches calls based on the `endpointAPI` constant (`src/constants.ts`). When a user selects "DeepSeek" in the sidebar (`API_DEEPSEEK = 5`), the endpoint is forced to `https://api.deepseek.com`, the server input becomes read-only, and all generation calls route through `deepseek.ts`. DeepSeek-specific behaviors include:

- Endpoints: `GET /models`, `POST /chat/completions`, `POST /beta/completions`
- Abort is a no-op (no server-side abort endpoint)
- Token counting is skipped entirely
- Logit bias uses OpenAI-compatible format
- Chat completions include `thinking: { type: "disabled" }` to disable reasoning models
- Default model: `deepseek-v4-flash` (configurable in UI)
- `strict` mode and `chatAPI` toggle are configurable (same as OpenAI Compatible) and applied on connection select

## 5. Key Custom Hooks

- **`usePromptBuilder` (`src/hooks/usePromptBuilder.ts`)**: Assembles the raw prompt injected into the LLM. It parses text, inserts instruct template tags (e.g. system messages, user instruction blocks, assistant headers), processes World Info (checking prompt text against regex keys), formats memory blocks, injects Author Notes at specified line depths, handles Fill-In-The-Middle (FIM) placeholders `{fill}` / `{predict}`, and converts conversational history to OpenAI-compatible messages.
- **`useGenerationLogic` (`src/hooks/useGenerationLogic.ts`)**: Manages the core prediction loop. It calls API completion engines, streams tokens back to the UI chunk by chunk, calculates generation speeds (tokens/sec), manages cancellation/abort signals, manages undo/redo state histories, and passes completed generation blocks to the Text-To-Speech queue.
- **`useTTS` (`src/hooks/useTTS.ts`)**: Interfaces with the Web Speech API to provide read-aloud capabilities for incoming tokens.

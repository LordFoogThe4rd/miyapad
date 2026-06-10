# Architecture

## 1. Storage Abstraction Layer

Miyapad is designed to run seamlessly as a fully self-contained local web app (storing data in the browser) or as a client connected to the Miyapad Node.js server. This is achieved via a pluggable database adapter interface:

```mermaid
graph TD
    App[src/main.js] -->|detects environment| DBAdapter[dbAdapter]
    DBAdapter -->|local file:// or dev| IndexedDBAdapter[IndexedDBAdapter.js]
    DBAdapter -->|server http://| ServerDBAdapter[ServerDBAdapter.js]
    SessionStorage[SessionStorage.js] --> AbstractStorage[AbstractStorage.js]
    TemplateStorage[TemplateStorage.js] --> AbstractStorage
    ThemeStorage[ThemeStorage.js] --> AbstractStorage
    ConnectionStorage[ConnectionStorage.js] --> AbstractStorage
    AbstractStorage -->|calls| DBAdapter
```

- **`AbstractStorage` (`src/storage/AbstractStorage.js`)**: Base class that coordinates database requests. It implements a **500ms debounced save queue** (`enqueueSave`) to avoid excessive disk/DB writes during rapid user editing.
- **`IndexedDBAdapter` (`src/storage/IndexedDBAdapter.js`)**: Communicates with the browser's IndexedDB engine (Database `MiyaPad`, version 5). Handles database upgrades, persistence requests, exports, and imports.
- **`ServerDBAdapter` (`src/storage/ServerDBAdapter.js`)**: Converts database calls to HTTP POST requests hitting the Express server REST endpoints.
- **`ConnectionStorage` (`src/storage/ConnectionStorage.js`)**: Extends `AbstractStorage` to persist named connection presets (endpoint, API type, API key, model, per-API options). Follows the same pattern as `ThemeStorage` — `performFullSave` replaces the entire connections object, and `loadConnections` loads all records on init. The `Connections` store is available in both IndexedDB (v5) and SQLite server-side.
- **Named Storage Optimization**: To prevent massive performance degradation, session titles and metadata are indexed separately in a `names` table/store as a JSON object `{name, created, modified, pinned, tags}`. This allows the dedicated Sessions Modal to quickly search, list, and sort sessions by creation or modification timestamps (and to float pinned sessions to the top) without pulling heavy compressed session history from the database.

## 2. Context APIs & State Management

- **`SettingsContext` (`src/contexts/SettingsContext.js`)**: Holds global settings and generation hyperparameters (e.g., Temperature, Top-K, Min-P, Mirostat, Dry Sampler options, selected model endpoints, OpenAI keys, instruction templates, active themes, TTS voice settings). Also manages connection presets (`connections` via `useDBConnections`) and per-session connection binding (`selectedConnectionId` via `useSessionState`).
- **`GenerationContext` (`src/contexts/GenerationContext.js`)**: Manages runtime generation and prompt state (e.g., prompt text chunks, total token count, generation speed, active abort controllers, undo/redo stacks, open modal states, and UI view toggles).

## 3. LLM Provider API Layer

The `src/api/` directory implements a provider dispatch pattern for interfacing with different LLM backends. Each provider is a dedicated module exporting a consistent set of functions:

| Provider | Module | Completion | Chat Completion | Models | Token Count |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **llama.cpp** | `llamacpp.js` | `llamaCppCompletion` | — | — | `llamaCppTokenCount` |
| **KoboldCPP** | `koboldcpp.js` | `koboldCppCompletion` | — | — | `koboldCppTokenCount` |
| **OpenAI Compatible** | `openai.js` | `openaiCompletion` | `openaiChatCompletion` | `openaiModels` | host-aware |
| **DeepSeek** | `deepseek.js` | `deepseekCompletion` | `deepseekChatCompletion` | `deepseekModels` | — |
| **AI Horde** | `aihorde.js` | `aiHordeCompletion` | — | `aiHordeModels` | — |

The router in `src/api/index.js` dispatches calls based on the `endpointAPI` constant (`src/constants.js`). When a user selects "DeepSeek" in the sidebar (`API_DEEPSEEK = 5`), the endpoint is forced to `https://api.deepseek.com`, the server input becomes read-only, and all generation calls route through `deepseek.js`. DeepSeek-specific behaviors include:

- Endpoints: `GET /models`, `POST /chat/completions`, `POST /beta/completions`
- Abort is a no-op (no server-side abort endpoint)
- Token counting is skipped entirely
- Logit bias uses OpenAI-compatible format
- Chat completions include `thinking: { type: "disabled" }` to disable reasoning models
- Default model: `deepseek-v4-flash` (configurable in UI)

## 4. Key Custom Hooks

- **`usePromptBuilder` (`src/hooks/usePromptBuilder.js`)**: Assembles the raw prompt injected into the LLM. It parses text, inserts instruct template tags (e.g. system messages, user instruction blocks, assistant headers), processes World Info (checking prompt text against regex keys), formats memory blocks, injects Author Notes at specified line depths, handles Fill-In-The-Middle (FIM) placeholders `{fill}` / `{predict}`, and converts conversational history to OpenAI-compatible messages.
- **`useGenerationLogic` (`src/hooks/useGenerationLogic.js`)**: Manages the core prediction loop. It calls API completion engines, streams tokens back to the UI chunk by chunk, calculates generation speeds (tokens/sec), manages cancellation/abort signals, manages undo/redo state histories, and passes completed generation blocks to the Text-To-Speech queue.
- **`useTTS` (`src/hooks/useTTS.js`)**: Interfaces with the Web Speech API to provide read-aloud capabilities for incoming tokens.

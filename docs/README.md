# Miyapad

Miyapad is a web-based AI text generation interface focused on autocompletion/Text Completion API. It serves as a high-fidelity frontend client to interact with various local and remote LLM APIs, including llama.cpp, KoboldCPP, OpenAI-compatible APIs, DeepSeek, and AI Horde.

The application features full local browser persistence via IndexedDB or centralized SQLite storage using an optional backend server. It supports rich features such as prompt templates, dynamic CSS themes, markdown previews, text-to-speech synthesis (TTS), token counts, interactive log-probability overlays, a keyboard-driven Quick Switcher for fast session switching, a dedicated modal for session management with search and metadata-based sorting, the ability to pin/star sessions so they float to the top, and a Connection Manager for saving and switching between connection presets (endpoint, API type, key, model) per-session.

## Documentation

- [Technology Stack](technology-stack.md) — React 19, TypeScript, htm, Parcel, Node/Express, SQLite3+zstd
- [Project Structure](project-structure.md) — Directory tree and purpose of each component
- [Architecture](architecture.md) — Storage abstraction layer, Context APIs, custom hooks
- [Type System](type-system.md) — tsconfig architecture, ambient declarations, typing conventions
- [Backend Server](backend-server.md) — Server entrypoint, database schema, compaction, CLI options
- [API Endpoints](api-endpoints.md) — Full REST API route reference
- [Tokenization](tokenization.md) — Optional server-side tokenization with HuggingFace tokenizers
- [Building & Running](building-and-running.md) — Dev server, production build, server CLI
- [CSS Architecture](css.md) — 20 partial files, import order, theming, conventions
- [Development Conventions](development-conventions.md) — JSX-less components, TypeScript conventions, CSS conventions, storage patterns
- [Screenshot Capture](screenshot-capture.md) — Native screenshot feature for styled quote PNGs
- [Session Tags](session-tags.md) — Freeform tags on sessions with inline editing and filtering

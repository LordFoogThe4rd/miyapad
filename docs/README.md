# Mikupad

Mikupad is a web-based AI text generation interface. It serves as a high-fidelity frontend client to interact with various local and remote LLM APIs, including llama.cpp, KoboldCPP, OpenAI-compatible APIs, and AI Horde.

The application features full local browser persistence via IndexedDB or centralized SQLite storage using an optional backend server. It supports rich features such as prompt templates, dynamic CSS themes, markdown previews, text-to-speech synthesis (TTS), token counts, interactive log-probability overlays, and a dedicated modal for session management with search and metadata-based sorting.

## Documentation

- [Technology Stack](technology-stack.md) — React 19, htm, Parcel, Node/Express, SQLite3+zstd
- [Project Structure](project-structure.md) — Directory tree and purpose of each component
- [Architecture](architecture.md) — Storage abstraction layer, Context APIs, custom hooks
- [Backend Server](backend-server.md) — Server entrypoint, database schema, compaction, CLI options
- [API Endpoints](api-endpoints.md) — Full REST API route reference
- [Tokenization](tokenization.md) — Optional server-side tokenization with HuggingFace tokenizers
- [Building & Running](building-and-running.md) — Dev server, production build, server CLI
- [CSS Architecture](css.md) — 18 partial files, import order, theming, conventions
- [Development Conventions](development-conventions.md) — JSX-less components, CSS conventions, storage patterns
- [Screenshot Capture](screenshot-capture.md) — Native screenshot feature for styled quote PNGs

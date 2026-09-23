# Miyapad

Miyapad is a web-based interface for AI text generation. It is built around the Text Completion API rather than chat, and it talks to local and remote LLM backends: llama.cpp, KoboldCPP, OpenAI-compatible APIs, DeepSeek and AI Horde.

Your sessions are saved in the browser's IndexedDB, or in SQLite when the optional backend server is running. You also get prompt templates, swappable CSS themes, an in-place markdown formatting mode for the prompt editor, text-to-speech, token counts, interactive log-probability overlays, and a keyboard-driven Quick Switcher for hopping between sessions. The Sessions modal searches and sorts by name or timestamp, pins sessions to the top, groups them into folders, and filters them by tag. Pick out several sessions and you can pin, export, move or delete them together. Deleted sessions go to a trash, where they can be restored. Sampler presets save and reload your generation parameters.

## Documentation

- [Technology Stack](technology-stack.md): React 19, TypeScript, htm, Parcel, Node/Express, SQLite3+zstd
- [Project Structure](project-structure.md): the directory tree and what each part does
- [Architecture](architecture.md): storage abstraction layer, Context APIs, custom hooks
- [Prompt Editor](prompt-editor.md): ProseMirror view, text sync, decoration plugins, markdown mode
- [Type System](type-system.md): tsconfig layout, ambient declarations, typing conventions
- [Backend Server](backend-server.md): server entrypoint, database schema, compaction, CLI options
- [API Endpoints](api-endpoints.md): every REST route
- [Tokenization](tokenization.md): optional server-side tokenization with HuggingFace tokenizers
- [Building & Running](building-and-running.md): dev server, production build, server CLI
- [Docker](docker.md): docker-compose setup with a named volume for storage
- [CSS Architecture](css.md): 22 partial files, import order, theming, conventions
- [Development Conventions](development-conventions.md): JSX-less components, TypeScript and CSS conventions, storage patterns
- [Screenshot Capture](screenshot-capture.md): turning selected text into a styled quote PNG
- [Session Tags](session-tags.md): freeform tags on sessions, with inline editing and filtering
- [Session Folders](session-folders.md): grouping sessions into folders by drag or by name
- [Session Trash](session-trash.md): deleted sessions, and restoring or deleting them for good

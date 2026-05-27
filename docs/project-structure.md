# Project Structure & Key Directories

```
mikupad/
├── dist/                          # Parcel build output (production bundle)
├── mikupad.html                   # HTML entry point (loads src/main.js as module)
├── package.json                   # Frontend dependencies and run scripts
├── server/                        # Node.js backend server
│   ├── lib/                       # Core modules (database, auth, utils)
│   │   ├── auth.js                # Basic Auth middleware factory
│   │   ├── database.js            # DB connection, migrations, zstd setup, maintenance
│   │   └── utils.js               # Helpers (column names, compression, header filters)
│   ├── routes/                    # Express route handlers by concern
│   │   ├── data.js                # /load, /save, /rename, /all, /sessions, /delete
│   │   ├── proxy.js               # /proxy, /proxy/* (GET/POST/DELETE), /proxy-image
│   │   ├── system.js              # /version, /vacuum, /log
│   │   ├── tokenizer.js           # /api/v1/tokenizer/* endpoints
│   │   └── zstd.js                # /zstd_* management endpoints
│   ├── libsqlite_zstd.so          # Precompiled sqlite-zstd shared library for Linux
│   ├── server.js                  # Entrypoint: arg parsing, app setup, mount routes, start
│   ├── package.json               # Backend dependencies
│   ├── start.sh / start.bat       # Startup scripts
│   └── web-session-storage.db     # SQLite storage file (auto-generated)
└── src/                           # Frontend React source code
    ├── App.js                     # Root component orchestrating providers
    ├── AppLayout.js               # Core app shell and layout setup
    ├── main.js                    # Entry point; detects database adapter and renders
    ├── api/                       # API modules for backends (llama.cpp, Horde, OpenAI, etc.)
    ├── components/                # React components (Modals, Sidebar, controls, icons)
    ├── contexts/                  # SettingsContext and GenerationContext
    ├── css/                       # CSS partials (18 files, imported by styles.css)
    ├── defaults/                  # Hardcoded defaults for presets, prompts, themes
    ├── hooks/                     # Custom hooks (generation logic, prompt builders, etc.)
    ├── storage/                   # Storage adapters (IndexedDB, Server REST API, storages)
    ├── utils/                     # RegEx helpers and string manipulation utilities
    └── styles.css                 # Entry point that @imports all css/ partials
```

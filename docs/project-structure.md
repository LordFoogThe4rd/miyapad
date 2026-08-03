# Project Structure & Key Directories

```
miyapad/
├── .github/workflows/             # GitHub Actions CI/CD
│   ├── release.yml                # Build & attach to GitHub Release on v* tags
│   └── pages.yml                  # Deploy to GitHub Pages on v* tags
├── dist/                          # Frontend production build output
├── scripts/                       # Root build scripts
│   └── write-version.mjs          # Generates src/version.ts from package.json (prebuild/prestart)
├── server/dist-server/            # esbuild server bundle output (generated)
├── server/miyapad-dist/           # Standalone distribution folder (generated)
├── miyapad.html                   # HTML entry point (loads src/main.tsx as module)
├── package.json                   # Frontend dependencies and run scripts
├── tsconfig.base.json             # Shared TypeScript config (strict mode, noEmit)
├── tsconfig.json                  # Frontend TypeScript config (ESNext, bundler resolution)
├── server/                        # Node.js backend server
│   ├── lib/                       # Core modules (database, auth, utils)
│   │   ├── auth.ts                # Basic Auth middleware factory
│   │   ├── backup.ts              # Auto-backup with VACUUM INTO, data_version check, rotation
│   │   ├── database.ts            # DB connection, migrations, zstd setup, maintenance
│   │   ├── update.ts              # Cached GitHub latest-release check for the update feature
│   │   └── utils.ts               # Helpers (column names, compression, header filters)
│   ├── routes/                    # Express route handlers by concern
│   │   ├── data.ts                # /load, /save, /rename, /all, /sessions, /delete
│   │   ├── proxy.ts               # /proxy, /proxy/* (GET/POST/DELETE), /proxy-image
│   │   ├── system.ts              # /version, /vacuum, /log
│   │   ├── tokenizer.ts           # /api/v1/tokenizer/* endpoints
│   │   └── zstd.ts                # /zstd_* management endpoints
│   ├── scripts/                   # Build scripts
│   │   ├── pack-dist.mjs          # Assembles miyapad-dist/ with node binary, bundle, deps, launch + update scripts
│   │   ├── miyapad-update.sh      # POSIX in-place updater (Linux/macOS)
│   │   └── miyapad-update.ps1     # PowerShell in-place updater (Windows)
│   ├── server.ts                  # Entrypoint: arg parsing, app setup, mount routes, start
│   ├── tokenizer.ts               # Server-side tokenization (HuggingFace tokenizers)
│   ├── types/                     # Ambient type declarations for the server
│   │   ├── env.d.ts               # Environment variable type augmentation
│   │   └── zstd.d.ts              # sqlite-zstd native addon type declarations
│   ├── tsconfig.json              # Server TypeScript config (NodeNext resolution)
│   ├── package.json               # Backend dependencies, esbuild bundle + pack build scripts
│   ├── start.sh / start.bat       # Startup scripts
│   └── web-session-storage.db     # SQLite storage file (auto-generated)
└── src/                           # Frontend React source code
    ├── App.tsx                    # Root component orchestrating providers
    ├── AppLayout.tsx              # Core app shell and layout setup
    ├── constants.ts               # Application-wide constants and enum definitions
    ├── main.tsx                   # Entry point; detects database adapter and renders
    ├── polyfills.ts               # Browser polyfills
    ├── version.ts                 # Generated (gitignored) — exports APP_VERSION from package.json
    ├── worldinfo.ts               # World info / lorebook data structures
    ├── api/                       # API modules for backends (.ts)
    ├── components/                # React components (Modals, Sidebar, controls, icons — .tsx)
    ├── contexts/                  # SettingsContext.tsx and GenerationContext.tsx
    ├── css/                       # CSS partials (20 files, imported by styles.css)
    ├── defaults/                  # Hardcoded defaults (.ts) — presets.ts, prompt.ts, templates.ts, themes.ts
    ├── hooks/                     # Custom hooks (.ts)
    ├── i18n/                      # UI localization — context.tsx (provider + useT), locales.ts (registry), {code}.json string tables
    ├── importer/                  # Preset importers (.ts) — SillyTavern, NovelAI
    ├── storage/                   # Storage adapters (.ts) — IndexedDB, Server REST API, etc.
    ├── types/                     # Ambient type declarations (.d.ts) — api, components, contexts, storage, defaults, global
    ├── utils/                     # Helpers (.ts) — regex, strings, errors
    └── styles.css                 # Entry point that @imports all css/ partials
```

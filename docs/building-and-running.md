# Building and Running

## Frontend (Development)

From the root directory:

1. Install dependencies: `npm install`
2. Start the development server: `npm start` (Runs `parcel` dev server, entry point `miyapad.html` loads `src/main.tsx`)
3. Build for production: `npm run build` (Runs `parcel build miyapad.html --no-cache`)
4. Type-check the frontend: `tsc --noEmit` (validates types without emitting files — Parcel handles transpilation independently)

The `prebuild` and `prestart` hooks run `scripts/write-version.mjs`, which reads the root `package.json` version and writes `src/version.ts` (gitignored) exporting `APP_VERSION`.

## Backend Server

From the `server/` directory:

1. Install dependencies: `npm install`
2. Type-check the server: `npm run check` (Runs `tsc --noEmit`)
3. Start the server: `npm start` (Runs `tsx server.ts`)

See [Backend Server](backend-server.md) for CLI options and environment variables.

## Standalone Distribution

Bundle the server and package it with a Node.js binary for "unzip and run" usage:

```bash
npm run build                      # Frontend production build → dist/
cd server && npm run build:dist    # Bundle + pack → miyapad-dist/
```

The resulting `miyapad-dist/` folder is the redistributable:

```text
miyapad-dist/
  miyapad.sh / miyapad.bat  # Launch scripts
  miyapad-update.sh / .ps1  # In-place update scripts (download + extract latest release)
  node / node.exe           # Node.js binary (from actions/setup-node)
  server.cjs                # esbuild server bundle
  libsqlite_zstd.*          # sqlite-zstd SQLite extension (bundled)
  dist/                     # Frontend assets (HTML, JS, CSS)
  tokenizers/               # HuggingFace tokenizer model files
  node_modules/             # Pre-installed native addons (sqlite3, tokenizers)
```

The sqlite-zstd extension is bundled in the distribution.

### Deploying

On the target machine:

```bash
# Run the launch script
./miyapad.sh --port 3000
```

The server resolves `dist/`, `tokenizers/`, and `libsqlite_zstd.*` relative to the Node.js binary location (`process.execPath`), so the folder can be placed anywhere.

### Cross-platform builds

Each platform must build its own distribution (native addons are platform-specific):

```bash
# On the target platform:
cd server && npm ci && npm run build:dist
```

CI (`.github/workflows/release.yml`) handles this via a matrix of `ubuntu-latest`, `macos-latest`, and `windows-latest`.

## CI/CD

Two GitHub Actions workflows automate releases and deployment:

### Release (`release.yml`)

**Trigger:** Pushing a tag matching `v*` (e.g., `v2.2.0`).

**Steps:**
1. Matrix build across ubuntu-latest, macos-latest, windows-latest
2. Each job: checkout → setup-node 24 → `npm ci` → `npm run build` (frontend)
3. `cd server && npm ci` (gets platform-native addons)
4. `npm run bundle` (esbuild → dist-server/server.cjs)
5. `npm ci --omit=dev` (slim node_modules to production-only)
6. `node scripts/pack-dist.mjs` (assembles miyapad-dist/ with node binary)
7. Archive as tar.gz (unix) or zip (windows), upload as artifact
8. Release job collects all artifacts + `dist/miyapad.html`, creates GitHub Release with changelog

### GitHub Pages (`pages.yml`)

**Trigger:** Same tags as release (`v*`) or manual via `workflow_dispatch`.

**Steps:**
1. Checkout repo, install Node 20 with npm caching
2. `npm ci` → `npm run build`
3. Copy `dist/miyapad.html` → `dist/index.html` and add `dist/.nojekyll`
4. Upload `dist/` as a Pages artifact and deploy via `actions/deploy-pages`

The live site is at [lordfoogthe4rd.github.io/miyapad](https://lordfoogthe4rd.github.io/miyapad/). Each release tag triggers both workflows in parallel.

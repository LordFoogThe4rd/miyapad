# Building and Running

## Frontend (Development)

From the root directory:

1. Install dependencies: `npm install`
2. Start the development server: `npm start` (runs `parcel`; the entry point `miyapad.html` loads `src/main.tsx`)
3. Build for production: `npm run build` (runs `parcel build miyapad.html --no-cache`)
4. Type-check: `npm run typecheck` (runs `tsc --noEmit`, which only checks types; Parcel does the transpiling)
5. Run the tests: `npm test` (Vitest), or `npm run bench` for the editor benchmarks

Both the `prestart` and `prebuild` hooks run `scripts/write-version.mjs`, which reads the version out of the root `package.json` and writes `src/version.ts` (gitignored) exporting `APP_VERSION`. `prebuild` also cleans `dist/` first, and `postbuild` runs `scripts/inline-dist.mjs`, which folds the built JS and CSS back into the HTML so `dist/miyapad.html` is a single file that runs on its own.

## Backend Server

From the `server/` directory:

1. Install dependencies: `npm install`
2. Type-check the server: `npm run check` (runs `tsc --noEmit`)
3. Start the server: `npm start` (runs `tsx server.ts`)

See [Backend Server](backend-server.md) for CLI options and environment variables.

## Standalone Distribution

To get a folder you can unzip and run anywhere, bundle the server and package it with a Node.js binary:

```bash
npm run build                      # Frontend production build → dist/
cd server && npm run build:dist    # Bundle + pack → miyapad-dist/
```

`npm run build:dist` from the root does both in one go. The resulting `miyapad-dist/` folder is the redistributable:

```text
miyapad-dist/
  miyapad.sh / miyapad.bat  # Launch scripts
  miyapad-update.sh / .ps1  # In-place update scripts (download + extract latest release)
  node / node.exe           # Node.js binary (from actions/setup-node)
  server.cjs                # esbuild server bundle
  libsqlite_zstd.*          # sqlite-zstd SQLite extension (bundled)
  dist/                     # Frontend assets (HTML, JS, CSS)
  tokenizers/               # HuggingFace tokenizer model files
  node_modules/             # Pre-installed native addons (better-sqlite3, tokenizers)
```

### Deploying

On the target machine:

```bash
# Run the launch script
./miyapad.sh --port 3000
```

The server resolves `dist/`, `tokenizers/` and `libsqlite_zstd.*` relative to the Node.js binary (`process.execPath`), so the folder works wherever you put it.

### Cross-platform builds

Native addons are platform-specific, so each platform builds its own distribution:

```bash
# On the target platform:
cd server && npm ci && npm run build:dist
```

CI (`.github/workflows/release.yml`) does this across a matrix of `ubuntu-latest`, `macos-latest` and `windows-latest`.

## CI/CD

Two GitHub Actions workflows handle releases and deployment.

### Release (`release.yml`)

Runs when you push a tag matching `v*`, like `v2.2.0`.

1. Matrix build across ubuntu-latest, macos-latest, windows-latest
2. Each job: checkout → setup-node 24 → `npm ci` → `npm run build` (frontend)
3. `cd server && npm ci` (gets platform-native addons)
4. `npm run bundle` (esbuild → dist-server/server.cjs)
5. `npm ci --omit=dev` (slim node_modules to production-only)
6. `node scripts/pack-dist.mjs` (assembles miyapad-dist/ with node binary)
7. Archive as tar.gz (unix) or zip (windows), upload as artifact
8. The release job collects every artifact plus `dist/miyapad.html` and creates the GitHub Release with the changelog

### GitHub Pages (`pages.yml`)

Runs on the same `v*` tags, or by hand through `workflow_dispatch`.

1. Checkout repo, install Node 20 with npm caching
2. `npm ci` → `npm run build`
3. Copy `dist/miyapad.html` → `dist/index.html` and add `dist/.nojekyll`
4. Upload `dist/` as a Pages artifact and deploy via `actions/deploy-pages`

The live site is at [lordfoogthe4rd.github.io/miyapad](https://lordfoogthe4rd.github.io/miyapad/). Each release tag starts both workflows in parallel.

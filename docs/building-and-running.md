# Building and Running

## Frontend (Development)

From the root directory:

1. Install dependencies: `npm install`
2. Start the development server: `npm start` (Runs `parcel` dev server)
3. Build for production: `npm run build` (Runs `parcel build miyapad.html --no-cache`)

## Backend Server

From the `server/` directory:

1. Install dependencies: `npm install`
2. Start the server: `npm start` (Runs `node server.js`)

See [Backend Server](backend-server.md) for CLI options and environment variables.

## CI/CD

Two GitHub Actions workflows automate releases and deployment:

### Release (`release.yml`)

**Trigger:** Pushing a tag matching `v*` (e.g., `v2.2.0`).

**Steps:**
1. Checkout repo, install Node 20 with npm caching
2. `npm ci` → `npm run build` (produces `dist/miyapad.html`)
3. Extract the relevant changelog section from `CHANGELOG.md` for the tagged version
4. Create a **GitHub Release** with `dist/miyapad.html` attached as the release asset

### GitHub Pages (`pages.yml`)

**Trigger:** Same tags as release (`v*`) or manual via `workflow_dispatch`.

**Steps:**
1. Checkout repo, install Node 20 with npm caching
2. `npm ci` → `npm run build`
3. Copy `dist/miyapad.html` → `dist/index.html` and add `dist/.nojekyll`
4. Upload `dist/` as a Pages artifact and deploy via `actions/deploy-pages`

The live site is at [lordfoogthe4rd.github.io/miyapad](https://lordfoogthe4rd.github.io/miyapad/). Each release tag triggers both workflows in parallel.

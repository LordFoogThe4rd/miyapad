# Plugins

A plugin is a `.miyaplugin` archive that you import through Preferences → Plugins, from your computer or from a web address. When Miyapad starts, it runs each switched-on plugin's code in `(manifest.order, id)` order and hands it a `miyapad` object with hooks, plugin storage, and checked views of Miyapad's state.

## Trust

Plugin code runs in the same page as Miyapad. It can read your API keys and every session, write to any store, open the `MiyaPad` IndexedDB database directly, and call the server with your saved login. Nothing inside the page can stop it, so Miyapad doesn't try. The Plugins tab and the import dialog say this plainly. Only install plugins you trust.

In server mode, plugins are stored in the server's database, so anyone who can write to the server can add a plugin, and that plugin then runs in every browser that opens Miyapad. With the default `127.0.0.1` binding that's only you. If you expose the server on a LAN, set a password (`--password`).

## Archive format (`.miyaplugin`)

A `.miyaplugin` file is a plain zip archive with up to three top-level files:

```
manifest.json
main.js
CHANGELOG.md      (optional)
```

- Caps: 10 MB compressed archive, 20 MB total decompressed size, 2 MB per entry. Only `manifest.json`, `main.js`, and `CHANGELOG.md` are read; any other entries in the zip are ignored.
- `main.js` must be bundled into a single file. Miyapad runs it as the body of an async function with one argument, `miyapad`, so top-level `await` works. Static `import` or `export` statements are rejected at import time with a reminder to bundle the plugin into `main.js`.
- `CHANGELOG.md` is optional. Missing or invalid UTF-8 bytes in `CHANGELOG.md` never reject the archive.

### `manifest.json`

```json
{
  "id": "date",
  "name": "Date in prompts",
  "version": "1.4.0",
  "description": "Replaces {{date}} in the prompt.",
  "author": "Miyapad",
  "homepage": "https://github.com/LordFoogThe4rd/miyapad-plugin-example",
  "minMiyapad": "2.9.0",
  "maxMiyapad": "2.11",
  "order": 0,
  "startTimeout": 5,
  "hookTimeout": 10,
  "api": 1,
  "requires": ["server"]
}
```

- `id` (required): `^[a-z0-9][a-z0-9_-]{0,63}$`. Identifies the plugin in storage, data keys, and hook error attribution, so renaming `name` never orphans saved data.
- `name` (required): non-empty display name shown in Preferences → Plugins and on the startup loading screen.
- `version` (required): plain dot-separated numbers (`1.4.0`, `2.10`).
- `description`, `author`, `homepage` (optional): metadata shown on the plugin's row (`homepage` must be an `http://` or `https://` URL).
- `minMiyapad`, `maxMiyapad` (optional): compatible Miyapad version bounds. `minMiyapad` alone means that version and every later one; a short `maxMiyapad` such as `2.10` covers every `2.10.x` release.
- `order` (optional, default `0`): safe integer controlling startup execution order (`order` ascending, then `id` ascending). Hooks registered at startup run in the same order.
- `startTimeout`, `hookTimeout` (optional, defaults `5` and `10`): whole positive seconds before startup stops waiting for top-level code or skips a slow hook.
- `api` (optional, default `1`): target plugin API generation. Values higher than Miyapad supports show a warning.
- `requires` (optional): host capabilities required by the plugin. Only `"server"` is recognized; plugins declaring `"requires": ["server"]` are switched off in standalone mode with a notice and cannot be switched on without the server.
- Unknown fields are ignored so newer archives still import on older Miyapad builds.

## Version and capability checks

Each plugin either **fits** this Miyapad version, is **mismatched** (outside its declared range), or is **undeclared** (neither `minMiyapad` nor `maxMiyapad`). Plugins can also require `"server"`. The tab marks incompatible rows with ⚠.

- Importing never switches a plugin on. The import confirmation mentions version mismatches, missing version bounds, or missing server support.
- Switching on a mismatched or undeclared plugin asks first; if confirmed, it stays on until Miyapad's version changes. A plugin requiring `"server"` cannot be switched on in standalone mode.
- At startup, enabled plugins that don't fit the current Miyapad version (unless allowed for it) or that require `"server"` in standalone mode are switched off before any plugin runs, and Preferences opens on the Plugins tab listing them.

## Importing from a URL and updating

Import from URL… reads the update mode from the address you paste and shows what was pinned on the plugin's row:

| Address | Mode | Stored fetch URL |
| :--- | :--- | :--- |
| `https://github.com/o/r` | latest release | `https://github.com/o/r/releases/latest/download/<asset>` |
| `https://github.com/o/r/releases/tag/v1.2.3` | pinned release | `https://github.com/o/r/releases/download/v1.2.3/<asset>` |
| `https://github.com/o/r/tree/main/dist/x.miyaplugin` | pinned branch | `https://raw.githubusercontent.com/o/r/main/dist/x.miyaplugin` |
| `https://github.com/o/r/blob/<sha>/dist/x.miyaplugin` | pinned commit | `https://raw.githubusercontent.com/o/r/<sha>/dist/x.miyaplugin` |
| `https://…/x.miyaplugin` or `.zip` | direct | the address |

- Latest-release and tag imports make one GitHub API call (`/releases/latest` or `/releases/tags/<tag>`) directly from the browser to pick the `.miyaplugin` asset (falling back to `.zip`). Latest-release mode stores `/releases/latest/download/<asset>` rather than `browser_download_url` so later update checks follow new releases without calling the GitHub API. If GitHub's unauthenticated API rate limit (60 requests/hour) is exhausted at import time, either paste the direct archive download address or set an optional GitHub Personal Access Token in Preferences → Plugins (stored in `localStorage` and sent only to `api.github.com`, raising the limit to 5,000 requests/hour).
- `commit/<sha>` without a file path is rejected with a hint to use `blob/<sha>/<path>`.
- In server mode the archive is fetched through `/proxy-url` (which follows up to 5 redirects and caps responses at 10 MB); in standalone mode the browser fetches it directly. Miyapad checks the zip magic bytes rather than `Content-Type` (since GitHub serves release and raw assets as `application/octet-stream` or `text/plain`), while still refusing `text/html` web pages.

### Checking for and applying updates

- Opening Preferences → Plugins automatically checks every plugin that has a saved URL, four at a time, and marks each row as `Checking…`, `Up to date`, `Update available (…)` (`1.3.0 → 1.4.0` or `changed, version still 1.3.0`), or `Couldn't check`. **Check updates** re-runs the batch check on demand. Nothing runs at startup or on a background timer, and updates are never applied automatically.
- Clicking **Update** on a row compares both `manifest.version` and `main.js`. If neither changed, it reports that the plugin is already up to date.
- An archive whose `manifest.id` does not match the installed plugin is refused (`This archive is for a different plugin.`).
- When an update is available, the confirmation dialog shows `<old> → <new>` or `changed, version still <version>`, together with the matching `## [<version>]` (or `## <version>`) section from `CHANGELOG.md` capped at 1,000 characters (`No notes for this version.` when absent).
- Confirming replaces the code and manifest, keeps the plugin's saved data and on/off state, and clears `allowedVersion`. Changes take effect after a reload.

## The `miyapad` object

### Stable vs unstable surface

| Surface | Fields |
| :--- | :--- |
| **Stable** (changes only with a `manifest.api` bump) | `id`, `name`, `version`, `hooks`, `events`, `context`, `storage`, `sessionData`, `generate`, `settings`, `generation`, `React`, `html` |
| **Unstable** (internal objects; may change in any release) | `sessionStorage`, `templateStorage`, `themeStorage`, `connectionStorage`, `samplerPresetStorage`, `api` |

Each plugin receives its own `miyapad` object (there is no `window.miyapad`):

| Field | What it is |
| :--- | :--- |
| `id` | The plugin's immutable identifier (`manifest.id`). |
| `name` | The plugin's display name (`manifest.name`). |
| `version` | Miyapad's version (`APP_VERSION` from `src/version.ts`). |
| `hooks` | Per-plugin view of shared hooks (`prompt`, `messages`, `output`, `commands`) tagged with `id` and `hookTimeout`. |
| `events` | Scoped lifecycle event bus (`on`, `once`, `off`) with sticky `ready`, session, and generation events. |
| `context` | Pre-truncation context injections (`setInjection`) and synchronous prompt placeholders (`setPlaceholder`). |
| `storage` | Global key-value storage isolated under `id`. |
| `sessionData` | Synchronous per-session storage backed by `session.pluginData[id]`, with a session-switch guard. |
| `generate` | Quiet off-screen generation helper sharing provider payloads and `/proxy` routing without touching UI state. |
| `settings`, `generation` | Checked live views of `useSettings` and `useGeneration`. |
| `React`, `html` | React and `htm`'s `html` tagged template helper. |
| `sessionStorage`, `templateStorage`, `themeStorage`, `connectionStorage`, `samplerPresetStorage`, `api` | Unstable internal storage instances and API router. |

## Miyapad's state

`miyapad.settings` and `miyapad.generation` expose the current values and setters from `useSettings` and `useGeneration` as plain properties via a proxy.

- Reads return the value from the latest render (`undefined` before Miyapad's first render).
- `set*` calls check the value's type, finiteness, and sidebar numeric range before calling the real setter, throwing `TypeError` or `RangeError` on invalid input. Update functions are refused; pass a concrete value.

## Hooks and error attribution

`hooks.prompt`, `hooks.messages`, and `hooks.output` are push-only views (`{ push(fn) }`). Entries pushed through `miyapad.hooks` carry both the plugin's `id` and its `hookTimeout` (10 seconds by default). `hooks.commands` is the shared command array.

- **`prompt`**: `(prompt: string, ctx) => string | Promise<string>`. Runs right before completion/chat requests and when Show Context previews the prompt. One-argument hooks remain valid. `ctx` carries:
  - `dryRun`: `true` in Show Context preview, `false` in a real `predict()` call.
  - `mode`: `'completion' | 'chat' | 'fill'`.
  - `abort()`: cancels the generation cleanly before the API call, pops the generation undo boundary, stops later hooks, and shows no error banner. No-op when `dryRun` is `true`.
  - `params(overrides)`: shallow-merges one-off fields (such as `stop`, `grammar`, or `logit_bias`) into this request's payload without changing saved settings. Ignored when `dryRun` is `true`.
- **`messages`**: `(messages: ChatMessage[], ctx) => ChatMessage[] | Promise<ChatMessage[]>`. Runs right after `convertChatToJSON` when Chat API mode is on, in both `predict()` and Show Context. `ctx` carries `{ dryRun, abort, params }`.
- **`output`**: `(text: string, info: { complete: boolean }) => void | Promise<void>`. Runs on its own async queue after any generation that produced text.
- **`commands`**: `{ label: string, action: () => void }` entries appended to the Quick Switcher's `>` command list.

If a `prompt`, `messages`, or `output` hook throws, exceeds `hookTimeout`, or returns the wrong type, Miyapad logs `[plugins] "<id>": …`, records the latest runtime failure under `id` in memory so Preferences → Plugins shows `Hook error: …` on that plugin's row, and skips the failed hook without aborting generation.

## Lifecycle events (`miyapad.events`)

`miyapad.events` exposes `{ on(event, fn), once(event, fn), off(event, fn) }`. Listener errors are caught, logged under `id`, recorded as runtime errors, and never block later listeners.

- **`ready`**: sticky. Fires once after `<App>` commits its first render (when `settings`, `generation`, and the prompt editor are populated). Subscribing after it has already fired runs `fn` on a microtask.
- **`sessionChange`**: `{ sessionId: number | undefined }`, fired when `SessionStorage` switches sessions or overwrites from a history snapshot.
- **`generationStart`**: `{ mode: 'completion' | 'chat' | 'fill', sessionId: number | undefined }`.
- **`generationChunk`**: `{ text: string, chunk: CompletionChunk }`, fired synchronously per streamed chunk; keep listeners non-blocking.
- **`generationEnd`**: `{ text: string, complete: boolean, aborted: boolean }`.

## Context injections and placeholders (`miyapad.context`)

`hooks.prompt` runs after World Info matching, `contextLength` truncation, and token counting. To contribute text that takes part in prompt assembly, use `miyapad.context`:

- **`setInjection(key, entry | null)`**: stores an entry under `<id>/<key>` (pass `null` to remove it). `entry` is `{ text, position?: 'before' | 'after' | 'depth', depth?: number, scanWorldInfo?: boolean }`.
  - Entries with `scanWorldInfo: true` are appended to the World Info scan slice before matching entries.
  - Every active injection's length is counted in `additionalContext` before truncation, so injected text never pushes the prompt past `contextLength`, and the token counter and Show Context include it automatically.
  - `position: 'depth'` (default `depth: 0`) splices into the truncated prompt by line depth like Author's Note. `'before'` and `'after'` sit above or below `{prompt}`, ordered by `(manifest.order, id, key)`.
- **`setPlaceholder(name, fn | null)`**: registers a synchronous `() => string` resolver for `{<name>}` and `{{<name>}}`, expanded before World Info scanning and truncation (pass `null` to remove). A throwing or non-string resolver logs under `id` and leaves the placeholder untouched.

## Session-scoped data (`miyapad.sessionData`)

For state tied to one writing session (summaries, trackers, per-session notes), use `miyapad.sessionData` instead of global `miyapad.storage`:

- `sessionId`: returns `sessionStorage.selectedSession`.
- `get(key)` / `keys()`: synchronous reads from `session.pluginData[id]` on the active session (`undefined` / `[]` when no session is open or active).
- `set(key, value, opts?)` / `delete(key, opts?)` / `clear(opts?)`: JSON-clones `value` (same rules as `storage.set`), updates `session.pluginData[id]`, and queues a save without bumping `session.modified` or creating a version-history snapshot.
- **Switch guard**: pass `{ sessionId: snapId }` captured before async work. If the user switched sessions (or the session is `inactive`), the write does nothing and returns `false`.
- Because `pluginData` lives on the session body, single-session export/import carries it and purging a trashed session removes it.

## Background generation (`miyapad.generate`)

`miyapad.generate(options)` runs an off-screen completion and resolves to the concatenated reply string without touching `promptChunks`, undo history, tokens/sec, session stats, TTS, or plugin hooks/events:

```js
const reply = await miyapad.generate({
  prompt: 'Summarize:\n' + text,
  connectionId: 'fast-local',
  samplerPresetId: 'deterministic',
  maxTokens: 256,
  temperature: 0.3,
  stop: ['\n\n'],
  params: {},
  signal,
});
```

- Pass `prompt` or (for Chat API connections) `messages`.
- `connectionId` reads `connectionStorage.connections[connectionId]` and `samplerPresetId` reads `samplerPresetStorage.presets[samplerPresetId]`, each falling back to active settings when omitted.
- Shares sampler filtering, provider quirks (`API_OPENAI_COMPAT`, `API_DEEPSEEK`, strict presets), `convertChatToJSON`, and server `/proxy` routing with `predict()`.

## Storage

`miyapad.storage` stores JSON values under the plugin's `id`:

- `get(key)` returns the saved value or `undefined`.
- `set(key, value)` JSON-clones and saves `value` (rejecting `undefined` and `BigInt` with `TypeError`).
- `delete(key)` deletes one key.
- `keys()` returns saved keys in insertion order.

Operations are serialized on an internal queue and committed atomically with the plugin's key list. Deleting a plugin removes its saved data and registry entry.

## Rules and recommended behaviour for plugin authors

- Bundle your code and dependencies into a single `main.js` inside `.miyaplugin`.
- Prefix any `localStorage` keys with `<id>:`.
- Never open the `MiyaPad` IndexedDB database directly; if you use IndexedDB yourself, open `miyapad-plugin-<id>`.
- Only pass JSON-serializable values to `storage.set`, and version your own schema with a `schemaVersion` key when evolving formats.
- Keep top-level startup code fast (within `startTimeout`, default 5s) and keep `prompt` hooks pure, cheap, and repeatable (they run on Show Context as well as real generations).

## Loading, safe mode, and backups

At startup (`startPlugins` in `src/plugins.ts`):

1. Incompatible plugins (version mismatch without `allowedVersion === APP_VERSION`, or `requires: ["server"]` in standalone mode) are switched off and saved.
2. Remaining enabled plugins run sequentially in `(manifest.order, id)` order. If startup takes longer than 300 ms, a loading screen names the current plugin with a **Skip** button.
3. Add `?safe` to the URL (or click **Reload without plugins** on the crash screen) to skip running and modifying plugins so a broken plugin can be switched off. The Plugins tab's **Reload** button strips `?safe`.
4. The Plugins tab shows the latest server backup status in server mode, or a **Download backup** button in standalone mode.

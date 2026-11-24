# Plugins

A plugin is a `.miyaplugin` archive (or a legacy single `.js` file) that you import through Preferences → Plugins, from your computer or from a web address. When Miyapad starts, it runs each switched-on plugin's code in `(manifest.order, id)` order and hands it a `miyapad` object with hooks, plugin storage, and checked views of Miyapad's state.

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

## Legacy `.js` files

Single `.js` files remain supported for existing plugins and quick scripts:

```js
// Replaces {{date}} in the prompt.
// @miyapad-min 2.9.0
// @miyapad-max 2.10
// @miyapad-start-timeout 5
// @miyapad-hook-timeout 10

const { hooks, storage } = miyapad;
const count = (await storage.get('count')) ?? 0;
await storage.set('count', count + 1);
hooks.prompt.push(async prompt => prompt.replaceAll('{{date}}', new Date().toDateString()));
```

- A `.js` plugin gets a synthetic manifest with `id` and `name` taken from the file name (or the last URL path segment) without `.js`, `order: 0`, and no `version`. Its row shows `no manifest` next to the version range.
- Optional `@miyapad-*` lines are read only from `//` comments at the top of the file, before the first line of code.
- Names that differ only in case resolve to the same existing key (`Foo.js` replaces `foo`), keeping saved data. Updating a legacy `.js` plugin from its URL keeps its legacy shape.

## Version and capability checks

Each plugin either **fits** this Miyapad version, is **mismatched** (outside its declared range), or is **undeclared** (neither `minMiyapad` nor `maxMiyapad`). Plugins can also require `"server"`. The tab marks incompatible rows with ⚠.

- Importing never switches a plugin on. The import confirmation mentions version mismatches, missing version bounds, or missing server support.
- Switching on a mismatched or undeclared plugin asks first; if confirmed, it stays on until Miyapad's version changes. A plugin requiring `"server"` cannot be switched on in standalone mode.
- At startup, enabled plugins that don't fit the current Miyapad version (unless allowed for it) or that require `"server"` in standalone mode are switched off before any plugin runs, and Preferences opens on the Plugins tab listing them.

## Importing from a URL and updating

Import from URL… accepts an `http://` or `https://` address pointing to a `.miyaplugin` archive or a `.js` file. Web pages (`text/html`) are refused. In server mode the server fetches the address via `/proxy-url`; in standalone mode the browser fetches it directly.

The address is saved with the plugin, and an Update button appears on its row:

- Update compares both `manifest.version` and `main.js`. If neither changed, it reports that the plugin is already up to date.
- For `.miyaplugin` archives, an archive whose `manifest.id` does not match the installed plugin is refused (`This archive is for a different plugin.`).
- When an archive update is available, the confirmation dialog shows either `<old> → <new>` or `changed, version still <version>`, together with the matching `## [<version>]` (or `## <version>`) section from `CHANGELOG.md` capped at 1,000 characters (`No notes for this version.` when absent).
- Confirming replaces the code and manifest, keeps the plugin's saved data and on/off state, and clears `allowedVersion`. Changes take effect after a reload.

## The `miyapad` object

### Stable vs unstable surface

| Surface | Fields |
| :--- | :--- |
| **Stable** (changes only with a `manifest.api` bump) | `id`, `name`, `version`, `hooks`, `storage`, `settings`, `generation`, `React`, `html` |
| **Unstable** (internal objects; may change in any release) | `sessionStorage`, `templateStorage`, `themeStorage`, `connectionStorage`, `samplerPresetStorage`, `api` |

Each plugin receives its own `miyapad` object (there is no `window.miyapad`):

| Field | What it is |
| :--- | :--- |
| `id` | The plugin's immutable identifier (`manifest.id`). |
| `name` | The plugin's display name (`manifest.name`). |
| `version` | Miyapad's version (`APP_VERSION` from `src/version.ts`). |
| `hooks` | Per-plugin view of shared hooks (`prompt`, `output`, `commands`) tagged with `id` and `hookTimeout`. |
| `storage` | Key-value storage isolated under `id`. |
| `settings`, `generation` | Checked live views of `useSettings` and `useGeneration`. |
| `React`, `html` | React and `htm`'s `html` tagged template helper. |
| `sessionStorage`, `templateStorage`, `themeStorage`, `connectionStorage`, `samplerPresetStorage`, `api` | Unstable internal storage instances and API router. |

## Miyapad's state

`miyapad.settings` and `miyapad.generation` expose the current values and setters from `useSettings` and `useGeneration` as plain properties via a proxy.

- Reads return the value from the latest render (`undefined` before Miyapad's first render).
- `set*` calls check the value's type, finiteness, and sidebar numeric range before calling the real setter, throwing `TypeError` or `RangeError` on invalid input. Update functions are refused; pass a concrete value.

## Hooks and error attribution

`hooks.prompt` and `hooks.output` are push-only views (`{ push(fn) }`). Entries pushed through `miyapad.hooks` carry both the plugin's `id` and its `hookTimeout` (10 seconds by default). `hooks.commands` is the shared command array.

- **`prompt`**: `(prompt: string) => string | Promise<string>`. Runs right before completion/chat requests and when Show Context previews the prompt.
- **`output`**: `(text: string, info: { complete: boolean }) => void | Promise<void>`. Runs on its own async queue after any generation that produced text.
- **`commands`**: `{ label: string, action: () => void }` entries appended to the Quick Switcher's `>` command list.

If a `prompt` or `output` hook throws, exceeds `hookTimeout`, or (for `prompt`) returns a non-string, Miyapad logs `[plugins] "<id>": …`, records the latest runtime failure under `id` in memory so Preferences → Plugins shows `Hook error: …` on that plugin's row, and skips the failed hook without aborting generation.

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

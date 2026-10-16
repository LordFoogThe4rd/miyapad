# Plugins

A plugin is a single `.js` file that you import through Preferences → Plugins. When Miyapad starts, it runs each switched-on plugin's code and hands it an object with Miyapad's internals, a few hooks, and storage that belongs only to that plugin.

Plugins get Miyapad's real internal objects, not a stable API. Any release can change those objects and break a plugin, and fixing the plugin is its author's job. That's why a plugin declares which Miyapad versions it works with.

## Trust

Plugin code runs in the same page as Miyapad. It can read your API keys and every session, write to any store, open the `MiyaPad` IndexedDB database directly, and call the server with your saved login. Nothing inside the page can stop it, so Miyapad doesn't try. The Plugins tab and the import dialog say this plainly. Only install plugins you trust.

In server mode, plugins are stored in the server's database, so anyone who can write to the server can add a plugin, and that plugin then runs in every browser that opens Miyapad. With the default `127.0.0.1` binding that's only you. If you expose the server on a LAN, set a password (`--password`).

## File format

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

- The plugin's name is its file name without `.js`. Importing a file whose name is already in use asks before replacing it; the replacement keeps the old plugin's saved data and is switched off. Names that differ only in case are the same plugin, so importing `Foo.js` when `foo` exists replaces `foo`. A file called `.js` is rejected.
- The file is the body of an async function with one argument, `miyapad`, so `await` works at the top level.
- The `@miyapad` lines are optional, and only read from the comment lines at the top of the file, before the first line of code. A version must be plain numbers (`2.9.0`, `2.10`), or the import is rejected.
- `@miyapad-min 2.0.0` on its own means 2.0.0 and every later version. A short max covers every release under it: `@miyapad-max 2.10` includes 2.10.3.
- `@miyapad-start-timeout` is how many seconds Miyapad waits for your top-level code before carrying on without you, and `@miyapad-hook-timeout` is how many seconds one of your hooks may run before it's skipped. Both are whole seconds and default to 5 and 10. A value that isn't a plain positive number rejects the import.
- Only `//` lines count. A header written in a `/* */` block isn't read at all, so the plugin imports as undeclared and is switched off at startup like any other undeclared plugin.

## Version checks

Each plugin either **fits** this Miyapad version, is **mismatched** (outside its range), or is **undeclared** (neither line). The tab marks the last two with ⚠.

- Importing never switches a plugin on. The import dialog mentions a mismatch or a missing declaration.
- Switching on a mismatched or undeclared plugin asks first. If you say yes, it stays on until Miyapad's version changes.
- After a Miyapad update, plugins that don't fit the new version and that you haven't allowed for it are switched off before anything runs. Once the app has loaded, Preferences opens on the Plugins tab with a notice listing them. Switch them back on to run them.

## The `miyapad` object

| Field | What it is |
| :--- | :--- |
| `name` | The plugin's own name. |
| `version` | Miyapad's version (`APP_VERSION` from `src/version.ts`). |
| `sessionStorage`, `templateStorage`, `themeStorage`, `connectionStorage`, `samplerPresetStorage` | The real storage objects created in `main()`. |
| `api` | The `src/api` module. |
| `React`, `html` | React and `htm`'s `html`, so a plugin can build UI the way Miyapad does. |
| `hooks` | This plugin's view of the shared hooks: `prompt` and `output` push entries wrapped with the plugin's hook timeout, and `commands` is the shared array. |
| `storage` | This plugin's own storage. |

There's no `window.miyapad`. Each plugin gets its own object, because `storage` is different for each.

## Hooks

`hooks.prompt` and `hooks.output` are push-only views of the hooks Miyapad runs: each has `push` and nothing else. Miyapad reads the hooks each time it uses them, so an entry pushed late, for example after startup stopped waiting for your plugin, still works. Plugins start in name order, so their entries run in name order. `hooks.commands` is the shared array, because commands are synchronous.

- **`prompt`**: `(prompt: string) => string | Promise<string>`. Runs right before the request is sent, after the token count and after chat mode adds the instruct suffix, so it sees exactly the text that would go out. It runs before the text is turned into chat messages, so it works for both the text-completion and chat APIs, and for `{fill}` requests too. The token counter keeps showing the count from before the hooks. A hook that throws or returns something that isn't a string is logged to the console and skipped: the next hook gets the prompt as it was, and the generation goes ahead. It also runs once each time you open Show Context, so the modal shows the prompt that would actually be sent; opening the modal and sending a request are two separate runs, so keep the hook cheap and repeatable, with no call counting and no non-idempotent side effects.
- **`output`**: `(text: string, info: { complete: boolean }) => void | Promise<void>`. Called once for each generation that produced any text, including ones that were cancelled, failed partway or were replaced by a newer one, and each `{fill}`. `text` is everything that generation produced. `complete` is true only when the stream ended normally and it's still the current generation. Output hooks run on their own queue, so a slow one doesn't hold up the Stop button. They can't change the text. Errors are logged.
- **`commands`**: `{ label: string, action: () => void }` entries, added to the end of the Quick Switcher's `>` commands. The list is rebuilt each time the switcher draws. An entry without a string label and a function action is left out.

An entry you push onto `prompt` or `output` carries your plugin's `@miyapad-hook-timeout` (10 seconds by default). A hook that runs longer is skipped like one that threw, and the next hook or the rest of the output chain carries on. A timeout stops Miyapad waiting for the hook; it doesn't cancel it.

## Storage

`miyapad.storage` saves data that belongs to your plugin. It works the same in the browser and on the server.

- `get(key)` returns the value, or `undefined`.
- `set(key, value)` saves the value. It's converted to JSON and back first, so a `Date` comes back as a string and a `Map` as `{}`. A value JSON can't hold (`undefined`, a `BigInt`) is refused with a `TypeError`.
- `delete(key)`.
- `keys()` returns your keys in the order you first set them.

Every call is a promise, and calls run one at a time in the order you make them. Miyapad keeps your keys under your plugin's name (`<name>/<key>`), with the key list under `<name>`, in the `PluginData` store; a value and the key list are saved together or not at all. Deleting the plugin deletes all of it. Plugin data is part of server backups and of the standalone database export.

## Rules for plugin authors

Nothing enforces these, but breaking them can break Miyapad or other plugins.

- Prefix your `localStorage` keys with `<name>:`.
- Never open the `MiyaPad` IndexedDB database. Adding a store means raising the database version, and after that Miyapad either refuses to open it or skips its own next upgrade. If you need IndexedDB, create your own database called `miyapad-plugin-<name>`.
- Only pass JSON to `storage.set`.
- To change the format of your saved data, keep a `schemaVersion` key and update your data when the plugin starts.
- Keep top-level code fast. Startup waits up to your `@miyapad-start-timeout` (5 seconds by default) for each plugin, then starts Miyapad without it while your code keeps running. The Plugins tab then says it took too long to start.

## Recommended behaviour

Nothing enforces these either. They keep a plugin well-behaved next to others, and to the person using Miyapad.

- **Keep prompt hooks cheap and repeatable.** They run before every request and each time Show Context opens, so the same input has to give the same output. Don't count calls or write storage in one; the preview and the real send are two separate runs.
- **Do slow setup inside hooks, not at the top level.** Top-level code delays Miyapad's first draw and is cut off by your start timeout; a slow hook is bounded by the hook timeout and is skipped without holding up the app.
- **Declare timeouts you'll actually meet.** A hook slower than its timeout is skipped. A plugin slower to start than its start timeout is left running while Miyapad carries on without it.
- **Treat every hook as best-effort.** A prompt hook that throws, returns something that isn't a string or times out is skipped, and the generation goes ahead. Errors reach the console, not the user, so don't rely on a hook having run.
- **Keep output hooks short.** They run one after another on their own queue, so a slow one delays the later output hooks, though not the UI. Move heavy work to your own promise chain.

## Loading

In `main()` (`src/main.tsx`), after the other stores are ready and before the app is drawn, `startPlugins` (`src/plugins.ts`):

1. Switches off and saves every switched-on plugin that doesn't fit this version, unless it was allowed for this version.
2. Runs each remaining switched-on plugin in name order, one at a time. A plugin that throws is logged and skipped, and the error shows next to it in the Plugins tab. One still running after its `@miyapad-start-timeout` (5 seconds by default) is left running.

What happened on this start (plugins switched off, errors, timeouts, skipped plugins) is kept in memory for the Plugins tab and not saved. Switching a plugin on or off takes effect after a reload, because there's no clean way to undo what a script already changed.

A start that takes longer than a moment shows a loading screen naming the plugin being started, with a Skip button. Skip stops the wait for the plugin that is starting and every one after it: they're left running-or-not for this session, are tried again after the next reload, and the Plugins tab says so on each row. Skip can't help a plugin stuck in a synchronous infinite loop, because the page is frozen and the button never gets the click; `?safe` is the way out of that. A plugin skipped before it starts registers no hooks this session.

## Safe mode

Add `?safe` to the address. No plugins run, and nothing is switched off or saved at startup. It works in both modes, without restarting the server. The Plugins tab says safe mode is on, and the switches still work, so you can switch off the plugin that broke things. The tab's Reload button removes `?safe`.

The crash screen has a "Reload without plugins" button that reloads with `?safe`. A plugin that breaks the page before React draws anything, or loops forever, never reaches the crash screen; type `?safe` yourself for those.

## Backups

Switching a plugin on doesn't make a backup. The Plugins tab shows how recent the newest one is instead:

- Server mode: the time of the last server backup and the backup interval, from the `backup` field of `/version`, or that automatic backups are off (`--noBackup`).
- Standalone: a "Download backup" button, the same export as Preferences → Editor → Export Full DB.

# Changelog

## [???] - unreleased

### Added

- Inline code and links are now styled in markdown formatting mode
- Statistics for your sessions, from Sessions → Statistics: generations run, tokens and characters the model produced, characters you wrote and deleted, time spent generating and average speed — for the session you have open and for all of them together. Text miyapad puts in the prompt for you (templates, `{predict}` and `{fill}` placeholders, search and replace, reformatting to another instruct template) is not counted as your own writing. Each section has its own Reset button
- Pick out several sessions in the Sessions list with ctrl-click, or a run of them with shift-click (or Select in a session's ⋯ menu, for touch screens). A bar above the list then moves all of them into a folder at once, or deletes them after a single confirmation
- Every session in the list now has a ⋯ button, and a right-click menu, with Export, Clone, History and Statistics for that session (History is greyed out while several sessions are picked, since a version history belongs to one of them). They used to be in the toolbar and only ever acted on the session you had open, so getting at another one meant opening it first. The toolbar keeps Create, Import, Export All and Statistics
- Folders in the Sessions list: drag a session onto another session to put both in a new folder, or onto a folder (or any session in it) to add it there. Drag a session to the box that appears above the list to take it back out. Folders can be collapsed, renamed (renaming one to another folder's name merges them) and removed, which keeps their sessions. The folder button next to each session does the same without dragging, for touch screens and keyboards: it opens a box that suggests the folders you already have, and typing a name that only differs in capitalisation joins the existing folder instead of making a second one. Leaving it empty takes the session out. Searching also matches folder names

### Changed

- Screenshots now open in a preview window inside miyapad instead of a new browser tab, with buttons to copy the image to the clipboard or save it. The file name is filled in from the session name and the date — change it before saving if you want something else
- Database backups are now LZMA-compressed `.7z` archives instead of `.gz` files, so they take up noticeably less space. Nothing needs to be installed — the server brings its own 7-Zip. Existing `.gz` backups are left alone and still count towards the retention limit
- Markdown formatting mode now hides the markup itself, like a live preview. The `#` of a heading, the `>` of a quote and the `-` of a bullet come back when you put the cursor on that line; `**`, backticks and link brackets come back only when the cursor is inside the word they wrap, and while they do, the line's own markers stay hidden so being inside a word does not also uncover the whole line's markup. Nothing is rewritten, so the hidden characters are still there and still copy out as markdown
- Opening a session now scrolls the prompt to the bottom, where the cursor is placed, instead of leaving you at the top of a long prompt
- New databases now store sessions more compactly — about 10% smaller on disk. The extra work happens during the housekeeping pass when miyapad shuts down, not while you are writing. Databases made before this keep the setting they were created with; nothing is rewritten and there is nothing to convert. Backups also come out slightly smaller

### Fixed

- Export All now saves your sessions when miyapad runs on its own without the server, instead of stopping on the first one and writing nothing
- Scrollbars now follow the theme's colors everywhere instead of showing the browser's default gray ones in modals, text areas and lists
- Renaming, pinning or tagging a session from the Sessions list no longer leaves a duplicate of it behind with its pins, tags and creation date missing
- The Sessions list on narrow screens no longer puts the column headers over the wrong columns or squeezes session names down to a letter or two

## [2.8.0] - 2026-09-16

### Added

- Version history for sessions: miyapad saves a version when you open a session, after a minute without edits, and before you delete or replace a large part of the prompt. Open it from Sessions → History and restore any version as a new session or over the current one (the current content is saved as a version first). In the Version History tab of Preferences you can change the number of versions kept (30 by default) and the deletion size that triggers a version (100 characters by default), and turn on a version before each generation
- Markdown formatting mode for the prompt editor: a toolbar toggle switches between plain source text and in-place styled rendering (headings, bold, italics, strikethrough, blockquotes, lists, tables, horizontal rules)

### Changed

- Server now always listens on `127.0.0.1` by default; additional addresses are opt-in via `--host` or `MIYAPAD_HOST`
- Hovering tokens in a long prompt no longer stutters
- Editing memory, the author's note or world info sends a third as many token-counting requests to your backend
- Typing and streaming stay responsive in long prompts — the editor now updates only the part of the highlighting that changed instead of rebuilding all of it on every keystroke and every generated token
- Markdown formatting mode no longer slows down as the prompt grows — styling is applied to the part of the document on screen instead of all of it, and scrolling keeps its place while it catches up
- Typing in markdown formatting mode is no longer held up by the formatting itself — characters appear immediately and the styling catches up a moment later

### Fixed

- Token counts no longer come out blank against an OpenAI-compatible server that answers the token-counting request in an unexpected format — miyapad now moves on to the next counting method instead
- Markdown formatting no longer leaks onto an unrelated part of the prompt while a construct is half-typed
- Opening a session no longer marks it as modified, so sorting sessions by modification date reflects actual edits
- Deleting the open session right after editing it no longer brings it back after a reload
- Pinning or tagging a session that isn't open no longer erases its content, and the pin or tags are now kept after a reload
- The world info token count in the Context panel now updates as soon as the active world info entries change
- Docker quick-start (`server/.env.example` + `docker-compose.yml`) now sets `MIYAPAD_HOST=0.0.0.0`, so the server is actually reachable through the container's port mapping instead of only binding to the container's own loopback interface

## [2.7.0] - 2026-08-11

### Changed

- Editor engine migrated from simple HTML textarea to ProseMirror

### Fixed

- The caret no longer gets stuck before a generated line break — it returns to the end of the document when generation finishes
- Re-tokenize button in the logit bias modal now shows a regenerate icon instead of a plain `+` text

### Removed

- Prompt preview feature

## [2.6.0] - 2026-07-20

### Added
- Language selector in Preferences (new "General" tab) with locale persistence and browser-language auto-detection on first visit; see the [Localization guide](https://github.com/LordFoogThe4rd/miyapad/wiki/Localization) to add or contribute a translation
- About dialog showing the current version, with a "Check for Updates" button that reports the latest release and links to the download
- Bundled `miyapad-update.sh` / `miyapad-update.ps1` scripts in server distributions for one-command updates
- Sampler Presets: save, load, and manage named sampler parameter presets (temperature, top-k, top-p, mirostat, DRY, XTC, etc.). Includes a manager modal, preset dropdown in the sidebar, preset cloning, and import from SillyTavern or NovelAI preset formats (experimental, please backup frequently and report any issues)
## [2.5.3] - 2026-07-03

### Fixed
- Running the server directly with `tsx server.ts` no longer shows "Cannot GET /" due to an incorrect frontend path

## [2.5.2] - 2026-07-03

### Fixed
- Closing the terminal or stopping miyapad as a systemd/Docker/Windows service now triggers a graceful shutdown (saves data, runs maintenance, closes database cleanly)
- Search and replace in regex mode now correctly replaces matched text with newlines when typing `\n` in the replace field
- Fireworks.ai compatibility: Ignore EOS token option is fixed and logprobs are capped at 5 to match their API limits, so strict API mode is no longer required for Fireworks
- TTS: fixed a regex bypass that could strip safety tokens when text contained newlines
- Screenshot capture: user-controlled text in the screenshot HTML is now properly escaped to prevent XSS

## [2.5.1] - 2026-06-27

### Fixed

- Proxy errors (403) now display a descriptive message instead of a cryptic "HTTP 403", making connection issues easier to diagnose
- Proxy no longer blocks requests to local/private-network LLM backends (localhost, 192.168.x.x, etc.)
- Switching sessions during text generation no longer corrupts the target session with output from the previous session
- Rapidly clicking sessions in the sidebar or Quick Switcher no longer causes sessions to appear overwritten with default content

## [2.5.0] - 2026-06-27

### Changed

- Codebase migrated from JavaScript to TypeScript
- Server now binds to localhost (`127.0.0.1`) by default

## [2.4.0] - 2026-06-11

### Added

- Connection Manager: save and switch between connection presets (endpoint, API type, model, API key) per session
- New modal for managing connection presets with model browser and API-specific settings

### Fixed

- Modal overlay now requires mousedown on the backdrop before click-to-close, preventing accidental dismissal when dragging text
- Modal tooltips no longer clipped by the modal content area — they now appear above input fields as intended
- Connection settings for strict mode and chat API toggle now apply to DeepSeek connections, not just OpenAI Compatible
- Connection clone now performs a deep copy to prevent shared references between original and duplicate
- Default endpoint for new connections changed from HTTPS to HTTP to avoid TLS certificate errors on local servers
- Rapidly clicking "Refresh List" in the connection model browser no longer risks stale data overwriting newer results
- Storage errors during connection save no longer leave the database and memory in an inconsistent state
- Page no longer crashes when deployed to GitHub Pages
- Sidebar and prompt area layout is no longer broken when opening the page from a local file

### Changed

- Session exports no longer include `endpoint` and `endpointAPIKey` fields (credential stripping)

## [2.3.2] - 2026-06-09

### Fixed

- Hardcoded 5-minute `zstd_incremental_maintenance` loop no longer runs unconditionally; the user-configured scheduler (mode, interval) now fully controls periodic maintenance. Default mode `shutdown` means zero automatic maintenance until server stop.

## [2.3.1] - 2026-06-09

### Changed

- Replaced `PRAGMA incremental_vacuum` with `zstd_incremental_maintenance` scheduler; added configurable maintenance mode (interval/startup/shutdown), duration, DB load, and optional WAL journal mode
- Renamed endpoints: `POST /incremental_vacuum` → `/zstd_maintenance`, `GET/POST /vacuum_config` → `/maintenance_config`
- Second SIGINT during maintenance shutdown now gracefully ignored
- Input validation on `POST /zstd_maintenance` (duration ≥ 0, dbLoad 0–1)
- Maintenance config fetch only runs when zstd extension is available
- WAL mode no longer re-applied on unchanged config saves
- Failed maintenance config saves now surface errors

## [2.3.0] - 2026-06-09

### Removed

- Unused `hideChatTemplates` feature (behind-the-scenes prompt affix-stripping mode that had no UI toggle)

### Changed

- Automatic backups are now gzip-compressed (`.backup.gz` instead of `.backup`); can be opened with any archive tool (7-Zip, Ark, etc.)

### Added

- DeepSeek provider — dedicated API support using `https://api.deepseek.com` with chat completions (`/chat/completions`) and FIM completions (`/beta/completions`); sidebar integration with API selector, read-only server input, and forced chat mode; skips token counting; EBNF grammar help
- Quick Switcher overlay (`Ctrl+P` / `Cmd+P`) to search and switch sessions via keyboard
- Pin/star sessions — click the star icon in the sessions modal to pin a session so it always floats to the top of the list; star indicator also shown in the Quick Switcher
- Automatic database backups — configurable periodic gzip-compressed backup of `web-session-storage.db` via `VACUUM INTO`, with mtime-based change-detection and automatic rotation
- Session tags — freeform tags on sessions with inline editing, AND/OR/NOT/wildcard tag filtering, and tooltip help in the Sessions modal

### Fixed

- Sidebar endpoint API switch no longer preserves pathname from the previous endpoint URL
- Session switch no longer updates the last modified date
- DeepSeek completions 400 error — `logprobs` now sent as integer (per API spec) instead of boolean for FIM endpoint
- DeepSeek default model changed to `deepseek-v4-flash` (`deepseek-chat` and `deepseek-reasoner` are deprecated)
- Starring a session no longer updates the last modified date

## [2.2.0] - 2026-06-06

### Added

- Editable context playground with live token counting in ContextModal

### Fixed

- ReDoS vulnerability in logit bias token ID regex
- Context playground state syncing only on modal open (not on every prop change)
- Token count reset to 0 on error for consistency
- Unnecessary API calls by guarding token counting effect with `isOpen`

### Changed

- Rename AGENTS.md section header from "Quick Links" to "Documentation"

### Performance

- Optimize `onInput` for long prompts: O(n²) back-matching → O(n) via push+reverse
- Add early-exit for append/deletion in cleanToOrig block using startsWith/endsWith
- Replace string concatenation with array join in affix reconstruction

## [2.1.0] - 2026-05-31

### Added

- Fade out animation on modal close (by @LordFoogThe4rd)
- UI animations and transitions (by @bg-l2norm)
- Tab content fade-in animation for PreferencesModal

### Fixed

- SQL injection in zstd_incremental_maintenance endpoint
- Path traversal in proxy endpoints and tokenizer loader
- Incomplete URL sanitization in openai.js and koboldcpp.js
- SSRF protection and XSS reflection in error responses

### Changed

- Replace sort arrow swap with CSS rotate for smoother transitions
- Add .gitattributes for automatic LF line endings

## [2.0.0] - 2026-05

First release.

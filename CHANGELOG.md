# Changelog

## [???] - unreleased

### Changed
- Re-tokenize button in the logit bias modal now shows a regenerate icon instead of a plain `+` text

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

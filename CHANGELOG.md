# Changelog

## [???] - unreleased

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

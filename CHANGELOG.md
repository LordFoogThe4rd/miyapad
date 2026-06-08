# Changelog

## [???] - unreleased

### Added
- Quick Switcher overlay (`Ctrl+P` / `Cmd+P`) to search and switch sessions via keyboard
- Pin/star sessions — click the star icon in the sessions modal to pin a session so it always floats to the top of the list; star indicator also shown in the Quick Switcher
- Automatic database backups — configurable periodic backup of `web-session-storage.db` via `VACUUM INTO`, with change-detection (`PRAGMA data_version`) and automatic rotation

### Fixed
- Session switch no longer updates the last modified date
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

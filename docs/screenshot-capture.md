# Screenshot Capture

The app has a native screenshot feature (ported from the [`mikupad-screenshot`](https://github.com/LordFoogThe4rd/mikupad-screenshot) userscript) that renders selected story text as a styled quote PNG.

## Key Files

- `src/hooks/useScreenshotCapture.js` — Core logic: reads selected text, uses `promptChunks` from context to color-code AI vs User text, builds a hidden HTML layout, renders to PNG via `html-to-image`, opens result in a new tab.
- `src/components/modals/ScreenshotModal.js` — Settings modal (12 fields: session name/date toggles, background URL/color, fonts, colors, avatar URL).

## Settings

Stored via `usePersistentState` in `SettingsContext.js` (keyed with `screenshot*` prefix). Buttons (camera + gear) are in the PromptContainer toolbar.

## Usage

Select text in the editor, click the camera icon. The screenshot opens in a new tab ready to save. Click the gear icon to customize the layout.

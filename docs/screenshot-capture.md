# Screenshot Capture

The app has a native screenshot feature (ported from the [`mikupad-screenshot`](https://github.com/LordFoogThe4rd/mikupad-screenshot) userscript) that renders selected story text as a styled quote PNG.

## Key Files

- `src/hooks/useScreenshotCapture.ts` — Core logic: reads selected text, uses `promptChunks` from context to color-code AI vs User text, builds a hidden HTML layout, renders to PNG via `html-to-image`, and opens the result in the preview modal (`modalState.screenshot`).
- `src/components/modals/ScreenshotPreviewModal.tsx` — Preview modal: shows the PNG with an editable file name (defaults to session name + date), a copy button (`navigator.clipboard.write`) and a download button. Rendered by `PromptContainer`.
- Settings live in the Screenshot tab of `src/components/modals/PreferencesModal.tsx` (12 fields: session name/date toggles, background URL/color, fonts, colors, avatar URL).

## Settings

Stored via `usePersistentState` in `SettingsContext.tsx` (keyed with `screenshot*` prefix). Buttons (camera + gear) are in the PromptContainer toolbar.

## Usage

Select text in the editor, then click the camera icon to capture only the selection. If nothing is selected, the entire prompt is captured. The screenshot opens in a preview modal where the file name can be edited before downloading, or the image copied to the clipboard. Click the gear icon to customize the layout.

The preview `<img>` is an object URL rather than the data URL `html-to-image` returns: a data URL has no path, so right-click → Copy image / Save image as makes the browser build a suggested file name out of the base64 payload. Only the download button can set the name (via the `download` attribute), so the object URL just keeps the fallback short.

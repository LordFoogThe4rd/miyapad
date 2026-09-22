# Screenshot Capture

Miyapad can turn selected story text into a styled quote PNG. The feature was ported from the [`mikupad-screenshot`](https://github.com/LordFoogThe4rd/mikupad-screenshot) userscript.

## Key Files

- `src/hooks/useScreenshotCapture.ts`: the core logic. It reads the selected text, uses `promptChunks` from context to colour AI and user text differently, builds a hidden HTML layout, renders it to PNG with `html-to-image`, and opens the result in the preview modal (`modalState.screenshot`).
- `src/components/modals/ScreenshotPreviewModal.tsx`: the preview modal. It shows the PNG with an editable file name (session name plus date by default), a copy button (`navigator.clipboard.write`) and a download button. `PromptContainer` renders it.
- The settings are in the Screenshot tab of `src/components/modals/PreferencesModal.tsx`. There are 12 fields: session name and date toggles, background URL and colour, fonts, colours, and avatar URL.

## Settings

Stored with `usePersistentState` in `SettingsContext.tsx`, under keys prefixed `screenshot*`. The two buttons (camera and gear) are in the PromptContainer toolbar.

## Usage

Select text in the editor and click the camera icon to capture just that selection. If nothing is selected, you get the whole prompt. The screenshot opens in a preview modal, where you can edit the file name before downloading or copy the image to the clipboard. Click the gear icon to change the layout.

The preview `<img>` uses an object URL instead of the data URL that `html-to-image` returns. A data URL has no path, so right-click → Copy image / Save image as would make the browser build a suggested file name out of the base64 payload. Only the download button can set the name (through the `download` attribute), so the object URL is there to keep the fallback name short.

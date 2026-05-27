# mikupad

**Fork of [mikupad](https://github.com/lmg-anon/mikupad) by lmg-anon** — major architectural overhaul with modern tooling and expanded features.

![image](https://github.com/user-attachments/assets/4c5fa8ff-5926-4a4b-807b-34e4f36a032c)

## Features

* **Multiple Backends**: Supports **llama.cpp**, **koboldcpp**, **AI Horde**, and any **OpenAI Compatible** API.
* **Session Persistence**: Your prompt is automatically saved and restored across multiple sessions. Import and export sessions for sharing or backups. The dedicated Sessions modal provides search, sort by name/created/modified, and a table layout for managing sessions. Database schema v4 with per-table column names avoids compression index collisions, with automatic V2→V3→V4 migration.
* **Optional Server**: Can be hosted on a local Node.js server for remote or LAN access. Features a modular architecture (`routes/` and `lib/` instead of monolithic `server.js`), **sqlite-zstd** transparent Zstandard compression with auto-vacuum and background dictionary training, and optional **server-side tokenization** — drop a `tokenizer.json` into `server/tokenizers/<name>/` and enable via Preferences → Server.
* **Persistent Context**:
  * **Memory**: Seamlessly inject text at the beginning of the context.
  * **Author's Note**: Seamlessly inject text at the end of the context, with adjustable depth.
  * **World Info**: Dynamically include extra information triggered by specific keywords.
* **Prediction Undo/Redo**: Easily experiment and refine generated text.
* **Token Probability**: Hover over any token to reveal the top 10 most probable tokens at that point. Click on a probability to regenerate text from that specific token. Token probability gradient endpoints and erase highlight are fully customizable via CSS variables instead of hardcoded. Optional server-side tokenization replaces client-side counting with accurate server-side counts.
  * If you're using oobabooga, make sure to use an \_HF sampler for this feature to function properly.
  * If you're using koboldcpp, token probabilities are only available with Token Streaming disabled.
* **Logit Bias**: Fine-tune generation by adjusting the likelihood bias of specific tokens on-the-fly.
* **Completion/Chat Modes**:
  * **Completion**: Have the model directly continue your prompt.
  * **Chat**: Automatically adds the right delimiters based on your selected template, structuring prompts into messages compatible with the Chat Completions API.
* **Screenshot Capture**: Select text in the editor, click the camera icon, and render a styled quote PNG with AI vs User color coding. Customize via the gear icon — fonts, colors, background image, avatar, and metadata toggles.
* **Themes**: Customize your environment with a variety of themes. Token highlight colors (`--color-prob-low`, `--color-prob-mid`, `--color-prob-high`) and erase highlight (`--color-highlight-erase`) are CSS variables, customizable per theme instead of hardcoded.

### Architecture

This refactored fork moves from a single monolithic HTML file to a **modular Parcel 2 project** (~60+ files across `src/`). The monolithic `styles.css` is split into 18 component-specific partials under `src/css/`, and global state is managed via **React Context API** (`SettingsContext`, `GenerationContext`) instead of inline global state.

> **Note:** The server requires the `sqlite-zstd` extension (`libsqlite_zstd.so` / `sqlite_zstd.dll` / `libsqlite_zstd.dylib` depending on platform — the server auto-detects the correct one). Obtain it from [sqlite-zstd releases](https://github.com/phiresky/sqlite-zstd/releases) or build from source, then place it in `server/`.

## Getting Started

Open `mikupad.html` in your web browser. No additional installation is required. Choose your preferred backend and start generating text!

```shell
git clone https://github.com/LordFoogThe4rd/mikupad-refactored.git
cd mikupad-refactored
open mikupad.html
```

To run the optional Node.js server:

```shell
npm install
npm start
```

For full offline use, download the pre-compiled `mikupad.html` from [Releases](https://github.com/LordFoogThe4rd/mikupad-refactored/releases/latest).

## Contributing

Contributions are welcome. To contribute:

1. Fork the repository.
2. Create a new branch: `git checkout -b feature/your-feature-name`
3. Make your changes and commit: `git commit -m 'Add your feature'`
4. Push to your fork: `git push origin feature/your-feature-name`
5. Open a pull request.

## License

This project is licensed under the GNU Affero General Public License v3.0 — see the [LICENSE](LICENSE) file for details.

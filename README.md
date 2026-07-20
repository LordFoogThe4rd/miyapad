# 🐈 miyapad

Miyapad is a user-friendly, browser-based interface for interacting with language models. It is a fork of [mikupad](https://github.com/lmg-anon/mikupad) by lmg-anon with a major architectural overhaul, modern tooling and expanded features.

![image](docs/assets/tw76055.png)

## Features

* **Multiple Backends**: Supports **llama.cpp**, **koboldcpp**, **AI Horde**, **DeepSeek** and any **OpenAI Compatible** API.
* **Connection Manager**: Save named connection presets (endpoint, API type, API key, model) and switch between them per-session. Each session remembers its selected connection. Presets include per-API-type settings, a model browser, and CRUD operations (create, clone, delete, enable/disable).
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
* **... and more!**

### Architecture

This refactored fork moves from a single monolithic HTML file to a **modular Parcel 2 project** (~60+ files across `src/`). The monolithic `styles.css` is split into 20 component-specific partials under `src/css/`, and global state is managed via **React Context API** (`SettingsContext`, `GenerationContext`) instead of inline global state.

## Getting Started

Open [miyapad on GitHub Pages](https://lordfoogthe4rd.github.io/miyapad/) or download the pre-compiled `miyapad.html` from [Releases](https://github.com/LordFoogThe4rd/miyapad/releases/latest) and open it in your browser.

For the full server + frontend, download the standalone distribution archive from [Releases](https://github.com/LordFoogThe4rd/miyapad/releases/latest) for your platform, extract, and run the launch script.

### Optional Server

#### Standalone Distribution (unzip and run)

1. Download `miyapad-<platform>-x64.{tar.gz,zip}` from [Releases](https://github.com/LordFoogThe4rd/miyapad/releases/latest)
2. Extract the archive
3. Run `./miyapad.sh` (Linux/macOS) or `miyapad.bat` (Windows)

No install needed — Node.js and native addons are pre-packaged.

#### From Source

From the `server/` directory:

```shell
npm install
npm start
```

See [Backend Server](docs/backend-server.md) for CLI options and environment variables.

### Building

```shell
npm install && npm run build        # Frontend only → dist/miyapad.html
npm run build:dist                  # Frontend + standalone distribution → server/miyapad-dist/
```

## Security

Network security concerns associated with hosting Miyapad on a public-facing server are out of scope of this project. It is the user's responsibility to secure their instance (e.g., with a reverse proxy, authentication, firewall rules, etc.) when exposing it to untrusted networks. Pull requests addressing such concerns are welcome and will be reviewed, as long as they don't break any localhost functionality.

## Contributing

Contributions are welcome. To contribute:

1. Fork the repository.
2. Create a new branch: `git checkout -b feature/your-feature-name`
3. Make your changes and commit: `git commit -m 'Add your feature'`
4. Push to your fork: `git push origin feature/your-feature-name`
5. Open a pull request.

## License

This project is licensed under the GNU Affero General Public License v3.0 — see the [LICENSE](LICENSE) file for details.

## Miya

<div style="text-align: center;">
    <img width="100%" src="docs/assets/miya.gif">
</div>

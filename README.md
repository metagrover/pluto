# Pluto

Intelligent meeting assistant and "second brain" application.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v24.11)
- **pnpm** (enable via `corepack enable` or install directly)
- **Apple Silicon Mac** (Intel macOS, Windows, and Linux are not currently supported)
- **macOS only:** Xcode Command Line Tools (`xcode-select --install`) for Swift builds

### Installation (for Contributors)

1.  **Clone the repository**
    ```bash
    git clone https://github.com/metagrover/pluto.git
    cd pluto
    ```

2.  **Install Node Dependencies**
    ```bash
    pnpm install
    ```
    This installs JavaScript dependencies only. Python and native capture tooling stay explicit so setup is easier to reason about.

3.  **Run the App**
    ```bash
    pnpm start
    ```
    Development startup builds any missing or stale native transcription and
    audio-capture executables before launching Pluto. On first use, Pluto then
    downloads and verifies its local transcription models in the setup screen.
    `pnpm dev` runs the same source app with hot reload. Both commands use the
    same persistent local profile, so your meetings remain visible when switching
    commands. A fresh profile creates its own local encryption key; no signed
    app installation or shared key is required. macOS may request Keychain access.

    To use an isolated profile for development or testing:
    ```bash
    PLUTO_USER_DATA_DIR="$HOME/Library/Application Support/pluto-sandbox" pnpm dev
    ```
    Existing profiles are never moved or merged automatically. If you previously
    recorded into `/tmp/pluto-development-profile`, use that path as the explicit
    override to reopen those meetings. Keep encryption keys and meeting data out
    of Git. See [profile troubleshooting](docs/dev.md#source-startup-and-local-profiles)
    for Keychain and signed-app profiles.

Python is needed only for optional speaker-attribution benchmarks. For those,
install Python 3.10+ and run `pnpm run setup-python`. FFmpeg and ffprobe for the
app are supplied by the project dependencies.

Agent project guidance lives in [AGENTS.md](AGENTS.md); no skill installation is
needed.

### Contributor Verification

Run the default contributor checks from a plain local checkout:

```bash
pnpm run lint
pnpm exec vitest run
```

If you want to run the local database / LLM probe tests as well, use:

```bash
pnpm run test:manual
```

Those manual probes expect a populated local Pluto database plus any provider credentials they exercise, so they are intentionally excluded from the default contributor verification path.

### 🛠 Troubleshooting

#### Electron ABI Mismatch (`better-sqlite3`)
For Electron, verify and repair the binding with:

```bash
pnpm run ensure:sqlite-abi
```

For Node/Vitest tests that report a binding or ABI error:

```bash
pnpm rebuild better-sqlite3
```

Before returning to Electron, run `pnpm run ensure:sqlite-abi` again (also run
automatically by `pnpm run dev`).

For more detailed troubleshooting, see [docs/dev.md](docs/dev.md).

### macOS Permissions

Pluto requires:
- **Microphone** access
- **System Audio Recording Only** (Privacy & Security → Screen & System Audio Recording)

If permissions change, macOS requires a full app restart.

## 📦 Building for Production

To create a DMG installer with the native capture and Parakeet runtimes:

```bash
pnpm run build
```

The output DMG will be in `release/`.

## 🛠 Project Structure

- `src/` - React UI and shared TypeScript
- `electron/` - Electron main process
- `native/` - Native transcription and calendar runtimes
- `python/` - Optional local speaker-attribution and benchmark tooling
- `scripts/` - Build and setup automation scripts
- `resources/` - Assets and bundled binaries (built by `pnpm run build-native`)

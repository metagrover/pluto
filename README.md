# Pluto

Intelligent meeting assistant and "second brain" application.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v24.11)
- **pnpm** (enable via `corepack enable` or install directly)
- **Python** (v3.10.x recommended, via `pyenv`)
    - *Note: You do NOT need to install Python libraries globally. The project handles this for you.*
- **FFmpeg** (`brew install ffmpeg` on macOS)
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

3.  **Set up Python Environment**
    This installs WhisperX and ML dependencies into a local virtual environment. This may take a few minutes.
    ```bash
    pnpm run setup-python
    ```

4.  **Build native audio tools (macOS)**
    This builds the Swift binaries used for microphone + system audio capture.
    ```bash
    pnpm run build-native
    ```

5.  **Run the App**
    ```bash
    pnpm run dev
    ```

### Contributor Verification

Run the default contributor checks from a plain local checkout:

```bash
pnpm run lint
pnpm test -- --run
```

If you want to run the local database / LLM probe tests as well, use:

```bash
pnpm run test:manual
```

Those manual probes expect a populated local Pluto database plus any provider credentials they exercise, so they are intentionally excluded from the default contributor verification path.

### 🛠 Troubleshooting

#### Electron ABI Mismatch (`better-sqlite3`)
If you see an error like `NODE_MODULE_VERSION mismatch` or tests fail because of `better-sqlite3`, run:
```bash
pnpm run fix-sqlite-abi
```

If a manual test or ad hoc Node script still cannot find the local `better-sqlite3` binding afterward, rebuild it for the current Node runtime:

```bash
pnpm rebuild better-sqlite3
```

For more detailed troubleshooting, see [docs/dev.md](docs/dev.md).

### macOS Permissions

Pluto requires:
- **Microphone** access
- **System Audio Recording Only** (Privacy & Security → Screen & System Audio Recording)

If permissions change, macOS requires a full app restart.

## 📦 Building for Production

To create a DMG installer that includes the bundled Python environment (no client-side setup required):

```bash
pnpm run build
```

The output DMG will be in `release/`.

## 🛠 Project Structure

- `src/` - React/Electron source code
- `python/` - Python server (WhisperX) and requirements
- `scripts/` - Build and setup automation scripts
- `resources/` - Assets and bundled binaries (built by `pnpm run build-native`)

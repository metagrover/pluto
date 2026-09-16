# Pluto

Intelligent meeting assistant and "second brain" application.

## Install Pluto

Pluto currently ships as an unsigned Apple Silicon macOS application. Download
the DMG from the latest [GitHub Release](https://github.com/metagrover/pluto/releases/latest),
open it, and drag `Pluto.app` into `/Applications`.

Because the first releases are not notarized, macOS may block the first launch.
Open **System Settings → Privacy & Security**, review the warning, and choose
**Open Anyway** only if the publisher, release tag, and SHA-256 checksum match
the GitHub release. Pluto never asks you to run a remote installer command or
disable Gatekeeper.

Updates are manual: Pluto opens the exact newer DMG in your browser. Quit Pluto,
open the DMG, drag the new app into `/Applications`, and approve replacing the
old app. User data remains in `~/Library/Application Support/pluto`; replacing
the application bundle does not replace that directory. To roll back the app,
install an older DMG. A database created by a newer incompatible Pluto version
will be rejected rather than downgraded.

Before a major or destructive schema migration, Pluto writes a durable,
hash-verified backup under `~/Library/Application Support/pluto/db-backups`.
If automatic migration recovery cannot prove either the source or target state,
Pluto stops without replacing the database and offers explicit backup
restoration. Failed database artifacts are retained for diagnosis.

Pluto is released under the [MIT License](LICENSE).

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
    pnpm run dev
    ```
    Development startup builds any missing or stale native transcription and
    audio-capture executables before launching Pluto. On first use, Pluto then
    downloads and verifies its local transcription models in the setup screen.

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

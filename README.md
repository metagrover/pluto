<p align="center">
  <img src="src/assets/brand/pluto_logo.svg" alt="Pluto" width="120" height="120" />
</p>

<h1 align="center">Pluto</h1>

<p align="center">
  <strong>A local-first meeting assistant and second brain for Apple Silicon Macs.</strong>
</p>

<h3 align="center">
  <a href="https://github.com/metagrover/pluto/releases">⬇ Download Pluto</a>
</h3>

<p align="center">Apple Silicon · macOS 14.2 or later</p>

<p align="center">
  <a href="#install-pluto">Install guide</a> ·
  <a href="#ai-models">AI models</a> ·
  <a href="#privacy-and-data">Privacy</a> ·
  <a href="#development">Build from source</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="LICENSE">MIT License</a>
</p>

Pluto turns conversations into a connected working memory. Capture meeting audio,
follow a local transcript, and return to notes, decisions, commitments, and the
context behind them. People and projects connect that history across meetings;
Ask Pluto helps you find answers with links back to supporting evidence.

Capture and speech recognition run on your Mac. For summaries and chat, choose a
local model through Ollama or configure a cloud provider with your own API key.
See [Privacy and data](#privacy-and-data) for that boundary.

**Status:** Pluto is under active development. Apple Silicon macOS is the supported
platform; Intel Macs, Windows, and Linux are not supported. Generated notes,
speaker attribution, and answers can be wrong—review the source before relying
on them.

## What you can do

- **Capture conversations without a meeting bot.** Record microphone and system
  audio directly on macOS, without installing a virtual audio device.
- **Transcribe locally.** Native Swift runtimes use Parakeet models through
  FluidAudio and Core ML for live text and final transcription.
- **Return to the important details.** Review meeting notes, decisions, action
  items, and searchable transcripts with paths back to source evidence.
- **Keep context across meetings.** People, Projects, and commitments bring
  related conversations together.
- **Prepare for the next conversation.** Use local calendar context and previous
  discussions to build meeting preparation.
- **Ask questions across your history.** Ask Pluto uses accumulated meeting
  context and provides citations to supporting material.
- **Review speaker identity.** Local speaker evidence supports attribution;
  calendar attendees are hints, not proof of who spoke. Identity confirmations
  and manual corrections remain important.

## Install Pluto

For people who want to use the app, the packaged Mac installer is the simplest
path. You do not need Node.js, pnpm, Xcode, or Python to use a packaged installer.

**[Download the Mac DMG](https://github.com/metagrover/pluto/releases)** · [Release notes](https://github.com/metagrover/pluto/releases)

### What you need

- An **Apple Silicon Mac** (M1 or later) running **macOS 14.2 or later**.
- An internet connection for initial model downloads.
- For notes and chat, either **Ollama with a local model** or an **API key for a
  supported cloud provider**. See [AI models](#ai-models).

Intel Macs, Windows, and Linux are not currently supported. Model downloads need
additional disk space; local intelligence also needs memory appropriate to your
chosen model.

### Install with one command

During private testing, with GitHub CLI already signed in and access to this repo:

```sh
gh api -H 'Accept: application/vnd.github.raw+json' repos/metagrover/pluto/contents/scripts/install-macos.sh | bash
```

Once this repository and its releases are public, anyone can use:

```sh
curl -fsSL https://raw.githubusercontent.com/metagrover/pluto/master/scripts/install-macos.sh | bash
```

Both commands download the newest published release (including RCs), verify its
SHA-256 checksum and app identity/version/signature, install Pluto into
Applications, remove only its quarantine attribute, and launch it. No manual DMG
download or dragging is needed. The public command needs no GitHub account,
Homebrew, Node, or Xcode. If Applications isn't writable on a new installation,
it uses `~/Applications`. Quit Pluto before upgrading; your profile and models
are preserved. Failed verification leaves an existing app in place.

Running the installer explicitly trusts this repository and Pluto's unnotarized
release. It does not disable Gatekeeper globally or grant microphone, audio, or
calendar permissions. Checksums and ad-hoc signatures verify integrity, not
Apple's malware review. You can [inspect the installer](scripts/install-macos.sh).

### Install manually

Download the DMG from the [release listing](https://github.com/metagrover/pluto/releases)
and drag Pluto into Applications. If macOS blocks it, use **System Settings →
Privacy & Security → Open Anyway**, or explicitly trust the installed app with:

```sh
xattr -dr com.apple.quarantine "/Applications/Pluto.app" && open "/Applications/Pluto.app"
```

### First launch and your first recording

1. Follow the setup screen to download and verify the local transcription
   models. Wait for setup to finish before recording.
2. Click **Allow microphone** and **Allow system audio** during setup. The
   system audio check briefly plays a test sound and requests macOS access.
   Grant **Microphone** and **System Audio Recording** access when prompted.
   Calendar access is optional. See [macOS permissions](#macos-permissions).
3. Open **Settings → Intelligence** and choose a provider for notes and chat:
   use Ollama with installed local models, or enter your own cloud API key.
   Cloud intelligence sends meeting text to the selected provider.
4. Start a short recording, speak into your selected microphone, and check the
   live transcript. For a call, check that incoming system audio is captured too.
5. Stop recording, wait for transcription and configured intelligence processing
   to finish, then review the transcript and generated notes.

Speech models and Ollama models are separate downloads. For provider setup, see
[AI models](#ai-models); for audio or startup problems, see
[Troubleshooting](#troubleshooting).

### macOS permissions

| Permission | Purpose |
| --- | --- |
| Microphone | Capture your microphone input. |
| System Audio Recording | Capture audio playing through your Mac. The settings category may be called **Screen & System Audio Recording**, depending on macOS. |
| Calendar, optional | Read local calendar events for upcoming meetings and preparation. Pluto does not write calendar events. |

Calendar reads the accounts already configured in the macOS Calendar app; an
Apple ID is only needed for iCloud calendars, not for microphone or system audio
access. Local, Google, and Exchange calendars can also be used. Allow time to
answer the calendar permission dialog.

Review permissions in **System Settings → Privacy & Security**. Restart Pluto
after changing them. The capture path records audio; it does not record screen
video. Tell participants when you are recording and obtain the permission
required for your conversation.

## AI models

Transcription uses Pluto's local native runtime. Meeting notes, preparation, and
Ask Pluto use the intelligence provider configured in **Settings**.

### Local intelligence with Ollama

For local notes and chat, start with **Gemma 4 12B for analysis** and
**Phi-4 Mini for fast chat**. These are Pluto's current UI defaults; you can
replace either with another installed model that fits your Mac.

1. **[Download Ollama for Mac](https://ollama.com/download/mac)**, drag it into
   **Applications**, and open it. Complete its setup so the `ollama` command is
   available in Terminal.
2. **Download the two models.** Open Terminal and run:

   ```bash
   ollama pull gemma4:12b
   ollama pull phi4-mini:3.8b
   ```

   The first downloads can take several minutes. Model storage and memory use
   depend on the model and context size; allow room for Pluto and other apps too.
3. **Configure Pluto.** Open **Settings → Intelligence**, select **Ollama**, and
   enter these names:

   | Setting | Model | Used for |
   | --- | --- | --- |
   | Local Analysis & Deep Model | `gemma4:12b` | Meeting preparation and deeper cross-meeting analysis. |
   | Fast Chat Model | `phi4-mini:3.8b` | Quick Ask Pluto answers. |

4. **Check the downloads.** Both models should appear when you run:

   ```bash
   ollama list
   ```

5. **Keep Ollama running** while using Pluto. Record a short conversation and
   try asking a question about it after processing finishes.

If Pluto cannot connect to Ollama, open the Ollama app again. If you use the CLI
without the app, start the local service with `ollama serve` in a separate
Terminal window and leave it running.

For model details and other sizes, see
[Gemma 4](https://ollama.com/library/gemma4) and
[Phi-4 Mini](https://ollama.com/library/phi4-mini). On a Mac with limited memory,
choose a smaller model and update the corresponding field in Pluto. Larger
models need more resources; try them with your own workflows before switching.

With speech models and local Ollama models downloaded, capture, transcription,
and local intelligence do not require a cloud provider or API key. Initial
setup, model downloads, and updates still need network access. Ollama models
are separate from the transcription models downloaded by Pluto.

### Cloud intelligence with your own key

Pluto supports **OpenAI**, **Anthropic Claude**, **Google Gemini**, and
**OpenRouter**. Select a provider, configure a supported model, and add your API
key in Settings. Cloud requests require network access and may incur charges
from the provider.

Using a cloud provider sends the text and context needed for the requested
intelligence operation to that provider, which can include transcripts, notes,
and retrieved meeting context. Review the provider's data policies before using
it with sensitive conversations.

## Privacy and data

Local-first describes where capture, transcription, and storage happen. Your
choice of intelligence provider determines whether meeting text leaves your Mac.

- **Capture and transcription:** audio is processed by the local native runtime.
  The transcription path does not use a hosted speech-to-text API.
- **Intelligence:** local Ollama runs on your machine when configured with a local
  endpoint; cloud providers receive the context used for their requests.
- **Database:** new profiles make a one-time choice between Standard setup
  (without app-level database encryption) and Encrypted setup (SQLCipher through
  `better-sqlite3-multiple-ciphers`). Encrypted setup uses Electron `safeStorage`,
  backed by macOS Keychain, and may request permission. Existing profiles keep
  their current database format. Provider credentials use secure storage with
  either setup and may require separate Keychain permission.
- **Recording files:** database encryption does **not** mean all audio files are
  encrypted. Encrypted capture is currently disabled by default and requires an
  explicitly enabled, verified signed distribution build. Source development
  uses the default unencrypted recording path. Historical recordings are not
  automatically encrypted. See the current
  [encryption rollout policy](electron/encryptionRollout.ts).
- **Exports and diagnostics:** treat recordings, exported text, local databases,
  logs, and recovery keys as private. Keep them out of issues, pull requests, and
  shared screenshots.

### Local profiles

`pnpm dev` and `pnpm start` share the default macOS profile at
`~/Library/Application Support/pluto`, also used by the installed app. Saved
meetings and calendar selections belong to that profile. macOS permissions
belong to the running app and may need to be granted again when switching
between source and packaged builds. A saved calendar selection does not grant
Calendar access to another build.

To keep test recordings separate from your regular meeting history, run:

```bash
PLUTO_USER_DATA_DIR="$HOME/Library/Application Support/pluto-sandbox" pnpm dev
```

Packaged builds also honor `PLUTO_USER_DATA_DIR` or `--user-data-dir=/absolute/path`
when launching the app executable. Profile overrides do not copy or merge data.

A fresh profile chooses its database setup before the database is created.
The choice is fixed for that profile and shown in Advanced settings. Only
Encrypted setup creates a database encryption key. Existing profiles are not
moved, merged, or converted automatically. Backups of encrypted data also need the original
key access or a supported recovery path. If a profile cannot unlock, preserve
its database and key envelope; see
[profile troubleshooting](docs/dev.md#source-startup-and-local-profiles).

## Development

For contributors and people who want to build or run Pluto from source. If you
only want to use the packaged app, start with [Install Pluto](#install-pluto).

### Requirements

- An **Apple Silicon Mac** running **macOS 14.2 or later**. System audio capture
  uses Core Audio process taps introduced in macOS 14.2.
- **Node.js 24.11.0**, the version pinned in `package.json` and used by release CI.
- **pnpm 9**, the version used by release CI.
- **Xcode Command Line Tools with Swift 6.0 or later** and a compatible macOS SDK.
  Install the tools with `xcode-select --install` if needed, then check
  `swift --version` and `xcode-select -p`.
- An internet connection for dependency installation and initial model downloads.
  Local models require additional disk space and memory; requirements depend on
  the models you choose.

Python is only needed for optional benchmark tooling. FFmpeg and ffprobe are
supplied by project dependencies.

### Run from source

```bash
git clone https://github.com/metagrover/pluto.git
cd pluto
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` prepares the media tools, checks the Electron SQLite binding, builds
missing or stale native capture and transcription executables, and prepares the
calendar helper before launching the app with hot reload. `pnpm start` runs the
same source app and startup preparation. The first native build can take several
minutes; compiler tools are required even though the scripts automate the build.

On first use, follow Pluto's setup screen to download and verify the local
transcription models, grant audio permissions, and configure an intelligence
provider for notes and chat. Speech models and Ollama models are separate downloads.

### Repository layout

```text
src/                 React UI and shared TypeScript
electron/           Electron main process, IPC, storage, and intelligence
native/             Swift transcription and calendar packages
resources/          Audio capture Swift sources, model manifests, and assets
scripts/            Build, runtime preparation, and maintenance tools
tests/              Automated tests and opt-in manual/provider checks
python/             Optional benchmark and research tooling
docs/               Developer guides, architecture, and design history
```

The UI communicates with Electron over IPC. Electron coordinates native audio
capture and transcription processes, persists local data, and calls the selected
intelligence provider. Native transcription is implemented in Swift; Python is
not the app's speech runtime.

See [developer troubleshooting](docs/dev.md) for runtime details and
[architecture notes](docs/architecture.md) for additional background. Historical
design documents may describe proposed or superseded behavior; check the current
implementation when changing a subsystem.

### Verification

Run checks appropriate to your change:

```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm exec vitest run
```

For a focused test run, pass the relevant test paths to Vitest. Changes to
capture, persistence, migrations, identity, attribution, or provenance should
include focused regression coverage and an explanation of what was verified.

`pnpm run check` runs Biome's combined lint and formatting checks.
`pnpm run fix` writes fixes; review the resulting diff before committing.
Manual tests and provider benchmarks are opt-in; see [docs/dev.md](docs/dev.md)
and the scripts in `package.json` before running them with private data or paid
providers.

### Build a macOS installer

```bash
pnpm run build
```

This type-checks and builds the app, builds the native runtimes, and packages an
**arm64** DMG under `release/<version>/`. The configured filename is
`Pluto-Mac-<version>-Installer.dmg`. A local package build does not establish
Apple signing or notarization; the current release workflow disables signing
identity discovery. See [packaging configuration](electron-builder.json5) and
[release workflow](.github/workflows/release.yml).

## Troubleshooting

**SQLite native module mismatch:** if Node/Vitest reports an ABI error, run
`pnpm rebuild better-sqlite3`. Before returning to Electron, run
`pnpm run ensure:sqlite-abi`; development startup also performs that check.

**Swift or transcription runtime errors:** verify the active compiler and SDK,
then run `pnpm run build:parakeet`. The setup screen must finish downloading
and verifying the speech models before transcription is available.

**Missing audio:** check microphone and system audio permissions, confirm the
selected input device, and restart Pluto after changing macOS permissions.

**Keychain or database unlock errors:** allow access for the Pluto runtime you
intend to use. Standard setup applies to new profiles; an existing encrypted
database still needs its original key. **Open Anyway** permits an unsigned app
to launch but does not grant Keychain access. An ad-hoc signed update may need
renewed Keychain permission. If no prompt appears, the recovery dialog
distinguishes Keychain unavailability from a failed key decryption. Keep the
database and key envelope together; see [docs/dev.md](docs/dev.md) for recovery
guidance.

## Contributing

Bug reports, documentation improvements, and focused pull requests are welcome.
For a substantial change, open an issue first to discuss the intended behavior.

1. Fork the repository and create a branch from its default branch.
2. Keep changes focused and follow the surrounding code and UI patterns.
3. Preserve source recordings, transcripts, provenance, identity confirmations,
   and reversible user data. Ground generated claims in evidence.
4. Run relevant checks and describe the behavior, verification, and limitations
   in your pull request.

For bug reports, include your macOS version, Mac architecture, Pluto version or
commit, reproduction steps, and sanitized error messages. Use fictional data in
examples and fixtures. Never include meeting content, participant details, audio,
credentials, or recovery keys in public reports.

For a security vulnerability, use GitHub's private **Report a vulnerability**
option if it is enabled for this repository. Keep sensitive details out of public
issues; if private reporting is unavailable, request a private contact without
publishing the vulnerability details.

## License and acknowledgments

Pluto's project code is licensed under the [MIT License](LICENSE). Third-party
code, fonts, and downloaded models retain their own licenses and notices.

Pluto builds on Electron, React, Core ML, FluidAudio, NVIDIA Parakeet, SQLite,
Drizzle, and Ollama. Transcription model revisions and attribution are recorded
in the [model manifest](resources/model-manifests/parakeet-tdt-0.6b-v3.json) and
[transcription notices](resources/model-manifests/FluidAudio-NOTICE.txt).
Vendored FluidAudio includes its [license](native/parakeet-runtime/vendor/FluidAudio/LICENSE)
and third-party notices; bundled fonts include
[Inter](src/assets/fonts/pluto-site/Inter-LICENSE.txt) and
[Lora](src/assets/fonts/pluto-site/Lora-LICENSE.txt) license files.

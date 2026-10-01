<p align="center">
  <img src="src/assets/brand/pluto_logo.svg" alt="Pluto" width="120" height="120" />
</p>

<h1 align="center">Pluto</h1>

<p align="center">
  <strong>A local-first meeting assistant and second brain for Apple Silicon Macs.</strong>
</p>

<p align="center">
  <a href="#getting-started">Getting started</a> ·
  <a href="#ai-models">AI models</a> ·
  <a href="#privacy-and-data">Privacy</a> ·
  <a href="#development">Development</a> ·
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

## Getting started

The source setup below is the documented way to run Pluto. Packaged installers,
when published, are available on the repository's
[Releases page](https://github.com/metagrover/pluto/releases). Check the release
notes for availability and signing status.

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

### macOS permissions

| Permission | Purpose |
| --- | --- |
| Microphone | Capture your microphone input. |
| System Audio Recording | Capture audio playing through your Mac. The settings category may be called **Screen & System Audio Recording**, depending on macOS. |
| Calendar, optional | Read local calendar events for upcoming meetings and preparation. Pluto does not write calendar events. |

Review permissions in **System Settings → Privacy & Security**. Restart Pluto
after changing them. The capture path records audio; it does not record screen
video. Tell participants when you are recording and obtain the permission
required for your conversation.

## AI models

Transcription uses Pluto's local native runtime. Meeting notes, preparation, and
Ask Pluto use the intelligence provider configured in **Settings**.

### Local intelligence with Ollama

Install and run Ollama, download a model that fits your Mac, and select **Ollama**
in Pluto's Settings. Configure the local analysis and fast chat model names to
match models installed on your machine. You can check installed models with:

```bash
ollama list
```

Keep the Ollama service running while using local intelligence. With the speech
and intelligence models downloaded and Ollama running locally, capture,
transcription, and local intelligence do not require a cloud model provider.
Initial setup, model downloads, and updates still need network access.

The UI model defaults are defined in
[`src/utils/ollamaModels.ts`](src/utils/ollamaModels.ts); provider fallback defaults
live in [`electron/llm/providerCatalog.ts`](electron/llm/providerCatalog.ts).
Select model names supported by your installation rather than assuming every
default is available or suitable for your hardware.

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
- **Database:** persistent meeting data uses SQLCipher through
  `better-sqlite3-multiple-ciphers`. Application key envelopes and provider
  credentials use Electron `safeStorage`, backed by macOS Keychain.
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
`~/Library/Application Support/pluto`. To keep development recordings separate
from your regular meeting history, run:

```bash
PLUTO_USER_DATA_DIR="$HOME/Library/Application Support/pluto-sandbox" pnpm dev
```

A fresh profile creates its own local encryption key. Existing profiles are not
moved or merged automatically. Backups of encrypted data also need the original
key access or a supported recovery path. If a profile cannot unlock, preserve
its database and key envelope; see
[profile troubleshooting](docs/dev.md#source-startup-and-local-profiles).

## Development

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
intend to use. Preserve the existing data and key envelope; an envelope tied to
a signed app identity may require that same signed app to unlock it. See
[docs/dev.md](docs/dev.md) for recovery guidance.

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

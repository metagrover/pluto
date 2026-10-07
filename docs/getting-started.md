# Getting started with Pluto

You need an **Apple Silicon Mac (M1 or later)** running **macOS 14.2 or later**,
and an internet connection for initial downloads. Intel Macs, Windows, and Linux
are not currently supported.

Open Terminal and run:

```sh
curl -fsSL https://raw.githubusercontent.com/metagrover/pluto/master/scripts/install-macos.sh | bash
```

The installer verifies the newest published release, installs Pluto, and opens
it. You do not need Homebrew, Node.js, Xcode, or Python. Quit Pluto before
upgrading; your profile and models are preserved.

Current releases are ad-hoc signed and not Apple-notarized. The installer removes
only Pluto’s download quarantine; it does not grant recording permissions or
disable Gatekeeper globally. [Read the installer](../scripts/install-macos.sh) or
[install manually](#install-manually).

### Your first meeting

1. Follow Pluto’s setup to choose Standard or Encrypted database storage and
   download the local speech models.
2. Allow **Microphone** and **System Audio Recording** access when prompted.
   Calendar access is optional and uses the accounts in your Mac’s Calendar app.
3. Set up [Ollama](#local-intelligence-with-ollama) for local notes and chat, or
   choose a cloud provider in **Settings → Intelligence**.
4. Start a short recording and check the live transcript. Stop recording, wait
   for processing, and review the transcript and notes.

Tell participants when you record and obtain their permission as required.
Pluto captures audio, not screen video.

### Updating Pluto

Choose **Update & Restart** in the sidebar or **Pluto → Check for Updates**.
Stop recording and let it finish saving first. Updates preserve your profile
and models; macOS may ask for permissions again. You can also quit Pluto and
rerun the install command.

## AI models

Speech recognition runs locally using Pluto’s native transcription runtime.
Notes, meeting preparation, and chat use your selected intelligence provider.

### Local intelligence with Ollama

[Download Ollama for Mac](https://ollama.com/download/mac), open it, and complete
its command-line setup. Then download Pluto’s default models:

```sh
ollama pull gemma4:12b
ollama pull phi4-mini:3.8b
```

Keep Ollama running. New Pluto setups use **Gemma 4 12B** for analysis and
**Phi-4 Mini** for fast chat by default. If you previously changed providers,
select **Ollama** in **Settings → Intelligence** and choose these models.

Speech models and Ollama models are separate downloads. Local models need
additional disk space and memory; you can choose smaller installed models in
Settings if needed. Once downloaded, local capture, transcription, and
intelligence work without a cloud provider or API key.

### Cloud intelligence

Choose **OpenRouter** in
**Settings → Intelligence** and add your own API key. Cloud requests need an
internet connection and may incur provider charges. They send the text and
context needed for the operation, which can include transcripts, notes, and
retrieved meeting context.

## Privacy and data

- **Capture and transcription stay on your Mac.** Meeting data is stored locally.
  Local intelligence runs through Ollama; cloud intelligence sends relevant
  text to the provider you choose.
- **Database encryption is a setup choice.** Encrypted setup uses macOS Keychain
  to protect the database key. Standard setup has no app-level database
  encryption. The choice is fixed for the profile; existing profiles keep their
  format. Provider credentials use secure storage with either choice.
- **Audio files are not encrypted by default.** Database encryption does not
  encrypt your recordings or exported files.
- **ChatGPT access is optional.** Enabling the plugin makes your meeting notes
  available to ChatGPT. Retrieved notes are sent to OpenAI; raw transcripts,
  recordings, and People or Project dossiers are excluded. Disabling access
  stops future reads; notes already shared remain in ChatGPT.

Treat recordings, exports, logs, and recovery keys as private. Calendar attendees
provide context; they do not prove who spoke.

## Troubleshooting

- **Missing audio:** check the selected microphone and macOS permissions in
  **System Settings → Privacy & Security**, then restart Pluto.
- **Ollama unavailable:** open Ollama and run `ollama list` to check your models.
- **Setup incomplete:** let speech model downloads and verification finish
  before recording.
- **Database won’t unlock:** preserve the database and its key files. Follow
  [profile recovery guidance](dev.md#source-startup-and-local-profiles).

Use **Help → Report a Problem** to prepare a reviewable diagnostic report. Keep
meeting content and credentials out of public issues.

## Install manually

Download the Mac DMG from the [release listing](https://github.com/metagrover/pluto/releases)
and drag Pluto into Applications. If macOS blocks it, use **System Settings →
Privacy & Security → Open Anyway**. The [one-command installer](#getting-started-with-pluto)
handles verification and launch for you.


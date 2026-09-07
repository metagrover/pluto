### Hardware-backed audio and biometric encryption at rest

- **Issue:** [#781](https://github.com/metagrover/pluto/issues/781)
- **PR:** [#782](https://github.com/metagrover/pluto/pull/782)
- **Changed:** Pluto now stores SQLite databases with SQLCipher page-level encryption, seals all audio journals and chunk files with AES-256-GCM authenticated envelopes using per-meeting derived keys from an OS Keychain-backed master root, decodes encrypted audio strictly in memory inside the Swift native Parakeet runtime, and provides audio retention lifecycle policies with verified cryptographic shredding.
- **Why:** Unencrypted local audio and database artifacts exposed sensitive spoken discussions, speaker voice embeddings, and meeting transcripts to other unprivileged local processes and physical device access.
- **Replaced:** Unencrypted SQLite database storage, plaintext WAV chunk files on disk, and temporary plaintext WAV staging during native offline transcription.
- **Notes:** Existing plaintext databases and audio journals are migrated seamlessly with bit-identical verification. Audio retention policies support 7 days, 30 days, immediately after finalization, or indefinitely, with fail-closed key deletion and chunk shredding.

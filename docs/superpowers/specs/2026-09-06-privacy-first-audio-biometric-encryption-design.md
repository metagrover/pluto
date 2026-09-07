# Privacy-First Audio and Biometric Voice Profile Encryption Design

## Issue

[#781 — Hardware-backed encryption at rest for meeting audio and biometric voice profiles](https://github.com/metagrover/pluto/issues/781)

## Context & Motivation

Pluto is positioned as a **privacy-first, secure "second brain"** that processes meeting audio, transcripts, and biometric speaker voice profiles locally on the user's Mac. 

Recent advancements introduced local voice profile recognition across meetings ([#755](https://github.com/metagrover/pluto/issues/755)), storing 256-dimensional acoustic embeddings in SQLite (`meeting_speaker_candidates` and `speaker_voice_enrollments`). Combined with raw microphone and system audio captured in `meetings/<meetingId>/capture/`, Pluto persists sensitive biometric and acoustic artifacts to disk.

### Threat Model & macOS Reality

1. **Other Devices on the Network:**
   - Isolated by default. Unless macOS File Sharing (SMB/AFP), SSH, or cloud sync directories (iCloud Drive, Dropbox) are explicitly enabled on the storage root, other devices cannot read local directories.
2. **Other Applications / Scripts on the Same Mac:**
   - **Critical vulnerability.** All user-level applications and scripts execute under the same POSIX User ID (`UID 501`).
   - Standard UNIX permissions (`chmod 0700`) protect against *other user accounts* on a multi-user machine, but **do not prevent other apps running under the same user account from reading files in `~/Library/Application Support/Pluto` or `/tmp`**.
   - A rogue background utility, terminal script, or compromised app can read plaintext SQLite databases (extracting full transcripts and biometric embeddings) and raw WAV recordings.

---

## Goals

1. **Enforce Hardware-Rooted Access Control:** Only Pluto (validated by macOS Code Signing identity) can access the decryption keys.
2. **Protect Biometrics and Transcripts at Rest:** Encrypt the SQLite database so voice embeddings, person identities, transcripts, and notes are never readable in plaintext on disk.
3. **Protect Audio at Rest:** Encrypt raw audio capture chunks and repair WAVs immediately as they are written to disk.
4. **Zero Impact on Accuracy:** Cryptographic operations must be strictly lossless (bit-for-bit identical waveforms delivered to Parakeet and FluidAudio models).
5. **Zero Human-Perceptible Latency:** Leverage hardware cryptographic accelerators (ARMv8 Crypto / AES-NI) on Apple Silicon and Intel to maintain sub-millisecond chunk encryption (<0.01 ms for a 1-second chunk; <30 ms for an entire 1-hour recording).
6. **Data Minimization & Ephemeral Audio Lifecycle:** Provide an automated policy to purge raw audio recordings after finalization, retaining only the privacy-preserving centroid vector and notes.
7. **Harden Dev Environment:** Eliminate un-isolated `/tmp` root usage in development.

---

## Non-Goals

- Remote zero-knowledge sync / cloud backup encryption (Pluto operates strictly local-first).
- Protecting against kernel-level malware with root/debugger access attached to Pluto's running memory space.
- DRM or watermarking of exported transcripts or notes.

---

## Architecture Overview

```
                   ┌───────────────────────────────────────┐
                   │            macOS Keychain             │
                   │  • kSecAccessControl (Pluto Code Sig) │
                   │  • kSecAttrAccessibleAfterFirstUnlock │
                   └──────────────────┬────────────────────┘
                                      │ Master Key (AES-256)
                                      ▼
                   ┌───────────────────────────────────────┐
                   │          Pluto Main Process           │
                   └───────────┬───────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
 ┌──────────────────────┐             ┌──────────────────────┐
 │   Biometrics & DB    │             │   Audio Capture &    │
 │ (Voice Vectors/Text) │             │    Native Handoff    │
 ├──────────────────────┤             ├──────────────────────┤
 │ SQLCipher (AES-256)  │             │ AES-256-GCM Chunks   │
 │ • Voice profiles     │             │ • In-memory Swift    │
 │ • Candidate vectors  │             │   CryptoKit decrypt  │
 │ • Transcripts/notes  │             │ • No raw disk audio  │
 └──────────────────────┘             └──────────────────────┘
```

---

## Technical Component Specifications

### 1. Master Key Store (`electron/crypto/keychainKeyStore.ts`)

- **Key Generation:** High-entropy 256-bit cryptographic random key generated via `crypto.randomBytes(32)`.
- **macOS Keychain Storage:** Stored using macOS Keychain Services (`kSecClassGenericPassword`):
  - Service: `com.pluto.desktop`
  - Account: `master-encryption-key`
  - Accessibility: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
  - Access Control: Bound to Pluto's designated requirement / Apple Team ID code signature.
- **Lifecycle:**
  - On startup: Pluto retrieves the key from the Keychain. If absent, it generates and stores a new key.
  - If a non-Pluto process attempts to read the item, macOS Keychain denies access or prompts with an explicit OS authorization modal.

### 2. Database & Biometrics Protection (`electron/database/runtime.ts`)

- **Engine:** Drop-in upgrade from `better-sqlite3` to `better-sqlite3-multiple-ciphers` (SQLCipher v4 profile).
- **Pragma Initialization:**
  ```typescript
  const db = new Database(databasePath);
  db.pragma(`key = "x'${masterKeyHex}'"`);
  db.pragma('cipher_compatibility = 4');
  db.pragma('cipher_page_size = 4096');
  db.pragma('kdf_iter = 256000');
  ```
- **Protected Assets:**
  - `meeting_speaker_candidates`: Biometric embeddings (`embedding_json`), digest, and confidence metrics.
  - `speaker_voice_enrollments`: Enrolled identity centroids and sample metadata.
  - `meetings`: Transcripts (`transcript_json`), analysis documents (`analysis_document_v3_json`), and user edits.
- **Migration Path:** Existing plaintext databases are migrated transparently on first launch via `sqlcipher_export()` into an encrypted file, replacing the old file atomically.

### 3. Audio Chunk At-Rest Encryption (`electron/captureJournal.ts`)

- **Cipher:** AES-256-GCM (Authenticated Encryption with Associated Data).
- **Storage Layout:**
  - Raw chunks: `${chunkPath}.enc`
  - Repair WAVs: `${repairPath}.enc`
  - Chunk format: `[12-byte IV nonce][16-byte GCM Auth Tag][Encrypted Audio Payload]`
- **Durable Validation:** Checksums stored in `manifest.json` match the authenticated ciphertext or are computed over decrypted canonical bytes for verification.
- **Performance Budget:** 
  - 1-second 16kHz mono chunk = 32 KB.
  - Hardware AES throughput on Apple Silicon M1-M4: ~3,500 MB/s per core.
  - Encryption time per chunk: **~0.009 ms (9 microseconds)**.

### 4. Native Runtime Handoff (`native/parakeet-runtime`)

- **Secure Session Key Transmission:**
  - During `NativeJsonLineProcess` initialization over stdin pipe, the main process provides an ephemeral session key derived from the master key.
- **Swift In-Memory Decryption:**
  - In `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/`:
  - When Parakeet reads an audio file path ending in `.enc`, `PathPolicy` validates the sandbox boundary, reads the ciphertext buffer into memory, and uses Apple's native `CryptoKit.AES.GCM.open` to produce an in-memory `AVAudioPCMBuffer` or raw PCM stream.
  - **Decrypted audio bytes never touch the physical disk.**

### 5. Audio Retention & Data Minimization Policy

- **Configurable Retention:**
  - Setting: `audioRetentionDays` (Default: `7` days, with options for `immediate_after_finalization`, `30_days`, or `keep_indefinitely`).
- **Post-Finalization Cleanup:**
  - Once a meeting's final transcript and speaker reviews are confirmed, the raw audio chunks and repair files can be automatically purged.
  - Only the 256-dimensional centroid (compact biometric summary) and transcript text are retained in the encrypted database.

### 6. Development Environment Hardening (`electron/appRuntimePolicy.ts`)

- Replace direct `/tmp/pluto-development-profile` fallback with a dedicated profile directory in user space:
  `path.join(os.homedir(), '.pluto-dev')`
- Explicitly enforce `fs.chmodSync(dir, 0o700)` on creation.

---

## Threat & Countermeasure Matrix

| Threat Scenario | Plaintext State | Encrypted State |
| :--- | :--- | :--- |
| **Another local app/script reads `~/Library/Application Support/Pluto`** | Full access to voice embeddings, transcripts, notes, and raw audio | Reads random bytes; cannot decrypt without Keychain key |
| **Attacker queries macOS Keychain for Pluto's key** | N/A (no key) | Blocked by macOS Security Framework code-signing validation |
| **Physical theft / forensic file extraction of unmounted disk** | Plaintext database and WAV files exposed | Full AES-256 encryption at rest |
| **Accidental sync / backup exposure (Time Machine / Cloud drive)** | Plaintext audio recordings exposed in backup | Only ciphertext files backed up |
| **Malicious audio tampering** | Unauthenticated files could be altered | AES-256-GCM authenticated tag rejects tampered chunks |

---

## Verification & Benchmarks

1. **Functional Integrity:**
   - Unit tests verifying roundtrip encryption/decryption of audio chunks and biometric vectors.
   - Parakeet ASR benchmark (`pnpm run test:asr`) verifying Word Error Rate (WER) is unchanged (0.00% delta).
   - Speaker attribution benchmark (`pnpm run test:attribution`) verifying cluster accuracy is unchanged.
2. **Performance:**
   - Automated benchmark asserting audio chunk encryption/decryption latency remains $< 1.0$ ms (target: $< 0.05$ ms).
   - SQL query latency on encrypted database remains within $5\%$ of baseline.

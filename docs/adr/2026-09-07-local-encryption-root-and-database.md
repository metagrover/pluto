# ADR: Local Encryption Root of Trust and Database Backend

- **Status:** Accepted
- **Date:** 2026-09-07
- **Source:** [Issue #781](https://github.com/metagrover/pluto/issues/781)
- **Design:** [Privacy-First Audio and Biometric Encryption Design](../superpowers/specs/2026-09-06-privacy-first-audio-biometric-encryption-design.md)

## Context

Pluto stores sensitive meeting transcripts, notes, person identities, and 256-dimensional acoustic voice profile embeddings in SQLite, alongside raw audio chunks under the meeting storage root. On macOS, processes running under the same user UID (501) can read files in `~/Library/Application Support/Pluto` and `/tmp`. Standard POSIX file permissions (`0700`) protect against other accounts, but do not prevent other applications, terminal scripts, or background utilities under the same login from inspecting plaintext database and audio artifacts.

Pluto requires application-layer encryption whose root key access is mediated by macOS Keychain, plus transparent page-level SQLite database encryption, authenticated audio chunk envelopes, and explicit retention controls.

## Decision

1. **Root of Trust & Key Custody:**
   - Use Electron `safeStorage` (which uses macOS Keychain `kSecClassGenericPassword` bound to the application's code signature) to store a versioned wrapped envelope containing a 256-bit random master key (`applicationRootKey`).
   - The security claim verified in PR A is strictly that **SafeStorage runtime availability and same-process round-trip encryption/decryption succeed**. The fallback to plaintext used in `createSecureSettingsManager` is strictly forbidden for root, database, and audio keys.
   - Secure Enclave requires provisioning profiles and entitlements not available to ad-hoc signed open-source builds; macOS Keychain provides app-bound encryption at rest via the Data Protection / Keychain APIs, with signed-build enforcement verification deferred to PR F.
   - **Key Custody Probe Guarantees and Limitations:** The runtime probe (`probeKeyCustody`) verifies runtime API presence and validates that an in-process encryption/decryption round-trip succeeds. It does **not** prove signed-build enforcement, cross-process isolation against other utilities running under the same UID 501, Keychain upgrade/reinstall behavior, or denial/recovery flows; signed enforcement verification is left for PR F.
   - If Keychain access is denied, locked, or unavailable, Pluto fails closed without writing unencrypted sensitive artifacts to disk.

2. **Key Hierarchy (HKDF-SHA-256):**
   - Derive `databaseKey` from `applicationRootKey` using a persisted salt and domain string `pluto:database:v1`.
   - Derive `audioWrappingKey` from `applicationRootKey` using the same salt and domain string `pluto:audio-wrap:v1`.
   - Generate an independent 256-bit `meetingAudioKey` per meeting, wrapped with `audioWrappingKey` (AES-256-GCM) and persisted in SQLite table `meeting_audio_keys`.

3. **Implementation Phasing:**
   - **PR A (Contract and Key Custody - Completed):**
     - Defines the canonical cross-language binary envelope specification (`PENC` v1, AES-256-GCM, deterministic JSON header with byte-for-byte canonical verification) shared between TypeScript (`EncryptedArtifactStore`) and Swift (`EncryptedAudioLoader`).
     - Establishes fail-closed `ScopedMeetingCapability` with mandatory generation, allowedOperations, and expiresAtMs.
     - Implements sidecar encryption for v4 capture journal artifacts, rejecting unencrypted sidecars in schema 4.
     - Implements HKDF-SHA-256 key derivation and key custody probing with explicit guarantees and limitations.
   - **PR B (Database Safety & Cipher Migration - Completed):**
     - Adopts `better-sqlite3-multiple-ciphers` pinned at `13.0.3` with SQLCipher profile (`PRAGMA cipher = 'sqlcipher'`, raw 256-bit hex keys).
     - Implements SQLite header inspection (`"SQLite format 3\000"` vs encrypted pages), downgrade guard, and typed `DatabaseLifecycleError`.
     - Implements crash-safe, resumable migration state machine with durable fsync and deep structural verification, and non-destructive recovery overlay when Keychain access is denied or locked.
   - **PR C (Encrypted Recording Path - Completed):**
     - Implements schema-v4 encrypted capture, bounded repair, playback, stitching, and scoped native decryption while leaving new schema-v4 capture creation disabled.
   - **PR D (Performance Hardening - Completed):**
     - Stores materialized mic, System, and mixed recordings as an encrypted index plus independently authenticated 60-second PCM16 segments. Electron and Swift readers decrypt only requested segments; native ASR, vocabulary rescoring, diarization, and channel-energy analysis consume the same random-access source.
     - Enforces crypto, durable capture, representative database, startup, and one-hour RSS budgets through `benchmark:encrypted-storage`; committed raw evidence is architecture-specific and does not replace the signed, slowest-supported-Mac or frozen real-meeting acceptance required before rollout.
   - **PR E (Storage Budget and Cleanup - Completed):**
     - Adds a user-configurable 2 GB, 10 GB (default), 20 GB, or unlimited audio budget. A serialized sweeper removes the oldest eligible audio while preserving transcripts, notes, identity consent, and wrapped keys whenever deletion is incomplete.
     - Eligibility requires finalized, validated meetings with no active capture, recovery, retry, or analysis work. Manual per-meeting deletion uses the same fail-closed path and requires capability-loss confirmation.
   - **PR F (Rollout and Historical Migration - Current):**
     - Keeps all mutating rollout gates off by default. Schema-v4 capture can be enabled only in a packaged, distribution-signed macOS build through the `PLUTO_ENCRYPTION_ROLLOUT=signed_canary` gate; ad-hoc signatures and development builds fail closed.
     - Keeps historical migration and automatic retention enforcement as separate, later canary gates (`PLUTO_HISTORICAL_AUDIO_MIGRATION=1` and `PLUTO_AUDIO_RETENTION_ENFORCEMENT=1`). Encrypted read compatibility remains enabled for rollback builds.
     - Migrates the newest eligible sealed meeting one at a time while foreground audio and inference work is idle. Plaintext materialized WAVs are converted into bounded encrypted segments, capture-journal artifacts and sidecars are converted to schema v4, and every replacement is authenticated and compared with the original bytes before plaintext deletion.
     - Uses encrypted transition plans and content-free SQLite states to resume cleanup after interruption. Failed verification preserves legacy evidence and prevents retention cleanup for that meeting.

## Alternatives Considered

- **Apple Secure Enclave (kSecAccessControlPrivateKeyUsage):** Evaluated in Phase 0. Secure Enclave supports only asymmetric EC/P-256 operations or hardware-entitled biometrics; it cannot directly hold or unwrap high-throughput symmetric AES keys without complex hybrid wrapping and provisioning profiles. Keychain-backed `safeStorage` is the robust, supported OS-mediated mechanism.
- **SQLCipher via custom native compilation:** Unnecessary overhead; `better-sqlite3-multiple-ciphers` builds in <2s with `@electron/rebuild`, runs seamlessly across Node and Electron ABI, and matches SQLCipher v4 profile.
- **Plaintext fallback:** Rejected. Insecure fallbacks undermine the core privacy guarantee.

## Consequences

- PR A establishes the cryptographic envelope contract, cross-language test vectors, fail-closed scoped capabilities, sidecar encryption, and key custody probe.
- PR B introduced `better-sqlite3-multiple-ciphers`, database migration, and the startup recovery overlay.
- Audio and transcript artifacts in journal schema 4 are authenticated and encrypted at rest.
- Materialized encrypted audio has a one-segment random-access working set instead of one process-sized plaintext float array. The index and every segment remain independently authenticated PENC artifacts.
- Retained audio is governed by a user-selected size budget rather than a fixed age. Cleanup is oldest-first among durably eligible meetings and never treats time alone as proof that deletion is safe.
- New schema-v4 capture creation and all automatic historical mutation remain disabled by default; read and recovery compatibility stay enabled in rollback builds. A signed-canary build must still pass the real-meeting acceptance matrix before these gates become release defaults.

## Rollout and rollback

The gates are deliberately ordered and independent:

1. Set `PLUTO_ENCRYPTION_ROLLOUT=signed_canary` only for a packaged, distribution-signed internal build. This enables new schema-v4 capture but does not touch historical audio or automatically enforce retention.
2. After transcription, diarization, speaker sample playback, manual retry, interrupted-finalization recovery, and frozen output parity pass on v4 recordings, set `PLUTO_HISTORICAL_AUDIO_MIGRATION=1` for the canary cohort. One newest eligible meeting is migrated per idle scheduling turn.
3. After historical migration convergence and rollback recovery pass, set `PLUTO_AUDIO_RETENTION_ENFORCEMENT=1`. Explicit user budget changes and confirmed per-meeting deletion remain user-directed operations independent of automatic enforcement.

Rollback is to remove the mutating environment gates. Existing v4 data remains readable and is never downgraded to plaintext. A failed or interrupted migration retains its wrapped meeting key, ciphertext, and any plaintext not yet positively replaced.

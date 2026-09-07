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
   - The security claim is explicitly documented as **OS-mediated app-bound key protection**. The fallback to plaintext used in `createSecureSettingsManager` is strictly forbidden for root, database, and audio keys.
   - If Keychain access is denied, locked, or unavailable, Pluto fails closed without writing to disk and presents a non-destructive recovery overlay.

2. **Key Hierarchy (HKDF-SHA-256):**
   - Derive `databaseKey` from `applicationRootKey` using a persisted salt and domain string `pluto:database:v1`.
   - Derive `audioWrappingKey` from `applicationRootKey` using the same salt and domain string `pluto:audio-wrap:v1`.
   - Generate an independent 256-bit `meetingAudioKey` per meeting, wrapped with `audioWrappingKey` (AES-256-GCM) and persisted in SQLite table `meeting_audio_keys`.

3. **Database Backend & Cipher Profile:**
   - Adopt `better-sqlite3-multiple-ciphers` pinned at `^13.0.3` as a drop-in replacement for `better-sqlite3`.
   - Use the `sqlcipher` compatibility profile (`PRAGMA cipher = 'sqlcipher'`) with raw 256-bit hex keys (`PRAGMA key = "x'...'"`).
   - Raw hex key application avoids PBKDF2 delay on warm startup (measured open latency ~0.46 ms).
   - Downgrade to plaintext is unsupported once encrypted database is activated.

4. **Lifecycle & Migration Safety Invariants:**
   - Inspect the SQLite header before opening. If a database is not identified as plaintext SQLite (`"SQLite format 3\000"`), treat it as encrypted.
   - An unopened or wrong-key failure emits a typed `DatabaseLifecycleError` (`database_key_rejected` or `database_encryption_recovery_required`) and **never** enters the corruption replacement path (`replaceExisting`).
   - Plaintext databases are migrated via a durable, resumable state machine using a staged sibling export, verified for schema, row counts, and integrity before atomic replacement.

## Alternatives Considered

- **Apple Secure Enclave (kSecAccessControlPrivateKeyUsage):** Evaluated in Phase 0. Secure Enclave supports only asymmetric EC/P-256 operations or hardware-entitled biometrics; it cannot directly hold or unwrap high-throughput symmetric AES keys without complex hybrid wrapping and provisioning profiles. Keychain-backed `safeStorage` is the robust, supported OS-mediated mechanism.
- **SQLCipher via custom native compilation:** Unnecessary overhead; `better-sqlite3-multiple-ciphers` builds in <2s with `@electron/rebuild`, runs seamlessly across Node and Electron ABI, and matches SQLCipher v4 profile.
- **Plaintext fallback:** Rejected. Insecure fallbacks undermine the core privacy guarantee.

## Consequences

- `package.json` adds `better-sqlite3-multiple-ciphers` and `scripts/ensure_sqlite_abi.mjs` verifies both Node and Electron bindings.
- Startup error recovery overlay is introduced to handle Keychain denial or lock gracefully.
- Subsequent phases (Phase 2 encrypted capture journal, Phase 3 native CryptoKit decryption, Phase 4 audio retention) build on this verified foundation.

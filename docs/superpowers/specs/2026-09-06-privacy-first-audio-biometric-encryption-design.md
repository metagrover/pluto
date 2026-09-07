# Privacy-First Audio and Biometric Encryption Design

## Issue

[#781 — Hardware-backed encryption at rest for meeting audio and biometric voice profiles](https://github.com/metagrover/pluto/issues/781)

## Status

Revised after engineering scope review on 2026-09-06. The work remains one umbrella security outcome, but implementation is split into gated, independently reviewable phases. No production data format changes may begin until Phase 0 proves the macOS key-custody guarantee and selects a supported encrypted SQLite backend.

## Context

Pluto stores meeting transcripts, notes, identities, and 256-dimensional voice-profile evidence in SQLite. It also retains microphone and System capture artifacts under the meeting storage root. These are sensitive local artifacts even though Pluto does not send them to a remote service.

Processes running as the same macOS user can ordinarily read files in that user's Application Support directory. File permissions still matter for other accounts and accidental exposure, but they are not the primary control against another same-user application or script. Pluto therefore needs application-layer encryption whose key access is mediated by macOS, plus a retention policy that reduces how long audio exists at all.

The current code already has useful foundations:

- `electron/secureSettings.ts` uses Electron `safeStorage`, whose macOS implementation stores app encryption keys in Keychain and prevents another app from loading them without user override.
- `electron/database/runtime.ts`, `electron/database/artifacts.ts`, and `electron/database/adoption.ts` already centralize database opening, health checks, WAL-family staging, migration ordering, and recovery.
- `electron/captureJournal.ts` already writes capture artifacts through temp-file, sync, rename, and directory-sync durability boundaries.
- `electron/captureJournalRecovery.ts` and `electron/timedWavStitch.ts` fail closed when capture evidence is incomplete and preserve timing across route/sample-rate changes.
- `NativeJsonLineProcess`, `PathPolicy`, and the Swift runtime already provide a bounded main-process-to-native protocol and an audio-root path boundary.
- Voice embeddings remain confined to `meeting_speaker_candidates` and `speaker_voice_enrollments`; they do not cross renderer IPC or enter transcript JSON.

These foundations should be extended, not replaced.

## Corrected Security Claims

The implementation must distinguish these properties:

1. **OS-mediated app-bound key protection:** Electron documents that macOS `safeStorage` uses Keychain and prevents other applications from loading its key without user override.
2. **Hardware-accelerated cryptography:** AES operations may use CPU acceleration, but that is a performance property, not hardware-backed key custody.
3. **Hardware-backed key custody:** This phrase is reserved for a design whose non-exportable key operation is demonstrably performed by Secure Enclave or equivalent hardware.

Phase 0 will prove the strongest guarantee Pluto can actually enforce in signed development and release builds. Until that proof exists, product copy and acceptance criteria use **OS-mediated app-bound key protection**, not “hardware-backed” or “only Pluto can decrypt.” A user can explicitly authorize another application through macOS, and Pluto cannot defend against root, kernel compromise, or a debugger attached to Pluto's memory.

## Goals

1. Prove and document the macOS key-access boundary before selecting the root-of-trust mechanism.
2. Encrypt the application database, including transcripts, notes, identities, search structures, biometric candidates, and enrolled voice profiles.
3. Encrypt new and retained capture artifacts before durable storage, including raw chunks, repair audio, reconstructed audio, and sensitive journal metadata.
4. Keep the root key out of renderer IPC, native runtime requests, logs, analytics, crash text, and transcript payloads.
5. Give the native runtime only meeting-scoped decryption capability, never the database key or root key.
6. Preserve decrypted audio bytes exactly and prove unchanged ASR and speaker-attribution behavior on frozen inputs.
7. Fail closed without replacing or mutating healthy encrypted data when keys are locked, missing, rejected, or temporarily unavailable.
8. Migrate existing plaintext database and audio artifacts through resumable, crash-safe state machines.
9. Provide explicit audio-retention controls and make the loss of retry/review capability understandable before deletion.
10. Measure crypto-only cost, end-to-end capture cost, database cost, finalization latency, and peak memory on supported Mac architectures.

## Non-Goals

- Remote sync, zero-knowledge cloud backup, or cross-device key recovery.
- Protection against root, kernel compromise, memory inspection of the running Pluto process, or a user explicitly granting another app Keychain access.
- Guaranteed forensic erasure of historical plaintext from APFS snapshots, Time Machine, SSD wear-leveling, or backups created before migration.
- Encryption of user-initiated exports after they leave Pluto's managed storage.
- A custom cryptographic primitive, custom Keychain implementation, or vendored fork without a pinned upstream and packaging tests.
- Changing voice-match thresholds, consent rules, deletion opt-out behavior, or identity provenance.
- Moving the development profile solely because it is under `os.tmpdir()`. On current macOS, the resolved temp root and Pluto profile are already mode `0700`; Phase 0 will verify and enforce the effective permissions instead of assuming `/tmp` is world-readable.

## Security Invariants

- No key material is ever written in plaintext.
- A missing key beside an existing encrypted database is a recovery state, never permission to generate a replacement key.
- Wrong-key, unavailable-key, unsupported-cipher, and corrupt-database failures are distinct typed states.
- The existing integrity-replacement path may run only after a correct key has opened the database and an authenticated integrity check proves corruption.
- The existing `secureSettings` plaintext fallback is forbidden for database keys, wrapping keys, and meeting audio keys.
- Every encrypted file uses a versioned envelope and a unique nonce under its data-encryption key.
- Header fields that control interpretation are authenticated as AES-GCM associated data.
- Per-meeting audio keys are random and independently wrapped; the native runtime never receives the application root key.
- Plaintext audio must not be persisted as an intermediate file once encrypted capture is enabled.
- Authentication failure, truncation, unknown envelope version, path escape, stale meeting key, or source mismatch fails closed with a content-free reason.
- Existing plaintext formats remain readable only by the migration path; ordinary post-rollout writes cannot create them.
- Deletion of a voice profile remains an explicit opt-out and cannot be reversed by migration, key rotation, or ordinary speaker confirmation.

## Target Architecture

```text
                         macOS Keychain
                              │
                    Electron safeStorage or
                  proved native alternative (Gate 0)
                              │
                    wrapped application root key
                              │
               ┌──────────────┴──────────────┐
               │                             │
          HKDF: database                HKDF: audio-wrap
               │                             │
       encrypted SQLite file        encrypted per-meeting DEKs
       + encrypted WAL/SHM            stored in encrypted DB
                                             │
                                      scoped DEK over stdin
                                      to native child only
                                             │
     Capture bytes ── AES-256-GCM ── encrypted journal/artifacts
                                             │
                               authenticate + decrypt in memory
                                             │
                               PCM samples passed to FluidAudio
```

### Key hierarchy

- `applicationRootKey`: 32 random bytes generated once and stored only as a `safeStorage`-wrapped envelope, unless Phase 0 proves and selects a stronger native mechanism.
- `databaseKey`: derived with HKDF-SHA-256 using a fixed versioned `info` value and a persisted random salt.
- `audioWrappingKey`: independently derived from the root key with a distinct `info` value.
- `meetingAudioKey`: random 32-byte key per meeting, wrapped with `audioWrappingKey` and stored in the encrypted database with `keyId`, algorithm, nonce, tag, and creation time.
- `nativeCapability`: the unwrapped meeting key plus meeting ID, generation, artifact root, key ID, allowed operation, and expiry, sent only to the spawned native process for the active request.

Domain separation is mandatory. The database key is never reused as an audio key, and a meeting key is never reused across meetings.

### Encrypted artifact envelope v1

```text
+----------------------+---------------------------------------------+
| Field                | Purpose                                     |
+----------------------+---------------------------------------------+
| magic + version      | deterministic format dispatch               |
| algorithm            | AES-256-GCM                                 |
| keyId                | select expected wrapped meeting key         |
| meetingId            | bind ciphertext to one meeting              |
| generation           | reject stale recording generations          |
| artifactKind         | raw, repair, manifest, mixed, mic, system   |
| source + sequence    | bind capture position and source             |
| plaintextLength      | bounded allocation and truncation check      |
| nonce (12 bytes)     | unique random nonce                          |
| ciphertext           | encrypted bytes                              |
| tag (16 bytes)       | authentication tag                           |
+----------------------+---------------------------------------------+
```

The fixed header is canonicalized and used as associated data. The manifest stores a ciphertext checksum for durability diagnosis and a plaintext checksum for post-decryption bit-identity checks. Filenames become opaque IDs; sensitive source/timing metadata moves into the encrypted manifest. A minimal plaintext locator may contain only envelope version, key ID, and encrypted-manifest filename.

## Database Startup State Machine

```text
                   ┌───────────────┐
                   │ inspect files │
                   └───────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
      no database      plaintext DB     encrypted DB
          │                │                │
   key available?     key available?    key available?
      │       │          │       │          │       │
     yes      no        yes      no        yes      no
      │       │          │       │          │       └─ recovery_required
  create new  hard    migrate   hard        │          preserve all files
  encrypted   stop    via state stop        ▼
  database            machine          authenticated open
                                          │        │
                                         pass     fail
                                          │        ├─ wrong/config → recovery_required
                                          ▼        └─ authenticated corruption only
                                      normal boot       → existing replacement path
```

Generating a new key is allowed only when no database exists or while migrating a database positively identified by the SQLite plaintext header. A Keychain denial, locked Keychain, malformed key envelope, wrong key, unknown cipher, or missing wrapped key stops startup without writes.

## Staged Implementation Plan

### Phase 0 — Proofs, inventory, and backend selection

**Outcome:** establish facts without changing any production data format.

1. Add a macOS-only signed key-custody probe that uses the existing Electron `safeStorage` path first.
   - Verify a release-signed Pluto build can decrypt across restart and upgrade when the designated signing requirement is stable.
   - Verify an unrelated same-user process cannot decrypt without a macOS authorization override.
   - Verify ad-hoc/dev signing behavior, Keychain locked/denied behavior, reinstall behavior, and Team ID changes.
   - Record exactly what the user sees for Deny, Allow, and Always Allow.
2. Compare encrypted SQLite candidates behind the current `better-sqlite3` interface.
   - Primary candidate: `better-sqlite3-multiple-ciphers` using an explicitly selected, pinned SQLite3MultipleCiphers cipher profile.
   - Alternative: a separately packaged SQLCipher-compatible native binding if the primary candidate fails format, maintenance, or packaging gates.
   - Do not call the primary candidate “SQLCipher” unless the selected mode and compatibility profile actually provide that format.
3. Build a disposable migration harness using a representative copy synthesized from the current schema.
   - Exercise plaintext main DB plus `-wal`, `-shm`, and `-journal` families.
   - Crash after every migration transition and prove deterministic resume or rollback.
   - Verify `user_version`, Drizzle history, schema, triggers, indexes, foreign keys, critical-table row counts, and application startup recovery.
4. Inventory every persisted sensitive copy under the production and development roots.
   - Include legacy adoption backups, integrity-replacement staging directories, capture journals, repair WAVs, reconstructed audio, temporary FFmpeg files, logs, crash text, and benchmark artifacts.
   - Confirm embeddings remain absent from renderer IPC, transcript JSON, logs, and analytics.
5. Benchmark plaintext and candidate encrypted paths on Apple Silicon and Intel when Intel remains supported.
6. Verify the current development profile's effective owner and mode. Add explicit creation/permission enforcement only if the live check or tests fail.
7. Record the selected key mechanism, database backend/version/cipher parameters, file formats, downgrade policy, and measured budgets in an ADR before Phase 1.

**Gate 0:** no later phase starts until the signed access probe passes, the database dependency packages on supported architectures, a crash matrix passes, performance is within the provisional budgets below, and the ADR contains no unverified “hardware-backed” claim.

**Likely files:**

- `electron/crypto/keyCustodyProbe.ts` (new)
- `scripts/verify_macos_key_custody.mjs` (new)
- `scripts/benchmark_encrypted_storage.ts` (new)
- `scripts/ensure_sqlite_abi.mjs`
- `scripts/verify_packaged_runtime.mjs`
- `electron/appRuntimePolicy.ts`
- `vite.config.ts`
- `package.json`
- `pnpm-lock.yaml`
- `docs/adr/2026-09-XX-local-encryption-root-and-database.md` (created only after evidence selects the mechanism)

**Rollback:** remove the probe/dependency experiment. No user data changes.

### Phase 1 — Fail-closed key custody and encrypted database migration

**Outcome:** encrypt SQLite through one resumable migration while making key failures non-destructive.

1. Add a dedicated application-key store; do not route root keys through `createSecureSettingsManager` because that manager intentionally falls back to plaintext for ordinary secrets.
2. Store a versioned wrapped-key envelope containing `keyId`, KDF version, salt, wrapped bytes, and creation metadata. Write it atomically with mode `0600` inside a mode-`0700` directory.
3. Extend database lifecycle errors with content-free states:
   - `database_key_unavailable`
   - `database_key_rejected`
   - `database_cipher_unsupported`
   - `database_encryption_migration_failed`
   - `database_encryption_recovery_required`
4. Classify the database before the first SQLite page operation. Apply cipher selection and all cipher parameters before the raw key.
5. Implement a durable migration journal with transitions:

```text
preflight → wal_checkpointed → source_closed → encrypted_exported
          → target_verified → artifacts_staged → target_activated
          → reopened_and_recovered → plaintext_removed → complete
```

6. Reuse and generalize database artifact staging for the main DB, WAL, SHM, journal, legacy backups, and encryption temp files.
7. Export into an encrypted sibling file on the same volume, copy required SQLite metadata, then verify:
   - cipher/key identity
   - `cipher_integrity_check` or backend equivalent
   - `PRAGMA integrity_check`
   - `PRAGMA foreign_key_check`
   - schema and migration history
   - row counts for meetings, people, identity bindings, candidates, enrollments, settings, and search indexes
   - normal application startup recovery
8. Atomically activate the encrypted database only after verification. Retain plaintext staging only until the encrypted DB reopens and startup recovery succeeds, then delete it and report the forensic-erasure limitation.
9. Ensure old application versions cannot mistake an encrypted database for corruption. Define downgrade as unsupported after activation and keep all data preserved.
10. Add a startup recovery surface with Retry Keychain Access, Open Data Folder, and Quit. Destructive reset requires a separate explicit confirmation and is not part of automatic recovery.
11. Ship the code dark behind `database_encryption_v1`; enable it first for test fixtures and signed canary builds, then make it mandatory only after migration telemetry contains content-free states and no user data.

**Likely files:**

- `electron/crypto/applicationKeyStore.ts` (new)
- `electron/crypto/keyDerivation.ts` (new)
- `electron/database/encryptionMigration.ts` (new)
- `electron/database/runtime.ts`
- `electron/database/applicationDatabase.ts`
- `electron/database/artifacts.ts`
- `electron/database/adoption.ts`
- `electron/database/errors.ts`
- `electron/database/startupRecovery.ts`
- `electron/bootstrap.ts`
- `src/components/overlays/DatabaseRecoveryOverlay.tsx` (new)
- `package.json`, `pnpm-lock.yaml`, `vite.config.ts`

**Rollback:** before activation, resume or restore the staged plaintext family. After verified activation and plaintext cleanup, rollback means installing a fixed encryption-capable build; it never means opening or replacing the DB with stock SQLite.

### Phase 2 — Versioned encrypted capture journal writes

**Outcome:** new capture bytes and journal metadata become durable only as authenticated ciphertext.

1. Add a single `EncryptedArtifactStore` responsible for envelope encoding, AES-GCM streaming, checksums, atomic replace, fsync, authenticated reads, and content-free errors.
2. Create and wrap a random meeting key before capture-journal admission. If the key cannot be created or persisted, recording does not start.
3. Introduce capture-journal schema v4:
   - encrypted manifest payload
   - opaque artifact filenames
   - envelope version, key ID, meeting generation, source, sequence, and artifact kind bound as associated data
   - ciphertext and plaintext checksums with explicit semantics
4. Route both legacy append and v3 raw/captured transitions through the same encrypted writer. Preserve the current temp-write, file-sync, rename, directory-sync, and serialized mutation ordering.
5. Remove the `repairPath` plaintext-file branch from the enabled v4 flow. FFmpeg decoding writes to a bounded stream whose output is encrypted before durable storage.
6. Make authentication failure, nonce reuse detection, checksum mismatch, missing key, and truncated envelope sticky capture failures. They must block sealing and preserve all ciphertext.
7. Keep v1-v3 journals readable only through a migration/recovery adapter. No ordinary v4 write may fall back to plaintext.

**Likely files:**

- `electron/crypto/encryptedArtifactStore.ts` (new)
- `electron/crypto/audioKeyStore.ts` (new)
- `electron/captureJournal.ts`
- `electron/captureJournalStart.ts`
- `electron/captureJournalRecovery.ts`
- `electron/main.ts`
- `src/components/AudioManager.tsx`
- `src/utils/recordingFinalization.ts`
- shared IPC types in `src/types/` and `electron/preload.ts`

**Rollback:** keep the feature flag off for ordinary users until Phase 3 can consume v4 artifacts. A rollback-capable build must understand both plaintext v1-v3 and encrypted v4; it may not create new plaintext v4 artifacts.

### Phase 3 — Plaintext-free native processing and historical audio migration

**Outcome:** final transcription, speaker evidence, retries, and recovery consume encrypted audio without materializing plaintext files.

1. Extend the JSON-line protocol with a versioned, allowlisted meeting-key capability. Send only the active meeting key, never the application root or database key.
2. Bind the capability to meeting ID, capture generation, approved artifact root, key ID, allowed operation, and request lifetime. Reject reuse outside that scope.
3. Extend `PathPolicy` into an encrypted-audio loader that validates the path first, validates envelope/AAD before allocation, decrypts in bounded chunks, and produces PCM samples in memory.
4. Refactor the native inference boundary from URL-only input to an explicit `AudioInput` abstraction.
   - Preserve URL input for plaintext fixtures and legacy migration tests.
   - Add PCM/sample input for encrypted production artifacts.
   - Adapt both initial ASR and custom-vocabulary rescoring to consume the same decoded samples so vocabulary behavior does not regress.
   - Adapt mixed/mic/System speaker evidence to release buffers as soon as each stage permits and enforce a measured peak-memory ceiling.
5. Replace file-based final stitch handoff with an encrypted logical-source reader. Timing gaps, overlaps, route changes, and per-chunk sample rates retain the current reconstruction semantics.
6. Ensure temporary FFmpeg normalization uses stdin/stdout streaming. No plaintext pathname is returned to renderer IPC or stored in the journal.
7. Add a resumable historical migrator:
   - newest eligible sealed meetings first
   - one meeting at a time under the existing inference/recording resource gates
   - verify ciphertext and bit-identical plaintext before deleting each plaintext artifact
   - never migrate active, recovery-required, incomplete, or currently processed meetings
   - preserve legacy evidence when any step fails
8. Enable encrypted capture only after transcription, diarization, speaker sample playback, manual retry, interrupted-finalization recovery, and historical reconciliation all pass on v4 artifacts.

**Likely files:**

- `electron/transcription/nativeJsonLineProcess.ts`
- `electron/transcription/parakeetFinalClient.ts`
- `electron/recoveryTranscriptionAudio.ts`
- `electron/timedWavStitch.ts`
- `electron/captureJournalRecovery.ts`
- `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`
- `native/parakeet-runtime/Sources/ParakeetRuntimeCore/PathPolicy.swift`
- `native/parakeet-runtime/Sources/ParakeetRuntimeCore/ParakeetTranscriber.swift`
- `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/RuntimeJSONLineRouter.swift`
- `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift`
- `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`
- `src/services/finalTranscription/`
- `src/services/retryMeetingTranscriptValidation.ts`

**Rollback:** disable new v4 capture while retaining read/decrypt support. Never downgrade ciphertext to plaintext automatically.

### Phase 4 — Retention, controls, and rollout completion

**Outcome:** users can minimize retained audio without silently losing recovery capabilities.

1. Add `audioRetentionPolicy` with explicit values:
   - `after_finalization`
   - `7_days` (default)
   - `30_days`
   - `keep_indefinitely`
2. Define eligibility from durable evidence, not elapsed time alone.
   - Exclude active, provisional, recovery-required, incomplete, retrying, enrollment-analysis, and historical-migration meetings.
   - `after_finalization` becomes eligible only after canonical final transcript commit and all in-flight speaker evidence work ends.
3. Before saving `after_finalization`, explain that deleting audio disables retranscription, speaker sample playback, new enrollment evidence, and audio-based repair for that meeting.
4. Run cleanup through a serialized, idempotent sweeper. Delete the meeting's wrapped audio key only after all managed artifacts are deleted or positively absent; otherwise retain the key and retry.
5. Record content-free retention status and last failure in the encrypted database. Do not log meeting titles, paths, transcripts, embeddings, or keys.
6. Provide per-meeting “Delete audio now” and retention status. Destructive deletion requires explicit confirmation and does not delete transcripts, notes, or voice-profile consent records.
7. Roll out in order: internal fixtures → signed canary → new installs → existing plaintext DB migration → new encrypted captures → historical audio migration → retention default enforcement.

**Likely files:**

- database schema and migration under `electron/database/` and `drizzle/`
- `electron/audioRetention.ts` (new)
- `electron/main.ts`, `electron/preload.ts`
- `src/components/features/SettingsTab.tsx`
- meeting-level privacy controls in `src/components/features/MeetingView.tsx`
- settings and IPC types under `src/types/`

**Rollback:** pause the sweeper and retain keys/ciphertext. Completed user-requested deletions are intentionally irreversible.

## Test Plan

TDD is required for every non-UI unit. Tests must prove failure behavior before implementation changes it.

```text
CODE PATHS                                             USER / OPERATOR FLOWS
[Phase 0] key custody                                  [First encrypted launch]
  ├─ signed app restart/upgrade                          ├─ migrate plaintext DB successfully [E2E]
  ├─ unrelated same-user process denied                  ├─ deny Keychain access; data preserved [E2E]
  ├─ user override recorded                              ├─ relaunch and retry access [E2E]
  └─ dev/ad-hoc identity behavior                        └─ old build refuses encrypted DB safely [E2E]

[Phase 1] database state machine                       [Interrupted migration]
  ├─ no DB + key → encrypted fresh DB                    ├─ kill after every transition [E2E]
  ├─ plaintext DB + key → verified export                ├─ resume or rollback deterministically
  ├─ encrypted DB + missing/wrong key → preserve          └─ never expose partial target
  ├─ authenticated corruption → staged replacement
  └─ WAL/SHM/journal + legacy backups handled

[Phase 2] encrypted artifact store                     [Recording]
  ├─ unique nonce + canonical AAD                         ├─ normal stop and finalization [E2E]
  ├─ atomic ciphertext durability                         ├─ crash/relaunch recovery [E2E]
  ├─ tamper/truncate/swap → typed failure                 ├─ route/sample-rate change [E2E]
  └─ no plaintext fallback                               └─ disk-full/key-unavailable → recovery_required

[Phase 3] native encrypted input                       [Meeting intelligence]
  ├─ scoped capability validation                         ├─ final transcript parity [E2E]
  ├─ decrypt → identical PCM samples                      ├─ diarization parity [E2E]
  ├─ ASR + vocabulary rescore use same samples            ├─ Retry transcription [E2E]
  ├─ mic/System/mixed reconstruction parity               ├─ speaker sample playback [E2E]
  └─ cancellation/error zeroization                       └─ historical migration resume [E2E]

[Phase 4] retention                                    [Privacy controls]
  ├─ eligibility excludes unsafe states                   ├─ understand capability loss [UI]
  ├─ partial delete retains wrapped key                    ├─ delete audio now + confirm [E2E]
  ├─ complete delete removes wrapped key                   └─ keep transcripts/notes/profile state
  └─ repeated sweep is idempotent
```

### Required automated coverage

- `tests/unit/applicationKeyStore.test.ts`: availability, denial, malformed envelope, atomic write, key IDs, no fallback, and injected backend behavior.
- `tests/unit/databaseEncryptionMigration.test.ts`: every transition, WAL family, export validation, crash resume, cleanup failure, wrong key, unsupported cipher, and plaintext preservation.
- Extend `tests/unit/databaseRuntime.test.ts`, `databaseReplacement.test.ts`, `databaseAdoption.test.ts`, and startup-error tests so key failures can never reach `replaceExisting`.
- `tests/unit/encryptedArtifactStore.test.ts`: fixed vectors, random-nonce uniqueness, AAD swaps, truncation, tag failure, size bounds, atomic durability, and stream cancellation.
- Extend capture journal and recovery suites for v4 state transitions, mixed legacy/v4 reads, sticky failures, disk-full, concurrent appends, sealing, and cleanup.
- Swift `EncryptedAudioEnvelopeTests`: cross-language test vectors generated from TypeScript, corrupted headers/tags, wrong meeting/generation/source, large-stream bounds, and zero-length input.
- Extend `ProtocolTests`, `PathPolicyTests`, `TranscriberTests`, `ParakeetServiceTests`, and FluidAudio engine tests for scoped capabilities and PCM/sample input.
- Extend final-transcription, retry, speaker-evidence, enrollment-audio, recording-finalization, and interrupted-recovery suites to exercise encrypted inputs end to end.
- Retention unit tests for every meeting state and deadline boundary; DOM tests for settings copy, confirmation, status, keyboard operation, and recovery actions.
- Packaged-runtime verification for the selected SQLite native module and Swift CryptoKit linkage on each supported architecture.

### Required acceptance runs

```bash
pnpm exec vitest run tests/unit/applicationKeyStore.test.ts tests/unit/databaseEncryptionMigration.test.ts
pnpm exec vitest run tests/unit/encryptedArtifactStore.test.ts tests/unit/captureJournal.test.ts tests/unit/captureJournalRecovery.test.ts
swift test --package-path native/parakeet-runtime
pnpm run benchmark:private-parakeet
pnpm run benchmark:speaker-attribution
pnpm run benchmark:production-speaker-attribution
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
pnpm run package:verify-runtime
pnpm run changelog:check
```

The exact focused filenames may be adjusted to repository conventions during implementation, but each listed behavior is a required assertion. Node-oriented SQLite tests must restore the Electron ABI with `pnpm run ensure:sqlite-abi` before Electron/package verification.

## Performance Budgets

Phase 0 records baselines and may tighten these budgets. It may not loosen them without evidence and an issue update.

- 32 KiB AES-GCM seal/open: p95 at or below `0.25 ms` on the slowest supported architecture.
- Capture durable-ack latency: p95 regression no greater than `5%` against the same fsync workload, with zero dropped or reordered chunks.
- Encrypted database representative query suite: warm p95 regression no greater than `10%`; no individual critical query over `20%` without explanation.
- Normal encrypted startup excluding first migration: no more than `250 ms` slower at p95.
- One-hour final transcription and attribution: wall-clock regression no greater than `5%`, exact decrypted-byte equality, and no change in frozen ASR/attribution outputs attributable to encryption.
- Native plaintext-audio memory: bounded processing preferred; peak RSS increase must remain below `256 MiB` on the one-hour fixture unless Phase 0 records and approves a different device-safe ceiling.
- Migration and historical backfill have no hidden latency promise. They must expose content-free progress, remain cancellable between atomic units, and never block recording once ordinary encrypted startup is complete.

The original `<0.01 ms` per chunk and `<30 ms` per hour estimates are not acceptance criteria. Crypto throughput alone excludes framing, copying, IPC, fsync, SQLite, audio conversion, and model-loading costs.

## Failure Modes and Required Product Behavior

| Failure | Required behavior | Verification |
|---|---|---|
| Keychain locked, denied, or unavailable | Stop without writes; show retry/quit/reveal-folder recovery | signed E2E |
| Wrapped root key missing beside encrypted DB | Never generate a new key; preserve all artifacts | startup regression |
| Wrong key or cipher parameters | Typed recovery state, never corruption replacement | unit + E2E |
| Crash during DB migration | Resume or roll back from durable transition journal | kill-point matrix |
| Encrypted DB verifies but app recovery fails | Restore staged plaintext before cleanup | E2E |
| Plaintext cleanup fails | Keep encrypted DB active, report residue, retry cleanup without exposing paths | unit + manual inspection |
| Nonce collision signal | Abort write, mark capture failure, preserve prior ciphertext | deterministic RNG test |
| Audio tag/AAD/checksum failure | Reject artifact; require recovery; never publish partial transcript | cross-language tests |
| Native process exits after receiving meeting key | Fail request, discard capability, respawn without cached key | protocol tests |
| Plaintext temp-file attempt in v4 flow | Test failure and blocked release | filesystem spy integration test |
| Historical migration fails midway | Keep verified ciphertext and untouched plaintext for the failed unit; retry idempotently | migration replay |
| Retention delete partially fails | Retain wrapped meeting key and retry; do not claim deletion complete | unit + E2E |
| User deletes audio | Remove managed audio/key only; retain transcript, notes, identity consent and opt-out state | E2E |

No failure may be logged with key bytes, transcripts, embeddings, meeting titles, or local audio paths.

## Rollout and Observability

- Use separate flags for database migration, v4 capture writes, encrypted native reads, historical audio migration, and retention enforcement.
- Flags are monotonic format gates, not permission to fall back to plaintext.
- Record only content-free counters and reason codes: migration transition, duration bucket, byte-count bucket, cipher version, architecture, result, and recovery reason.
- Before each enablement step, snapshot fixture results and compare against the prior phase.
- Block release on any data-loss path, plaintext fallback, authentication bypass, missing package architecture, unexplained model-output delta, or unresolved P1 finding.
- Update issue #781 after every gate with measured results, selected versions, rollout state, and rollback evidence.

## Worktree and PR Strategy

The work is an ordered PR stack, not one branch-sized change.

| Lane | Work | Depends on |
|---|---|---|
| A | Phase 0 key-custody and database dependency proofs | — |
| B | Phase 0 encrypted-artifact/native sample-input prototype | — |
| C | Phase 1 key store and DB migration | Gate 0, Lane A |
| D | Phase 2 encrypted journal writer | Gate 0, Lane B, Phase 1 key hierarchy |
| E | Phase 3 native consumption and historical migration | Phase 2 |
| F | Phase 4 retention and UI | Phase 3 |

Launch A and B in parallel worktrees. Merge their evidence and record the ADR. Then run C → D → E → F sequentially because they share file formats, key contracts, and recovery states. Do not parallelize database activation with capture-format activation.

Each implementation PR must link #781 or its outcome-sized child issue, add/update the relevant changelog fragment, state its format compatibility, include rollback instructions, and leave later phase flags disabled.

## What Is Explicitly Deferred

- Secure Enclave wrapping unless Phase 0 proves it is necessary and supportable; Keychain-backed `safeStorage` is the boring built-in candidate.
- Cloud sync and cross-device key recovery; these require a separate trust and account model.
- Password-based emergency recovery; it creates credential UX and recovery-key custody beyond this issue.
- Key rotation UI; v1 formats carry key IDs and domain separation so rotation can be added without redesign.
- Guaranteed erasure from pre-existing backups or APFS snapshots; Pluto can stop creating plaintext and delete managed copies, not rewrite external history.
- Encryption of user exports; Pluto must warn that exported files follow the destination's security policy.

## Implementation Tasks

- [ ] **T1 (P1)** — Run the signed macOS key-custody proof and record the exact enforceable claim.
- [ ] **T2 (P1)** — Select and pin an encrypted SQLite backend after ABI, packaging, migration, crash, and performance tests.
- [ ] **T3 (P1)** — Implement the dedicated fail-closed root-key store and typed startup classifier.
- [ ] **T4 (P1)** — Implement and verify the resumable plaintext-to-encrypted database migration.
- [ ] **T5 (P1)** — Implement the shared encrypted-artifact envelope and per-meeting key hierarchy.
- [ ] **T6 (P1)** — Upgrade capture-journal writes and recovery to encrypted schema v4 without plaintext fallback.
- [ ] **T7 (P1)** — Add scoped native capabilities and PCM/sample inference for ASR, rescoring, and speaker evidence.
- [ ] **T8 (P1)** — Replace plaintext reconstruction/temp-file paths and pass frozen output-parity acceptance.
- [ ] **T9 (P2)** — Add resumable historical audio migration and content-free progress.
- [ ] **T10 (P2)** — Add retention controls, eligibility state machine, confirmed deletion, and capability-loss copy.
- [ ] **T11 (P1)** — Run the complete signed/package/runtime acceptance matrix and stage rollout flags in order.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` | Scope and strategy | 0 | — | Not run |
| Codex Review | `/codex review` | Independent second opinion | 0 | — | Nested Codex pass skipped because this review already runs under Codex |
| Eng Review | `/plan-eng-review` | Architecture and tests | 1 | CLEAR | Staged scope accepted; 8 architecture/code/test/performance gaps folded into the plan |
| Design Review | `/plan-design-review` | UI and recovery UX | 0 | — | Recommended before Phase 4 UI implementation |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | Not required for the security architecture plan |

**VERDICT:** ENG CLEARED — Phase 0 may begin; later phases remain blocked by Gate 0.

NO UNRESOLVED DECISIONS

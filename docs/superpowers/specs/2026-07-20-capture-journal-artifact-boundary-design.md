# Capture Journal Artifact Boundary Design

## Issue

[#505 — Reject capture journals that escape their artifact boundary](https://github.com/metagrover/pluto/issues/505), under crash-safe capture outcome #438 and recording trust roadmap #446.

## Problem

Capture journal manifests are durable evidence used to recover interrupted recordings. The current reader checks only `schemaVersion`, then trusts the requested meeting ID, the manifest's identity and relative paths, and every chunk entry path.

That trust is unsafe. A malformed meeting ID can make journal creation target a nested or parent path. A corrupt version-1 manifest can claim a different meeting identity or redirect a chunk read outside the meeting's capture-journal directory. Recovery then uses those fields to read audio and create a recovered meeting, so validating only the schema version does not preserve the artifact boundary.

## Goals

- Reject unsafe meeting IDs before journal creation performs filesystem mutation.
- Treat the meeting directory used to load a manifest as the authoritative identity.
- Accept only canonical manifest and chunk paths derived from that identity and the entry metadata.
- Reject a malformed manifest before recovery reads any referenced chunk artifact.
- Preserve valid create, append, duplicate-delivery, seal, and launch-recovery behavior.

## Non-goals

- Supporting nested meeting IDs or migrating non-canonical journals.
- General-purpose path sanitization outside capture journals.
- Recovery UI, journal retention, transcript retry, or model policy.
- Reworking the durable sync behavior shipped under #503.
- Expanding validation to unrelated semantic constraints such as timestamp ordering or checksum syntax.

## Chosen Approach

Centralize canonical validation in `electron/captureJournal.ts`, at the shared journal boundary.

The two rejected alternatives are:

1. Validate only inside launch recovery. This leaves create, append, seal, and direct manifest callers with inconsistent trust rules.
2. Resolve and containment-check every filesystem operation independently. This duplicates policy and can still allow a misleading manifest identity even when a particular resolved path stays under the root.

Central canonical validation gives every caller the same contract and makes the manifest's claimed paths verifiable rather than merely contained.

## Meeting Identity Contract

`normalizeMeetingId` remains the single entry point for caller-supplied meeting IDs. After trimming, an accepted ID must:

- be non-empty;
- not equal `.` or `..`;
- contain no `/` or `\` path separator;
- contain no NUL byte.

This is a single-safe-segment contract, not a filename-character allowlist. Existing IDs may retain spaces, punctuation, and Unicode as long as they cannot form multiple path segments or special dot segments.

All public journal operations validate the meeting ID before calling `mkdir`, `readFile`, `writeFile`, `rename`, or `stat`. In particular, `createCaptureJournal` must normalize and reject the identity before creating the `chunks` directory.

## Canonical Manifest Contract

After parsing a version-1 manifest loaded for requested meeting ID `M`, the reader validates:

- `manifest.meetingId === M`;
- `manifest.artifactRootRelativePath === `${M}/capture-journal``;
- `manifest.manifestRelativePath === `${M}/capture-journal/manifest.json``;
- `manifest.entries` is an array;
- every entry has source `mic` or `system`;
- every entry has a non-negative integer sequence;
- every entry's `relativePath` equals the path derived from the canonical artifact root, source, zero-padded sequence, and the normalized extension derived from its `format`.

Validation compares exact normalized relative-path strings; it does not rewrite or silently repair manifest evidence. A mismatch rejects the entire manifest with a capture-journal validation error.

The existing TypeScript types describe trusted in-process values, not parsed JSON. Runtime validation therefore treats parsed fields as untrusted until all boundary checks pass.

## Data Flow and I/O Ordering

### Create

1. Normalize and validate the caller's meeting ID.
2. Derive the canonical journal directory.
3. Create the canonical `chunks` directory.
4. If a manifest already exists, read and fully validate it.
5. Otherwise write a new manifest whose identity and paths are derived internally.

### Read, append, and seal

1. Normalize and validate the requested meeting ID.
2. Read only its canonical `manifest.json` path.
3. Parse and validate the complete canonical manifest contract.
4. Only after validation may append or duplicate handling stat/read a chunk, or seal rewrite the manifest.

### Launch recovery

1. Directory enumeration supplies a single directory-entry name as the requested meeting ID.
2. `readCaptureJournalManifest` validates the manifest against that directory identity.
3. Invalid manifests increment `skippedInvalidManifestCount` and recovery continues with later journals.
4. `buildSourceSegments` receives only validated canonical entries, so its first chunk `access`, `stat`, or `readFile` cannot be redirected by manifest data.

## Error Handling

Validation failures throw an `Error` with a stable `Invalid capture journal ...` prefix and enough field context for local diagnosis, without including audio content. Callers retain their current behavior:

- direct create, read, append, and seal calls reject;
- launch recovery counts the journal as an invalid manifest and continues;
- no invalid manifest is rewritten or partially repaired.

An invalid existing manifest is not treated as `ENOENT`, so `createCaptureJournal` must not replace it with a clean manifest.

## Compatibility

Canonical manifests produced by current Pluto already satisfy the new rules. The change is fail-closed for corrupt or handcrafted non-canonical manifests. No schema-version bump is needed because the accepted version-1 representation is unchanged; this work enforces invariants that the writer already intends.

## Testing Strategy

Focused tests in `tests/unit/captureJournal.test.ts` will prove:

- traversal-like, slash-separated, backslash-separated, dot-segment, and NUL-containing meeting IDs reject before filesystem mutation;
- a manifest identity mismatch rejects;
- non-canonical artifact-root and manifest paths reject;
- an entry path that does not match its source, sequence, and normalized format rejects;
- existing valid create, append, duplicate, and seal tests remain green.

Focused recovery coverage in `tests/unit/captureJournalRecovery.test.ts` will place a malformed manifest beside a sentinel file outside its canonical journal directory and prove:

- recovery counts the manifest in `skippedInvalidManifestCount`;
- no stitch operation receives the escaped path;
- a later healthy journal is still recovered.

Tests follow red-green-refactor: add one failing boundary behavior, verify the expected failure, implement the minimum centralized validation, then run the focused journal and recovery suites before broader verification.

## Documentation and Shipping

The implementation PR will add one issue-scoped changelog fragment under `docs/changelog/entries/` describing the tightened recording evidence boundary. This validation enforces an existing trust decision and does not require a new ADR. If implementation reveals a broader product or architecture decision, `docs/decisions.md` will be updated before the PR is opened.

# App-Managed Speech Models Design

**Issue:** [#476](https://github.com/metagrover/pluto/issues/476)

**Status:** Approved written specification; distribution contract published in #529

**Scope:** Credential-free acquisition, activation, readiness, and rollback for Pluto's selected sherpa-onnx speaker-attribution bundle

## Outcome

Pluto installs and operates its selected local speaker-attribution models without asking the user for a Hugging Face token or leaving a failed download as the only usable state. A checked-in, application-shipped manifest identifies one reviewed bundle. Pluto downloads that bundle from a Pluto-controlled release endpoint, verifies its artifacts and legal notice, probes it offline, and then activates it atomically. Interrupted acquisition resumes safely, a failed upgrade leaves the current model usable, and an explicit rollback can restore the last healthy version.

This slice hardens the existing credential-free sherpa-onnx production path. It does not build a generic model manager, fetch mutable manifests, remove optional Hugging Face settings, automatically roll back after inference errors, or delete superseded model versions.

## Existing System

`python/sherpa_diarization_runtime.py` currently embeds one sherpa-onnx version, two upstream GitHub release URLs, fixed checksums, and a fixed two-file directory layout. `ensure_model_artifacts` downloads both artifacts into a temporary directory, verifies them, and replaces the fixed files. `require_model_artifacts` and `model_readiness` read that directory directly. The WhisperX sidecar exposes status and prepare endpoints, while Electron supplies a version-specific directory under Pluto's user-data root.

That path is credential-free and checksum-pinned, but it has no application-shipped bundle manifest, durable active-version state, resumable partial downloads, cross-process writer lock, previous-healthy pointer, health probe, legal-notice artifact, or rollback operation. Replacing fixed files also cannot guarantee that a concurrent diarization request observes one immutable model snapshot.

## Design Principles

- **Signed application configuration is the authority.** The manifest ships inside Pluto and is never fetched as remote configuration.
- **Installed versions are immutable.** A request resolves one active version before loading models; writers never repair that directory in place.
- **Verification precedes activation.** Size, checksum, provenance, legal notice, runtime compatibility, and an offline probe must pass before durable state changes.
- **Failure preserves service.** Acquisition, probe, activation, and rollback failures leave the current active version unchanged.
- **Resume is identity-bound.** Partial bytes are reusable only for the exact manifest artifact and validated HTTP range response.
- **Operational output is content-free.** Status and errors expose stable reason codes and sanitized provenance, never local paths, download URLs, meeting identity, audio, or transcript content.

## Managed Root Layout

Electron passes a stable managed root such as `models/speaker-attribution`; Python owns its internal layout:

```text
speaker-attribution/
  lifecycle.lock
  state.json
  versions/
    sherpa-onnx-1.13.4-pluto.1/
      bundle.json
      segmentation.int8.onnx
      embedding.onnx
      NOTICE.txt
  staging/
    sherpa-onnx-1.13.4-pluto.1/
      segmentation.int8.onnx.partial
      segmentation.int8.onnx.partial.json
      embedding.onnx.partial
      embedding.onnx.partial.json
      NOTICE.txt
```

The manifest's `bundleVersion` is a safe, opaque directory identifier validated before path construction. Manifest artifact ids and destination names come from a finite schema; user or network input never supplies arbitrary relative paths. A successfully installed version directory is never mutated. Staging may survive process exit so acquisition can resume.

## Application-Shipped Manifest

Add a checked-in manifest next to the runtime plus the real repository-shipped notice it names. The application build includes both files. The schema is exact and versioned:

```ts
type SpeakerModelManifestV1 = {
  schemaVersion: 1;
  bundleVersion: string;
  provider: "sherpa-onnx";
  runtimeVersion: "1.13.4";
  licenseId: string;
  notice: {
    source: "python/model_manifests/sherpa-onnx-1.13.4-NOTICE.txt";
    sha256: "5c679366fe937211ed45a72f6bdd7f83590b85dd9ad3eaff59d53708d0b389cf";
  };
  artifacts: [
    {
      id: "segmentation";
      url: "https://github.com/metagrover/pluto-models/releases/download/sherpa-onnx-1.13.4-pluto.1/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2";
      size: 6958444;
      transportSha256: "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488";
      installedSha256: "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d";
      format: "tar.bz2";
      member: "sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx";
      destination: "segmentation.int8.onnx";
    },
    {
      id: "embedding";
      url: "https://github.com/metagrover/pluto-models/releases/download/sherpa-onnx-1.13.4-pluto.1/nemo_en_titanet_small.onnx";
      size: 40257283;
      transportSha256: "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e";
      installedSha256: "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e";
      format: "raw";
      destination: "embedding.onnx";
    }
  ];
};
```

Issue #529 satisfied the distribution prerequisite by publishing the reviewed objects in the public `metagrover/pluto-models` release `sherpa-onnx-1.13.4-pluto.1`. Repository-level release immutability locked the release tag, metadata, and assets after publication. Anonymous clean downloads reproduced both transport sizes and SHA-256 digests, and an anonymous byte-range request returned the requested `206` response and matching bytes. The former upstream URLs remain only as recorded source and legacy-migration provenance; they are not the managed-distribution contract.

Manifest validation rejects unknown schema versions, duplicate or missing required artifact ids, non-HTTPS or non-Pluto-controlled sources, invalid sizes or checksums, unsafe names, unsupported archive formats, missing notice files, notice checksum mismatch, and a runtime version incompatible with the installed sherpa-onnx package.

## Durable Lifecycle State

`state.json` has this exact schema:

```json
{
  "schemaVersion": 1,
  "generation": 2,
  "activeVersion": "sherpa-onnx-1.13.4-pluto.1",
  "previousHealthyVersion": null
}
```

Every successful activation or rollback increments `generation`. State persistence writes a sibling temporary file, flushes and `fsync`s it, atomically replaces `state.json`, and then `fsync`s the managed root directory. A crash before replacement leaves the prior state authoritative; a crash after replacement yields either the old or complete new document, never a partial document. Startup rejects malformed state with a stable `model_state_invalid` reason rather than guessing from directories.

`activeVersion` and `previousHealthyVersion` may be null only before the first successful activation. Activation of B from A records B active and A previous. Rollback from B to a healthy A records A active and B previous, permitting an explicit roll-forward with the same operation. State never points to staging.

## Lifecycle Serialization and Read Snapshots

Prepare, legacy adoption, activation, and rollback acquire one advisory cross-process exclusive lock at `lifecycle.lock`. A contending writer does not wait indefinitely or begin a second operation; it returns a stable `model_operation_busy` response plus the current sanitized readiness state. Lock ownership is bounded to the mutation and is released on process exit by the operating system.

Diarization does not hold the writer lock for inference. Before loading models it reads and validates one state generation, resolves both artifacts within that immutable version directory, and retains those resolved paths for the request. Later activation or rollback therefore cannot change the model pair halfway through inference. Garbage collection is deferred, so the resolved version cannot disappear in this slice.

## Resumable Acquisition

Each downloaded artifact uses a partial file and a JSON sidecar recording:

- schema version, bundle version, and artifact id;
- URL, expected compressed byte size, and expected SHA-256;
- response validator (`ETag` preferred, otherwise `Last-Modified`) when supplied.

On retry, Pluto compares every identity field with the current shipped manifest and derives the offset from the actual partial file length. A partial larger than the expected size is discarded. For a non-empty partial, the request sends a byte range beginning at that actual offset and sends `If-Range` when a validator exists. Pluto appends only after a `206` whose `Content-Range` start equals the actual offset and whose total equals the manifest size; a changed validator also invalidates the partial. A `200`, malformed or mismatched range, validator change, or changed manifest identity discards that artifact's partial and restarts it from byte zero.

After download, compressed size and SHA-256 are authoritative. An archive member is selected only by the manifest's validated exact member name, must be a regular file, and is extracted without using archive paths as filesystem destinations. Extracted artifacts are verified again against their installed-artifact checksum when the manifest distinguishes transport and installed digests. A resumed checksum failure triggers one clean full-download retry. A second mismatch fails closed as `model_checksum_mismatch` while leaving the active version untouched.

Unrelated valid partials remain available after one artifact fails. Status may expose bundle version, artifact id, bytes received, and expected bytes, but not the URL or local path.

## Verification, Probe, and Activation

Once all staged artifacts exist, the lifecycle service performs these steps under the writer lock:

1. Revalidate the shipped manifest and notice.
2. Verify every staged artifact's final size and SHA-256.
3. Copy the repository-shipped notice into staging and write a canonical `bundle.json` containing sanitized provenance and checksums.
4. Confirm the runtime package version is compatible with the manifest.
5. Run a deterministic offline health probe that loads both models and processes a tiny committed 16 kHz mono synthetic waveform. Network access is disabled or replaced by a test transport at this boundary.
6. Move the complete staged directory into the bundle-version directory under `versions/` atomically. If that immutable version already exists, require it to match the manifest exactly instead of modifying it.
7. Durably write the next state generation with the new active and prior active versions.

A probe failure never updates state. If the version directory move succeeds but state persistence fails, the unreferenced immutable directory is safe and can be reused after complete revalidation on retry. Readiness becomes true only when state is valid and the active directory passes manifest, checksum, notice, compatibility, and probe checks. Readiness does not automatically redownload or repair.

The probe fixture proves load/process compatibility, not diarization quality. Quality remains covered by the recording and speaker-attribution benchmarks.

## Legacy Adoption

On first prepare with no active state, Pluto checks the existing fixed layout currently supplied by Electron. If both legacy model files match the accepted manifest checksums, it stages them into the versioned layout by hard link when the source and staging roots support safe linking, otherwise by copy. It then performs the same verification, notice, offline probe, immutable install, and durable activation flow as a download.

Adoption never moves, edits, or deletes legacy files. A failed adoption leaves the old runtime usable and the operation retryable. After successful activation, production reads the versioned active state; deleting the legacy layout and collecting old versions are separate future work.

## Rollback

Add an explicit rollback lifecycle operation. It performs no network request. Under the writer lock it reads `previousHealthyVersion`, verifies that immutable directory against its installed `bundle.json`, checks the legal notice and runtime compatibility, and runs the same offline probe. If healthy, it durably swaps active and previous while incrementing generation.

If there is no previous version, its directory is missing, validation fails, or the probe fails, rollback returns `rollback_unavailable` with a sanitized subreason and leaves the current active state byte-for-byte unchanged. An ordinary diarization failure never triggers rollback automatically.

## Sidecar and Electron Contracts

The existing status and prepare endpoints remain narrow lifecycle adapters. Prepare becomes idempotent for the shipped target manifest: it adopts, resumes, downloads, verifies, probes, and activates only when necessary. Add an explicit rollback endpoint. Electron targets the stable managed root rather than embedding a version directory in `PLUTO_SPEAKER_MODELS_DIR`.

Successful readiness returns only:

```ts
type DiarizationModelReadiness =
  | {
      ready: true;
      provider: "sherpa-onnx";
      runtimeVersion: string;
      bundleVersion: string;
      licenseId: string;
      generation: number;
      modelChecksums: string[];
    }
  | {
      ready: false;
      reason: string;
      operation?: "idle" | "preparing" | "rolling_back";
      progress?: Array<{ artifactId: string; receivedBytes: number; expectedBytes: number }>;
    };
```

Errors use a finite set including `manifest_invalid`, `model_operation_busy`, `model_acquisition_failed`, `model_checksum_mismatch`, `model_probe_failed`, `model_state_invalid`, and `rollback_unavailable`. HTTP status mapping stays stable and tests assert that serialized responses contain no URL, filesystem path, meeting data, or chained exception text.

## Failure and Crash Semantics

- **Offline or interrupted download:** retain identity-bound valid partials; active state is unchanged.
- **Server ignores or rejects range:** discard that artifact partial and restart safely.
- **Checksum or notice mismatch:** fail closed; never install or activate the staged version.
- **Probe or runtime incompatibility:** retain the current active version and return a retryable sanitized reason.
- **Concurrent prepare or rollback:** one writer proceeds; the other receives busy plus current readiness.
- **Crash during staging:** state is unchanged and valid partials may resume.
- **Crash around state replacement:** recovery observes either the previous complete generation or the new complete generation.
- **Corrupt current state:** inference and mutation fail closed with `model_state_invalid`; no directory is guessed active.
- **Missing or corrupt previous version:** rollback is unavailable and current active remains unchanged.
- **Diarization during activation:** the request completes against the immutable version snapshot resolved at its start.

## Testing Strategy

### Manifest and state unit tests

- accept the exact checked-in manifest and reject unknown schemas, unsafe names, invalid sources, sizes, checksums, archive members, notice digests, and runtime versions;
- prove generation increments and active/previous transitions for first activation, upgrade, rollback, and roll-forward;
- inject crashes before and after state-file flush, replace, and directory `fsync`, then prove recovery reads only a complete authoritative generation;
- prove malformed state fails closed without scanning version directories for an implicit active model.

### Acquisition tests

- fresh complete downloads, valid `206` resume, restart across process launch, and independent artifact progress;
- ignored range returning `200`, wrong `Content-Range` start or total, validator change, oversized partial, and changed manifest identity;
- resumed checksum failure followed by one clean successful retry, plus a second failure that leaves active state untouched;
- exact archive-member extraction with traversal and non-file members rejected.

### Lifecycle and integration tests

- prepare/prepare and prepare/rollback contention across processes;
- legacy hard-link and copy adoption, with failed adoption preserving the old layout;
- activation failure before and after immutable-directory placement;
- rollback success, no previous version, corrupt previous version, and failed previous probe;
- diarization started before activation continues with the original immutable artifact pair;
- a no-network finalization/probe integration test loads the shipped bundle contract and synthetic waveform;
- status and every error path remain free of private paths, URLs, meeting identity, audio, transcript content, and raw exception text.

Repository verification for implementation includes focused Python and Electron tests, `pnpm run lint`, `pnpm run test`, `pnpm run changelog:check`, `pnpm run build-native` when packaging changes touch native distribution, and `git diff --check`.

## Delivery Boundary

This design is one architecture outcome but should be implemented as one focused runtime slice after the exact Pluto-controlled release artifacts are published and reviewed. Because those assets do not currently exist in the Pluto repository's releases, that publication is a prerequisite issue; implementation must not substitute the current upstream URLs.

The implementation may split `sherpa_diarization_runtime.py` into focused manifest/state, acquisition, and runtime modules if needed to preserve clear interfaces. It must keep the existing diarization response compatible for callers and migrate the fixed layout non-destructively.

## Out of Scope

- garbage collection or deletion of inactive and legacy versions;
- optional Hugging Face token UI removal;
- mutable remote manifests or runtime model-channel updates;
- a generic multi-model package manager;
- named-speaker recognition, voiceprints, or enrollment;
- automatic rollback after inference or attribution errors;
- recording UI redesign or outbound integrations.

## Approved State Flow

```text
absent
  -> staging (identity-bound partials retained)
  -> verified
  -> probed healthy
  -> durable atomic activation
  -> active immutable version

active A + prepare B failure   -> active A unchanged
active A + activate B          -> active B, previous A
active B + rollback healthy A  -> active A, previous B
active B + corrupt/missing A   -> active B unchanged, rollback_unavailable
```

## Written-Spec Review Gate

Owner merge of design PR #528 completed the written-spec review. The reviewed specification covers the Pluto-controlled distribution prerequisite, exact resume rules, cross-process serialization, crash-durable state, deterministic offline probe, non-destructive legacy adoption, and rollback-unavailable behavior. Runtime implementation can begin from this contract after the #529 distribution PR lands.

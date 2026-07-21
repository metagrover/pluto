# Managed Speaker-Model Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Pluto's fixed speaker-model directory with a manifest-driven, resumable, versioned lifecycle that preserves the last healthy bundle and supports explicit rollback.

**Architecture:** Add a focused Python lifecycle module that owns manifest validation, resumable transport, immutable version directories, durable state, locking, legacy adoption, probing, readiness, and rollback. Keep `sherpa_diarization_runtime.py` responsible for inference and route its preparation/readiness calls through the lifecycle module. Extend the Python sidecar and Electron adapter with one explicit rollback operation while preserving the no-download finalization boundary.

**Tech Stack:** Python 3 standard library, FastAPI sidecar, Electron/TypeScript, unittest, Vitest, pnpm/Biome.

---

### Task 1: Manifest and durable-state contracts

**Files:**
- Create: `python/sherpa_model_lifecycle.py`
- Create: `python/tests/test_sherpa_model_lifecycle.py`
- Read: `python/model_manifests/sherpa-onnx-1.13.4-distribution.json`

- [ ] **Step 1: Write failing manifest-validation tests**

```python
class ManifestValidationTest(unittest.TestCase):
    def test_loads_the_shipped_distribution_contract(self):
        manifest = load_shipped_manifest()
        self.assertEqual(manifest.bundle_version, "sherpa-onnx-1.13.4-pluto.1")
        self.assertEqual([item.id for item in manifest.artifacts], ["segmentation", "embedding"])

    def test_rejects_uncontrolled_url_before_filesystem_mutation(self):
        payload = shipped_payload()
        payload["artifacts"][0]["url"] = "https://example.com/model.tar.bz2"
        with self.assertRaisesRegex(ModelLifecycleError, "manifest_invalid"):
            parse_manifest(payload, notice_path=self.notice)
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `python3 -m unittest python.tests.test_sherpa_model_lifecycle.ManifestValidationTest -v`
Expected: import failure because `python.sherpa_model_lifecycle` does not exist.

- [ ] **Step 3: Implement exact manifest types and fail-closed validation**

```python
@dataclass(frozen=True)
class ModelArtifact:
    id: str
    url: str
    size: int
    transport_sha256: str
    installed_sha256: str
    format: str
    destination: str
    member: str | None = None

@dataclass(frozen=True)
class ModelManifest:
    schema_version: int
    bundle_version: str
    provider: str
    runtime_version: str
    license_ids: tuple[str, ...]
    notice_path: Path
    notice_sha256: str
    artifacts: tuple[ModelArtifact, ...]

def load_shipped_manifest() -> ModelManifest:
    root = Path(__file__).parent / "model_manifests"
    payload = json.loads((root / "sherpa-onnx-1.13.4-distribution.json").read_text())
    return parse_manifest(payload, notice_path=root / "sherpa-onnx-1.13.4-NOTICE.txt")
```

Validation must accept only schema 1, the exact provider/runtime, a safe bundle identifier, the two required unique artifact ids, positive sizes, lowercase 64-character SHA-256 values, HTTPS URLs under `github.com/metagrover/pluto-models/releases/download/`, finite destinations/formats, the exact segmentation member, and a notice whose bytes match the declared digest. Every validation error raises only `ModelLifecycleError("manifest_invalid")`.

- [ ] **Step 4: Add state-transition and malformed-state tests**

```python
def test_activation_records_previous_and_increments_generation(self):
    write_state(self.root, LifecycleState(1, 4, "A", None))
    write_state(self.root, next_activation(read_state(self.root), "B"))
    self.assertEqual(read_state(self.root), LifecycleState(1, 5, "B", "A"))

def test_malformed_state_fails_closed_without_scanning_versions(self):
    (self.root / "state.json").write_text("{")
    with self.assertRaisesRegex(ModelLifecycleError, "model_state_invalid"):
        read_state(self.root)
```

- [ ] **Step 5: Implement atomic, fsync-backed state IO**

```python
@dataclass(frozen=True)
class LifecycleState:
    schema_version: int = 1
    generation: int = 0
    active_version: str | None = None
    previous_healthy_version: str | None = None

def next_activation(state: LifecycleState, version: str) -> LifecycleState:
    return LifecycleState(1, state.generation + 1, version, state.active_version)
```

`write_state` writes canonical JSON to `state.json.tmp`, flushes and fsyncs the file, replaces `state.json`, then fsyncs the managed root. `read_state` accepts only the exact schema and safe version identifiers; missing state returns generation zero, while malformed state raises `model_state_invalid`.

- [ ] **Step 6: Run focused tests and commit**

Run: `python3 -m unittest python.tests.test_sherpa_model_lifecycle.ManifestValidationTest python.tests.test_sherpa_model_lifecycle.LifecycleStateTest -v`
Expected: all tests pass.

Commit: `git commit -m 'Add managed model manifest and state contracts (#476)'`

### Task 2: Identity-bound resumable acquisition

**Files:**
- Modify: `python/sherpa_model_lifecycle.py`
- Modify: `python/tests/test_sherpa_model_lifecycle.py`

- [ ] **Step 1: Write failing resume and restart tests**

```python
def test_resumes_only_from_matching_206_range(self):
    partial = self.staging / "embedding.onnx.partial"
    partial.write_bytes(b"abc")
    write_resume_metadata(partial, self.embedding, validator='"v1"')
    transport = FakeTransport([response(206, b"def", content_range="bytes 3-5/6", etag='"v1"')])
    download_artifact(self.embedding_with(size=6, digest=sha256(b"abcdef")), partial, transport)
    self.assertEqual(partial.read_bytes(), b"abcdef")
    self.assertEqual(transport.requests[0].headers, {"Range": "bytes=3-", "If-Range": '"v1"'})

def test_range_ignored_restarts_from_zero(self):
    partial = self.partial(b"abc")
    transport = FakeTransport([response(200, b"abcdef")])
    download_artifact(self.embedding_with(size=6, digest=sha256(b"abcdef")), partial, transport)
    self.assertEqual(partial.read_bytes(), b"abcdef")
```

- [ ] **Step 2: Run tests and verify RED**

Run: `python3 -m unittest python.tests.test_sherpa_model_lifecycle.AcquisitionTest -v`
Expected: failure because resumable acquisition functions are missing.

- [ ] **Step 3: Implement resumable transport**

```python
class UrlTransport:
    def open(self, url: str, headers: dict[str, str]):
        return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120)

def download_artifact(artifact: ModelArtifact, partial: Path, transport: UrlTransport) -> Path:
    offset = valid_resume_offset(partial, artifact)
    headers = resume_headers(partial, offset)
    with transport.open(artifact.url, headers) as response:
        append = response.status == 206 and valid_content_range(response, offset, artifact.size)
        if offset and not append:
            offset = 0
        write_response(partial, response, append=append)
    verify_size_and_digest(partial, artifact.size, artifact.transport_sha256)
    return partial
```

Persist sidecar identity fields for schema, bundle version, artifact id, URL, size, digest, and validator. Reject changed identity, oversized partials, changed validators, incorrect range start/total, and malformed responses. Retry one clean full download after a resumed checksum mismatch; a second mismatch raises `model_checksum_mismatch`. Preserve unrelated valid partials.

- [ ] **Step 4: Add safe extraction tests**

```python
def test_extracts_only_the_declared_regular_member(self):
    installed = materialize_artifact(self.segmentation, self.archive, self.output)
    self.assertEqual(installed.read_bytes(), b"model")

def test_rejects_traversal_or_non_file_members(self):
    with self.assertRaisesRegex(ModelLifecycleError, "model_acquisition_failed"):
        materialize_artifact(self.segmentation_with(member="../model"), self.archive, self.output)
```

- [ ] **Step 5: Implement exact-member extraction and verification**

For `raw`, copy bytes to the declared destination. For `tar.bz2`, call `getmember` with the already validated exact name, require `isfile()`, stream only that member to the finite destination, then verify the installed checksum. Never call `extract` or use archive paths as destinations.

- [ ] **Step 6: Run focused tests and commit**

Run: `python3 -m unittest python.tests.test_sherpa_model_lifecycle.AcquisitionTest -v`
Expected: all tests pass.

Commit: `git commit -m 'Add resumable speaker model acquisition (#476)'`

### Task 3: Immutable install, health, legacy adoption, and rollback

**Files:**
- Modify: `python/sherpa_model_lifecycle.py`
- Modify: `python/tests/test_sherpa_model_lifecycle.py`

- [ ] **Step 1: Write failing lifecycle behavior tests**

```python
def test_failed_probe_leaves_current_active_version_unchanged(self):
    self.activate("A")
    with self.assertRaisesRegex(ModelLifecycleError, "model_probe_failed"):
        prepare_managed_models(self.root, manifest=self.manifest_b, transport=self.transport, probe=failing_probe)
    self.assertEqual(read_state(self.root).active_version, "A")

def test_rollback_swaps_active_and_previous_without_network(self):
    self.activate("A")
    self.activate("B")
    result = rollback_managed_models(self.root, manifest_loader=self.loader, probe=passing_probe)
    self.assertEqual((result.active_version, result.previous_healthy_version), ("A", "B"))
    self.assertEqual(self.transport.requests, [])
```

- [ ] **Step 2: Run tests and verify RED**

Run: `python3 -m unittest python.tests.test_sherpa_model_lifecycle.ManagedLifecycleTest -v`
Expected: lifecycle entry points are missing.

- [ ] **Step 3: Implement writer serialization and immutable activation**

```python
@contextmanager
def lifecycle_lock(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    handle = (root / "lifecycle.lock").open("a+b")
    try:
        acquire_nonblocking_lock(handle)
        yield
    except BlockingIOError as error:
        raise ModelLifecycleError("model_operation_busy") from error
    finally:
        release_lock(handle)
        handle.close()
```

`prepare_managed_models` holds the lock, validates manifest/notice, adopts a checksum-valid legacy layout when no state exists, otherwise resumes downloads, materializes and verifies staging, copies the notice, writes canonical `bundle.json`, checks runtime compatibility, runs the injected deterministic probe, atomically renames staging to `versions/<bundleVersion>`, then durably activates it. An existing immutable version must match exactly and is never repaired in place.

- [ ] **Step 4: Implement readiness snapshots and rollback**

`resolve_active_artifacts` reads one state generation, validates the active immutable directory and its `bundle.json`, and returns both resolved artifact paths plus provenance. `model_readiness` returns sanitized bundle/version/license/generation/checksum data or a finite reason. `rollback_managed_models` performs no network request, revalidates and probes `previousHealthyVersion`, then durably swaps active/previous; all failure paths leave current state byte-for-byte unchanged and return `rollback_unavailable`.

- [ ] **Step 5: Add lock, privacy, legacy, and immutable-snapshot tests**

Cover writer contention returning `model_operation_busy`, legacy copy adoption without source mutation, invalid legacy remaining unavailable, missing/corrupt previous version, status free of paths/URLs/raw exceptions, and a read snapshot retaining its original artifact pair while activation changes state.

- [ ] **Step 6: Run lifecycle tests and commit**

Run: `python3 -m unittest python.tests.test_sherpa_model_lifecycle -v`
Expected: all lifecycle tests pass.

Commit: `git commit -m 'Add activation health and rollback lifecycle (#476)'`

### Task 4: Runtime, sidecar, and Electron integration

**Files:**
- Modify: `python/sherpa_diarization_runtime.py`
- Modify: `python/tests/test_sherpa_diarization_runtime.py`
- Modify: `python/whisperx_server.py`
- Modify: `electron/whisperx.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Write failing runtime integration tests**

```python
def test_finalization_resolves_active_snapshot_without_downloading(self):
    active = require_model_artifacts(self.root)
    self.assertEqual(active, (self.version / "segmentation.int8.onnx", self.version / "embedding.onnx"))
    self.assertEqual(self.transport.requests, [])

def test_readiness_names_bundle_generation_and_license(self):
    self.assertEqual(model_readiness(self.root), {
        "ready": True,
        "provider": "sherpa-onnx",
        "runtimeVersion": "1.13.4",
        "bundleVersion": "sherpa-onnx-1.13.4-pluto.1",
        "licenseIds": ["MIT", "Apache-2.0"],
        "generation": 1,
        "modelChecksums": [SEGMENTATION_SHA256, EMBEDDING_SHA256],
    })
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run: `python3 -m unittest python.tests.test_sherpa_diarization_runtime -v`
Expected: current fixed-layout resolution does not return managed provenance.

- [ ] **Step 3: Route runtime entry points through lifecycle**

Keep `verify_artifact`, audio-boundary checks, and inference in `sherpa_diarization_runtime.py`. Replace embedded upstream acquisition with lifecycle calls:

```python
def ensure_model_artifacts(model_root: Path, **dependencies) -> tuple[Path, Path]:
    return prepare_managed_models(model_root, **dependencies).artifact_paths

def require_model_artifacts(model_root: Path) -> tuple[Path, Path]:
    return resolve_active_artifacts(model_root).artifact_paths
```

Finalization must call only `require_model_artifacts`; it never invokes prepare or a network transport.

- [ ] **Step 4: Add rollback sidecar and Electron contract**

Add `POST /diarization/models/rollback` that maps sanitized lifecycle errors to the existing finite HTTP error shape. Add `rollbackDiarizationModels()` and IPC handler `WHISPER_ROLLBACK_DIARIZATION_MODELS`. Update `DiarizationModelReadiness` to the approved bundle/generation/license/progress union. Change `PLUTO_SPEAKER_MODELS_DIR` to the stable `models/speaker-attribution` root rather than embedding a version.

- [ ] **Step 5: Run focused Python and TypeScript checks and commit**

Run:
- `python3 -m unittest python.tests.test_sherpa_model_lifecycle python.tests.test_sherpa_diarization_runtime -v`
- `pnpm exec tsc --noEmit`
- `pnpm run lint`

Expected: all pass.

Commit: `git commit -m 'Integrate managed speaker models with the sidecar (#476)'`

### Task 5: Documentation, changelog, and release verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-20-app-managed-speech-models-design.md`
- Create: `docs/changelog/entries/2026-07-21-476-managed-model-lifecycle.md`

- [ ] **Step 1: Record the shipped runtime boundary**

Update the spec status to implemented by the runtime PR and record that automatic rollback remains limited to activation/first-load health, while ordinary meeting inference errors never change active version. Add the issue-scoped changelog fragment with `Issue`, `PR`, `Changed`, `Why`, `Replaced`, and `Notes` fields.

- [ ] **Step 2: Run the full verification matrix**

Run:
- `python3 -m unittest python.tests.test_sherpa_model_lifecycle python.tests.test_sherpa_diarization_runtime -v`
- `python3 -m json.tool python/model_manifests/sherpa-onnx-1.13.4-distribution.json`
- `pnpm run changelog:check`
- `pnpm run lint`
- `pnpm run test -- --run`
- `pnpm run audit:high`
- `git diff --check`

Expected: zero failures, no high-severity advisories, and no whitespace errors.

- [ ] **Step 3: Inspect privacy and scope**

Run: `git diff origin/master...HEAD | rg -n '/Users/|/tmp/|meeting.*(name|title)|transcript|audioPath|https://github.com/k2-fsa'`
Expected: only deliberate source-provenance documentation matches; no private paths, meeting content, credentials, or upstream runtime download URLs.

- [ ] **Step 4: Commit and prepare delivery**

Commit: `git commit -m 'Document managed speaker model lifecycle (#476)'`

Push `codex/476-managed-model-lifecycle`, open a PR against `master`, link #476, add `codex` and `codex-automation`, update #476 with verification, and append the Builder run memory.

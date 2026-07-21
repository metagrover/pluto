from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tarfile
import tempfile
import urllib.error
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MANIFEST_DIR = Path(__file__).parent / "model_manifests"
MANIFEST_PATH = MANIFEST_DIR / "sherpa-onnx-1.13.4-distribution.json"
NOTICE_PATH = MANIFEST_DIR / "sherpa-onnx-1.13.4-NOTICE.txt"
CONTROLLED_URL_PREFIX = "https://github.com/metagrover/pluto-models/releases/download/"
SAFE_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SEGMENTATION_MEMBER = "sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx"


class ModelLifecycleError(RuntimeError):
    pass


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


@dataclass(frozen=True)
class LifecycleState:
    schema_version: int = 1
    generation: int = 0
    active_version: str | None = None
    previous_healthy_version: str | None = None


@dataclass(frozen=True)
class ManagedModelSnapshot:
    artifact_paths: tuple[Path, Path]
    bundle_version: str
    runtime_version: str
    license_ids: tuple[str, ...]
    generation: int
    active_version: str
    previous_healthy_version: str | None


def _sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def _manifest_invalid() -> ModelLifecycleError:
    return ModelLifecycleError("manifest_invalid")


def parse_manifest(payload: dict[str, Any], *, notice_path: Path) -> ModelManifest:
    try:
        if set(payload) < {"schemaVersion", "bundleVersion", "provider", "runtimeVersion", "licenses", "notice", "artifacts"}:
            raise _manifest_invalid()
        version = payload["bundleVersion"]
        licenses = payload["licenses"]
        notice = payload["notice"]
        items = payload["artifacts"]
        if payload["schemaVersion"] != 1 or payload["provider"] != "sherpa-onnx" or payload["runtimeVersion"] != "1.13.4":
            raise _manifest_invalid()
        if not isinstance(version, str) or not SAFE_VERSION.fullmatch(version):
            raise _manifest_invalid()
        if licenses != ["MIT", "Apache-2.0"] or not notice_path.is_file():
            raise _manifest_invalid()
        notice_digest = notice["sha256"]
        if not isinstance(notice_digest, str) or not SHA256.fullmatch(notice_digest) or _sha256(notice_path) != notice_digest:
            raise _manifest_invalid()
        if not isinstance(items, list) or len(items) != 2:
            raise _manifest_invalid()
        parsed: list[ModelArtifact] = []
        for item in items:
            artifact = ModelArtifact(
                id=item["id"],
                url=item["url"],
                size=item["size"],
                transport_sha256=item["transportSha256"],
                installed_sha256=item["installedSha256"],
                format=item["format"],
                destination=item["destination"],
                member=item.get("member"),
            )
            if not artifact.url.startswith(CONTROLLED_URL_PREFIX) or not isinstance(artifact.size, int) or artifact.size <= 0:
                raise _manifest_invalid()
            if not SHA256.fullmatch(artifact.transport_sha256) or not SHA256.fullmatch(artifact.installed_sha256):
                raise _manifest_invalid()
            expected = {
                "segmentation": ("tar.bz2", "segmentation.int8.onnx", SEGMENTATION_MEMBER),
                "embedding": ("raw", "embedding.onnx", None),
            }.get(artifact.id)
            if expected != (artifact.format, artifact.destination, artifact.member):
                raise _manifest_invalid()
            parsed.append(artifact)
        if [item.id for item in parsed] != ["segmentation", "embedding"]:
            raise _manifest_invalid()
        return ModelManifest(1, version, "sherpa-onnx", "1.13.4", tuple(licenses), notice_path, notice_digest, tuple(parsed))
    except (KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as error:
        raise _manifest_invalid() from error


def load_shipped_manifest() -> ModelManifest:
    try:
        payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise _manifest_invalid() from error
    return parse_manifest(payload, notice_path=NOTICE_PATH)


def read_state(root: Path) -> LifecycleState:
    path = root / "state.json"
    if not path.exists():
        return LifecycleState()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if set(payload) != {"schemaVersion", "generation", "activeVersion", "previousHealthyVersion"}:
            raise ValueError
        state = LifecycleState(payload["schemaVersion"], payload["generation"], payload["activeVersion"], payload["previousHealthyVersion"])
        if state.schema_version != 1 or not isinstance(state.generation, int) or state.generation < 0:
            raise ValueError
        for version in (state.active_version, state.previous_healthy_version):
            if version is not None and (not isinstance(version, str) or not SAFE_VERSION.fullmatch(version)):
                raise ValueError
        return state
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise ModelLifecycleError("model_state_invalid") from error


def write_state(root: Path, state: LifecycleState) -> None:
    root.mkdir(parents=True, exist_ok=True)
    temporary = root / "state.json.tmp"
    payload = {
        "schemaVersion": state.schema_version,
        "generation": state.generation,
        "activeVersion": state.active_version,
        "previousHealthyVersion": state.previous_healthy_version,
    }
    try:
        with temporary.open("w", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True, separators=(",", ":"))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(root / "state.json")
        descriptor = os.open(root, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError as error:
        raise ModelLifecycleError("model_state_invalid") from error


def next_activation(state: LifecycleState, version: str) -> LifecycleState:
    if not SAFE_VERSION.fullmatch(version):
        raise ModelLifecycleError("model_state_invalid")
    return LifecycleState(1, state.generation + 1, version, state.active_version)


class UrlTransport:
    def open(self, url: str, headers: dict[str, str]):
        request = urllib.request.Request(url, headers=headers)
        return urllib.request.urlopen(request, timeout=120)


def _resume_metadata_path(partial: Path) -> Path:
    return partial.with_suffix(partial.suffix + ".json")


def _resume_identity(artifact: ModelArtifact) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifactId": artifact.id,
        "url": artifact.url,
        "size": artifact.size,
        "sha256": artifact.transport_sha256,
    }


def _resume_details(partial: Path, artifact: ModelArtifact) -> tuple[int, str | None]:
    metadata_path = _resume_metadata_path(partial)
    if not partial.is_file() or not metadata_path.is_file():
        return 0, None
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        identity = _resume_identity(artifact)
        if any(metadata.get(key) != value for key, value in identity.items()):
            return 0, None
        size = partial.stat().st_size
        if size <= 0 or size > artifact.size:
            return 0, None
        validator = metadata.get("validator")
        if validator is not None and not isinstance(validator, str):
            return 0, None
        return size, validator
    except (OSError, json.JSONDecodeError, TypeError):
        return 0, None


def _header(headers: Any, name: str) -> str | None:
    if hasattr(headers, "get"):
        return headers.get(name) or headers.get(name.lower())
    return None


def _valid_content_range(response: Any, offset: int, total: int) -> bool:
    value = _header(response.headers, "Content-Range")
    if not isinstance(value, str):
        return False
    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", value)
    return bool(match and int(match.group(1)) == offset and int(match.group(3)) == total)


def _stream_response(response: Any, output) -> None:
    while True:
        chunk = response.read(1024 * 1024)
        if not chunk:
            return
        output.write(chunk)


def _write_resume_metadata(partial: Path, artifact: ModelArtifact, validator: str | None) -> None:
    payload = {**_resume_identity(artifact), "validator": validator}
    _resume_metadata_path(partial).write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def _download_once(artifact: ModelArtifact, partial: Path, transport: Any) -> bool:
    partial.parent.mkdir(parents=True, exist_ok=True)
    offset, validator = _resume_details(partial, artifact)
    headers: dict[str, str] = {}
    if offset:
        headers["Range"] = f"bytes={offset}-"
        if validator:
            headers["If-Range"] = validator
    with transport.open(artifact.url, headers) as response:
        append = offset > 0 and response.status == 206 and _valid_content_range(response, offset, artifact.size)
        response_validator = _header(response.headers, "ETag") or _header(response.headers, "Last-Modified")
        if append and validator and response_validator and response_validator != validator:
            append = False
        _write_resume_metadata(partial, artifact, response_validator)
        with partial.open("ab" if append else "wb") as output:
            _stream_response(response, output)
    return append


def _verify_size_digest(path: Path, size: int, expected_sha256: str, reason: str) -> Path:
    if not path.is_file() or path.stat().st_size != size or _sha256(path) != expected_sha256:
        raise ModelLifecycleError(reason)
    return path


def download_artifact(artifact: ModelArtifact, partial: Path, transport: Any | None = None) -> Path:
    transport = transport or UrlTransport()
    try:
        resumed = _download_once(artifact, partial, transport)
        try:
            return _verify_size_digest(partial, artifact.size, artifact.transport_sha256, "model_checksum_mismatch")
        except ModelLifecycleError:
            if not resumed:
                raise
            partial.unlink(missing_ok=True)
            _resume_metadata_path(partial).unlink(missing_ok=True)
            _download_once(artifact, partial, transport)
            return _verify_size_digest(partial, artifact.size, artifact.transport_sha256, "model_checksum_mismatch")
    except ModelLifecycleError:
        raise
    except (OSError, urllib.error.URLError) as error:
        raise ModelLifecycleError("model_acquisition_failed") from error


def materialize_artifact(artifact: ModelArtifact, transport_path: Path, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / artifact.destination
    try:
        if artifact.format == "raw":
            shutil.copyfile(transport_path, destination)
        elif artifact.format == "tar.bz2" and artifact.member:
            with tarfile.open(transport_path, "r:bz2") as bundle:
                member = bundle.getmember(artifact.member)
                source = bundle.extractfile(member)
                if source is None or not member.isfile():
                    raise ModelLifecycleError("model_acquisition_failed")
                with source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output)
        else:
            raise ModelLifecycleError("model_acquisition_failed")
        return _verify_size_digest(destination, destination.stat().st_size, artifact.installed_sha256, "model_checksum_mismatch")
    except ModelLifecycleError:
        raise
    except (OSError, KeyError, tarfile.TarError) as error:
        raise ModelLifecycleError("model_acquisition_failed") from error


@contextmanager
def lifecycle_lock(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    handle = (root / "lifecycle.lock").open("a+b")
    try:
        try:
            _set_file_lock(handle, acquire=True)
        except (BlockingIOError, OSError) as error:
            raise ModelLifecycleError("model_operation_busy") from error
        yield
    finally:
        try:
            _set_file_lock(handle, acquire=False)
        except OSError:
            pass
        handle.close()


def _set_file_lock(handle, *, acquire: bool) -> None:
    try:
        import fcntl

        operation = fcntl.LOCK_EX | fcntl.LOCK_NB if acquire else fcntl.LOCK_UN
        fcntl.flock(handle.fileno(), operation)
    except ImportError:
        import msvcrt

        if handle.tell() == 0 and handle.seek(0, os.SEEK_END) == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        mode = msvcrt.LK_NBLCK if acquire else msvcrt.LK_UNLCK
        msvcrt.locking(handle.fileno(), mode, 1)


def _bundle_payload(manifest: ModelManifest) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "bundleVersion": manifest.bundle_version,
        "provider": manifest.provider,
        "runtimeVersion": manifest.runtime_version,
        "licenseIds": list(manifest.license_ids),
        "noticeSha256": manifest.notice_sha256,
        "artifacts": [
            {
                "id": item.id,
                "destination": item.destination,
                "installedSha256": item.installed_sha256,
            }
            for item in manifest.artifacts
        ],
    }


def _write_bundle(directory: Path, manifest: ModelManifest) -> None:
    shutil.copyfile(manifest.notice_path, directory / "NOTICE.txt")
    (directory / "bundle.json").write_text(
        json.dumps(_bundle_payload(manifest), sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def _verify_version(root: Path, version: str, generation: int = 0, previous: str | None = None) -> ManagedModelSnapshot:
    directory = root / "versions" / version
    try:
        payload = json.loads((directory / "bundle.json").read_text(encoding="utf-8"))
        if payload["schemaVersion"] != 1 or payload["bundleVersion"] != version or payload["provider"] != "sherpa-onnx":
            raise ValueError
        licenses = tuple(payload["licenseIds"])
        if licenses != ("MIT", "Apache-2.0") or _sha256(directory / "NOTICE.txt") != payload["noticeSha256"]:
            raise ValueError
        paths: list[Path] = []
        for expected_id, item in zip(("segmentation", "embedding"), payload["artifacts"], strict=True):
            if item["id"] != expected_id or item["destination"] not in ("segmentation.int8.onnx", "embedding.onnx"):
                raise ValueError
            path = directory / item["destination"]
            if not path.is_file() or _sha256(path) != item["installedSha256"]:
                raise ValueError
            paths.append(path.resolve())
        return ManagedModelSnapshot((paths[0], paths[1]), version, payload["runtimeVersion"], licenses, generation, version, previous)
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise ModelLifecycleError("model_missing") from error


def resolve_active_artifacts(root: Path) -> ManagedModelSnapshot:
    state = read_state(root)
    if state.active_version is None:
        raise ModelLifecycleError("model_missing")
    return _verify_version(root, state.active_version, state.generation, state.previous_healthy_version)


def _adopt_legacy(root: Path, install_dir: Path, manifest: ModelManifest) -> bool:
    legacy = root / "sherpa-onnx-1.13.4"
    sources = (legacy / "segmentation.int8.onnx", legacy / "embedding.onnx")
    if not all(path.is_file() for path in sources):
        return False
    if any(_sha256(path) != artifact.installed_sha256 for path, artifact in zip(sources, manifest.artifacts, strict=True)):
        return False
    for source, artifact in zip(sources, manifest.artifacts, strict=True):
        shutil.copyfile(source, install_dir / artifact.destination)
    return True


def prepare_managed_models(
    root: Path,
    *,
    manifest: ModelManifest | None = None,
    transport: Any | None = None,
    probe=lambda _paths: True,
) -> ManagedModelSnapshot:
    manifest = manifest or load_shipped_manifest()
    transport = transport or UrlTransport()
    with lifecycle_lock(root):
        state = read_state(root)
        if state.active_version == manifest.bundle_version:
            return _verify_version(root, state.active_version, state.generation, state.previous_healthy_version)
        version_dir = root / "versions" / manifest.bundle_version
        if version_dir.exists():
            candidate = _verify_version(root, manifest.bundle_version, state.generation, state.previous_healthy_version)
        else:
            staging_root = root / "staging" / manifest.bundle_version
            staging_root.mkdir(parents=True, exist_ok=True)
            install_dir = Path(tempfile.mkdtemp(prefix="install-", dir=staging_root))
            adopted = state.active_version is None and _adopt_legacy(root, install_dir, manifest)
            if not adopted:
                for artifact in manifest.artifacts:
                    partial = staging_root / f"{artifact.id}.partial"
                    transport_path = download_artifact(artifact, partial, transport)
                    materialize_artifact(artifact, transport_path, install_dir)
            _write_bundle(install_dir, manifest)
            candidate = _verify_candidate(install_dir, manifest)
            if not probe(candidate.artifact_paths):
                raise ModelLifecycleError("model_probe_failed")
            version_dir.parent.mkdir(parents=True, exist_ok=True)
            try:
                install_dir.replace(version_dir)
            except OSError as error:
                raise ModelLifecycleError("model_acquisition_failed") from error
            candidate = _verify_version(root, manifest.bundle_version, state.generation, state.previous_healthy_version)
        if not probe(candidate.artifact_paths):
            raise ModelLifecycleError("model_probe_failed")
        new_state = next_activation(state, manifest.bundle_version)
        write_state(root, new_state)
        return _verify_version(root, new_state.active_version or manifest.bundle_version, new_state.generation, new_state.previous_healthy_version)


def _verify_candidate(directory: Path, manifest: ModelManifest) -> ManagedModelSnapshot:
    for artifact in manifest.artifacts:
        if _sha256(directory / artifact.destination) != artifact.installed_sha256:
            raise ModelLifecycleError("model_checksum_mismatch")
    if _sha256(directory / "NOTICE.txt") != manifest.notice_sha256:
        raise ModelLifecycleError("manifest_invalid")
    paths = (
        (directory / manifest.artifacts[0].destination).resolve(),
        (directory / manifest.artifacts[1].destination).resolve(),
    )
    return ManagedModelSnapshot(paths, manifest.bundle_version, manifest.runtime_version, manifest.license_ids, 0, manifest.bundle_version, None)


def rollback_managed_models(root: Path, *, probe=lambda _paths: True) -> LifecycleState:
    with lifecycle_lock(root):
        state = read_state(root)
        if state.active_version is None or state.previous_healthy_version is None:
            raise ModelLifecycleError("rollback_unavailable")
        try:
            candidate = _verify_version(root, state.previous_healthy_version, state.generation, state.active_version)
            if not probe(candidate.artifact_paths):
                raise ModelLifecycleError("rollback_unavailable")
        except ModelLifecycleError as error:
            raise ModelLifecycleError("rollback_unavailable") from error
        next_state = LifecycleState(1, state.generation + 1, state.previous_healthy_version, state.active_version)
        write_state(root, next_state)
        return next_state


def model_readiness(root: Path) -> dict[str, Any]:
    try:
        snapshot = resolve_active_artifacts(root)
    except ModelLifecycleError as error:
        return {"ready": False, "reason": str(error)}
    return {
        "ready": True,
        "provider": "sherpa-onnx",
        "runtimeVersion": snapshot.runtime_version,
        "bundleVersion": snapshot.bundle_version,
        "licenseIds": list(snapshot.license_ids),
        "generation": snapshot.generation,
        "modelChecksums": [_sha256(path) for path in snapshot.artifact_paths],
    }

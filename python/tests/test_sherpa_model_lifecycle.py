import hashlib
import json
import tempfile
import tarfile
import unittest
from pathlib import Path

from python.sherpa_model_lifecycle import (
    LifecycleState,
    ModelLifecycleError,
    load_shipped_manifest,
    next_activation,
    parse_manifest,
    read_state,
    write_state,
    download_artifact,
    materialize_artifact,
    ModelArtifact,
    ModelManifest,
    model_readiness,
    prepare_managed_models,
    resolve_active_artifacts,
    rollback_managed_models,
    lifecycle_lock,
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ManifestValidationTest(unittest.TestCase):
    def test_loads_the_shipped_distribution_contract(self):
        manifest = load_shipped_manifest()
        self.assertEqual(manifest.bundle_version, "sherpa-onnx-1.13.4-pluto.1")
        self.assertEqual([item.id for item in manifest.artifacts], ["segmentation", "embedding"])

    def test_rejects_uncontrolled_url_before_filesystem_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            notice = Path(directory) / "NOTICE.txt"
            notice.write_bytes(b"notice")
            payload = {
                "schemaVersion": 1,
                "bundleVersion": "sherpa-onnx-1.13.4-pluto.1",
                "provider": "sherpa-onnx",
                "runtimeVersion": "1.13.4",
                "licenses": ["MIT", "Apache-2.0"],
                "notice": {"source": "NOTICE.txt", "sha256": digest(b"notice")},
                "artifacts": [
                    {
                        "id": "segmentation",
                        "url": "https://example.com/model.tar.bz2",
                        "size": 10,
                        "transportSha256": "0" * 64,
                        "installedSha256": "1" * 64,
                        "format": "tar.bz2",
                        "member": "sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx",
                        "destination": "segmentation.int8.onnx",
                    },
                    {
                        "id": "embedding",
                        "url": "https://github.com/metagrover/pluto-models/releases/download/v/embedding.onnx",
                        "size": 10,
                        "transportSha256": "2" * 64,
                        "installedSha256": "2" * 64,
                        "format": "raw",
                        "destination": "embedding.onnx",
                    },
                ],
            }
            with self.assertRaisesRegex(ModelLifecycleError, "manifest_invalid") as raised:
                parse_manifest(payload, notice_path=notice)
            self.assertNotIn(directory, str(raised.exception))


class LifecycleStateTest(unittest.TestCase):
    def test_activation_records_previous_and_increments_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_state(root, LifecycleState(1, 4, "A", None))
            write_state(root, next_activation(read_state(root), "B"))
            self.assertEqual(read_state(root), LifecycleState(1, 5, "B", "A"))

    def test_malformed_state_fails_closed_without_scanning_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "state.json").write_text("{")
            (root / "versions" / "guessed").mkdir(parents=True)
            with self.assertRaisesRegex(ModelLifecycleError, "model_state_invalid"):
                read_state(root)

    def test_missing_state_starts_at_generation_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(read_state(Path(directory)), LifecycleState())


class FakeResponse:
    def __init__(self, status, body, headers=None):
        self.status = status
        self.body = body
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size=-1):
        if not self.body:
            return b""
        if size < 0:
            result, self.body = self.body, b""
        else:
            result, self.body = self.body[:size], self.body[size:]
        return result


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, url, headers):
        self.requests.append((url, headers))
        return self.responses.pop(0)


class AcquisitionTest(unittest.TestCase):
    def artifact(self, *, size=6, transport_digest=None):
        return ModelArtifact(
            "embedding",
            "https://github.com/metagrover/pluto-models/releases/download/v/embedding.onnx",
            size,
            transport_digest or digest(b"abcdef"),
            digest(b"abcdef"),
            "raw",
            "embedding.onnx",
        )

    def test_resumes_only_from_matching_206_range(self):
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / "embedding.onnx.partial"
            partial.write_bytes(b"abc")
            metadata = partial.with_suffix(partial.suffix + ".json")
            metadata.write_text(json.dumps({
                "schemaVersion": 1, "artifactId": "embedding", "url": self.artifact().url,
                "size": 6, "sha256": digest(b"abcdef"), "validator": '"v1"'
            }))
            transport = FakeTransport([FakeResponse(206, b"def", {"Content-Range": "bytes 3-5/6", "ETag": '"v1"'})])
            download_artifact(self.artifact(), partial, transport)
            self.assertEqual(partial.read_bytes(), b"abcdef")
            self.assertEqual(transport.requests[0][1], {"Range": "bytes=3-", "If-Range": '"v1"'})

    def test_range_ignored_restarts_from_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / "embedding.onnx.partial"
            partial.write_bytes(b"abc")
            partial.with_suffix(partial.suffix + ".json").write_text(json.dumps({
                "schemaVersion": 1, "artifactId": "embedding", "url": self.artifact().url,
                "size": 6, "sha256": digest(b"abcdef"), "validator": None
            }))
            transport = FakeTransport([FakeResponse(200, b"abcdef")])
            download_artifact(self.artifact(), partial, transport)
            self.assertEqual(partial.read_bytes(), b"abcdef")

    def test_resumed_checksum_failure_retries_once_from_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / "embedding.onnx.partial"
            partial.write_bytes(b"abc")
            partial.with_suffix(partial.suffix + ".json").write_text(json.dumps({
                "schemaVersion": 1, "artifactId": "embedding", "url": self.artifact().url,
                "size": 6, "sha256": digest(b"abcdef"), "validator": None
            }))
            transport = FakeTransport([
                FakeResponse(206, b"xxx", {"Content-Range": "bytes 3-5/6"}),
                FakeResponse(200, b"abcdef"),
            ])
            download_artifact(self.artifact(), partial, transport)
            self.assertEqual(partial.read_bytes(), b"abcdef")
            self.assertEqual(transport.requests[1][1], {})

    def test_extracts_only_declared_archive_member(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "model"
            source.write_bytes(b"model")
            archive = root / "model.tar.bz2"
            member = "sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx"
            with tarfile.open(archive, "w:bz2") as bundle:
                bundle.add(source, arcname=member)
            artifact = ModelArtifact("segmentation", "https://github.com/metagrover/pluto-models/releases/download/v/model.tar.bz2", archive.stat().st_size, digest(archive.read_bytes()), digest(b"model"), "tar.bz2", "segmentation.int8.onnx", member)
            output = materialize_artifact(artifact, archive, root / "output")
            self.assertEqual(output.read_bytes(), b"model")

    def test_rejects_missing_archive_member_without_exposing_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "model"
            source.write_bytes(b"model")
            archive = root / "model.tar.bz2"
            with tarfile.open(archive, "w:bz2") as bundle:
                bundle.add(source, arcname="different")
            artifact = ModelArtifact("segmentation", "https://github.com/metagrover/pluto-models/releases/download/v/model.tar.bz2", archive.stat().st_size, digest(archive.read_bytes()), digest(b"model"), "tar.bz2", "segmentation.int8.onnx", "expected")
            with self.assertRaisesRegex(ModelLifecycleError, "model_acquisition_failed") as raised:
                materialize_artifact(artifact, archive, root / "output")
            self.assertNotIn(directory, str(raised.exception))


class ManagedLifecycleTest(unittest.TestCase):
    def make_manifest(self, root, version="B"):
        notice = root / "NOTICE-source.txt"
        notice.write_bytes(b"notice")
        segmentation_bytes = b"segmentation"
        archive_source = root / "archive-source"
        archive_source.write_bytes(segmentation_bytes)
        archive = root / "segmentation.tar.bz2"
        member = "sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx"
        with tarfile.open(archive, "w:bz2") as bundle:
            bundle.add(archive_source, arcname=member)
        embedding = b"embedding"
        artifacts = (
            ModelArtifact("segmentation", "https://github.com/metagrover/pluto-models/releases/download/v/segmentation.tar.bz2", archive.stat().st_size, digest(archive.read_bytes()), digest(segmentation_bytes), "tar.bz2", "segmentation.int8.onnx", member),
            ModelArtifact("embedding", "https://github.com/metagrover/pluto-models/releases/download/v/embedding.onnx", len(embedding), digest(embedding), digest(embedding), "raw", "embedding.onnx"),
        )
        manifest = ModelManifest(1, version, "sherpa-onnx", "1.13.4", ("MIT", "Apache-2.0"), notice, digest(b"notice"), artifacts)
        return manifest, archive.read_bytes(), embedding

    def install_version(self, root, version):
        version_dir = root / "versions" / version
        version_dir.mkdir(parents=True)
        (version_dir / "segmentation.int8.onnx").write_bytes(b"segmentation")
        (version_dir / "embedding.onnx").write_bytes(b"embedding")
        (version_dir / "NOTICE.txt").write_bytes(b"notice")
        (version_dir / "bundle.json").write_text(json.dumps({
            "schemaVersion": 1, "bundleVersion": version, "provider": "sherpa-onnx", "runtimeVersion": "1.13.4",
            "licenseIds": ["MIT", "Apache-2.0"], "noticeSha256": digest(b"notice"),
            "artifacts": [
                {"id": "segmentation", "destination": "segmentation.int8.onnx", "installedSha256": digest(b"segmentation")},
                {"id": "embedding", "destination": "embedding.onnx", "installedSha256": digest(b"embedding")},
            ]
        }))

    def test_failed_probe_leaves_current_active_version_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.install_version(root, "A")
            write_state(root, LifecycleState(1, 1, "A", None))
            manifest, archive, embedding = self.make_manifest(root)
            transport = FakeTransport([FakeResponse(200, archive), FakeResponse(200, embedding)])
            with self.assertRaisesRegex(ModelLifecycleError, "model_probe_failed"):
                prepare_managed_models(root, manifest=manifest, transport=transport, probe=lambda _paths: False)
            self.assertEqual(read_state(root).active_version, "A")

    def test_prepare_activates_verified_immutable_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, archive, embedding = self.make_manifest(root)
            result = prepare_managed_models(root, manifest=manifest, transport=FakeTransport([FakeResponse(200, archive), FakeResponse(200, embedding)]), probe=lambda _paths: True)
            self.assertEqual(result.bundle_version, "B")
            self.assertEqual(read_state(root), LifecycleState(1, 1, "B", None))
            self.assertEqual([path.read_bytes() for path in result.artifact_paths], [b"segmentation", b"embedding"])

    def test_rollback_swaps_active_and_previous_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.install_version(root, "A")
            self.install_version(root, "B")
            write_state(root, LifecycleState(1, 2, "B", "A"))
            result = rollback_managed_models(root, probe=lambda _paths: True)
            self.assertEqual((result.active_version, result.previous_healthy_version), ("A", "B"))
            self.assertEqual(read_state(root), LifecycleState(1, 3, "A", "B"))

    def test_rollback_failure_preserves_state_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.install_version(root, "B")
            write_state(root, LifecycleState(1, 2, "B", "missing"))
            before = (root / "state.json").read_bytes()
            with self.assertRaisesRegex(ModelLifecycleError, "rollback_unavailable"):
                rollback_managed_models(root, probe=lambda _paths: True)
            self.assertEqual((root / "state.json").read_bytes(), before)

    def test_adopts_valid_legacy_files_without_mutating_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, _archive, _embedding = self.make_manifest(root)
            legacy = root / "sherpa-onnx-1.13.4"
            legacy.mkdir()
            (legacy / "segmentation.int8.onnx").write_bytes(b"segmentation")
            (legacy / "embedding.onnx").write_bytes(b"embedding")
            result = prepare_managed_models(root, manifest=manifest, transport=FakeTransport([]), probe=lambda _paths: True)
            self.assertEqual([path.read_bytes() for path in result.artifact_paths], [b"segmentation", b"embedding"])
            self.assertEqual((legacy / "segmentation.int8.onnx").read_bytes(), b"segmentation")

    def test_concurrent_writer_fails_fast(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with lifecycle_lock(root):
                with self.assertRaisesRegex(ModelLifecycleError, "model_operation_busy"):
                    with lifecycle_lock(root):
                        self.fail("second writer acquired lock")

    def test_readiness_is_sanitized_and_names_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.install_version(root, "A")
            write_state(root, LifecycleState(1, 7, "A", None))
            readiness = model_readiness(root)
            self.assertTrue(readiness["ready"])
            self.assertEqual(readiness["generation"], 7)
            self.assertEqual(readiness["bundleVersion"], "A")
            self.assertNotIn(directory, str(readiness))

    def test_resolve_missing_state_never_downloads(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ModelLifecycleError, "model_missing"):
                resolve_active_artifacts(Path(directory))


if __name__ == "__main__":
    unittest.main()

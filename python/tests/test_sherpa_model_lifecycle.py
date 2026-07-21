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


if __name__ == "__main__":
    unittest.main()

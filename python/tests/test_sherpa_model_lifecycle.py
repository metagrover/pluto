import hashlib
import json
import tempfile
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


if __name__ == "__main__":
    unittest.main()

import hashlib
import sys
import tempfile
import tarfile
import types
import unittest
import wave
from pathlib import Path

from python.sherpa_diarization_runtime import (
    EMBEDDING_SHA256,
    SEGMENTATION_SHA256,
    SherpaDiarizationError,
    diarize,
    ensure_managed_audio_path,
    ensure_model_artifacts,
    resolve_model_artifacts,
    verify_artifact,
)


class SherpaDiarizationRuntimeTest(unittest.TestCase):
    def test_rejects_checksum_mismatch_without_exposing_path(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "private-model.onnx"
            model.write_bytes(b"wrong")

            with self.assertRaisesRegex(SherpaDiarizationError, "model_checksum_mismatch") as raised:
                verify_artifact(model, "0" * 64)

            self.assertNotIn(str(model), str(raised.exception))

    def test_returns_normalized_anonymous_intervals(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            segmentation = root / "segmentation.onnx"
            embedding = root / "embedding.onnx"
            audio = root / "meeting.wav"
            segmentation.write_bytes(b"segmentation")
            embedding.write_bytes(b"embedding")
            with wave.open(str(audio), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                output.writeframes(b"\x00\x00" * 160)

            fake = types.SimpleNamespace()
            fake.OfflineSpeakerSegmentationPyannoteModelConfig = lambda **kwargs: kwargs
            fake.OfflineSpeakerSegmentationModelConfig = lambda **kwargs: kwargs
            fake.SpeakerEmbeddingExtractorConfig = lambda **kwargs: kwargs
            fake.FastClusteringConfig = lambda **kwargs: kwargs
            fake.OfflineSpeakerDiarizationConfig = lambda **kwargs: kwargs

            class Segment:
                def __init__(self, start, end, speaker):
                    self.start = start
                    self.end = end
                    self.speaker = speaker

            class Result:
                def sort_by_start_time(self):
                    return [Segment(1.25, 2.5, 1), Segment(0, 1, 0)]

            class Runtime:
                def __init__(self, _config):
                    pass

                def process(self, _samples):
                    return Result()

            fake.OfflineSpeakerDiarization = Runtime
            original = sys.modules.get("sherpa_onnx")
            sys.modules["sherpa_onnx"] = fake
            try:
                result = diarize(
                    audio,
                    segmentation,
                    hashlib.sha256(b"segmentation").hexdigest(),
                    embedding,
                    hashlib.sha256(b"embedding").hexdigest(),
                )
            finally:
                if original is None:
                    del sys.modules["sherpa_onnx"]
                else:
                    sys.modules["sherpa_onnx"] = original

            self.assertEqual(
                result["segments"],
                [
                    {"start": 0.0, "end": 1.0, "speaker": "speaker_0"},
                    {"start": 1.25, "end": 2.5, "speaker": "speaker_1"},
                ],
            )
            self.assertEqual(result["provider"], "sherpa-onnx")
            self.assertEqual(result["version"], "1.13.4")

    def test_pinned_checksums_match_the_accepted_decision(self):
        self.assertEqual(SEGMENTATION_SHA256, "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d")
        self.assertEqual(EMBEDDING_SHA256, "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e")

    def test_resolves_only_the_fixed_model_layout(self):
        root = Path("/models")
        self.assertEqual(
            resolve_model_artifacts(root),
            (root / "segmentation.int8.onnx", root / "embedding.onnx"),
        )

    def test_rejects_audio_outside_pluto_meeting_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            meetings = Path(directory) / "meetings"
            meetings.mkdir()
            outside = Path(directory) / "outside.wav"
            outside.write_bytes(b"audio")
            with self.assertRaisesRegex(SherpaDiarizationError, "audio_path_not_managed"):
                ensure_managed_audio_path(outside, meetings)

    def test_installs_models_from_fixed_artifacts_and_verifies_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "segmentation.tar.bz2"
            source = root / "model.int8.onnx"
            source.write_bytes(b"segmentation")
            with tarfile.open(archive, "w:bz2") as bundle:
                bundle.add(source, arcname="sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx")
            embedding = root / "source-embedding.onnx"
            embedding.write_bytes(b"embedding")
            payloads = {"segmentation": archive, "embedding": embedding}

            def download(url, destination):
                destination.write_bytes(payloads[url].read_bytes())

            installed = ensure_model_artifacts(
                root / "installed",
                segmentation_url="segmentation",
                embedding_url="embedding",
                segmentation_sha256=hashlib.sha256(b"segmentation").hexdigest(),
                embedding_sha256=hashlib.sha256(b"embedding").hexdigest(),
                download=download,
            )

            self.assertEqual(installed[0].read_bytes(), b"segmentation")
            self.assertEqual(installed[1].read_bytes(), b"embedding")


if __name__ == "__main__":
    unittest.main()

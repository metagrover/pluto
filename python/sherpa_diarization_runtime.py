import array
import hashlib
import importlib
import shutil
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import wave
from pathlib import Path

SHERPA_ONNX_VERSION = "1.13.4"
SEGMENTATION_SHA256 = "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d"
EMBEDDING_SHA256 = "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e"
SEGMENTATION_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMBEDDING_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx"
SEGMENTATION_ARCHIVE_MEMBER = "sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx"


class SherpaDiarizationError(RuntimeError):
    pass


def resolve_model_artifacts(model_dir: Path) -> tuple[Path, Path]:
    return model_dir / "segmentation.int8.onnx", model_dir / "embedding.onnx"


def _download(url: str, destination: Path) -> None:
    with urllib.request.urlopen(url, timeout=120) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def ensure_model_artifacts(
    model_dir: Path,
    *,
    segmentation_url: str = SEGMENTATION_URL,
    embedding_url: str = EMBEDDING_URL,
    segmentation_sha256: str = SEGMENTATION_SHA256,
    embedding_sha256: str = EMBEDDING_SHA256,
    download=_download,
) -> tuple[Path, Path]:
    segmentation, embedding = resolve_model_artifacts(model_dir)
    try:
        return (
            verify_artifact(segmentation, segmentation_sha256),
            verify_artifact(embedding, embedding_sha256),
        )
    except SherpaDiarizationError:
        pass

    model_dir.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(dir=model_dir.parent) as temporary:
            staging = Path(temporary)
            archive = staging / "segmentation.tar.bz2"
            staged_segmentation = staging / "segmentation.int8.onnx"
            staged_embedding = staging / "embedding.onnx"
            download(segmentation_url, archive)
            download(embedding_url, staged_embedding)
            with tarfile.open(archive, "r:bz2") as bundle:
                member = bundle.getmember(SEGMENTATION_ARCHIVE_MEMBER)
                source = bundle.extractfile(member)
                if source is None or not member.isfile():
                    raise SherpaDiarizationError("model_acquisition_failed")
                with source, staged_segmentation.open("wb") as output:
                    shutil.copyfileobj(source, output)
            verify_artifact(staged_segmentation, segmentation_sha256)
            verify_artifact(staged_embedding, embedding_sha256)
            model_dir.mkdir(parents=True, exist_ok=True)
            staged_segmentation.replace(segmentation)
            staged_embedding.replace(embedding)
    except (OSError, KeyError, tarfile.TarError, urllib.error.URLError) as error:
        raise SherpaDiarizationError("model_acquisition_failed") from error
    return verify_artifact(segmentation, segmentation_sha256), verify_artifact(embedding, embedding_sha256)


def require_model_artifacts(model_dir: Path) -> tuple[Path, Path]:
    segmentation, embedding = resolve_model_artifacts(model_dir)
    return (
        verify_artifact(segmentation, SEGMENTATION_SHA256),
        verify_artifact(embedding, EMBEDDING_SHA256),
    )


def model_readiness(model_dir: Path) -> dict:
    try:
        require_model_artifacts(model_dir)
    except SherpaDiarizationError as error:
        return {"ready": False, "reason": str(error)}
    return {
        "ready": True,
        "provider": "sherpa-onnx",
        "version": SHERPA_ONNX_VERSION,
        "modelChecksums": [SEGMENTATION_SHA256, EMBEDDING_SHA256],
    }


def ensure_managed_audio_path(audio_path: Path, meetings_dir: Path) -> Path:
    resolved_audio = audio_path.resolve()
    resolved_meetings = meetings_dir.resolve()
    if not resolved_audio.is_relative_to(resolved_meetings):
        raise SherpaDiarizationError("audio_path_not_managed")
    return resolved_audio


def verify_artifact(path: Path, expected_sha256: str) -> Path:
    if not path.is_file():
        raise SherpaDiarizationError("model_missing")
    digest = hashlib.sha256()
    with path.open("rb") as artifact:
        for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest().lower() != expected_sha256.lower():
        raise SherpaDiarizationError("model_checksum_mismatch")
    return path.resolve()


def diarize(
    audio_path: Path,
    segmentation_path: Path,
    segmentation_sha256: str = SEGMENTATION_SHA256,
    embedding_path: Path | None = None,
    embedding_sha256: str = EMBEDDING_SHA256,
    *,
    num_threads: int = 2,
    num_speakers: int = -1,
    cluster_threshold: float = 0.5,
) -> dict:
    if embedding_path is None:
        raise SherpaDiarizationError("model_missing")
    segmentation = verify_artifact(Path(segmentation_path), segmentation_sha256)
    embedding = verify_artifact(Path(embedding_path), embedding_sha256)
    if not Path(audio_path).is_file():
        raise SherpaDiarizationError("audio_missing")

    try:
        with wave.open(str(audio_path), "rb") as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
                raise SherpaDiarizationError("audio_format_unsupported")
            samples = array.array("h", audio.readframes(audio.getnframes()))
    except (wave.Error, EOFError) as error:
        raise SherpaDiarizationError("audio_format_unsupported") from error
    if sys.byteorder != "little":
        samples.byteswap()

    sherpa = importlib.import_module("sherpa_onnx")
    runtime = sherpa.OfflineSpeakerDiarization(
        sherpa.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(segmentation)),
                num_threads=num_threads,
            ),
            embedding=sherpa.SpeakerEmbeddingExtractorConfig(model=str(embedding), num_threads=num_threads),
            clustering=sherpa.FastClusteringConfig(num_clusters=num_speakers, threshold=cluster_threshold),
        )
    )
    result = runtime.process([sample / 32768.0 for sample in samples])
    segments = [
        {"start": float(item.start), "end": float(item.end), "speaker": f"speaker_{item.speaker}"}
        for item in result.sort_by_start_time()
        if float(item.end) > float(item.start)
    ]
    segments.sort(key=lambda item: (item["start"], item["end"], item["speaker"]))
    return {
        "segments": segments,
        "provider": "sherpa-onnx",
        "version": SHERPA_ONNX_VERSION,
        "modelProvenance": {
            "segmentationSha256": segmentation_sha256.lower(),
            "embeddingSha256": embedding_sha256.lower(),
        },
    }

#!/usr/bin/env python3
"""Private, local-only JSONL adapter for attribution candidate benchmarks.

Stdout is reserved for protocol messages. Optional ML dependencies are loaded
only by their candidate handlers so the deterministic synthetic candidate can
run in CI without a benchmark environment.
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib
import importlib.metadata
import json
import platform
import resource
import sys
import time
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
PIPELINE_VERSION = "speaker-attribution-adapter-v1"
KNOWN_CANDIDATES = {
    "synthetic",
    "current-whisperx",
    "apple-silicon-asr",
    "pyannote-community-1",
    "nemo-local",
}


class CandidateError(Exception):
    def __init__(self, code: str, public_message: str) -> None:
        super().__init__(public_message)
        self.code = code
        self.public_message = public_message


def _package_version(distribution: str) -> str:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        raise CandidateError(
            "candidate_model_missing", "The optional candidate runtime is not installed."
        ) from None


def _peak_memory_mb() -> float:
    peak = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    # macOS reports bytes; Linux reports KiB.
    return peak / (1024 * 1024) if sys.platform == "darwin" else peak / 1024


def _hardware() -> str:
    return f"{platform.system()}-{platform.machine()}"


def _object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CandidateError(
            "candidate_contract_mismatch", f"{field} must be an object."
        )
    return value


def _nonempty_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise CandidateError(
            "candidate_contract_mismatch", f"{field} must be a non-empty string."
        )
    return value


def _validate_request(raw: Any) -> dict[str, Any]:
    request = _object(raw, "request")
    if request.get("schemaVersion") != SCHEMA_VERSION:
        raise CandidateError(
            "candidate_contract_mismatch", "Unsupported request schema version."
        )
    _nonempty_string(request.get("id") or request.get("requestId"), "request id")
    action = _nonempty_string(request.get("action", "probe"), "action")
    if action not in {"probe", "transcribe", "diarize"}:
        raise CandidateError("candidate_contract_mismatch", "Unsupported action.")
    candidate = _object(request.get("candidate"), "candidate")
    candidate_id = _nonempty_string(candidate.get("id"), "candidate.id")
    if candidate_id not in KNOWN_CANDIDATES:
        raise CandidateError("candidate_unknown", "Unknown local candidate.")
    if not isinstance(candidate.get("config", {}), dict):
        raise CandidateError(
            "candidate_contract_mismatch", "candidate.config must be an object."
        )
    if action != "probe":
        case = _object(request.get("case"), "case")
        _nonempty_string(case.get("id"), "case.id")
    return request


def _model_path(config: dict[str, Any]) -> str | None:
    raw = config.get("modelPath")
    if raw is None:
        return None
    path = Path(_nonempty_string(raw, "candidate.config.modelPath"))
    if not path.exists():
        raise CandidateError("candidate_model_missing", "The local model is unavailable.")
    if not path.is_file() and not path.is_dir():
        raise CandidateError("candidate_model_missing", "The local model is unavailable.")
    resolved = str(path.resolve())
    expected_checksum = config.get("sha256")
    if expected_checksum is not None:
        if (
            not isinstance(expected_checksum, str)
            or len(expected_checksum) != 64
            or any(character not in "0123456789abcdefABCDEF" for character in expected_checksum)
        ):
            raise CandidateError(
                "candidate_contract_mismatch", "The model checksum configuration is invalid."
            )
        if not path.is_file():
            raise CandidateError(
                "candidate_model_checksum_failed", "Local model verification failed."
            )
        digest = hashlib.sha256()
        with path.open("rb") as model_file:
            for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest().lower() != expected_checksum.lower():
            raise CandidateError(
                "candidate_model_checksum_failed", "Local model verification failed."
            )
    return resolved


def _identity(candidate_id: str, version: str) -> dict[str, str]:
    return {"id": candidate_id, "version": version}


def _probe(candidate_id: str, config: dict[str, Any]) -> tuple[list[dict[str, str]], str]:
    if candidate_id == "synthetic":
        return [_identity("synthetic", "1")], _hardware()
    if candidate_id == "current-whisperx":
        return [_identity("whisperx", _package_version("whisperx"))], _hardware()
    if candidate_id == "apple-silicon-asr":
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            raise CandidateError(
                "candidate_unsupported_hardware",
                "The Apple-Silicon candidate requires arm64 macOS.",
            )
        return [_identity("mlx-whisper", _package_version("mlx-whisper"))], _hardware()
    if candidate_id == "pyannote-community-1":
        if not _model_path(config):
            raise CandidateError("candidate_model_missing", "An explicit local model is required.")
        return [
            _identity("pyannote/speaker-diarization-community-1", _package_version("pyannote.audio"))
        ], _hardware()
    if candidate_id == "nemo-local":
        if not _model_path(config):
            raise CandidateError("candidate_model_missing", "An explicit local model is required.")
        return [_identity("nvidia-nemo-diarizer", _package_version("nemo_toolkit"))], _hardware()
    raise CandidateError("candidate_unknown", "Unknown local candidate.")


def _safe_audio_path(request: dict[str, Any]) -> str:
    case = _object(request.get("case"), "case")
    audio = _object(case.get("audio"), "case.audio")
    path = Path(_nonempty_string(audio.get("mixedPath"), "case.audio.mixedPath"))
    if not path.is_file():
        raise CandidateError("candidate_model_missing", "The local audio input is unavailable.")
    return str(path.resolve())


def _normalize_transcript(result: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    words: list[dict[str, Any]] = []
    segments: list[dict[str, Any]] = []
    for segment in result.get("segments", []):
        start = float(segment.get("start", 0))
        end = float(segment.get("end", start))
        text = str(segment.get("text", ""))
        if end > start:
            segments.append({"startTime": start, "endTime": end, "text": text})
        for word in segment.get("words", []):
            word_start = float(word.get("start", start))
            word_end = float(word.get("end", word_start))
            if word_end <= word_start:
                continue
            normalized = {
                "startTime": word_start,
                "endTime": word_end,
                "text": str(word.get("word", "")),
            }
            score = word.get("score")
            if isinstance(score, (int, float)) and 0 <= score <= 1:
                normalized["confidence"] = float(score)
            words.append(normalized)
    return words, segments


def _transcribe(candidate_id: str, request: dict[str, Any], config: dict[str, Any]) -> tuple[Any, Any, list[Any], str]:
    audio_path = _safe_audio_path(request)
    model_name = str(config.get("model", "small"))
    if candidate_id == "current-whisperx":
        version = _package_version("whisperx")
        whisperx = importlib.import_module("whisperx")
        device = str(config.get("device", "cpu"))
        compute_type = str(config.get("computeType", "int8"))
        model = whisperx.load_model(model_name, device, compute_type=compute_type)
        result = model.transcribe(audio_path, language=config.get("language", "en"))
        words, segments = _normalize_transcript(result)
        return words, segments, [_identity(f"whisperx:{model_name}", version)], device
    if candidate_id == "apple-silicon-asr":
        models, hardware = _probe(candidate_id, config)
        mlx_whisper = importlib.import_module("mlx_whisper")
        result = mlx_whisper.transcribe(audio_path, path_or_hf_repo=model_name)
        words, segments = _normalize_transcript(result)
        return words, segments, models, hardware
    raise CandidateError("candidate_contract_mismatch", "Candidate does not support transcription.")


def _synthetic_output(request: dict[str, Any], config: dict[str, Any]) -> tuple[Any, Any, Any, Any]:
    raw_turns = config.get("turns", [])
    if not isinstance(raw_turns, list):
        raise CandidateError("candidate_contract_mismatch", "Synthetic turns must be an array.")
    turns = []
    for raw in raw_turns:
        turn = _object(raw, "synthetic turn")
        try:
            start = float(turn["startTime"])
            end = float(turn["endTime"])
        except (KeyError, TypeError, ValueError):
            raise CandidateError("candidate_contract_mismatch", "Synthetic turn timestamps are invalid.") from None
        cluster = _nonempty_string(turn.get("cluster"), "synthetic turn cluster")
        if start < 0 or end <= start:
            raise CandidateError("candidate_contract_mismatch", "Synthetic turn timestamps are invalid.")
        normalized = {"startTime": start, "endTime": end, "cluster": cluster}
        if isinstance(turn.get("overlap"), bool):
            normalized["overlap"] = turn["overlap"]
        if isinstance(turn.get("confidence"), (int, float)) and 0 <= turn["confidence"] <= 1:
            normalized["confidence"] = float(turn["confidence"])
        turns.append(normalized)
    turns.sort(key=lambda item: (item["startTime"], item["endTime"]))
    return [], [], turns, [_identity("synthetic", "1")]


def _diarize(candidate_id: str, request: dict[str, Any], config: dict[str, Any]) -> tuple[list[Any], list[Any], list[Any], str]:
    audio_path = _safe_audio_path(request)
    model_path = _model_path(config)
    if not model_path:
        raise CandidateError("candidate_model_missing", "An explicit local model is required.")
    if candidate_id == "pyannote-community-1":
        models, hardware = _probe(candidate_id, config)
        pyannote = importlib.import_module("pyannote.audio")
        pipeline = pyannote.Pipeline.from_pretrained(model_path)
        result = pipeline(audio_path)
        annotation = getattr(result, "speaker_diarization", result)
        turns = [
            {"startTime": float(turn.start), "endTime": float(turn.end), "cluster": str(speaker)}
            for turn, _, speaker in annotation.itertracks(yield_label=True)
            if turn.end > turn.start
        ]
        return [], [], turns, hardware
    if candidate_id == "nemo-local":
        # NeMo is intentionally installed in the candidate command's isolated
        # environment. Its manifest/config path is consumed by ClusteringDiarizer.
        models, hardware = _probe(candidate_id, config)
        nemo_models = importlib.import_module("nemo.collections.asr.models")
        diarizer = nemo_models.ClusteringDiarizer(cfg=model_path)
        diarizer.diarize()
        output_path = config.get("rttmPath")
        if not isinstance(output_path, str) or not Path(output_path).is_file():
            raise CandidateError("candidate_contract_mismatch", "NeMo did not produce a local RTTM result.")
        turns = []
        for line in Path(output_path).read_text(encoding="utf-8").splitlines():
            parts = line.split()
            if len(parts) < 8 or parts[0] != "SPEAKER":
                continue
            start, duration = float(parts[3]), float(parts[4])
            if duration > 0:
                turns.append({"startTime": start, "endTime": start + duration, "cluster": parts[7]})
        return [], [], turns, hardware
    raise CandidateError("candidate_contract_mismatch", "Candidate does not support diarization.")


def _classify_exception(error: BaseException) -> CandidateError:
    if isinstance(error, CandidateError):
        return error
    if isinstance(error, (ImportError, ModuleNotFoundError, FileNotFoundError)):
        return CandidateError("candidate_model_missing", "The optional candidate runtime or model is unavailable.")
    message = str(error).lower()
    if "checksum" in message or "hash mismatch" in message:
        return CandidateError("candidate_model_checksum_failed", "Local model verification failed.")
    if isinstance(error, MemoryError) or "out of memory" in message or "oom" in message:
        return CandidateError("candidate_out_of_memory", "The candidate exhausted available memory.")
    if "cuda" in message and ("unavailable" in message or "not found" in message):
        return CandidateError("candidate_unsupported_hardware", "Required local hardware is unavailable.")
    return CandidateError("candidate_contract_mismatch", "The candidate request could not be completed.")


def _handle(raw: Any) -> dict[str, Any]:
    request = _validate_request(raw)
    request_id = str(request.get("id") or request.get("requestId"))
    candidate = request["candidate"]
    candidate_id = candidate["id"]
    config = candidate.get("config", {})
    action = request.get("action", "probe")
    started = time.perf_counter()
    if action == "probe":
        models, hardware = _probe(candidate_id, config)
        return {
            "id": request_id,
            "requestId": request_id,
            "schemaVersion": SCHEMA_VERSION,
            "output": {
                "available": True,
                "candidateId": candidate_id,
                "runtime": {
                    "pipelineVersion": PIPELINE_VERSION,
                    "models": models,
                    "hardware": hardware,
                    "elapsedMs": (time.perf_counter() - started) * 1000,
                    "peakResidentMemoryMb": _peak_memory_mb(),
                },
            },
        }
    case_id = request["case"]["id"]
    if candidate_id == "synthetic":
        words, segments, turns, models = _synthetic_output(request, config)
        hardware = _hardware()
    elif action == "transcribe":
        words, segments, models, hardware = _transcribe(candidate_id, request, config)
        turns = []
    else:
        words, segments, turns, hardware = _diarize(candidate_id, request, config)
        models, _ = _probe(candidate_id, config)
    return {
        "id": request_id,
        "requestId": request_id,
        "schemaVersion": SCHEMA_VERSION,
        "output": {
            "schemaVersion": SCHEMA_VERSION,
            "caseId": case_id,
            "candidateId": candidate_id,
            "transcript": {"words": words, "segments": segments},
            "diarization": {"turns": turns},
            "runtime": {
                "pipelineVersion": PIPELINE_VERSION,
                "models": models,
                "elapsedMs": (time.perf_counter() - started) * 1000,
                "hardware": hardware,
                "peakResidentMemoryMb": _peak_memory_mb(),
            },
        },
    }


def _request_id(raw: Any) -> str:
    if isinstance(raw, dict):
        value = raw.get("id") or raw.get("requestId")
        if isinstance(value, str):
            return value
    return "invalid-request"


def main() -> int:
    for line in sys.stdin:
        if not line.strip():
            continue
        raw: Any = None
        try:
            raw = json.loads(line)
            # Some ML libraries print progress to stdout. Redirect it to the
            # local diagnostic stream to preserve the machine protocol.
            with contextlib.redirect_stdout(sys.stderr):
                response = _handle(raw)
        except Exception as error:  # request isolation is intentional
            failure = _classify_exception(error)
            response = {
                "id": _request_id(raw),
                "requestId": _request_id(raw),
                "schemaVersion": SCHEMA_VERSION,
                "error": {"code": failure.code, "message": failure.public_message},
            }
        sys.stdout.write(json.dumps(response, separators=(",", ":"), allow_nan=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

import os
import io
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Literal, Optional
from pathlib import Path
import json
import logging
import threading
from sherpa_diarization_runtime import (
    SherpaDiarizationError,
    diarize as run_sherpa_diarization,
    ensure_managed_audio_path,
    ensure_model_artifacts,
    model_readiness,
    require_model_artifacts,
    rollback_model_artifacts,
)
from aligned_audio_energy import aligned_energy_windows

try:
    import mlx_whisper
    MLX_WHISPER_AVAILABLE = True
except ImportError:
    MLX_WHISPER_AVAILABLE = False

MLX_MODEL_MAP = {
    "tiny": "mlx-community/whisper-tiny",
    "base": "mlx-community/whisper-base-mlx",
    "small": "mlx-community/whisper-small-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "large-v2": "mlx-community/whisper-large-v2-mlx",
    "large-v3": "mlx-community/whisper-large-v3-turbo",
}

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("transcription_server")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting local transcription server [engine=mlx, available=%s]", MLX_WHISPER_AVAILABLE)
    try:
        load_model_if_needed({})
    except Exception as e:
        logger.error(f"Failed to pre-load model: {e}")
    yield

app = FastAPI(title="Pluto Transcription Server", lifespan=lifespan)

# Global state
model_lock = threading.RLock()

model_config = {
    "device": "mlx",
    "compute_type": "float16",
    "model_name": "medium",
    "language": "en"
}

class TranscribeRequest(BaseModel):
    audio_path: str
    model: Optional[str] = None
    device: Optional[Literal["mlx"]] = None
    compute_type: Optional[Literal["float16"]] = None
    language: Optional[str] = None
    diarize: Optional[bool] = False

class ConfigRequest(BaseModel):
    model: Optional[str] = None
    device: Optional[Literal["mlx"]] = None
    compute_type: Optional[Literal["float16"]] = None
    language: Optional[str] = None

class DiarizeRequest(BaseModel):
    audio_path: str

class AlignedEnergyRequest(BaseModel):
    mic_audio_path: str
    system_audio_path: str

def load_model_if_needed(new_config):
    with model_lock:
        target_model = new_config.get("model", model_config["model_name"])
        if not MLX_WHISPER_AVAILABLE:
            raise HTTPException(status_code=503, detail="MLX Whisper is unavailable")
        if target_model != model_config["model_name"]:
            logger.info("Updating transcription model: model=%s", target_model)
        model_config["model_name"] = target_model

@app.get("/health")
def health():
    return {
        "status": "ok",
        "engine": (
            "mlx_whisper" if MLX_WHISPER_AVAILABLE else "unavailable"
        ),
        "mlx_available": MLX_WHISPER_AVAILABLE,
        "device": model_config["device"],
        "model": model_config["model_name"],
        "compute_type": model_config["compute_type"],
        "model_loaded": MLX_WHISPER_AVAILABLE,
        "supported_devices": ["mlx"],
        "supported_compute_types": ["float16"],
    }

@app.get("/models")
def list_models():
    return {
        "models": [
            {"id": "tiny", "size": "39M", "speed": "Fastest", "quality": "Low"},
            {"id": "base", "size": "74M", "speed": "Fast", "quality": "Decent"},
            {"id": "small", "size": "244M", "speed": "Balanced", "quality": "Good"},
            {"id": "medium", "size": "769M", "speed": "Slow", "quality": "Better"},
            {"id": "large-v2", "size": "1550M", "speed": "Slowest", "quality": "Best"},
            {"id": "large-v3", "size": "1550M", "speed": "Slowest", "quality": "Best"},
        ]
    }

@app.post("/config")
def update_config(request: ConfigRequest):
    new_conf = {}
    if request.model: new_conf["model"] = request.model
    if request.device: new_conf["device"] = request.device
    if request.compute_type: new_conf["compute_type"] = request.compute_type
    
    if request.language: model_config["language"] = request.language
    
    load_model_if_needed(new_conf)
    
    return {"status": "updated", "config": model_config}

@app.post("/diarize")
def diarize(request: DiarizeRequest):
    model_dir = Path(os.environ.get("PLUTO_SPEAKER_MODELS_DIR", ""))
    meetings_dir = Path(os.environ.get("PLUTO_MEETINGS_DIR", ""))
    if not str(model_dir) or str(model_dir) == ".":
        raise HTTPException(status_code=503, detail="speaker_models_unavailable")
    if not str(meetings_dir) or str(meetings_dir) == ".":
        raise HTTPException(status_code=503, detail="meeting_storage_unavailable")
    try:
        audio_path = ensure_managed_audio_path(Path(request.audio_path), meetings_dir)
        segmentation_path, embedding_path = require_model_artifacts(model_dir)
        return run_sherpa_diarization(
            audio_path,
            segmentation_path,
            embedding_path=embedding_path,
        )
    except SherpaDiarizationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

@app.get("/diarization/models/status")
def diarization_model_status():
    model_dir = Path(os.environ.get("PLUTO_SPEAKER_MODELS_DIR", ""))
    if not str(model_dir) or str(model_dir) == ".":
        return {"ready": False, "reason": "speaker_models_unavailable"}
    return model_readiness(model_dir)

@app.post("/diarization/models/prepare")
def prepare_diarization_models():
    model_dir = Path(os.environ.get("PLUTO_SPEAKER_MODELS_DIR", ""))
    if not str(model_dir) or str(model_dir) == ".":
        raise HTTPException(status_code=503, detail="speaker_models_unavailable")
    try:
        ensure_model_artifacts(model_dir)
        return model_readiness(model_dir)
    except SherpaDiarizationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

@app.post("/diarization/models/rollback")
def rollback_diarization_models():
    model_dir = Path(os.environ.get("PLUTO_SPEAKER_MODELS_DIR", ""))
    if not str(model_dir) or str(model_dir) == ".":
        raise HTTPException(status_code=503, detail="speaker_models_unavailable")
    try:
        return rollback_model_artifacts(model_dir)
    except SherpaDiarizationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

@app.post("/attribution/aligned-energy")
def attribution_aligned_energy(request: AlignedEnergyRequest):
    meetings_dir = Path(os.environ.get("PLUTO_MEETINGS_DIR", ""))
    if not str(meetings_dir) or str(meetings_dir) == ".":
        raise HTTPException(status_code=503, detail="meeting_storage_unavailable")
    try:
        mic_path = ensure_managed_audio_path(Path(request.mic_audio_path), meetings_dir)
        system_path = ensure_managed_audio_path(Path(request.system_audio_path), meetings_dir)
        return {"schemaVersion": 1, "windows": aligned_energy_windows(mic_path, system_path)}
    except (SherpaDiarizationError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

@app.post("/transcribe")
def transcribe(request: TranscribeRequest):
    with model_lock:
        return _transcribe_locked(request)

def _transcribe_locked(request: TranscribeRequest):
    request_conf = {}
    if request.model:
        request_conf["model"] = request.model
    if request.device:
        request_conf["device"] = request.device
    if request.compute_type:
        request_conf["compute_type"] = request.compute_type

    load_model_if_needed(request_conf)
    
    if not os.path.exists(request.audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
        
    try:
        if MLX_WHISPER_AVAILABLE:
            model_name = request_conf.get("model", model_config["model_name"])
            repo_id = MLX_MODEL_MAP.get(model_name, f"mlx-community/whisper-{model_name}")
            language = request.language or "en"
            logger.info("Transcribing managed audio using MLX [model=%s, language=%s]", model_name, language)
            
            mlx_kwargs = {"path_or_hf_repo": repo_id, "word_timestamps": True}
            if language and language != "auto":
                mlx_kwargs["language"] = language
                
            mlx_result = mlx_whisper.transcribe(request.audio_path, **mlx_kwargs)
            raw_segments = mlx_result.get("segments", [])
            formatted_segments = []
            for seg in raw_segments:
                formatted_words = []
                for w in seg.get("words", []):
                    formatted_words.append({
                        "word": w.get("word", ""),
                        "start": float(w.get("start", 0.0)),
                        "end": float(w.get("end", 0.0)),
                        "score": float(w.get("probability", 1.0)),
                    })
                formatted_segments.append({
                    "start": float(seg.get("start", 0.0)),
                    "end": float(seg.get("end", 0.0)),
                    "text": seg.get("text", "").strip(),
                    "words": formatted_words,
                })
                
            detected_language = mlx_result.get("language", language or "en")
            
            result = {
                "segments": formatted_segments,
                "language": detected_language,
                "duration": float(mlx_result.get("duration", 0.0)),
                "vad": {
                    "status": "speech" if formatted_segments else "no_speech",
                    "speechSeconds": sum(
                        max(0.0, float(s["end"]) - float(s["start"]))
                        for s in formatted_segments
                    ),
                },
                "active_config": {
                    "model": model_name,
                    "device": "mlx",
                    "compute_type": "float16",
                },
            }

            if request.diarize:
                raise HTTPException(status_code=422, detail="Use the local diarization endpoint")

            logger.info("Transcription complete [engine=mlx]")
            return result
        raise HTTPException(status_code=503, detail="MLX Whisper is unavailable")
        
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.environ.get("WHISPERX_PORT", 5123))
    uvicorn.run(app, host="127.0.0.1", port=port)

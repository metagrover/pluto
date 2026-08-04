
import os
import io
import torch
import whisperx
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List
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

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("whisperx_server")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting WhisperX Server on {model_config['device']} ({model_config['compute_type']})")
    try:
        load_model_if_needed({})
    except Exception as e:
        logger.error(f"Failed to pre-load model: {e}")
    yield

app = FastAPI(title="Pluto WhisperX Server", lifespan=lifespan)

# Global state
model = None
diarize_model = None
model_lock = threading.Lock()
# Force CPU for PyTorch 2.0.1 compatibility (MPS not fully supported by WhisperX with this version)
model_config = {
    "device": "cpu",
    "compute_type": "int8",  # Use int8 for faster CPU inference
    "model_name": "small",
    "language": "en"
}

class TranscribeRequest(BaseModel):
    audio_path: str
    # Deprecated runtime override. We keep it for backward compatibility
    # but model changes should happen via /config.
    model: Optional[str] = None
    device: Optional[str] = None
    compute_type: Optional[str] = None
    language: Optional[str] = None
    diarize: Optional[bool] = False
    hf_token: Optional[str] = None

class ConfigRequest(BaseModel):
    model: Optional[str] = None
    device: Optional[str] = None
    compute_type: Optional[str] = None
    language: Optional[str] = None

class DiarizeRequest(BaseModel):
    audio_path: str

class AlignedEnergyRequest(BaseModel):
    mic_audio_path: str
    system_audio_path: str

def load_model_if_needed(new_config):
    global model, model_config
    
    with model_lock:
        needs_reload = False
        if model is None:
            needs_reload = True
        if "model" in new_config and new_config.get("model") != model_config["model_name"]:
            needs_reload = True
        if "device" in new_config and new_config.get("device") != model_config["device"]:
            needs_reload = True
        if "compute_type" in new_config and new_config.get("compute_type") != model_config["compute_type"]:
            needs_reload = True
            
        if needs_reload:
            logger.info(f"Loading model {new_config.get('model', model_config['model_name'])}...")
            
            # Update config
            if "model" in new_config: model_config["model_name"] = new_config["model"]
            if "device" in new_config: model_config["device"] = new_config["device"]
            if "compute_type" in new_config: model_config["compute_type"] = new_config["compute_type"]
            
            try:
                model = whisperx.load_model(
                    model_config["model_name"], 
                    model_config["device"], 
                    compute_type=model_config["compute_type"]
                )
                logger.info("Model loaded successfully")
            except Exception as e:
                logger.error(f"Failed to load model: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")

@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": model_config["device"],
        "model": model_config["model_name"],
        "compute_type": model_config["compute_type"],
        "model_loaded": model is not None,
        "supported_devices": ["cpu", "cuda"],
        "supported_compute_types": ["int8", "float32"],
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
    
    # Language is just stored for preference, not requiring reload usually unless model is language specific
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
    global model, diarize_model

    request_conf = {}
    if request.model:
        request_conf["model"] = request.model
    if request.device:
        request_conf["device"] = request.device
    if request.compute_type:
        request_conf["compute_type"] = request.compute_type

    # Ensure model is loaded
    load_model_if_needed(request_conf)
    
    if not os.path.exists(request.audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
        
    try:
        logger.info(f"Transcribing {request.audio_path}...")
        
        # 1. Transcribe
        try:
            language = request.language or "en"
            logger.info(f"Transcribing {request.audio_path} (language={language})...")
            result = model.transcribe(
                request.audio_path,
                batch_size=16,
                language=language
            )
        except IndexError as e:
            logger.warning(f"No active speech detected or VAD error: {e}")
            return {
                "segments": [],
                "language": "en",
                "duration": 0,
                "vad": {"status": "failed", "speechSeconds": 0}
            }
        
        detected_language = result["language"]
        
        if not result["segments"]:
            logger.info("No segments detected, skipping alignment")
            return {
                "segments": [],
                "language": detected_language,
                "duration": 0,
                "vad": {"status": "no_speech", "speechSeconds": 0}
            }
        
        # 2. Align for word-level timestamps
        try:
            align_model, align_metadata = whisperx.load_align_model(
                language_code=detected_language,
                device=model_config["device"],
            )
            result = whisperx.align(
                result["segments"],
                align_model,
                align_metadata,
                request.audio_path,
                model_config["device"],
                return_char_alignments=False,
            )
            logger.info("Word-level alignment complete")
        except Exception as e:
            logger.warning("Alignment skipped (unsupported language or error): %s", e)
        
        # 3. Diarize (optional, power-user)
        # Pyannote diarization is gated on HuggingFace; most users won't set hf_token.
        # Never fail the whole transcribe: fall back to non-diarized segments.
        if request.diarize:
            try:
                if diarize_model is None:
                    logger.info("Loading diarization model...")
                    diarize_model = whisperx.DiarizationPipeline(
                        use_auth_token=request.hf_token,
                        device=model_config["device"],
                    )
                diarize_segments = diarize_model(request.audio_path)
                result = whisperx.assign_word_speakers(diarize_segments, result)
            except Exception as e:
                logger.warning(
                    "Diarization skipped (no usable model/token or runtime error): %s",
                    e,
                )
                diarize_model = None
            
        logger.info("Transcription complete")
        return {
            "segments": result["segments"],
            "language": detected_language,
            "duration": 0, # TODO: Calculate duration
            "vad": {
                "status": "speech",
                "speechSeconds": sum(
                    max(0, float(segment.get("end", 0)) - float(segment.get("start", 0)))
                    for segment in result["segments"]
                ),
            },
            "active_config": {
                "model": model_config["model_name"],
                "device": model_config["device"],
                "compute_type": model_config["compute_type"],
            },
        }
        
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.environ.get("WHISPERX_PORT", 5123))
    uvicorn.run(app, host="127.0.0.1", port=port)

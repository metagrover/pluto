"""
WhisperX Server for Pluto
A Flask HTTP server that wraps WhisperX for transcription with speaker diarization.
"""

import os
import json
import logging
import torch
from flask import Flask, request, jsonify

# Fix for PyTorch 2.6+ weights_only=True security change
# Many models used by WhisperX/Pyannote are not yet compatible with weights_only=True
orig_load = torch.load
def patched_load(*args, **kwargs):
    if 'weights_only' in kwargs:
        kwargs['weights_only'] = False
    return orig_load(*args, **kwargs)
torch.load = patched_load

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Global state
whisperx_model = None
current_config = {
    "model": "base",
    "device": "cpu",
    "compute_type": "int8",
    "language": "en"
}


def get_device():
    """Determine the best available device."""
    import torch
    if torch.cuda.is_available():
        return "cuda"
    # MPS (Apple Silicon) is experimental, default to CPU for stability
    # Uncomment below to try MPS:
    # if torch.backends.mps.is_available():
    #     return "mps"
    return "cpu"


def load_model(model_name: str = "base", device: str = None, compute_type: str = "int8"):
    """Load or reload the WhisperX model."""
    global whisperx_model, current_config
    
    import whisperx
    
    if device is None:
        device = get_device()
    
    logger.info(f"Loading WhisperX model: {model_name} on {device}")
    whisperx_model = whisperx.load_model(model_name, device, compute_type=compute_type)
    
    current_config["model"] = model_name
    current_config["device"] = device
    current_config["compute_type"] = compute_type
    
    logger.info(f"Model loaded successfully")
    return whisperx_model


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    try:
        import whisperx
        version = getattr(whisperx, '__version__', 'unknown')
    except ImportError:
        version = 'not installed'
    
    return jsonify({
        "status": "ok",
        "whisperx_version": version,
        "device": current_config["device"],
        "model": current_config["model"],
        "model_loaded": whisperx_model is not None
    })


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """
    Transcribe an audio file.
    
    Request body:
    {
        "audio_path": "/path/to/audio.wav",
        "model": "base",  // optional, defaults to current config
        "language": "en",  // optional
        "diarize": true,  // optional, requires hf_token
        "hf_token": "hf_xxx..."  // required if diarize=true
    }
    """
    global whisperx_model
    
    try:
        import whisperx
        
        data = request.get_json()
        
        if not data or 'audio_path' not in data:
            return jsonify({"error": "audio_path is required"}), 400
        
        audio_path = data['audio_path']
        
        if not os.path.exists(audio_path):
            return jsonify({"error": f"Audio file not found: {audio_path}"}), 404
        
        # Load model if needed
        model_name = data.get('model', current_config['model'])
        if whisperx_model is None or model_name != current_config['model']:
            load_model(model_name)
        
        # Load audio
        logger.info(f"Loading audio: {audio_path}")
        audio = whisperx.load_audio(audio_path)
        
        # Transcribe
        logger.info("Transcribing...")
        # Force language to English if not specified to prevent hallucinations in other languages
        target_lang = data.get('language') or current_config.get('language', 'en')
        
        result = whisperx_model.transcribe(
            audio, 
            batch_size=16,
            language=target_lang
        )
        logger.info(f"Transcription result language: {result.get('language')}")
        
        # Align whisper output for word-level timestamps
        logger.info("Aligning transcript...")
        model_a, metadata = whisperx.load_align_model(
            language_code=result["language"], 
            device=current_config["device"]
        )
        result = whisperx.align(
            result["segments"], 
            model_a, 
            metadata, 
            audio, 
            current_config["device"],
            return_char_alignments=False
        )
        
        # Speaker diarization (optional)
        if data.get('diarize') and data.get('hf_token'):
            logger.info("Running speaker diarization...")
            try:
                from whisperx.diarize import DiarizationPipeline
                
                diarize_model = DiarizationPipeline(
                    use_auth_token=data['hf_token'],
                    device=current_config["device"]
                )
                diarize_segments = diarize_model(audio)
                result = whisperx.assign_word_speakers(diarize_segments, result)
                logger.info("Diarization complete")
            except Exception as e:
                logger.warning(f"Diarization failed: {e}")
                # Continue without diarization
        
        # Calculate duration
        duration = len(audio) / 16000  # Assuming 16kHz sample rate
        
        # Format response
        segments = []
        hallucination_phrases = ["고맙습니다", "Thank you", "字幕", "Amara.org"]
        
        for seg in result.get("segments", []):
            text = seg.get("text", "").strip()
            
            # Simple hallucination filter
            if any(hallucination in text for hallucination in hallucination_phrases) and len(text) < 20:
                logger.info(f"Filtered potential hallucination: {text}")
                continue
                
            segment_data = {
                "start": seg.get("start", 0),
                "end": seg.get("end", 0),
                "text": text
            }
            if "speaker" in seg:
                segment_data["speaker"] = seg["speaker"]
            if "words" in seg:
                segment_data["words"] = seg["words"]
            segments.append(segment_data)
        
        # If all segments were filtered, return empty list
        if not segments and result.get("segments"):
             logger.info("All segments filtered as hallucinations")
        
        return jsonify({
            "segments": segments,
            "language": result.get("language", "en"),
            "duration": duration
        })
        
    except ImportError as e:
        logger.error(f"Import error: {e}")
        return jsonify({"error": f"Missing dependency: {e}"}), 500
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/config', methods=['POST'])
def update_config():
    """
    Update server configuration.
    
    Request body:
    {
        "model": "large-v3",
        "device": "cpu",
        "compute_type": "float32"
    }
    """
    global current_config
    
    data = request.get_json()
    
    if 'model' in data:
        current_config['model'] = data['model']
    if 'device' in data:
        current_config['device'] = data['device']
    if 'compute_type' in data:
        current_config['compute_type'] = data['compute_type']
    if 'language' in data:
        current_config['language'] = data['language']
    
    # Reload model with new config
    load_model(
        current_config['model'],
        current_config['device'],
        current_config['compute_type']
    )
    
    return jsonify({
        "status": "ok",
        "config": current_config
    })


@app.route('/models', methods=['GET'])
def list_models():
    """List available WhisperX models."""
    return jsonify({
        "models": [
            {"id": "tiny", "size": "39M", "speed": "fastest", "quality": "basic"},
            {"id": "base", "size": "74M", "speed": "fast", "quality": "good"},
            {"id": "small", "size": "244M", "speed": "medium", "quality": "better"},
            {"id": "medium", "size": "769M", "speed": "slow", "quality": "great"},
            {"id": "large-v2", "size": "1550M", "speed": "slowest", "quality": "best"},
            {"id": "large-v3", "size": "1550M", "speed": "slowest", "quality": "best"}
        ],
        "recommended": "base"
    })


if __name__ == '__main__':
    port = int(os.environ.get('WHISPERX_PORT', 5123))
    
    logger.info(f"Starting WhisperX server on port {port}")
    logger.info(f"Device: {get_device()}")
    
    # Pre-load the default model
    try:
        load_model()
    except Exception as e:
        logger.warning(f"Could not pre-load model: {e}")
        logger.info("Model will be loaded on first transcription request")
    
    app.run(host='127.0.0.1', port=port, debug=False)

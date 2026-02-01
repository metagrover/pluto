# WhisperX Server for Pluto

A Flask HTTP server that wraps WhisperX for transcription with speaker diarization.

## Prerequisites

1. **Python 3.10+** (check with `python3 --version`)
2. **ffmpeg** (install with `brew install ffmpeg` on macOS)

## Installation

```bash
# Install dependencies globally (on macOS, use --break-system-packages if needed)
pip3 install flask whisperx --break-system-packages
```

That's it! The Pluto app will automatically start the WhisperX server when needed.

## Hugging Face Setup (for Speaker Diarization)

Speaker diarization requires accepting the pyannote model licenses:

1. Create a free account at [huggingface.co](https://huggingface.co)
2. Accept the user agreements for:
   - [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0)
   - [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
3. Create an access token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
4. The Pluto app will prompt you to enter this token on first launch

## Running the Server

```bash
# Make sure you're in the python directory with venv activated
python whisperx_server.py

# Server runs on http://localhost:5123 by default
```

## API Endpoints

### `GET /health`
Check if the server is running.

**Response:**
```json
{
  "status": "ok",
  "whisperx_version": "3.1.1",
  "device": "cpu"
}
```

### `POST /transcribe`
Transcribe an audio file.

**Request:**
```json
{
  "audio_path": "/path/to/audio.wav",
  "model": "base",
  "language": "en",
  "diarize": true,
  "hf_token": "hf_xxx..."
}
```

**Response:**
```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "Hello, how are you?",
      "speaker": "SPEAKER_00"
    }
  ],
  "language": "en",
  "duration": 60.5
}
```

### `POST /config`
Update server configuration.

**Request:**
```json
{
  "model": "large-v3",
  "device": "cpu",
  "compute_type": "float32"
}
```

## Troubleshooting

### "No module named whisperx"
Make sure you've activated the virtual environment and installed requirements.

### Slow transcription
- Use a smaller model (`base` or `small`) for faster results
- GPU acceleration (CUDA) is much faster but requires NVIDIA GPU

### Diarization not working
- Ensure you've accepted the pyannote model agreements on Hugging Face
- Check that your HF token has the correct permissions

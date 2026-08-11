import time
import os
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "python"))

from whisperx_server import _transcribe_locked, TranscribeRequest, MLX_WHISPER_AVAILABLE

def get_wav_duration(audio_path):
    with wave.open(audio_path, 'r') as f:
        frames = f.getnframes()
        rate = f.getframerate()
        return frames / float(rate)

def run_benchmark():
    audio_path = os.path.abspath("tests/fixtures/sample_meeting.wav")
    if not os.path.exists(audio_path):
        print(f"Error: {audio_path} not found.")
        return

    duration_sec = get_wav_duration(audio_path)
    print("=" * 70)
    print(f"🎙   PLUTO SPEECH-TO-TEXT PERFORMANCE BENCHMARK (M1 Pro)")
    print(f"📁  Audio File: {os.path.basename(audio_path)}")
    print(f"⏱   Audio Duration: {duration_sec:.2f} seconds")
    print(f"🍏  MLX Whisper Available: {MLX_WHISPER_AVAILABLE}")
    print("=" * 70)

    if not MLX_WHISPER_AVAILABLE:
        print("MLX Whisper is not installed.")
        return

    # Benchmark MLX Whisper (Apple Silicon)
    print("\n🚀 Running MLX Whisper (Apple Neural Engine + Metal GPU)...")
    start_time = time.time()
    req_mlx = TranscribeRequest(
        audio_path=audio_path,
        device="mlx",
        model="small",
        language="en"
    )
    res_mlx = _transcribe_locked(req_mlx)
    elapsed_mlx = time.time() - start_time
    rtf_mlx = elapsed_mlx / duration_sec if duration_sec > 0 else 0
    text_mlx = " ".join([s["text"] for s in res_mlx.get("segments", [])])

    print("-" * 70)
    print(f"⚡️  MLX Elapsed Time: {elapsed_mlx * 1000:.1f} ms ({elapsed_sec:.2f} s)" if 'elapsed_sec' in locals() else f"⚡️  MLX Elapsed Time: {elapsed_mlx * 1000:.1f} ms ({elapsed_mlx:.2f} s)")
    print(f"🏎   MLX Speedup: {duration_sec / elapsed_mlx:.1f}x real-time speed (RTF: {rtf_mlx:.4f})")
    print(f"📝  MLX Transcribed Text:\n    \"{text_mlx}\"")
    print(f"📊  Segments: {len(res_mlx.get('segments', []))}")
    print("=" * 70)

if __name__ == "__main__":
    run_benchmark()

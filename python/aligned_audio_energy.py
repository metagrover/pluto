import array
import math
import sys
import wave
from pathlib import Path


def _read_mono_pcm16(path: Path) -> tuple[int, array.array]:
    try:
        with wave.open(str(path), "rb") as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
                raise ValueError("audio_contract_mismatch")
            sample_rate = audio.getframerate()
            samples = array.array("h", audio.readframes(audio.getnframes()))
    except (wave.Error, EOFError) as error:
        raise ValueError("audio_contract_mismatch") from error
    if sys.byteorder != "little":
        samples.byteswap()
    return sample_rate, samples


def _rms(samples: array.array) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum((sample / 32768.0) ** 2 for sample in samples) / len(samples))


def aligned_energy_windows(
    mic_path: Path,
    system_path: Path,
    *,
    window_seconds: float = 0.1,
) -> list[dict]:
    mic_rate, mic_samples = _read_mono_pcm16(mic_path)
    system_rate, system_samples = _read_mono_pcm16(system_path)
    if mic_rate != system_rate or mic_rate <= 0:
        raise ValueError("audio_contract_mismatch")
    window_samples = max(1, round(mic_rate * window_seconds))
    total_samples = max(len(mic_samples), len(system_samples))
    windows = []
    for start in range(0, total_samples, window_samples):
        end = min(total_samples, start + window_samples)
        windows.append(
            {
                "startTime": start / mic_rate,
                "endTime": end / mic_rate,
                "micRms": _rms(mic_samples[start:end]),
                "systemRms": _rms(system_samples[start:end]),
            }
        )
    return windows

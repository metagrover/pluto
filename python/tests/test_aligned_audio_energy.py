import math
import tempfile
import unittest
import wave
from pathlib import Path

from python.aligned_audio_energy import aligned_energy_windows


def write_wave(path: Path, amplitudes: list[float], sample_rate: int = 1000):
    samples = bytearray()
    for amplitude in amplitudes:
        value = max(-32768, min(32767, round(amplitude * 32767)))
        samples.extend(int(value).to_bytes(2, "little", signed=True))
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(samples)


class AlignedAudioEnergyTest(unittest.TestCase):
    def test_emits_aligned_content_free_rms_windows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mic = root / "mic.wav"
            system = root / "system.wav"
            write_wave(mic, [0.5] * 100 + [0.0] * 100)
            write_wave(system, [0.25] * 100 + [0.5] * 100)

            windows = aligned_energy_windows(mic, system, window_seconds=0.1)

            self.assertEqual(len(windows), 2)
            self.assertAlmostEqual(windows[0]["micRms"], 0.5, places=3)
            self.assertAlmostEqual(windows[0]["systemRms"], 0.25, places=3)
            self.assertAlmostEqual(windows[1]["micRms"], 0.0, places=3)
            self.assertAlmostEqual(windows[1]["systemRms"], 0.5, places=3)
            self.assertNotIn(str(root), str(windows))

    def test_rejects_mismatched_audio_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mic = root / "mic.wav"
            system = root / "system.wav"
            write_wave(mic, [0.1] * 100, sample_rate=1000)
            write_wave(system, [0.1] * 200, sample_rate=2000)

            with self.assertRaisesRegex(ValueError, "audio_contract_mismatch"):
                aligned_energy_windows(mic, system)


if __name__ == "__main__":
    unittest.main()

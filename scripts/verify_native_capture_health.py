"""Opt-in native continuity check. Tap only a muted synthetic afplay process.

No microphone, production profile, or captured audio is saved. Compare HEAD
against current native sources, retaining only timing, CPU, and numeric health.
"""
import json
import math
import os
from pathlib import Path
import selectors
import signal
import struct
import subprocess
import sys
import tempfile
import time
import wave


def command(args):
    return subprocess.check_output(["rtk", "proxy", *args])


def capture(binary, fixture):
    player = subprocess.Popen(["/usr/bin/afplay", "-v", "0", str(fixture)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.4)
    child = subprocess.Popen([str(binary), "--pid", str(player.pid)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ, "pcm")
    selector.register(child.stderr, selectors.EVENT_READ, "health")
    began = time.monotonic()
    received = []
    total_bytes = 0
    health_events = []
    pending = ""
    cpu_seconds = 0
    rss_kb = 0
    try:
        while time.monotonic() - began < 20:
            if child.poll() is not None:
                raise RuntimeError("native_capture_exited_before_test_completed")
            for key, _ in selector.select(0.1):
                data = os.read(key.fileobj.fileno(), 65536)
                if not data:
                    continue
                if key.data == "pcm":
                    total_bytes += len(data)
                    received.append(time.monotonic() - began)
                else:
                    pending = (pending + data.decode(errors="replace"))[-8192:]
                    lines = pending.split("\n")
                    pending = lines.pop()
                    for line in lines:
                        if line.startswith("[AudioCapHealth] "):
                            record = json.loads(line[17:])
                            health_events.append({key: record[key] for key in ["event", "framesWritten", "tapGeneration", "retries"]})
        usage = command(["ps", "-p", str(child.pid), "-o", "time=,rss="]).decode().split()
        minutes, seconds = usage[0].split(":")
        cpu_seconds = int(minutes) * 60 + float(seconds)
        rss_kb = int(usage[1])
    finally:
        child.send_signal(signal.SIGINT) if child.poll() is None else None
        player.terminate() if player.poll() is None else None
        child.wait(timeout=5)
        player.wait(timeout=5)
        selector.close()
    if not received:
        raise RuntimeError("native_pcm_unavailable_check_system_audio_permission")
    gaps = [right - left for left, right in zip(received, received[1:])]
    result = {
        "bytesReceived": total_bytes,
        "pcmSeconds": total_bytes / 192000,
        "firstPcmMs": received[0] * 1000,
        "maxDeliveryGapMs": max(gaps, default=0) * 1000,
        "cpuPercent": cpu_seconds / 20 * 100,
        "rssKiB": rss_kb,
        "nativeHealth": health_events,
    }
    assert result["pcmSeconds"] > 18, result
    assert result["maxDeliveryGapMs"] < 3000, result
    assert all(event["event"] == "heartbeat" for event in health_events), result
    return result


with tempfile.TemporaryDirectory(prefix="pluto-native-health-") as temporary:
    root = Path(temporary)
    fixture = root / "synthetic.wav"
    with wave.open(str(fixture), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(48000)
        # Synthetic source includes digital silence; transport must keep flowing.
        wav.writeframes(b"".join(struct.pack("<h", 0 if 8 <= sample / 48000 < 12 else int(4000 * math.sin(sample * 2 * math.pi * 440 / 48000))) for sample in range(24 * 48000)))
    results = {}
    source_dir = Path("resources/swift/audiocap")
    for version in ["baseline", "diagnostics"]:
        directory = root / version
        directory.mkdir()
        for source in source_dir.glob("*.swift"):
            content = command(["git", "show", f"HEAD:{source}"]) if version == "baseline" else source.read_bytes()
            (directory / source.name).write_bytes(content)
        binary = directory / "audiocap"
        command(["xcrun", "swiftc", *map(str, directory.glob("*.swift")), "-o", str(binary), "-framework", "CoreAudio", "-framework", "AudioToolbox", "-framework", "AVFoundation"])
        command(["codesign", "--sign", "-", "--force", str(binary)])
        results[version] = capture(binary, fixture)
        print(json.dumps({"completed": version}), flush=True)
    report = {"isolation": "explicit_muted_synthetic_playback_pid_only_no_audio_saved", "results": results}
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(json.dumps(report, indent=2))
        os.chmod(sys.argv[1], 0o600)
    print(json.dumps(report, indent=2))

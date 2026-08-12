from typing import List, Dict, Any

class RollingAudioBuffer:
    def __init__(self, max_duration_seconds: float = 60.0):
        self.max_duration_seconds = max_duration_seconds
        self.chunks: List[Dict[str, Any]] = []

    def append_chunk(self, audio_data: bytes, duration_seconds: float, start_time: float):
        self.chunks.append({
            "audio_data": audio_data,
            "duration_seconds": duration_seconds,
            "start_time": start_time
        })
        self._prune()

    def _prune(self):
        total_duration = sum(c["duration_seconds"] for c in self.chunks)
        while total_duration > self.max_duration_seconds and len(self.chunks) > 1:
            removed = self.chunks.pop(0)
            total_duration -= removed["duration_seconds"]

    def get_buffered_window(self) -> Dict[str, Any]:
        self._prune()
        total_dur = sum(c["duration_seconds"] for c in self.chunks)
        return {
            "total_duration": total_dur,
            "chunks": self.chunks[:]
        }

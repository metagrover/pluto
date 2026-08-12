import pytest
from rolling_audio_buffer import RollingAudioBuffer

def test_rolling_audio_buffer_sliding_window():
    buf = RollingAudioBuffer(max_duration_seconds=60.0)
    buf.append_chunk(audio_data=b"chunk1", duration_seconds=30.0, start_time=0.0)
    buf.append_chunk(audio_data=b"chunk2", duration_seconds=40.0, start_time=30.0)
    
    # Total 70s > 60s max -> chunk1 pruned
    window = buf.get_buffered_window()
    assert window["total_duration"] <= 60.0
    assert len(window["chunks"]) == 1
    assert window["chunks"][0]["audio_data"] == b"chunk2"

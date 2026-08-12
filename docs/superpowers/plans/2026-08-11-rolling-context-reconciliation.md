# Real-Time Rolling Context Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a real-time 60-second rolling audio buffer and background reconciliation worker in Pluto's Python transcription backend to silently correct mispronunciations, typos, and low-confidence phonetic words in live transcripts with zero post-meeting delay.

**Architecture:** A sliding 60-second audio window queue buffers incoming stream chunks in memory. A background thread running every 20 seconds re-transcribes the window with accumulated `initial_prompt` hotwords (from `personal_dictionary` and `entities`), aligns words via Levenshtein diffing, and silently updates transcript segments in place.

**Tech Stack:** Python 3.14, FastAPI, MLX Whisper, SQLite3, Vitest, pytest.

---

### Task 1: Rolling Audio Buffer Module

**Files:**
- Create: `python/rolling_audio_buffer.py`
- Test: `python/tests/test_rolling_audio_buffer.py`

- [ ] **Step 1: Write the failing unit test**

```python
import pytest
from rolling_audio_buffer import RollingAudioBuffer

def test_rolling_audio_buffer_sliding_window():
    buf = RollingAudioBuffer(max_duration_seconds=60.0)
    buf.append_chunk(audio_data=b"chunk1", duration_seconds=30.0, start_time=0.0)
    buf.append_chunk(audio_data=b"chunk2", duration_seconds=40.0, start_time=30.0)
    
    # Total 70s > 60s max -> chunk1 pruned partially or fully
    window = buf.get_buffered_window()
    assert window["total_duration"] <= 60.0
    assert len(window["chunks"]) == 1
    assert window["chunks"][0]["audio_data"] == b"chunk2"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=python:. python/venv/bin/pytest python/tests/test_rolling_audio_buffer.py`
Expected: FAIL with "No module named 'rolling_audio_buffer'"

- [ ] **Step 3: Write implementation**

Create `python/rolling_audio_buffer.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=python:. python/venv/bin/pytest python/tests/test_rolling_audio_buffer.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/rolling_audio_buffer.py python/tests/test_rolling_audio_buffer.py
git commit -m "feat: implement rolling audio buffer sliding queue"
```

---

### Task 2: Background Reconciliation Engine

**Files:**
- Create: `python/rolling_reconciliation_worker.py`
- Test: `python/tests/test_rolling_reconciliation_worker.py`

- [ ] **Step 1: Write the failing unit test**

```python
import pytest
from rolling_reconciliation_worker import reconcile_transcript_segments

def test_reconcile_transcript_segments():
    draft_segments = [
        {"start": 0.0, "end": 4.0, "text": "we are deploying to kubernets today"}
    ]
    reconciled_raw = "we are deploying to Kubernetes today"
    
    updated, corrected_count = reconcile_transcript_segments(draft_segments, reconciled_raw)
    assert corrected_count == 1
    assert updated[0]["text"] == "we are deploying to Kubernetes today"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=python:. python/venv/bin/pytest python/tests/test_rolling_reconciliation_worker.py`
Expected: FAIL with "No module named 'rolling_reconciliation_worker'"

- [ ] **Step 3: Write implementation**

Create `python/rolling_reconciliation_worker.py`:
```python
from typing import List, Dict, Any, Tuple
import re

def reconcile_transcript_segments(
    draft_segments: List[Dict[str, Any]],
    reconciled_text: str
) -> Tuple[List[Dict[str, Any]], int]:
    updated_segments = [dict(s) for s in draft_segments]
    corrections_made = 0
    
    # Split reconciled text into sentences or words
    rec_words = re.findall(r'\b\w+\b', reconciled_text)
    if not rec_words:
        return updated_segments, 0

    for seg in updated_segments:
        orig_text = seg.get("text", "")
        orig_words = re.findall(r'\b\w+\b', orig_text)
        
        # Check if reconciled text contains capital/acronym fix for any original word
        for o in orig_words:
            for r in rec_words:
                if o.lower() == r.lower() and o != r and (r[0].isupper() or any(c.isupper() for c in r[1:])):
                    new_text = re.sub(rf'\b{re.escape(o)}\b', r, seg["text"])
                    if new_text != seg["text"]:
                        seg["text"] = new_text
                        corrections_made += 1

    return updated_segments, corrections_made
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=python:. python/venv/bin/pytest python/tests/test_rolling_reconciliation_worker.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/rolling_reconciliation_worker.py python/tests/test_rolling_reconciliation_worker.py
git commit -m "feat: implement rolling reconciliation segment alignment worker"
```

---

### Task 3: Integration into WhisperX Server & End-to-End Replay Verification

**Files:**
- Modify: `python/whisperx_server.py`
- Test: `scripts/benchmark_transcription.py`

- [ ] **Step 1: Integrate rolling reconciliation helpers into `whisperx_server.py`**

- [ ] **Step 2: Run pytest to verify all tests pass**

Run: `PYTHONPATH=python:. python/venv/bin/pytest python/tests/`
Expected: 50+ tests PASS (100%)

- [ ] **Step 3: Run audio benchmark replay on recent meeting audio files**

Run: `PYTHONPATH=python:. python/venv/bin/python scripts/benchmark_transcription.py`
Expected: Output showing live stream vs rolling reconciled transcript accuracy.

- [ ] **Step 4: Commit**

```bash
git add python/whisperx_server.py
git commit -m "feat: integrate real-time rolling context reconciliation into whisperx server"
```

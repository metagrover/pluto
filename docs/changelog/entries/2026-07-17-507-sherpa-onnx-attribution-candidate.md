### Evaluate a credential-free local diarization candidate

- **Issue:** `#507`
- **PR:** `#508`
- **Changed:** Pluto's local speaker-attribution benchmark now supports a checksum-pinned sherpa-onnx diarizer backed by separate segmentation and speaker-embedding artifacts, with credential-free and redistribution-review gates enforced before probe or inference.
- **Why:** Production integration in `#460` cannot start until `#465` has a locally runnable candidate that does not ask users for model-hub credentials and cannot silently substitute mutable model downloads.
- **Replaced:** Benchmark coverage limited to token-gated pyannote and isolated NeMo candidate adapters.
- **Notes:** The adapter emits only model identifiers, checksums, timing, and normalized diarization intervals; it does not expose private paths or meeting content.

### Use Parakeet for quality-first final transcription

- **Issue:** [#441](https://github.com/metagrover/pluto/issues/441)
- **PR:** [#628](https://github.com/metagrover/pluto/pull/628)
- **Changed:** Pluto keeps fast MLX Whisper live previews, then validates the sealed microphone and system recordings sequentially with a pinned local FluidAudio/Parakeet Core ML process before committing the canonical transcript.
- **Why:** Whole-meeting MLX caused unsafe unified-memory growth, while final transcript quality needs a stronger recognizer than the bounded live-preview model.
- **Replaced:** Whole-session MLX finalization, legacy Whisper backend/device settings, and analysis paths that could run before a generation-guarded canonical final commit.
- **Notes:** First use downloads Pluto-owned model bundles. An app-wide post-meeting worker owns finalization outside the recorder lifecycle; new capture cancels and unloads it, and downstream analysis consumes the committed result without a second ASR pass. Thermal or memory pressure pauses inference visibly, and the child unloads after five idle minutes. Failures preserve the provisional transcript and recording in a retryable state; private audio, transcript text, paths, vocabulary, and identities are excluded from diagnostics and committed benchmarks. The implementation remains a promotion candidate until human-reviewed excerpts prove accuracy against the current canonical path.

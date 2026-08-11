### Bound capture-time compute to the live meeting

- **Issue:** [#603](https://github.com/metagrover/pluto/issues/603)
- **PR:** [#605](https://github.com/metagrover/pluto/pull/605)
- **Changed:** Active recordings no longer mount the hidden legacy waveform, speaker activity uses a fixed five-sample-per-second cadence, live word reveal updates only the newest transcript segment, pane scrolling stays contained, and queued knowledge synthesis remains paused for the full capture lease.
- **Why:** Display-rate loops, history-wide word updates, scroll chaining, and background local-LLM work consumed compute unrelated to new speech and made longer recordings increasingly hot and laggy.
- **Replaced:** Invisible waveform animation, animation-frame speaker sampling, transcript-wide reveal state, and transcription-only synthesis pausing.
- **Notes:** Durable audio capture, MLX transcription settings, transcript evidence, speaker thresholds, manual-scroll suspension, Return to live, and reduced-motion behavior are unchanged. Verification uses only synthetic inputs and content-free aggregate measurements.

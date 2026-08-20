### Reprepare Parakeet after runtime unload

- **Issue:** [#630](https://github.com/metagrover/pluto/issues/630)
- **PR:** Not created; local change pending review.
- **Changed:** Final transcription clears its prepared-runtime cache when the Parakeet child exits or is unloaded.
- **Why:** A fresh child must load the model before its first final-transcription request.
- **Replaced:** Stale prepared state that could send transcription to an unprepared runtime.
- **Notes:** The next finalization now sends a new prepare request before inference.

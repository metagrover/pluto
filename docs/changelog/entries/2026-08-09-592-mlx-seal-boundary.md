### Make MLX Live Transcription and Meeting Finalization Honest

- **Issue:** [#592](https://github.com/metagrover/pluto/issues/592), [#593](https://github.com/metagrover/pluto/issues/593)
- **PR:** [#595](https://github.com/metagrover/pluto/pull/595)
- **Changed:** Pluto selects and persists the native MLX backend only when Apple Silicon runtime health proves it is available, models the MLX device contract explicitly, and seals durable recording evidence before transcript repair.
- **Why:** An unset backend kept the app on an unavailable CPU recognizer, while stop-time transcript repair ran inside the journal seal handler and mislabeled derived processing failure as recording recovery failure.
- **Replaced:** Implicit CPU defaults, an untyped MLX device bridge, silent unavailable-engine fallback, and transcription-coupled capture sealing.
- **Notes:** Existing backend choices are preserved, configured quality models remain authoritative, post-seal transcript failures remain retryable, and historical meeting records are not rewritten.

### Run guarded rolling Parakeet transcription during recordings

- **Issue:** [#651](https://github.com/metagrover/pluto/issues/651)
- **PR:** Not created; local change pending review.
- **Changed:** Ready recordings now run Parakeet in the background over sealed, non-overlapping 30-second microphone and System-audio windows. MLX remains the live preview and the existing Parakeet final pass remains canonical.
- **Why:** The complete receipt-bound shadow path was hidden behind a development-only flag, so normal recordings never produced the operational evidence needed to evaluate it.
- **Replaced:** Development-only opt-in for the guarded dual-source Parakeet shadow stage.
- **Notes:** The resource fence, cancellation, cleanup, and content-free failure report remain mandatory; shadow output cannot alter the visible or canonical transcript.

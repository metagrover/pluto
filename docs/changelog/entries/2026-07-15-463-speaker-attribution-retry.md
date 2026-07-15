### Retry low-confidence speaker attribution before fallback persistence

- **Issue:** `#463`
- **PR:** `(pending)`
- **Changed:** Recording finalization now plans one stronger diarization-capable retry when the first speaker-mapping pass is untrusted, instead of immediately persisting fallback `Me`/`Them` labels from the weaker attribution path.
- **Why:** Pluto already knew when diarization mapping was skipped or untrusted, but it did not use that signal to try a stronger local attribution pass before saving the final transcript.
- **Replaced:** Treating all failed diarization-mapping attempts as final speaker attribution outcomes.
- **Notes:** This stays scoped to retrying attribution behavior. Persisted attribution metadata remains tracked separately in `#461`.

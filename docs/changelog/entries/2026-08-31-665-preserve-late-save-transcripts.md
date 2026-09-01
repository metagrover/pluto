### Preserve transcripts during late meeting saves

- **Issue:** [#665](https://github.com/metagrover/pluto/issues/665)
- **PR:** [#696](https://github.com/metagrover/pluto/pull/696)
- **Changed:** Generic partial meeting saves now retain omitted transcript and audio state, while explicit transcript replacements remain authoritative. Live recognized and interim transcript text wraps long unbroken ASR tokens inside the recording workspace.
- **Why:** Late title or analysis saves could previously bind omitted transcript fields as null/default values and erase a completed transcript.
- **Replaced:** Destructive null/default bindings for transcript-owned fields omitted from generic meeting saves.
- **Notes:** Explicit transcript replacements, including nullable clears, remain supported. Guarded transcript validation and finalization paths keep their existing concurrency checks.

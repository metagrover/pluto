### Recover interrupted capture journals on launch

- **Issue:** [#470](https://github.com/metagrover/pluto/issues/470)
- **PR:** [#471](https://github.com/metagrover/pluto/pull/471)
- **Changed:** Pluto now scans unsealed capture journals on launch, reconstructs recoverable mic and system WAVs from durable chunk entries, and saves one `needs_attention` meeting instead of leaving interrupted recordings stranded on disk.
- **Why:** The crash-safe capture work from `#438` and `#456` was still missing the recovery step that turns acknowledged journal writes into an honest, retryable recovered meeting after interruption.
- **Replaced:** Manual artifact digging and silent data loss after interrupted recordings.
- **Notes:** Recovery stays scoped to reconstructing durable source audio and persisting an honest meeting record; it does not auto-finalize transcripts or add new recovery UI yet.

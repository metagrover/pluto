### Complete trusted processing for recovered meetings
- **Issue:** [#572](https://github.com/metagrover/pluto/issues/572)
- **PR:** [#573](https://github.com/metagrover/pluto/pull/573)
- **Changed:** Transcript retry now verifies per-source sealed checkpoint coverage, falls back to preserved-channel transcription when checkpoints are incomplete, accounts for verified cross-channel pass-through, and resumes interrupted analysis after restart.
- **Why:** Canonical duplicate removal could discard mic-attributed copies before coverage validation, leaving recovered meetings stuck behind a false speech-loss warning even when both source transcripts were preserved.
- **Replaced:** Validating only the post-arbitration transcript and stopping after an insufficient checkpoint fast path.
- **Notes:** Canonical transcripts remain deduplicated, genuine capture gaps stay fail-closed, and verification evidence remains content-free.

### Retire rolling AEC from the Parakeet rollout

- **Issue:** [#629](https://github.com/metagrover/pluto/issues/629)
- **PR:** Not opened; scope decision only.
- **Changed:** Retired the planned rolling AEC and dual-source-primary path; Pluto continues to reconcile overlapping mic/System transcript content after transcription.
- **Why:** Duplicate text does not justify a new DSP runtime when timestamped cross-channel reconciliation already addresses the user-facing outcome.
- **Replaced:** The proposed AEC-gated residual-mic path for normal live transcript deduplication.
- **Notes:** The isolated WebRTC AudioProcessing spike remains content-free evidence only. No capture, renderer, finalization, or production dependency wiring was added.


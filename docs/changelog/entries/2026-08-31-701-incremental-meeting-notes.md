### Reuse safe note fragments generated before meeting completion

- **Issue:** [#701](https://github.com/metagrover/pluto/issues/701)
- **PR:** [#702](https://github.com/metagrover/pluto/pull/702)
- **Changed:** Accepted live transcripts can offer source-growth-bounded, latest-only incremental note work. Pluto admits at most one closed-leaf writer under explicit capture ownership, AC-power, nominal-thermal, healthy-transcript, memory, and background-priority constraints; retains validated drafts in a 64-entry, one-hour in-memory cache; and reuses only exact compatible leaves during final note generation.
- **Why:** A typical local notes run can spend many minutes writing hierarchy leaves after the meeting ends. Moving an already-required writer call into safe capture headroom can shorten post-meeting wait without publishing provisional notes or repeating completed work.
- **Replaced:** Starting every final notes hierarchy with an empty writer cache, whole-source cache identity that rejected an unchanged closed prefix after transcript growth, and unbounded repeated incremental offers.
- **Notes:** The growing tail is never cached. Provisional drafts are never persisted or displayed. Stop, owner loss, unhealthy live transcription, stale offers, capture-policy denial, and higher-priority preemption discard or cancel incremental work; final source, merge, audit, cancellation, and revision-checked publication contracts are unchanged. Automated tests prove coordination and exact reuse, but a live-meeting latency improvement has not yet been demonstrated.

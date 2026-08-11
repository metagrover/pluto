### Finish post-meeting intelligence while Pluto is backgrounded

- **Issue:** [#608](https://github.com/metagrover/pluto/issues/608)
- **PR:** [#609](https://github.com/metagrover/pluto/pull/609)
- **Changed:** Pluto keeps its renderer unsuspended only while a claimed post-meeting run is active, bounds each downstream stage, and shows distinct analysis progress, stopped, missing, and ready states.
- **Why:** Electron could suspend the renderer after local model requests completed, leaving a validated meeting in `processing` until the window was raised and incorrectly labeling missing analysis as ready.
- **Replaced:** Window-visibility-dependent persistence, a single thirty-minute healthy-looking lease, and the unconditional `Synthesis ready` meeting badge.
- **Notes:** Transcript evidence, source/run fencing, local-only inference, idle renderer throttling, and restart recovery remain intact. Diagnostics and verification use only content-free state and synthetic inputs.

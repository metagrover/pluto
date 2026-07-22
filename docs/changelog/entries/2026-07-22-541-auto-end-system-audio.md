### Auto-end checks meeting system audio during recording

- **Issue:** [#541](https://github.com/metagrover/pluto/issues/541)
- **PR:** [#545](https://github.com/metagrover/pluto/pull/545)
- **Changed:** Targeted active-call checks now probe the meeting app's system-audio processes even while Pluto's own native capture process is running.
- **Why:** The existence of Pluto's capture process proves that recording is active, not that the meeting is still producing audio, so it cannot keep a recording alive after hangup.
- **Replaced:** The shared probe fast path that treated any running Pluto capture process as high-confidence meeting activity and prevented the auto-end grace period from starting.
- **Notes:** Untargeted readiness checks still reuse the running capture process; meeting-app detection, confidence semantics, polling cadence, and grace durations are unchanged.

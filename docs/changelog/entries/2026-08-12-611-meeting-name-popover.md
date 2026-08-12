### Keep active recording navigation reversible
- **Issue:** [#611](https://github.com/metagrover/pluto/issues/611)
- **PR:** [#620](https://github.com/metagrover/pluto/pull/620)
- **Changed:** Active recordings now expose a top-center meeting name pill with voice-input status and an expand action when they continue in the background from the home dashboard, and Zen View now offers an inline back-home path beside the recording status.
- **Why:** Meeting review and live capture should feel quiet without making users feel trapped away from the rest of Pluto.
- **Replaced:** The inline recording title field that lived inside the capture bar and the all-or-nothing Zen View shell swap during active recording.
- **Notes:** The pill uses the current meeting name when available and falls back to `Meeting`; it is hidden while Zen View itself is open. Recording persistence and post-meeting title generation are unchanged.

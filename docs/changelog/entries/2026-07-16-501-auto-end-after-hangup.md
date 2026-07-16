### Auto-end recordings after call hangup

- **Issue:** [#501](https://github.com/metagrover/pluto/issues/501)
- **PR:** [#502](https://github.com/metagrover/pluto/pull/502)
- **Changed:** Auto-end now treats a silent attached meeting app or open meeting tab as inactive after Pluto has confirmed the live call, starting the existing two-minute grace period before finalization.
- **Why:** Meeting apps and browser tabs often remain open after hangup, so their process presence cannot indefinitely prove that the call is still live.
- **Replaced:** Medium-confidence fallback detection that kept recordings active forever whenever the call app or meeting tab remained present.
- **Notes:** High-confidence audio cancels the grace period if the call resumes, and silent fallback alone cannot lock a newly started recording onto an unconfirmed call.

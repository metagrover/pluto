### Require confirmed Zoom audio before alerting

- **Issue:** [#554](https://github.com/metagrover/pluto/issues/554)
- **PR:** [#555](https://github.com/metagrover/pluto/pull/555)
- **Changed:** Pluto now shows the call-detected alert only for high-confidence meeting audio.
- **Why:** A silent Zoom background process was treated as alert-worthy even though process attachment is only medium-confidence presence evidence.
- **Replaced:** Alert eligibility based on any active detector result, including silent app fallback.
- **Notes:** Medium confidence remains post-confirmation fallback evidence for auto-end. The reported auto-end failure remains under investigation in #554 and is not claimed as fixed by this change.

### Require confirmed call audio before alerting

- **Issue:** [#554](https://github.com/metagrover/pluto/issues/554)
- **PR:** Pending.
- **Changed:** Pluto now shows the call-detected alert only for high-confidence meeting audio and records deduplicated, content-free auto-end observation transitions.
- **Why:** A silent Zoom background process was treated as alert-worthy, while missing lifecycle evidence made a separate failure to arm auto-end impossible to distinguish from a detector failure.
- **Replaced:** Alert eligibility based on any active detector result and auto-end logs that began only after a grace-period decision.
- **Notes:** Medium confidence remains post-confirmation fallback evidence, existing auto-end decisions and 60/120-second grace periods are unchanged, and diagnostics store no audio content.

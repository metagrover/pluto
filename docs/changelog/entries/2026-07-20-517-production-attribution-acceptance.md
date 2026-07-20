### Prove production speaker attribution and preserve safe retries

- **Issue:** `#517`
- **PR:** `#523`
- **Changed:** Added a production-path acceptance runner for pass-through, all-remote, overlap, and short-local-turn attribution; bounded near-end injection to complete short canonical turns; and routed explicit transcript retries through validate-then-save replacement.
- **Why:** Attribution is trustworthy only when real pass-through cannot manufacture `Me`, the reviewed short local reply survives, and a failed replacement never destroys the prior transcript.
- **Replaced:** Evidence-only benchmark assertions, arbitrary word carving inside long remote turns, skipped two-word local replies, and direct retry replacement saves without an explicit preservation result.
- **Notes:** The committed and gitignored private runners emit only aggregate case counts and false/missed-`Me` durations. Private audio, transcript content, identities, timestamps, and paths remain local.

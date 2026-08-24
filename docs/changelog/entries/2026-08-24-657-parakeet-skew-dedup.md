### Remove strongly evidenced skewed Parakeet duplicates

- **Issue:** [#657](https://github.com/metagrover/pluto/issues/657)
- **PR:** Not created; committed directly to master at the user's request.
- **Changed:** Parakeet final transcripts calibrate stable microphone/System word-clock skew and remove exact cross-channel bleed at that offset while persisting content-free reconciliation proof.
- **Why:** Sealed recordings can contain the same playback speech on both channels with a consistent delay just outside the direct duplicate matcher's safe tolerance.
- **Replaced:** Direct timestamp matching alone for cross-channel word bleed.
- **Notes:** Calibration requires three independent unique four-word anchors, a 75% dominant cluster, and an absolute offset no greater than 2.5 seconds; ambiguous overlapping speech remains unchanged.

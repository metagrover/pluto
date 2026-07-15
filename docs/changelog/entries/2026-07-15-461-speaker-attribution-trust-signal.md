### Persist speaker attribution trust signals

- **Issue:** `#461`
- **PR:** `(pending)`
- **Changed:** Saved recording transcripts now persist content-free speaker-attribution metadata that distinguishes diarization-backed `Me`/`Them` mapping from channel-only fallback, including mapping confidence and explicit fallback reasons when diarization is disabled, unavailable, low-confidence, or otherwise skipped.
- **Why:** Pluto already computed speaker-attribution trust internally, but downstream consumers could not tell whether a completed transcript was diarization-backed or a weaker fallback, which kept `#460`'s attribution bug opaque.
- **Replaced:** Treating all saved final transcripts as if they carried equivalent speaker-attribution certainty.
- **Notes:** This slice records the trust signal only. It does not yet change the attribution algorithm or block persistence on low-confidence mapping.

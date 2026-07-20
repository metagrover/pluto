### Separate speaker-model readiness from finalization

- **Issue:** `#514`
- **PR:** `#520`
- **Changed:** Pluto now exposes explicit local speaker-model readiness and preparation operations, while the diarization request itself only accepts already-installed checksum-verified artifacts.
- **Why:** Completed-recording finalization must be reproducible and offline; it cannot hide a model download inside a trust-critical retry path.
- **Replaced:** First-use model acquisition performed implicitly by the `/diarize` finalization request.
- **Notes:** Missing and corrupt artifacts produce finite content-free readiness reasons. Preparation still uses the reviewed credential-free release URLs and both accepted SHA-256 pins.

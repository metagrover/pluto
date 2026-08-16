### Evaluate external WebRTC APM echo cancellation

- **Issue:** [#629](https://github.com/metagrover/pluto/issues/629)
- **PR:** Not opened; isolated spike only.
- **Changed:** Added a synthetic-only runner for the pinned upstream WebRTC AudioProcessing extraction, including deterministic paired System/mic delay and drift residual evidence that currently fails closed as `no_backend_selected` because complete delay/drift and local-preservation gate measurements are not available.
- **Why:** Pluto needs a maintained external echo canceller rather than a Pluto-owned DSP implementation.
- **Replaced:** No production behavior or dependency; this replaces only an unverified AEC-selection hypothesis.
- **Notes:** The runner uses generated content-free PCM and has no Electron, capture, renderer, finalization, package, or runtime-build wiring. A future production design requires separately approved integration after the spike evidence is reviewed.

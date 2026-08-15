# Live background transcript validation implementation plan

**Issue:** [#616](https://github.com/metagrover/pluto/issues/616)  
**Design:** `docs/superpowers/specs/2026-08-14-live-background-transcript-validation-design.md`

1. Add failing tests for per-request MLX configuration and fix the client boundary.
2. Add a pure bounded background-validation queue with live-idle, cadence, thermal, battery, close, and generation fences.
3. Add a pure time-aligned correction merge that preserves deterministic segment identities.
4. Persist successful medium results as capture-journal checkpoint revisions and publish safe corrections in place.
5. Expose a quiet preview/validated live state and content-free diagnostics.
6. Verify finalization reuse, cancellation, full builds, and a synthetic packaged-app flow.
7. Record the decision, changelog, issue evidence, and pull request.

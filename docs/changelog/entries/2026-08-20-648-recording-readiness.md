### Enforce local recording readiness blockers

- **Issue:** [#648](https://github.com/metagrover/pluto/issues/648)
- **PR:** Not created; local change pending review.
- **Changed:** Recording start is blocked in `main.ts` and the UI if local transcription models, audio capture executables, or permissions are unavailable. A blocker screen guides the user through preparation.
- **Why:** Prevent catastrophic silent capture failures or partially corrupted meeting journals.
- **Replaced:** Ad-hoc UI assumptions about whether recording can start safely.
- **Notes:** Readiness probes are fast and synchronous with fallback UI retry flows.

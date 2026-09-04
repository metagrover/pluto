### Start a meeting through Parakeet warm-up

- **Issue:** [#742](https://github.com/metagrover/pluto/issues/742)
- **PR:** Pending.
- **Changed:** New meeting now prepares and verifies the local Parakeet runtime inside the existing starting state before capture admission continues.
- **Why:** The intentional five-minute idle unload cleared runtime readiness, so a later recording attempt failed its status-only check, flashed through completed onboarding, and required another click after the model became warm.
- **Replaced:** A status-only readiness probe that rejected an intentionally cold Parakeet runtime instead of preparing it.
- **Preserved:** AudioCap, permission, model-capability, capture-journal, and microphone checks remain fail-closed. Duplicate starts remain excluded while the first request is preparing.
- **Notes:** Startup continues to use Pluto's existing finite starting presentation; no background recording begins before readiness succeeds.

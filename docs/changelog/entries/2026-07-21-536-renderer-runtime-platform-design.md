### Design a process-free renderer runtime boundary

- **Issue:** [#536](https://github.com/metagrover/pluto/issues/536)
- **PR:** [#537](https://github.com/metagrover/pluto/pull/537)
- **Changed:** Defined a narrow preload/browser runtime descriptor so renderer transcription capability checks no longer depend on Node's global `process` during module evaluation.
- **Why:** The isolated Electron renderer currently crashes before React mounts, leaving a white screen, while truthful Apple Silicon capability still requires explicit platform and architecture evidence.
- **Replaced:** Shared renderer code reading `process.platform` and `process.arch` at module scope.
- **Notes:** Unknown architecture fails closed, Node integration stays disabled, and unrelated Knowledge synthesis errors remain outside this startup fix.

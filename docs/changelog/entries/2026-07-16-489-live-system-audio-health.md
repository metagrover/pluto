### Report live system-audio capture health

- **Issue:** [#489](https://github.com/metagrover/pluto/issues/489)
- **PR:** Pending.
- **Changed:** The recording header now derives system-audio health from the native capture start result and the arrival of valid PCM instead of treating the boot-time permission probe as live capture evidence.
- **Why:** A stale or inconclusive startup probe could leave `System audio needs attention` visible even while Pluto was successfully recording the meeting.
- **Replaced:** Permission-derived capture health that never reconciled with the active native recorder.
- **Notes:** Silent PCM still proves the capture path is working; Pluto does not require audible speech or transcript content to clear the warning.

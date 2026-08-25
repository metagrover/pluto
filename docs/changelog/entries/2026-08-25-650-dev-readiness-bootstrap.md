### Make development startup recording-ready

- **Issue:** [#650](https://github.com/metagrover/pluto/issues/650)
- **PR:** [#666](https://github.com/metagrover/pluto/pull/666)
- **Changed:** `pnpm run dev` now builds missing or stale Parakeet and audio-capture executables before launch, while Pluto's setup and returning-user readiness surfaces own model download and verified readiness. During transfer they show exact total size, downloaded bytes, percentage, and current speed.
- **Why:** A clean checkout could reach the app without `audiocap`, and a roughly 1 GB model preparation could begin behind a generic checking screen with no evidence that it was progressing.
- **Replaced:** The separate contributor `build-native` prerequisite and the readiness status call that performed model preparation.
- **Notes:** Current signed native executables are reused on later starts. Packaged apps continue to bundle native runtimes; the pinned ASR, CTC, and EOU models remain app-managed user data. Transfer telemetry comes from the pinned repository trees and actual downloader byte callbacks; integrity verification is a separate visible phase with no download-speed claim.

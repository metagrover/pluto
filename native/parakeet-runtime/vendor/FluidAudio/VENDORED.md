# Vendored FluidAudio

- Upstream: https://github.com/FluidInference/FluidAudio
- Tag: `v0.15.5` (release version `0.15.5`)
- Revision: `19600a485baa4998812e4654b70d2bab8f2c9949`
- Vendored for: Pluto issue #630

This directory contains the complete SwiftPM package sources, tests, required resources,
Apache-2.0 `LICENSE`, and `ThirdPartyLicenses`. Repository metadata, build output, CI files,
supplemental documentation, scripts, CocoaPods metadata, and promotional assets are excluded
because they are not required to build, test, attribute, or maintain the Swift package.

## Pluto patch

Modified upstream files:

- `Sources/FluidAudio/ASR/Parakeet/SlidingWindow/SlidingWindowAsrManager.swift`
- `Sources/FluidAudio/Shared/AppLogger.swift`
- `Tests/FluidAudioTests/ASR/Parakeet/SlidingWindow/SlidingWindowAsrManagerTests.swift`

Added files:

- `Sources/FluidAudio/ASR/Parakeet/SlidingWindow/SlidingWindowIngestionReport.swift`
- `Tests/FluidAudioTests/Shared/AppLoggerTests.swift`

The patch adds serialized acknowledged ingestion reports, exact center-sample coverage,
detailed deterministic finish reporting, finite failure reasons, ingestion-mode fencing,
generation-fenced finish/cancel/reset quiescence, and a thread-safe process-wide logging gate
with cancelled-recognizer tail suppression. Logging defaults to disabled process-wide. Transcript
text and vocabulary replacement values were removed from the sliding-window logger calls.

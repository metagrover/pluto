# Noisy Swift Binary Path Plan

**Goal:** Let a successful Parakeet build proceed when Swift prints planning output before its binary directory, without weakening the build-root containment check.

- [x] Add failing tests for noisy output, empty/relative/missing paths, and a symlink escape.
- [x] Resolve the final non-empty output line and canonicalize both candidate and expected `.build` root.
- [x] Make the Parakeet build script use the tested resolver.
- [x] Run focused and full verification, then exercise the real build and current-runtime skip path.
- [x] Commit, push, open a PR, and update issue #669.

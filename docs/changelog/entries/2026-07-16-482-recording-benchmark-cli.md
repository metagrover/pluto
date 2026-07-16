### Restore the committed recording-quality benchmark CLI on `master`

- **Issue:** `#482`
- **PR:** `(pending)`
- **Changed:** `pnpm run benchmark:recording-quality` now resolves the transcription backend helpers through explicit TypeScript runtime paths, so the committed synthetic benchmark corpus runs successfully again under Pluto's current Node `--experimental-strip-types` execution path.
- **Why:** The benchmark command had regressed on current `master` and crashed before exercising any cases, which removed a core regression gate from the recording-trust foundation in `#443`.
- **Replaced:** A broken CLI path that exited with `ERR_MODULE_NOT_FOUND` while loading `src/utils/recordingFinalization.ts`.
- **Notes:** This is intentionally limited to runtime wiring and benchmark verification coverage; it does not add new benchmark cases or tolerance-gating behavior.

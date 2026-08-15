# Onboarding Issues and Fixes

This doc captures setup issues we hit on macOS during initial onboarding and the fixes that worked. Use it as a checklist when someone new sets up the project.

## 1) MLX transcription is unavailable

**Symptoms**

- The transcription health endpoint reports `engine: unavailable`.
- Startup reports that MLX Whisper is unavailable.

**Root cause**

- Pluto transcription currently requires an Apple Silicon Mac and the project-managed Python environment.

**Fix**

- Verify `uname -m` reports `arm64`, then rebuild the managed environment.

**Commands**

```bash
pnpm run setup-python
```

MLX is the live-preview recognizer only. Canonical final transcription uses the separately managed Parakeet runtime.

## 1a) Parakeet final transcription is unavailable

**Symptoms**

- Final validation remains retryable with a Parakeet preparation or runtime reason.
- The provisional transcript remains visible and analysis does not start.

**Fix**

Verify Apple Silicon and rebuild the signed native executable:

```bash
pnpm run build:parakeet
```

On first use, allow Pluto to download its pinned Parakeet and CTC Core ML bundles. Pluto does not reuse Hex or another application's cache. Do not replace this failure path with whole-session MLX; the process boundary is intentional.

Private quality manifests contain absolute paths only and must stay outside version control. Validate one without printing content or paths:

```bash
pnpm run benchmark:private-transcription:validate -- --manifest /absolute/private/manifest.json
```

To replay recent local meetings and create an owner-only blind-review page, keep the output under Pluto's private application-data directory:

```bash
pnpm run benchmark:private-parakeet -- \
  --runtime /absolute/path/to/resources/bin/parakeet-runtime \
  --database /absolute/private/pluto.db \
  --model-root /absolute/private/models/transcription/parakeet \
  --audio-root /absolute/private/meetings \
  --limit 5 \
  --review-cases 24 \
  --review-out /absolute/private/evaluations/parakeet-review.html
```

The console emits aggregate metrics only. The review page contains private audio references and transcript excerpts, is written with owner-only permissions, must remain outside the repository, and exports content-free A/B ratings. Keep the adjacent hidden-assignment manifest private until the review is complete, then score the exported ratings against it:

```bash
pnpm run benchmark:private-parakeet:review -- \
  --ratings /absolute/private/parakeet-review-ratings.json \
  --manifest /absolute/private/evaluations/parakeet-review.html.manifest.json
```

To exercise the persisted service workflow without mutating the production database, run the guarded manual test with absolute local paths supplied through `PLUTO_E2E_*` environment variables. The test always creates its own process-unique user-data directory and ignores any `PLUTO_E2E_USER_DATA_DIR` value:

```bash
RUN_PARAKEET_APPLICATION_WORKFLOW=1 \
PLUTO_E2E_SOURCE_DATABASE=/absolute/private/pluto.db \
PLUTO_E2E_PARAKEET_RUNTIME=/absolute/path/to/parakeet-runtime \
PLUTO_E2E_PARAKEET_MODEL_ROOT=/absolute/private/models/transcription/parakeet \
PLUTO_E2E_AUDIO_ROOT=/absolute/private/meetings \
pnpm exec vitest run --config vitest.manual.config.ts tests/manual/parakeetApplicationWorkflow.test.ts
```

The source database and audio are read-only. All provisional, validation, canonical, and downstream writes go to the isolated database. The test compares content-free SHA-256 values internally and never prints transcript text or digest values.

## 2) Electron native module ABI mismatch (NODE_MODULE_VERSION)

**Symptoms**

- App fails to load with errors like:
  - `NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 143`
  - Often with `better-sqlite3.node`

**Root cause**

- Native modules were compiled against a different Node/Electron ABI than the runtime (Electron 40 expects ABI 143).

**Fix (recommended)**

```bash
rm -rf node_modules
pnpm install
npx electron-rebuild -f -w better-sqlite3
```

**Alternative**

```bash
pnpm exec electron-rebuild -f -w better-sqlite3
```

**Node test / script fallback**

If a plain Node-based command still reports `Could not locate the bindings file`, rebuild `better-sqlite3` for the current Node runtime:

```bash
pnpm rebuild better-sqlite3
```

Default contributor verification uses `pnpm run lint` and `pnpm test -- --run`. Local database / provider probe tests now live behind `pnpm run test:manual` so contributors do not need a warmed personal database to get a green baseline.

## 3) Swift build error: duplicate method redeclaration

**Symptoms**

- `invalid redeclaration of 'stream(_:didStopWithError:)'` in `resources/swift/AudioRecorder.swift`

**Fix**

- Remove the duplicate `stream(_:didStopWithError:)` implementation so it appears only once.

## 4) Xcode Command Line Tools

**Check if installed**

```bash
xcode-select -p
xcodebuild -version
```

**Install if missing**

```bash
xcode-select --install
```

## Suggested setup order (macOS)

1. Install Xcode Command Line Tools (if missing)
2. `pnpm install`
3. `pnpm run setup-python`
4. `pnpm run build-native`
5. `pnpm run lint`
6. `pnpm test -- --run`
7. If MLX is unavailable: verify Apple Silicon and re-run `pnpm run setup-python`
8. If Electron throws ABI mismatch: run `pnpm exec electron-rebuild -f -w better-sqlite3`

## Code Formatting with Biome

This project uses [Biome](https://biomejs.dev/) for code formatting and linting.

**Configuration**

- Biome config: `biome.json` at project root
- Biome runs as part of the pre-commit hook via Lefthook
- Pre-commit hook runs `biome check {staged_files} --write` on staged files only

**Manual Usage**

```bash
# Check for formatting issues
pnpm run check

# Auto-fix formatting issues
pnpm run fix
```

**Pre-commit Hook**

When you commit, Lefthook automatically:
1. Runs `biome check` on staged JavaScript, TypeScript, and JSON files
2. Auto-fixes formatting issues with the `--write` flag
3. Re-stages the fixed files

If Biome finds issues during commit, they will be automatically fixed. You may need to re-stage and commit again if files were modified.

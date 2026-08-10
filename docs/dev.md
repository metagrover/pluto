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

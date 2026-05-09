# Onboarding Issues and Fixes

This doc captures setup issues we hit on macOS during initial onboarding and the fixes that worked. Use it as a checklist when someone new sets up the project.

## 1) WhisperX install fails with `ModuleNotFoundError: No module named 'pkg_resources'`

**Symptoms**

- `Getting requirements to build wheel did not run successfully`
- Stack trace ends with: `ModuleNotFoundError: No module named 'pkg_resources'`
- Often appears while installing `git+https://github.com/m-bain/whisperx.git@v3.3.1`

**Root cause**

- `setuptools` 82 removed `pkg_resources`. WhisperX (or its build step) still imports it.

**Fix**

- Pin setuptools to `<82` and keep that pin in place for installs.

**Commands**

```bash
source python/venv/bin/activate
pip install --force-reinstall "setuptools<82" wheel
```

If installing requirements manually:

```bash
PIP_CONSTRAINT=python/constraints.txt pip install -r python/requirements.txt
```

## 2) `pnpm install` reintroduces the WhisperX error

**Symptoms**

- `pnpm install` runs `pnpm run setup-python` (via `postinstall`) and reinstalling requirements re-upgrades `setuptools` back to 82.

**Fix**

- `scripts/setup_python.sh` now pins `setuptools<82` and applies `python/constraints.txt` automatically.
- If you still see the error, re-run:

```bash
pnpm run setup-python
```

## 3) Electron native module ABI mismatch (NODE_MODULE_VERSION)

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

## 4) Swift build error: duplicate method redeclaration

**Symptoms**

- `invalid redeclaration of 'stream(_:didStopWithError:)'` in `resources/swift/AudioRecorder.swift`

**Fix**

- Remove the duplicate `stream(_:didStopWithError:)` implementation so it appears only once.

## 5) Xcode Command Line Tools

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
7. If WhisperX fails: pin `setuptools<82` (see above) and re-run `pnpm run setup-python`
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

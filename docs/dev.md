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

## 2) `npm install` reintroduces the WhisperX error

**Symptoms**
- `npm install` runs `npm run setup-python` (via `postinstall`) and reinstalling requirements re-upgrades `setuptools` back to 82.

**Fix**
- `scripts/setup_python.sh` now pins `setuptools<82` and applies `python/constraints.txt` automatically.
- If you still see the error, re-run:
```bash
npm run setup-python
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
npm install
npx electron-rebuild -f -w better-sqlite3
```

**Alternative**
```bash
npm rebuild better-sqlite3 --runtime=electron --target=40.0.0 --dist-url=https://electronjs.org/headers
```

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
2. `npm install`
3. If WhisperX fails: pin `setuptools<82` (see above) and re-run `npm run setup-python`
4. If Electron throws ABI mismatch: run `npx electron-rebuild -f -w better-sqlite3`


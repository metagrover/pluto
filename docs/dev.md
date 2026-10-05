# Development troubleshooting

Start with the installation steps in [README.md](../README.md). Use the sections below for specific runtime or verification problems.

Internal recovery tools, including the voice candidate backfill, are documented
in [scripts/README.md](../scripts/README.md). These are developer maintenance
commands, not user-facing settings or routine setup requirements.

## Source startup and local profiles

`pnpm start` and `pnpm dev` both prepare the native runtimes and launch source
Pluto with hot reload. On macOS both use `~/Library/Application Support/pluto` by
default, so changing commands does not change the visible meetings. No installed
app, signing certificate, or exported recovery key is required. A fresh profile
first shows a native welcome step with a one-time Standard or Encrypted database
choice, before the usual setup wizard. Standard setup does not create or access
a database key. Encrypted setup obtains key-storage permission before creating
the database; denied permission permits retrying or choosing Standard setup.
Existing databases retain their format and skip this choice. Encrypted profiles
reuse their original keys, and macOS may request Keychain access.

The choice is shown read-only in Advanced settings and is recorded in
`database-storage.json` for new profiles. Do not edit that file to switch formats;
format mismatches or a missing database in a completed profile stop startup
without resetting data. Saved cloud-provider keys use secure storage with either
setup. Empty credential checks do not request Keychain access, but saving or
reading a credential may do so.

Development startup uses a cached `Pluto.app` copy of Electron under ignored
`node_modules` so the macOS menu bar shows Pluto. It leaves the installed Electron
dependency untouched and recreates the copy when the Electron binary changes.

For an isolated profile, set `PLUTO_USER_DATA_DIR` to a separate absolute directory
before either command. Previously isolated meetings at
`/tmp/pluto-development-profile` stay there; use that explicit override to reopen
them. Startup does not move, merge, or delete existing profiles.

If unlocking fails, resolve Keychain access with the original runtime; do not
delete the database or key envelope. Encrypted databases with missing or rejected
keys stop startup without being reset. Envelopes bound to a signed distribution
identity still require that signed app; source startup cannot silently unwrap
those keys. Existing explicit recovery files remain supported but are never
created or removed automatically. Keys are local and must not be committed to Git.

## 1) Parakeet transcription is unavailable

**Symptoms**

- Final validation remains retryable with a Parakeet preparation or runtime reason.
- The provisional transcript remains visible and analysis does not start.

**Fix**

Verify Apple Silicon and rebuild the signed native executable:

```bash
pnpm run build:parakeet
```

On first use, allow Pluto to download its pinned Parakeet and CTC Core ML bundles. Pluto does not reuse Hex or another application's cache.

Private quality manifests contain absolute paths only and must stay outside version control. Validate one without printing content or paths:

```bash
pnpm run benchmark:private-transcription:validate -- --manifest /absolute/private/manifest.json
```

For a dual-source live-transcript fixture, validate the guarded EOU manifest and
run the production renderer-session replay with explicit opt-in:

```bash
pnpm run benchmark:private-parakeet-eou:validate -- \
  --manifest /absolute/private/eou-manifest.json

RUN_PARAKEET_EOU_CAUSAL_REPLAY=1 \
PLUTO_PRIVATE_PARAKEET_EOU_MANIFEST=/absolute/private/eou-manifest.json \
pnpm run replay:parakeet-eou
```

The EOU recognizer currently has one production configuration. The runtime's
`--live-config` flag applies to its separate sliding-window live session and is
therefore intentionally not exposed by this EOU replay.

The EOU report contains aggregate transport, presentation, and resource metrics
only. `crossSourceDuplicatePeak`, `crossSourceDuplicateUpdates`, and
`crossSourceDuplicateVisibleMs` measure substantial time-overlapping passages
visible under both sources during replay, including a six-unit contiguous
subspan inside a longer locally owned passage. `settledCrossSourceDuplicates`
is the strict acceptance gate after recognition finishes. Transient duplicate metrics
remain diagnostic until the evidence-settlement budget is calibrated against
annotated local interruptions and held-out recordings.
The `echoEvidence` counters report content-free detector decisions, including
activity, independent microphone energy, similarity, compatible-window support,
and retained evidence. They are comparison counts rather than speech durations.
`recognition` compares settled live words with an independent final pass using a
sequence-aware count for each source. It is a diagnostic recall signal rather
than ground truth; listening-verified annotation is still required before
tuning recognition behavior.

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

The console emits aggregate metrics only. Canonical validation probes each actual source duration. Review cases are generated only from meetings whose persisted mic source is distinct from the persisted mixed artifact, whose mic and system durations align with the meeting timeline, and whose bounded excerpt contains recognized system speech. The review page contains private audio references and transcript excerpts, is written with owner-only permissions, must remain outside the repository, and exports content-free A/B ratings. Keep the adjacent hidden-assignment manifest private until the review is complete, then score the exported ratings against it:

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

**Fix**

For Electron, verify the binding and rebuild only if necessary:

```bash
pnpm run ensure:sqlite-abi
```

For Node/Vitest tests that report a binding or ABI error:

```bash
pnpm rebuild better-sqlite3
```

Run `pnpm run ensure:sqlite-abi` before returning to Electron. Development startup
also runs this check automatically.

Use `pnpm run lint` and `pnpm exec vitest run` for contributor verification.
Local database/provider probes are opt-in through `pnpm run test:manual`.

## 3) Xcode Command Line Tools

**Check if installed**

```bash
xcode-select -p
xcodebuild -version
```

**Install if missing**

```bash
xcode-select --install
```

Pluto's native build scripts verify that the active Swift compiler can import
the selected macOS SDK. If a Command Line Tools update leaves the default SDK
symlink temporarily incompatible, the scripts use the newest compatible SDK
already installed on the machine and keep the module cache in a writable
temporary directory. If no installed SDK works, update or reinstall Command
Line Tools before continuing.

## Capture continuity diagnostics

New recordings keep a bounded, content-free `capture-journal/diagnostics.json`
beside the capture journal. Counters cover native frames successfully written
to the pipe, bytes received/forwarded by Electron, renderer samples accepted,
packaged and trimmed, and raw/repair disk-write progress. Native heartbeat
messages reuse the existing watchdog every five seconds. Renderer counters
piggyback on existing microphone chunk writes. There is no per-frame logging,
new healthy-path timer, extra audio copy, database write, or provider request.

The report retains at most 120 progress records and 32 fault records, preserving
early faults and the latest faults. It saves asynchronously on at most four
faults and once on stop; report failures cannot reject capture or delay sealing.
Only numeric counters and fixed event codes are retained, not general stderr,
exceptions, paths, process IDs, audio, transcripts or participant identities.

Interpret sustained counter differences within the same `nativeRun`:

- Fresh native `framesWritten` advances, but Electron `bytesReceived` does not:
  investigate native pipe delivery/main-process responsiveness.
- Electron `bytesForwarded` advances, but renderer `samplesAccepted` does not:
  investigate renderer delivery, decoding or responsiveness.
- Renderer `samplesAccepted` advances but `samplesPackaged` does not, or
  `samplesTrimmed` rises: investigate interval packaging and delayed PCM.
- Disk `pending`/`pendingSinceMs` remains set or failure counters rise:
  investigate journal persistence rather than assuming source audio stopped.
- No fresh native heartbeat: native capture, its control queue, pipe backpressure
  and main-process responsiveness remain possible; a stale counter cannot
  establish which failed.

These are diagnostic clues, not capture-completeness or transcript-trust
evidence. Missing intervals must remain missing unless original captured audio
and its provenance can actually be recovered. Digital silence counts as valid
PCM transport. Historical recordings cannot acquire retrospective native
diagnostics.

The renderer warns after three seconds without valid PCM and allows the native
watchdog another three seconds before a bounded process restart. Recovery is
limited to two attempts per recording and fenced against stop and replacement
sessions. A detected recording interruption records `failed_during_capture` in the journal;
receiving PCM again restores current capture health but cannot clear the
historical interruption. Final transcription retains its incomplete-capture
check even when partially populated intervals are all marked captured.

Opt-in checks (no production database or microphone; synthetic fixtures only):

```bash
node scripts/verify_capture_continuity.mjs /tmp/pluto-capture-continuity-report.json
python3 scripts/verify_native_capture_health.py /tmp/pluto-native-capture-report.json
node scripts/benchmark_capture_health.mjs
```

The first uses a temporary Electron profile, real IPC, real journal writes and
saved-byte checks. It injects source stalls, delivery loss and a disk-write
failure, with accelerated health deadlines. It uses a synthetic producer and
sample clock; it does not exercise the full meeting UI, MediaRecorder interval
timing, Parakeet or model workload. The native check compiles HEAD and current
Swift sources, taps only a muted synthetic playback process, and discards
captured PCM while measuring transport, CPU and memory. The benchmark compares
healthy per-frame work against HEAD. Do not run timing comparisons alongside
other benchmarks; finite checks cannot guarantee zero overhead or reproduce
every macOS capture failure.

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

When you commit, Lefthook runs the dependency security audit and Biome checks on
staged JavaScript, TypeScript, and JSON files. Biome may write formatting fixes;
review and stage those changes before retrying the commit. See `lefthook.yml`
for the current hook configuration.

### Ask Pluto workflow acceptance

After `pnpm exec vite build` and `pnpm run ensure:sqlite-abi`, run:

```sh
ASK_PLUTO_WORKFLOW_ACCEPTANCE=1 pnpm exec electron scripts/verify_ask_pluto_workflows.cjs
```

This opt-in replay creates and removes a temporary Standard profile containing
only synthetic meetings. It exercises the built renderer/preload/main IPC path,
real database retrieval, and the configured Gemma model for assignment, retry,
broader search, and drafting. It then redirects only this test process's local
model transport to a controlled server for truncation, unavailability,
cancellation, and recovery. The installed app and its profile are untouched.
Results default to ignored `.private/ask-pluto-workflow-acceptance.json`;
`ASK_PLUTO_WORKFLOW_REPORT` selects another output path. This complements the
provider latency benchmark; it does not establish real-meeting correctness or
latency percentiles. Restore the Node SQLite ABI with `pnpm rebuild better-sqlite3`
before Node-based database tests, and the Electron ABI before returning to the app.

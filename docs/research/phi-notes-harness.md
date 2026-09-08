# Phi notes harness development

The candidate is opt-in and notes-specific. These commands exercise development
fixtures; they do not consume the frozen promotion holdout or select a default.
Run from the repository root with dependencies installed.

## Type and protocol checks

The regular application TypeScript configuration excludes manual tests and scripts.
Check the evaluator, manifest builder, fixtures, and integration entry explicitly:

```sh
pnpm exec tsc --noEmit -p tsconfig.notes-evaluation.json
```

For SQLite-backed Node tests, rebuild `better-sqlite3` first if its binding targets
Electron. Restore it with `pnpm run ensure:sqlite-abi` after testing.

```sh
RUN_PHI_NOTES_INTEGRATION=1 LOCAL_INTELLIGENCE_EVALUATION_DRY_RUN=1 pnpm exec vitest run --config vitest.manual.config.ts tests/manual/phiNotesIntegration.test.ts
```

This suite creates a private temporary profile, checks SQLite's actual database
path, and uses the real provider, source-first inventory/editor pipeline,
coordinator, database publication transaction, and downstream note packager.
Only the Electron profile API and Ollama transport are substituted. Dry mode
rejects any actual fetch. Transport substitutions are restored after each run.

The assertions cover:

- exact Phi digest admission, two-stage notes routing, and Gemma chat routing on
  the same provider configured with Gemma defaults;
- a single publication notification and current source provenance in persisted
  notes;
- generated notes reaching the correct project's downstream input package,
  with no leakage to an unrelated project having the same name;
- preservation of prior notes after a source edit, editor transport failure,
  cancellation, and a persisted interrupted run;
- explicit retry reaching publication after the fault is removed.

The interrupted-run test closes SQLite, reloads database modules, reopens the same
temporary database, and invokes startup recovery. It is not an OS process-kill,
Electron relaunch, or sleep/wake test.

## Downstream fixture contracts

The dry suite also passes paired generated meeting notes through the real idle
dreaming coordinator, Gemma provider request, output validator, and SQLite proposal
store. Six development fixtures cover owner/date correction, withdrawal, an unmet
condition, unrelated same-name projects, legitimate no-change, and a new commitment.
It verifies persisted proposals and completed run state, idempotent scheduling, and
cancellation when notes change or foreground activity interrupts automatic dreaming.
Explicit retry must converge without duplicate proposals.

The fixture oracle checks the expected current commitment and follows each proposal
excerpt through a visible note block's canonical source spans to its original
transcript revision. Mutation checks reject missing proposals, historical/wrong
owners and dates, unrelated meetings, and changed original transcripts. Expected
tasks use exact fixture text; this is deliberately not a general semantic judge.

Ollama responses in these tests are scripted. Passing establishes integration and
oracle sensitivity, not that either model actually chooses the correct proposal.
The six fixture cases and interruption tests are skipped in the real-provider smoke
mode below; that mode remains a single notes-publication smoke.

## Optional real-provider smoke

```sh
RUN_PHI_NOTES_INTEGRATION=1 pnpm exec vitest run --config vitest.manual.config.ts tests/manual/phiNotesIntegration.test.ts
```

This sends one synthetic development meeting through installed Phi and checks its
persisted publication and downstream package. The provider checks the frozen Phi
digest. It has a ten-minute notes deadline and removes its temporary database on
completion. The transport fault fixtures are skipped in this mode. This is a
functional smoke check, not a quality or latency benchmark; it produces no
promotion report. Never substitute private production transcripts for this fixture.

## Real Electron application driver

```sh
node scripts/run_phi_notes_application.mjs
```

This builds the current checkout, prepares and pins an Electron-compatible SQLite
binding, then launches real Electron processes against one newly created owner-only
temporary profile. Default mode leaves onboarding incomplete so boot-time capture
probes cannot run. Default smoke mode never accepts a production profile path,
starts a recording, downloads a model, or consumes held-out fixtures. A profile-bound random capability
is checked before database initialization; packaged or ordinary launches cannot
activate this route through a setting. Gemma remains the other-workload default.

The driver uses the app's actual preload and renderer IPC to seed a synthetic
meeting, publish Phi notes, observe a persisted running attempt, kill the process,
relaunch, inspect startup recovery, and retry. Additional trials edit the source or
cancel active generation and verify prior notes are unchanged. Repeated cancellation
is labeled as such: it is not scheduler preemption. Model-rejected retries are
preserved as failures, not retried until they happen to pass. The driver also exercises
one Gemma Ask request alongside notes; one Ask trial cannot establish the frozen p95
gate. Once native runtimes/models and permissions have been prepared for a controlled
session, `--allow-readiness-probes` opts into full UI startup and twenty cached
navigation samples per destination. That flag can run mic/system-audio boot probes;
do not use it on an uncontrolled desktop. Missing readiness fails the navigation
trial instead of bypassing the app's readiness gates.

The private output directory is printed at launch and retained for inspection.
It contains the SQLite database, phase logs, results, once-per-second resource and
run-state samples, plus a physical-request ledger with starts, responses, chunks,
and terminal errors. Starts/chunks are flushed before proceeding, including killed
attempts. HTTP observation does not replace model responses. Recording and long-run
acceptance remain explicitly excluded from the smoke report; no benchmark rankings
may be inferred from these instrumented diagnostic timings. A missing resource probe
or critical-pressure safety stop exits nonzero. Do not run concurrent model benchmarks.

September 8 live development finding: initial publication, abrupt process restart,
and cancellation retry succeeded. A source-edit trial preserved old notes correctly,
but Phi's retry promoted a reported status to a decision with an unsupported owner
placeholder and was rejected as `notes_writer_invalid`. A regression fixture verifies
that classification is still rejected and that the original text is acceptable as a
fact. Prompt-only clarifications tried during development did not resolve the failure
and were not retained. This is a known candidate failure, not an integration pass.

## Remaining controlled acceptance work

### Opt-in capture rehearsals

With operator permission for a controlled desktop, prepare a synthetic PCM WAV
and build native assets with `pnpm run build:parakeet` and
`pnpm run build:audio-cap`, then run:

```sh
node scripts/run_phi_notes_application.mjs --allow-readiness-probes --capture-seconds=240 --capture-workload=mixed --native-bin=/absolute/native/bin --model-root=/absolute/parakeet/models --audio-fixture=/absolute/synthetic-system.wav --microphone-fixture=/absolute/synthetic-mic.wav
```

Use `control` for recording without injected notes/Ask traffic. Each launch copies
models and native executables into a new private profile; the runtime cannot modify
the source assets. Both WAVs are copied and hashed. Chromium replays the microphone
fixture and `afplay` replays the system fixture into the real native tap. Use
distinct, alternating speech rather than offset copies of identical speech on both
channels: the latter is an attribution stress case, not a clean load control. Keep unrelated
audio/calls off the desktop. This is not hardware-microphone acceptance. The
audio-service sandbox is disabled only for this opted-in test process so it can
read the owner-only WAV; the ordinary application launch is unchanged.

Mixed mode schedules four notes jobs and eight Ask requests at fifteen-second
intervals, retaining every terminal outcome. The driver uses real start/stop
handlers, samples rendered transcript/health, and waits for persisted finalized,
validated transcription. Failed readiness, unavailable capture sources, failed
finalization, and convergence timeouts fail the run. Private resource telemetry
includes native-descendant/Ollama RSS as well as Electron metrics. Runtime failure
and interrupted evidence are retained. Native readiness also now normalizes the
configured and requested model roots identically, fixing the macOS `/private/var`
alias rejection without admitting unrelated or relative roots.

These are diagnostic rehearsals, even when configured for 1,800 seconds. Marker
alignment, zero-loss/chunk-integrity adjudication, settled paired baselines,
navigation, and twenty-sample responsiveness gates are not implemented by this
entry and remain explicitly unscored. Eight Ask requests with missing first-useful
content do not form a passing p95. Do not substitute successful lifecycle completion
for sustained acceptance or model-quality evidence.

### Opt-in OS sleep/wake

```sh
node scripts/run_phi_notes_application.mjs --sleep-wake
```

This is a separate non-recording trial. It first publishes valid synthetic notes,
then waits for a `sleep-cue` file in the printed private profile. Create that cue
only once an operator has explicitly agreed to wake the Mac manually. The driver
observes a persisted running notes attempt before calling `pmset sleepnow`, requires
actual Electron suspend/resume events, records their measured interval, and checks
publication identity plus an explicit retry. Resource sampling is explicitly paused
and recorded for the sleep interval; it is not zero-filled or a sustained-resource
pass. A failed command, absent event pair, stale publication, or failed retry fails
the trial. No automatic wake is scheduled. Do not combine this mode with capture.

### Explicitly authorized read-only production sources

```sh
node scripts/read_phi_notes_sources.mjs /absolute/production/pluto.db
pnpm exec tsx scripts/check_phi_notes_source_capacity.ts /printed/private/directory/sources.json
```

The first command requires explicit permission to read production meetings. It
never launches the app on that profile, initializes/migrates SQLite, checkpoints a
WAL, reads existing generated notes/settings, or changes meeting rows. It uses an
immutable read-only connection with `query_only`, refuses pending WAL/journal
writes, and verifies the database inode, size, modification time, and hash after
reading. Active sources require a separately supplied consistent snapshot; this
command will not create one by mutating production. Source-only rows go to a new
owner-only temporary directory, never Git. Child-process/parser errors are scrubbed
of partial private output.

The second command checks the frozen 16K candidate preflight against those private
development sources with a callback that throws before provider access. It makes
zero physical requests. Admission is not generation success, quality, or promotion
evidence. Existing notes are deliberately excluded to avoid answer leakage. These
sources are not imported into the synthetic-only application activation or counted
as the frozen held-out corpus.

The existing `RUN_LOCAL_INTELLIGENCE_MIXED_WORKLOAD=1` entry supports dry scenario
inventory only. Requesting its non-dry mode now fails explicitly instead of exiting
with all tests skipped. Use the application driver above for the implemented
renderer/IPC and process-restart path.

Model-generated downstream proposal/commitment adjudication, a fixed human-reviewed
notes control, 30-minute recording comparisons, sustained resource acceptance,
and complete repeated-preemption recovery still require implementation and
execution. Running mic/system capture and OS sleep on an active user desktop
requires a controlled session; neither happens in default smoke mode. The separate
opt-in sleep/wake trial above has been executed for one brief OS event pair.
The paired
held-out model evaluation and blinded human review remain separate subsequent
work, governed by the frozen plan in issue #788.

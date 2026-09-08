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
probes cannot run. It never accepts a production profile path, starts a recording,
downloads a model, or consumes held-out fixtures. A profile-bound random capability
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

The existing `RUN_LOCAL_INTELLIGENCE_MIXED_WORKLOAD=1` entry supports dry scenario
inventory only. Requesting its non-dry mode now fails explicitly instead of exiting
with all tests skipped. Use the application driver above for the implemented
renderer/IPC and process-restart path.

Model-generated downstream proposal/commitment adjudication, a fixed human-reviewed
notes control, 30-minute recording comparisons, sustained resource acceptance,
sleep/wake, and repeated scheduler preemption still require implementation and
execution. Running mic/system capture and OS sleep on an active user desktop
requires a controlled session; the smoke driver deliberately does not perform them.
The paired
held-out model evaluation and blinded human review remain separate subsequent
work, governed by the frozen plan in issue #788.

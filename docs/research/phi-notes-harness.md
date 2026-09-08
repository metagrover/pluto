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
Electron relaunch, or sleep/wake test. The downstream assertion checks packaging;
it does not establish proposal quality or commitment extraction accuracy.

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

## Remaining acceptance work

The existing `RUN_LOCAL_INTELLIGENCE_MIXED_WORKLOAD=1` entry supports dry scenario
inventory only. Requesting its non-dry mode now fails explicitly instead of exiting
with all tests skipped. Use the provider/publication smoke above for the implemented
integration path.

Full downstream proposal/commitment adjudication, renderer/IPC orchestration,
30-minute recording comparisons, resource sampling, process crash, sleep/wake,
and repeated preemption still require implementation and execution. The paired
held-out model evaluation and blinded human review remain separate subsequent
work, governed by the frozen plan in issue #788.

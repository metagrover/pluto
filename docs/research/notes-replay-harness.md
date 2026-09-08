# Production-path notes development replay

Phi-specific notes development is parked. This harness exercises the existing
Gemma unified-provider route without changing production records or model routing.
The synthetic Electron capture/recovery driver remains separate; this command is
not a full application, held-out quality, or sustained performance acceptance test.

## Run

Use an explicitly owner-authorized, source-only export of the latest ten meetings.
The export must be an absolute owner-only (`0600`) file produced by the immutable
reader. Reuse the same frozen export for a development comparison; do not silently
replace ineligible meetings with older ones.

```sh
pnpm exec tsx scripts/run_notes_replay.ts /absolute/private/sources.json --run
pnpm exec tsx scripts/summarize_notes_replay.ts /printed/private/run-directory
pnpm exec tsx scripts/replay_notes_response_case.ts /printed/private/run-directory 3
```

The run directory is `0700`, with `0600` artifacts. No application DB, settings,
existing generated notes, migrations, recording, or publication are loaded. User
notes and entity hints are deliberately empty, making this a transcript-only
provider baseline rather than an exact reproduction of every production input.

The manifest freezes input bytes, installed model digest, important code hashes,
ten scheduled source IDs (hashed), context, and production review/deadline policy.
The provider uses compact writer plus editor, not Phi source-first reconciliation.
Local Ollama is the only allowed transport; redirects, wrong generation models,
wrong context sizes, and malformed/incomplete streams fail closed.

Each physical attempt has a fsynced request, exact streamed response bytes (also
for rejected output), headers and terminal events. Stage events remain separate.
Every meeting terminal and partial results report is durable. The summarizer
reconstructs the entire denominator after interruption: no terminal record is not
success, nor does it prove a currently running process has crashed. Missing
physical terminals remain censored at observation. An incomplete final JSONL
append is disclosed, not invented or silently treated as a terminal.

The response replay command makes zero provider requests. It verifies pipeline
hashes and exact prompt/schema/output-budget matches, then reproduces validation
and compares the serialized result (ignoring only its generation timestamp).
It refuses incomplete attempts, unknown model responses, changed prompts, and
unused/missing attempts rather than silently making a new request. It is not a
replay of wall-clock deadlines, scheduler preemption, or publication.

## Review

Accepted-in-replay is a pipeline outcome, never a quality verdict. Each accepted
case gets a private source/notes review document and mechanical triage:

- missing/stale/out-of-range visible provenance;
- pipeline quality warnings, including guarded fallback;
- literal text copied from elsewhere in the source while citing a different span;
- a high ratio of verbatim points suggesting a transcript dump.

These conservative heuristics do not establish entailment, critical recall,
ownership correctness, or usefulness. Paraphrases are not rejected merely for
failing literal matching. Even clean triage stays `pending_review` with
`qualityApproved: false`.

Review the canonical source independently for key facts, decisions, accepted
commitments, owners/dates, unresolved questions, cancellations/corrections and
source defects. Then compare the visible notes and exact citations. Record
source-grounded reasons for omissions, unsupported claims, and poor synthesis.
Do not score noisily transcribed speech as recoverable truth. Gold expectations
for future acceptance must be frozen before reading candidate outputs and kept
separate from this development set. Blinded human review remains a later gate.

Resource admission and a five-second sampling loop require at least 10% reported
memory headroom, no thermal/performance warning, and at most 512 MiB swap growth
relative to the run baseline. Missing telemetry stops the run. A safety stop or
operator signal cancels the owned request and leaves subsequent cases unstarted;
it never kills the shared Ollama daemon or other applications. Preexisting swap
alone is not a failure. These conservative thresholds are execution safeguards,
not evidence of a passing sustained-resource benchmark.

Existing resident models, other
applications, and instrumented disk I/O mean these timings are not clean isolated
model benchmarks. The shared harness must improve the production notes experience,
not become an open-ended model-selection project.

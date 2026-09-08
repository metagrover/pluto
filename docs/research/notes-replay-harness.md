# Production-path notes development replay

This model-neutral harness exercises the existing Gemma unified-provider route
without changing production records or model routing. It is not a full
application, held-out quality, or sustained performance acceptance test.

## Run

Use an explicitly owner-authorized, source-only export of the latest ten meetings.
The export must be an absolute owner-only (`0600`) file produced by the immutable
reader. Reuse the same frozen export for a development comparison; do not silently
replace ineligible meetings with older ones.

```sh
node scripts/read_notes_sources.mjs /absolute/source/pluto.db
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
The provider uses the production compact writer plus editor.
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
unused/missing attempts rather than silently making a new request. It advances a
discrete clock at recorded request boundaries so optional review admission
accounts for time already spent. This is not an OS-timer, scheduler-preemption,
or publication simulation. When recorded, full private error details must match
as well as the normalized outcome label. Failed offline checks are appended to
a private error journal.

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

## Isolated runtime-cache diagnosis (macOS)

Sequential requests can still accumulate runtime memory: the installed Ollama
0.33.3 llama-server retained historical prompts and their context checkpoints in
a separate RAM cache. In the original development run its reported cache grew
from zero to 5420 MiB, with an 8192 MiB limit. This is not the active KV cache,
and the model size reported by `/api/ps` is not a complete process-memory budget.
The safety stop is system-wide swap growth, not proof of a model memory leak.

For an explicitly authorized diagnostic comparison, first ensure the shared
runtime has no loaded models or active work. The launcher refuses loaded models;
it never unloads them automatically. Then run:

```sh
pnpm exec tsx scripts/run_notes_cache_isolation.ts /absolute/private/sources.json --run
```

This starts the installed macOS Ollama binary on `127.0.0.1:11435` with
`LLAMA_ARG_CACHE_RAM=0`, `LLAMA_ARG_CTX_CHECKPOINTS=0`, one parallel slot, one loaded model, cloud disabled and
startup model pruning disabled. It reuses local model files without changing
production configuration. The replay's fixed diagnostic transport also sends
`use_mmap: true`, matching the original worker's memory-mapped load; a fresh
daemon otherwise selected eager-copy loading on this machine. Model identity,
context, prompts, generation budgets and resource guards remain unchanged.

The launcher prints a private runtime-evidence directory containing its requested
configuration and daemon log, separately from the replay directory. Verify the
actual startup log says `prompt cache is disabled` and `load_mode = mmap`;
requested environment variables alone are not configuration proof. Verify no
context checkpoints are created. Active-slot checkpoints still existed with
historical caching alone disabled; that intermediate comparison remains a
separate, preserved attempt rather than being relabeled as this configuration.
Only the launcher's own daemon process group is terminated on exit. Normal
production replay still uses port 11434 and does not override memory mapping.

Retain every failed loading attempt. Record startup versus steady-state samples,
process RSS, dirty footprint, clean mapped memory and cache occupancy separately;
do not add overlapping memory measurements or equate free percentage with an
available model budget. An isolated endpoint alone does not establish a clean
system benchmark. Compare repeated sequential requests before claiming stable
memory, and keep performance findings separate from note-quality acceptance.

Generation is explicitly serial: the transport rejects a second generation
while the first stream remains outstanding. Summaries report the maximum number
of outstanding physical requests. A missing terminal leaves a request outstanding;
that ledger upper bound is not proof of simultaneous server execution.

See [the measured runtime diagnosis](2026-09-08-gemma-runtime-memory.md) for the
separate failed attempts, complete sequential run, and remaining quality limits.

## Historical evidence and cleanup

The recorded development runs predate removal of the experimental application
changes from PR #794. Their manifests identify the code that actually ran; they
are not fresh inference evidence for the cleaned branch. Exact response replay
must reject a changed code hash. Do not rewrite manifests or relax that check to
reuse older results against a different implementation.

## Next latency experiment (not implemented)

Compare the unchanged production path with one concise streamed Markdown draft,
using the same frozen sources, model, context and runtime profile. Measure time
to first visible text separately from total completion, prompt/output token
counts, physical requests, capacity failures and source-grounded quality.
Streaming alone does not reduce required model work. Test reducing repeated
generation passes, retaining source references and deterministic validation,
with model repair only on a demonstrated validation failure. Partial text must
remain a provisional draft, not approved notes or downstream commitments.
No default-route change is justified by responsiveness alone.

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

## Development latency comparisons

The same frozen ten-row schedule can now run selected cases without rereading
the production database. Unselected rows remain explicit `not_selected` entries.
These options affect only the diagnostic process:

- `NOTES_REPLAY_CASES=9,10`: selected one-based case numbers, always serial.
- `NOTES_REPLAY_MODE=production|markdown`: existing structured pipeline (default)
  or a single-pass provisional Markdown comparison. Neither publishes notes.
- `NOTES_REPLAY_MODEL=gemma4:12b|qwen3.5:4b`: installed model, digest verified.
  “production” names the pipeline, not approval of an overridden model.
- `NOTES_REPLAY_CONTEXT=16384|24576|32768`: default 16K; Markdown is fixed at 16K.
- `NOTES_REPLAY_KV_CACHE_TYPE=f16|q8_0`: isolated daemon only, default f16.
  The launcher enables flash attention and checks actual K/V types in its log.
- `NOTES_REPLAY_LOAD_MODE=mmap|none`: isolated loading comparison, default mmap.
  The actual load mode must match the requested profile.

Do not promote these diagnostic overrides to application defaults merely because
a run completes. In particular, the 32K Gemma trials hit the resource guard.
The guard is unchanged; failed startup and incomplete output stay in the ledger.

Markdown packs every original source segment into lossless labelled passages.
It does not discard the transcript middle or tail. Mechanical citation triage
does not establish entailment, correct ownership, coverage, or note quality.
Provisional fragments stay in private evidence files, never the application UI,
database, or downstream commitments. Input truncation and context shifting are
explicitly disabled; over-capacity source is rejected.

Development evidence on the 16GB Mac found a genuine latency/quality tradeoff:
the historical structured Gemma run took 8m40s for one 31-minute meeting.
Single-pass Gemma Markdown with 16K/q8 completed the eight eligible cases without
a resource stop; the two long cases took 2m23s and 1m50s. Source review still found
ownership, omission, and action/decision errors. The smaller-model Markdown
comparison was faster but also made material factual errors. A smaller-model
structured comparison took 2m21s for the 31-minute case and passed pipeline
validation, yet still omitted an important deadline and used ambiguous ownership.
None of those results is quality approval or an average production latency.

Measure first answer text separately from reasoning and complete output.
Streaming changes when text appears, not the amount of inference required.
Keep physical token/timing metrics, resource outcomes, pipeline acceptance,
source-grounded review, and actual UI publication as separate measurements.

The minified-wire 16K/q8 development run reduced the short case from a historical
618 generated tokens to 260 (59s to 41s). The 31-minute case still took 8m18s:
three writers and two editors, versus the historical 8m40s with three writers and
one editor. The optional-review budget consumed some savings on additional review.
Do not turn reduced writer token counts into a claim of proportional end-to-end
speedup. Larger 12,000-character leaves took 7m26s but retained an ownership
error; that change was reverted, and its next case was intentionally cancelled.

The production cache regression is separate: live precomputation previously used
the legacy full draft and a different partitioner, while final generation used
the compact contract. A failing-then-passing test now proves reuse with the real
bounded planner, retained final reviews, and invalidation of corrected source.
This does not prove reuse across live-to-canonical transcription changes in an
actual recording, nor eliminate cold generation cost for historical meetings.
Compact precomputation also skips meetings whose current source still fits the
direct writer/editor pair. The final short q8 smoke test completed and reproduced
exactly offline; an f16 long-case retry stopped on resource pressure during
startup. These are not evidence of sustained production performance.

The isolated launcher holds a temporary idle-sleep assertion only for its own
lifetime; it never changes persistent power settings or blocks explicit sleep.
Monitoring gaps over 30 seconds, backwards wall-clock jumps, and changes between
AC/battery stop the run. Summaries also detect gaps in historical ledgers without
rewriting their original outcomes. A 24K attempt interrupted by macOS idle sleep
and its retry interrupted by AC-to-battery transition are contaminated tests, not
evidence that the 24K profile is fast, slow, or capacity-safe.

Timing fields have separate meanings: `elapsedMs` and `firstAnswerMs` are host
wall-clock milliseconds; Ollama's `*_duration` metrics remain nanoseconds.
First answer text is not approved or visible application notes. A
`no_recorded_gap` summary means only that the ledger has no detected gap above
the threshold, not that a workload or quality gate passed. A completed schedule
may still contain failed, ineligible, or unselected meetings.

The uninterrupted 24K/q8 diagnostic completed the long case in 423,954 ms with
two serial calls: 210,936 ms of prompt evaluation and 209,406 ms of decoding.
No resource or timing-continuity stop was recorded. Exact offline replay passed,
but manual source review still found stale timing and missing follow-ups; this
does not promote the context profile or establish a representative average.

`NOTES_REPLAY_CONTEXT_REUSE=1` is an isolated diagnostic opt-in. An immediately
completed writer can become the exact conversation prefix for its editor only
when source blocks and model/context match. The original source stays verbatim
in the first message; the raw writer response and current canonical editor draft
remain untrusted. The whole conversation must fit the conservative input/output
budget. Otherwise the original standalone editor request is sent. Failed calls
and meeting changes cannot seed reuse. Captures contain the actual wire messages;
offline replay reconstructs them and checks the continuation helper's hash.
This is a cache-reuse hypothesis, not a claimed cache hit or app default.

The first continuation trial was deliberately cancelled after runtime logs
proved full prompt reprocessing: the rendered answer prefix differed and no
sliding-window checkpoint was available. Its partial editor is not a completed
latency sample. `NOTES_REPLAY_CHECKPOINTS=1` permits exactly one context checkpoint
in the isolated launcher (default zero); the historical multi-prompt RAM cache
remains disabled. A subsequent trial restored a 170 MiB checkpoint and finished
in 352,990 ms. Editor prompt processing was 45,315 ms versus 115,830 ms in the
earlier standalone-editor run, with no resource stop. Different generated drafts
and power conditions mean this is not a controlled total-latency speedup estimate.
Offline replay reproduced the result, but missing follow-ups remained. The
launcher initially flagged its old zero-checkpoint-only postcondition after that
completed run; validation now checks the explicitly requested zero/one profile.
Neither the experiment nor the validation repair changes application defaults.

The broader smaller-model follow-up was stopped early on quality: the first
eligible case omitted an approval gate and scheduled follow-up retained by the
Gemma baseline, and the next case failed the notes guardrail. Those two outcomes
reproduced offline. A short subsequent case completed; the next partial request
was deliberately cancelled. This is not a completed eight-case comparison.

Production now has an ephemeral section-level draft preview, not raw-token
Markdown publication. The harness records `draft_preview_ready` events and
`firstDraftMs` separately from physical first-answer text and final completion.
A fresh short Gemma/q8 run produced a draft at 21,278 ms and completed at
42,321 ms; offline result replay matched exactly. Cache regression tests expose
two matching precomputed sections before any new model request, then the final
section after one writer call, while retaining all three final reviews.
Neither the short replay nor that exact-source test proves capture-to-canonical
cache reuse in a real recording. Cold historical long-meeting completion remains
minutes rather than instantaneous.

## Saved live-to-final cache identity inspection

Run `pnpm exec tsx scripts/inspect_notes_live_reuse.ts /absolute/private/sources.json`
against an existing owner-only latest-ten export. This does not open the database,
invoke a model, or replay historical capture/admission timing. It reconstructs the
saved live snapshot's event-time sorting and adjacent-speaker merging, then uses
the actual precompute/final planners and cache keys with explicitly synthetic
responses. Positive-control tests require genuine exact-key reuse; corrected
source must miss. Output is a private content-free report with source/code hashes.
Synthetic guardrail outcomes are not model-quality results.

The frozen ten-row inspection retained two ineligible sources in its denominator.
Of eight eligible saved live snapshots, six fit the direct path and therefore
skip precomputation. The two long snapshots plan four leaves, above the existing
three-leaf limit, and also skip precomputation. No live packets were cached in
this saved-final-snapshot probe. This does not prove that every earlier offer
would miss: earlier prefixes, admission decisions, cache expiry and runtime
requests were not recorded or reconstructed. The eligible snapshots came from
recovered-channel finalization, not a fresh canonical-session capture acceptance
test. Finalization also changes source row boundaries/text; exact-source unit
reuse must not be presented as real capture-to-final reuse evidence.

Consequently, a ten-second useful preview and ninety-second reviewed completion
for a thirty-minute meeting remain unachieved product targets. Do not expand
precompute limits or introduce fuzzy source matching to manufacture a hit rate.
The next performance acceptance needs a fresh recording with content-free counts
for admitted/completed live packets, exact final hits and invalidations, alongside
stop-to-preview/reviewed timing and capture/resource continuity. Cold historical
generation remains a separate workload and is currently measured in minutes.

Incremental admission now registers cancellation before awaiting the memory
probe, rechecks capture/power/thermal state after that probe, and recovers from
probe errors without losing the next pending offer. Battery, suspend and
non-nominal thermal events cancel active and queued incremental work. These are
event-driven protections, not continuous memory-pressure monitoring or proof of
packaged sleep/wake behavior.

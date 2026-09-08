# Gemma runtime memory diagnosis

Scope: source-only, owner-authorized development replays on the 16 GiB Apple M1
Pro, using installed Ollama 0.33.3, `gemma4:12b`, and a 16384-token context.
Production records and model routing are unchanged. Private prompts, outputs,
meeting identifiers and runtime artifacts are not committed.

## What was wrong

The original run was sequential, not parallel. Nevertheless, llama-server saved
prior prompts and their context checkpoints in a separate historical RAM cache.
Its logs show cache occupancy increasing through 1086, 2192, 3290, 4413 and 5420
MiB, against an 8192 MiB limit. Each retained prompt included two approximately
320 MiB context checkpoints. The `/api/ps` model-size estimate did not describe
this entire working set. An already-loaded model and a single reported system
free percentage were therefore insufficient admission evidence.

A later retest reused that worker and stopped after about ten seconds with
roughly 1.7 GiB additional system swap. The worker's later `footprint` snapshot
reported 7508 MB dirty footprint, including 6376 MB of `MALLOC_LARGE`. The cache
occupancy is direct runtime evidence, not a hypothesis that other applications
must be responsible. It does not by itself prove an unbounded memory leak or
attribute every system swap operation to the cache.

## Bounded comparisons

All new comparisons retained the five-second resource guard: stop below 10%
reported free memory, above 512 MiB swap growth from that run's baseline, on a
thermal/performance warning, or on missing system telemetry. Stops cancel the
owned request and preserve incomplete evidence; subsequent cases stay unstarted.

1. A fresh isolated daemon unexpectedly chose eager-copy model loading
   (`--load-mode none`). The guard stopped this attempt during loading. It is
   retained as a failed startup, not a valid cache-only comparison.
2. Explicit mapped loading (`use_mmap: true`) matched the original worker.
   Disabling historical prompt caching alone completed three eligible meetings
   before stopping during the fourth at 516.32 MiB swap growth after 883.8 seconds.
   Seven physical requests all have terminal records. The sampled dirty footprint
   cycled around 1186–1871 MB; its recorded peak was 2029 MB. Active-slot
   checkpoints still existed, despite the historical cache being disabled.
3. A fresh worker with both historical caching and active checkpoints disabled
   completed the ten-row schedule in 1602.4 seconds (26.7 minutes), with sixteen
   physical requests, maximum one outstanding request, no missing terminals and
   no resource stop. This is a separate complete denominator, not a union of
   partial runs. Six meetings were accepted in replay, one failed the missing-
   action guardrail, one exceeded the bounded plan before inference, and two were
   source-ineligible. Thus seven meetings reached Gemma; this is not ten successful
   generations.

The final run recorded 319 system-resource samples. Swap never exceeded its
3645.44 MiB baseline and ended at 3357.44 MiB; reported free memory stayed at or
above 14%, with no recorded thermal/performance warning. The sampled process
dirty footprint ranged from 1224 MB to a recorded peak of 1404 MB. Maximum sampled
RSS was 8414064 KiB, including resident mapped pages. Startup logs confirmed mapped
loading and disabled historical cache, and contained no context-checkpoint
creation. The worker was not recycled between meetings. The launcher exited
successfully, and subsequent checks found neither its daemon/worker PIDs nor a
listener on the diagnostic port. The production DB content hash was unchanged.

The two larger sources exposed useful boundaries: one used three sequential
writer passes plus review (four physical requests, 520.3 seconds); the other
required four planned leaves and was rejected by the existing bounded-plan
limit without a model request. These remain latency/capacity findings, not memory
failures, and must not be hidden by replacing those meetings or loosening limits.

The final diagnostic profile is `LLAMA_ARG_CACHE_RAM=0`,
`LLAMA_ARG_CTX_CHECKPOINTS=0`, one parallel slot, and explicitly mapped loading.
It does not reduce model size, context, precision, prompts or output budgets.
Actual startup logs must confirm the profile; environment variables alone are
not proof. The isolated launcher records private runtime logs and process-memory
samples and tears down only its own daemon process group.

## Interpretation boundaries

Dirty footprint excludes separately reported clean mapped model pages. A
1–2 GB dirty footprint is **not** a claim that the entire model uses 1–2 GB.
RSS, mapped pages, dirty footprint and `/api/ps` sizes overlap and must not be
blindly summed. System swap baselines differed between attempts, and the
cache-only run briefly overlapped focused development checks. These are bounded
development observations, not a randomized performance experiment.

The content guardrail's missing-action rejection recurred independently of the
runtime stop. Runtime completion does not establish note completeness, factual
support, publication, production mixed-workload acceptance, or a model promotion.
Phi remains parked. The shared production daemon's persistent settings are not
modified by the diagnostic launcher.

## Verification

Focused verification passed 44 tests across eight files, the notes-evaluation
TypeScript check, repository lint, and whitespace validation. This is not a claim
that the full application suite or production mixed-workload acceptance ran.

All eight source-eligible cases reproduced their exact serialized results or
rejection outcomes from captured responses with zero provider calls, including
the no-inference bounded-plan rejection. The multi-pass case required preserving
elapsed review-admission time at recorded request boundaries; granting a fresh
budget incorrectly attempted an unrecorded review. Replay still does not simulate
OS timers or scheduler behavior. The independent launcher lifecycle smoke used
ten synthetic ineligible rows, made zero model requests, and verified clean daemon
exit without touching the production runtime configuration.

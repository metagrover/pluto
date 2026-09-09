# Notes efficiency: progressive previews and measured limits

Status: experimental, not production promotion. Continues the merged #794 work.
The production Gemma model, 16K context, editor contract, source guards and runtime
settings remain unchanged. The branch adds progressive, memory-only draft previews;
this does not change saved output, model requests or source acceptance. Existing recordings are sufficient for development;
a new meeting is not a prerequisite for source/audio replay.

## Implemented

- The unsuccessful compact-editor implementation was removed during closeout,
  including its production-module branches and dedicated tests. Its private source
  archive and existing commit history preserve reproducibility. The replay CLI
  explicitly rejects the retired flag/captures rather than silently running a
  different editor. The historical results below are not results of the final code.
- `inspect_notes_token_accounting.ts` reads existing owner-only captures without
  model calls or writes. It distinguishes content/message-JSON estimates from
  observed prompt/output counts, retains incomplete telemetry as unavailable, and
  includes capture hashes. Its reports cannot authorize lower admission margins.
- `inspect_owned_notes_tokens.ts` tokenizes captured requests against an already
  running, PID-verified private worker. It requires the captured model digest and
  Ollama 0.33.3, makes no generation requests, and emits counts/hashes only. Its
  narrow text-only Gemma renderer rejects unsupported requests and versions.
- Complete compact-writer items now reach the existing plain-text, unsaved preview
  before the writer finishes. Partial strings/items, unresolved citations and
  leaf-only drafts are excluded. Retries reset preview state; cancellation/current
  run checks and final validation remain separate. Observer errors cannot fail
  generation. The UI says "not final" during both writing and review.
- Replay distinguishes `firstCompleteBulletMs` from `firstDraftMs` instead of
  changing the meaning of the existing full-draft metric. The explicit
  `--compare-current` response-replay option reports changed code hashes and
  writes a separate comparison artifact; it does not silently bypass identity.
- Private audio replay can record sampled live transcript revisions, stop its
  own runtime on cancellation/resource pressure, and inspect offer/planning policy
  without generating notes or initializing a database.

## Evidence and boundaries

- The initial 16K/q8 short-case attempt stopped during loading after approximately
  808 MiB swap growth exceeded the unchanged 512 MiB guard. One physical request
  produced no answer. Its private attempt and successful owned-runtime cleanup
  are retained; it is not a latency sample.
- After reported headroom recovered from 64% to 71%, a separately recorded retry
  completed the same short case in 38,263 ms, with draft availability at 19,499 ms.
  Two sequential requests generated 119 and 125 tokens. Exact offline replay
  reproduced the accepted-in-replay result with zero new provider requests.
- Source review found two explicit follow-ups retained as discussion instead of
  structured actions. The earlier full-editor smoke has the same classifications.
  A clean mechanical result is not semantic acceptance or a thirty-minute timing
  forecast. The earlier 42.3-second run is not a controlled speedup denominator.
- The 31m09s case completed in 307,492 ms with draft availability at 182,608 ms
  (24K/q8, one continuation checkpoint). Writer/editor output was 892/890 tokens.
  The earlier full-editor/context-reuse diagnostic took 352,990 ms, but generated
  drafts differed and tokenization probes overlapped this run: this is not an
  isolated causal speedup. Source validation rejected the edited result and used
  the guarded writer fallback; no structured actions survived. Not quality-approved.
- The 9m53s case completed in 221,088 ms with draft availability at 107,028 ms
  (16K/q8, no historical cache/checkpoint). Two sequential requests completed and
  offline replay exactly reproduced the result, but review found a missing launch
  approval condition and incorrect participant attribution. This also used the
  guarded writer fallback. Valid source offsets do not establish semantic support.
  Both owned runtimes completed cleanup; neither result is production publication.
- Retrospective accounting of the earlier long continuation run found message-JSON
  estimates of 15,488/21,688 against observed counts of 10,180/13,648. Content-only
  estimates were 14,162/19,924. These are different accounting boundaries, not
  interchangeable exact tokenizer results.
- The installed Ollama model reports a generic `{{ .Prompt }}` template and uses
  a native Gemma renderer. The underlying server is launched with a chatml template;
  its `/apply-template` endpoint is therefore not an authoritative reconstruction
  of the Ollama request. The pinned runtime resolves the 12B model to its large
  renderer, including an empty no-think channel prefix. The owned-worker inspector
  reproduced exactly 10,180/13,648 tokens for the earlier complete long captures,
  with zero generation calls. This establishes those two request boundaries, not
  general tokenizer coverage or permission to reduce production margins. See the
  pinned [renderer resolution](https://github.com/ollama/ollama/blob/v0.33.3/server/renderer_resolution.go)
  and [Gemma renderer](https://github.com/ollama/ollama/blob/v0.33.3/model/renderers/gemma4.go).
- Three inherited owner/due/condition tests fail only on an expected trailing
  period. The identical failures reproduce on untouched merge commit `44eff0b1`.
  They are disclosed baseline failures, not edited away for this experiment.

## Follow-on experiments and decisions

- A fixed-draft correction-only review generated 134 tokens in 70,147 ms on the
  medium case. It added a duplicate follow-up, left the critical prerequisite and
  attribution errors, and failed the existing source validator. Rejected for
  promotion. Its implementation was removed from the proposed changes; a private
  source archive retains the experiment for reproducibility.
- A stronger commitment/condition prompt restored one missing launch condition,
  but retained the attribution error and failed final validation. Total time was
  242,810 ms (two calls). The unsuccessful prompt/version change was removed;
  its patch against `dff70c3d6` and source-backed review evidence remain private.
- That fresh run verified progressive callbacks: the first complete bullet was
  available at 58,891 ms and the full draft at 119,850 ms. This does not reduce
  total model work or establish UI paint latency. Earlier captured long-response
  chunks yield a first complete bullet at 103,727 ms versus writer completion at
  182,527 ms; these are recorded transport timestamps, not a new live UI benchmark.
- The existing full 593-second dual-source audio recording was replayed in real
  time, with no concurrent notes generation. Both source tails reached 593.053s,
  maximum queue depth was one, and there were no native or presentation failures.
  Twenty sampled snapshots stayed below the 12,000-character offer threshold
  (maximum 11,814), so none offered incremental notes. This is sampled policy
  evidence, not proof about every transient update or other meeting lengths.
- The first audio replay exposed a measurement bug: update latency included
  decode/model preparation. The harness now separates preparation and ready-time
  latency. Its original p50/p95 figures must not be cited as ASR update latency.
  Queued append failures are also consumed and drained rather than becoming
  unhandled rejections during cancellation.
- A subsequently retired diagnostic Markdown control supported a second, full-source
  review call, with separate writer/reviewer metrics and no fallback on reviewer
  failure. It is not a production route or a quality-approved result. Its first
  reviewed attempt stopped during model startup: swap grew approximately 849 MiB
  in ten seconds, exceeding the unchanged 512 MiB guard. AC power and nominal
  thermal state were confirmed; the owned daemon exited cleanly. This censored
  attempt is excluded from completed-generation timing. A preceding single-pass
  attempt stopped on a switch to battery and is likewise not a completed sample.

## Bounded closeout: performance and memory reassessment

| Observation | Earlier | Later | Interpretation |
| --- | --- | --- | --- |
| 31m09s meeting, total elapsed | 520,333 ms | 307,492 ms | 40.9% lower observed time; not a controlled comparison or quality-approved result |
| Fresh medium run, visible content | Full draft at 119,850 ms | First complete bullet at 58,891 ms | 50.9% earlier preview; same run, not final notes or UI paint latency |
| Recorded long writer stream | Full draft at 182,527 ms | First complete bullet at 103,727 ms | 43.2% earlier complete bullet in captured chunks |

There is no defensible average for a thirty-minute meeting and no measured
quality-approved end-to-end speedup. Interrupted runs are not completed samples.

The original 512 MiB swap-growth stop was a diagnostic policy, not a macOS memory
limit. Apple's [memory guidance](https://support.apple.com/guide/activity-monitor/view-memory-usage-actmntr1004/mac)
uses pressure informed by multiple signals, not swap occupancy alone. The guard
now reads the kernel's pressure state and allows at most 2 GiB growth only with
affirmative normal pressure. This is an engineering test budget, not an Apple
recommendation. It still stops at warning/critical pressure, below 10% reported
headroom, thermal warnings, or telemetry loss. Unknown pressure fails closed;
legacy evidence without pressure retains the old 512 MiB interpretation. The
sysctl exports [dispatch flags](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/event_private.h),
not the similarly named internal pressure enum. No OS or production limits change.

One repeat of the unchanged medium compact-editor configuration under this policy
stopped after 10,135 ms: macOS reported warning pressure, 13% headroom, and about
1.23 GiB swap growth. Its owned daemon exited cleanly. This demonstrates real OS
pressure in that attempt, not proof that every startup fails or that older stops
were out-of-memory crashes. No further retry of that configuration was made.

Correction-only and the unfinished reviewed-Markdown additions were removed from
the proposed changes and archived privately. No new prompt or model variant is
being added. The older opt-in compact editor was also removed, including its
application code paths. Useful preview, replay, telemetry and
audio-measurement fixes remain separate from model promotion.

The immediate acceptance target is a repeatable resource-safe baseline with
source-grounded notes. The broader ideas below are deferred, not a commitment to
continue expanding this PR until every experiment has been attempted.

Final closeout checks: 88 focused unit tests passed, as did both TypeScript
configurations and repository lint. The audio helper suite passed six tests with
one real-runtime test skipped. A current-code replay of the older full-editor
long capture matched the captured requests but failed exact final-result equality
on trailing punctuation; it is not reported as an exact replay pass. The earlier
compact-result replay passed before that experiment was retired. The revised
audio timing/cleanup implementation still needs a fresh real-runtime acceptance
run. These limitations keep the PR draft; they are not reasons to resume broad
model experimentation.

## Deferred research and acceptance

1. Treat compact review as an unaccepted experimental control, not a winning
   production route. Freeze source-backed quality expectations before further
   prompt tuning: critical facts, commitments, owner uncertainty, conditions,
   corrections, and citation entailment. Separate held-out sources from tuned ones.
2. Extend exact-token boundary verification to Unicode/dense and continuation
   captures, then integrate prospective accounting only with a verified runtime
   boundary. Keep heuristic fallback and output/safety reservations; do not scale
   estimates down from two samples.
3. Compare Markdown plus evidence markers against compact JSON with equivalent
   source coverage and semantic review. The existing single-pass Markdown runner
   is not an equivalent reviewed control. The unfinished two-call diagnostic was
   removed during scope reduction.
4. Evaluate minimal correction-only review only after the compact full-document
   control is established. Do not recreate a deterministic semantic rules engine.
5. Validate bounded context reuse separately, then combine winning changes.
6. Extend progressive rendering without enabling draft publication, exports or
   downstream commitments. Measure first useful content separately from completion.
7. Replay existing original audio tracks into transcription in an isolated profile;
   record source revisions and actual final cache reuse before redesigning packet
   identity. Never conflate accelerated replay with real-time contention evidence.
8. Run held-out quality, repeated-workload, cancellation/recovery and publication
   checks before changing defaults. Remove losing candidates rather than retaining
   permanent experimental product routes.

Production data was not modified. No new model or cloud route is introduced.

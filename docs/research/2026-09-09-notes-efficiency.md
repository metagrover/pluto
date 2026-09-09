# Notes efficiency implementation: compact review and token accounting

Status: experimental, not production promotion. Continues the merged #794 work.
The production Gemma model, 16K context, editor contract, source guards and runtime
settings remain unchanged. Existing recordings are sufficient for development;
a new meeting is not a prerequisite for source/audio replay.

## Implemented

- A replay-only compact full-document editor selected with
  `NOTES_REPLAY_COMPACT_EDITOR=1`. This is a structured replay option, not a UI
  setting or automatic route. The manifest and generated prompt identity identify
  the experiment; offline replay reconstructs the selected contract.
- Editor input removes application-generated IDs and duplicated heading evidence.
  Editor output retains meeting classification, complete topic items, owner/due,
  short source markers, and optional validated terminology. The existing parser,
  source checks and guarded acceptance still run. Independent overview/recent-win
  input and inherited-commitment reconciliation are explicitly unsupported rather
  than silently discarded. This is not patch-based review or review removal.
- `inspect_notes_token_accounting.ts` reads existing owner-only captures without
  model calls or writes. It distinguishes content/message-JSON estimates from
  observed prompt/output counts, retains incomplete telemetry as unavailable, and
  includes capture hashes. Its reports cannot authorize lower admission margins.
- `inspect_owned_notes_tokens.ts` tokenizes captured requests against an already
  running, PID-verified private worker. It requires the captured model digest and
  Ollama 0.33.3, makes no generation requests, and emits counts/hashes only. Its
  narrow text-only Gemma renderer rejects unsupported requests and versions.

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

## Remaining implementation and acceptance

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
   is not an equivalent reviewed control.
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

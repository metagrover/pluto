# 16 GB Local Intelligence Evaluation Implementation Plan

> **For agentic workers:** Use the executing-plans workflow to execute this plan task by task. Do not delegate in the side conversation. Implementation, model downloads, inference runs, process isolation, and publication require execution authorization; writing this plan does not authorize them.

**Goal:** Select a measured, source-grounded local intelligence configuration for Pluto on a 16 GB Apple Silicon baseline, covering notes, chat, project synthesis, and dreaming without compromising recording or ordinary desktop responsiveness.

**Architecture:** Reuse Pluto's production prompt builders, validators, and private replay infrastructure. First make the evaluation trustworthy, then compare models under a fixed pipeline, then change one pipeline or runtime variable at a time. Keep readable drafts, accepted meeting intelligence, and accepted cross-meeting proposals as different outcomes.

**Tech Stack:** TypeScript, Vitest, Electron, read-only SQLite, Ollama, macOS resource observations; optional llama.cpp/MLX comparison only after model screening.

**Status:** Proposed evaluation protocol and implementation backlog. No candidate has passed this protocol. Numerical promotion thresholds below are proposed product targets, to be frozen before candidate results are reviewed—not measured capabilities or universal hardware guarantees.

**Tracking:** The existing [#695 post-meeting resource-budget issue](https://github.com/metagrover/pluto/issues/695) is the primary evaluation anchor. Coordinate chat evidence with [#699](https://github.com/metagrover/pluto/issues/699), notes reliability with [#753](https://github.com/metagrover/pluto/issues/753) and [#776](https://github.com/metagrover/pluto/issues/776), and fragment reuse with [#701](https://github.com/metagrover/pluto/issues/701). This local draft does not update those issues or claim their full scope is approved. Before execution, attach the approved protocol to #695; create a separate outcome-sized evaluation issue if its owner wants the model-selection work tracked separately.

---

## 1. Decisions this exercise must produce

1. Minimum supported chip/OS alongside the 16 GB memory requirement. Start with the available M1 Pro 16 GB machine as a reference, not a proxy for all 16 GB PCs or base M1/M2 Macs.
2. Default model by workload: quick chat, meeting notes, cross-meeting comparison, project synthesis, and dreaming. A single winner across every workload is not required.
3. Residency and scheduling policy: what may run during capture, during final transcription, after meetings, and during ordinary navigation.
4. Context/output budgets and physical retry ceilings that fit actual supported workloads.
5. Whether simpler notes generation preserves the information downstream intelligence needs.
6. Whether a separate Phi runtime produces enough end-to-end benefit to justify a second runtime's lifecycle and memory cost.
7. An explicit retain-current / adopt-candidate / specialized-routing / no-candidate-passes verdict, with remaining gaps and rollback procedure.

Do not choose a model on token rate, package size, valid JSON rate, or attractive prose alone. The primary metric is time to useful, accepted, source-grounded output under realistic desktop load.

## 2. Evidence baseline and important limitations

### Pluto snapshot

Source reference: `c592a997fb0103aec96756ea1086a817eec8bb5d`, inspected September 6, 2026. Re-freeze the source and bundle hashes before running: the main thread may deliver additional fixes.

- Compact notes now allow 2,048 writer tokens, at most three initial source parts, 8,000 source characters per part, one recovery split, and six logical model calls. Writers finish before remaining model reviews. Existing deterministic review fallback can cover some review-budget failures.
- The provider can restart a preempted generation inside a logical pipeline call. Measure actual HTTP generation starts; do not assume the six-call counter bounds physical work.
- Source routing still unloads the previously tracked model on a model change. Non-notes contexts vary by prompt/task. The inference gate is module/process-local, not a broker for every client of Ollama.
- Projects overview can request synthesis after displaying the portfolio. Default project review priority is 15, above automatic notes at 10. Existing busy checks must be included in the scheduling experiment rather than assuming every navigation starts inference.
- Dreaming builds structured proposals from supplied meeting notes and accepted baseline/corrections. The current request pins Gemma and requires source evidence, including two distinct meetings for a project summary. It is not merely another summarization prompt.
- Recent server observations showed roughly 13 output tokens/second and approximately 43 seconds to process a 5,481-token prompt. These are individual observations, not a clean benchmark distribution. At that rate, 2,048 output tokens alone take roughly 158 seconds.
- Recent Ollama residency was about 8.1 GB at 16K context; system swap used was about 4.5 GB. Historical swap occupancy is not proof of ongoing swap pressure or attribution to Pluto. RSS, Ollama residency, and unified-memory totals overlap and must not be added together.

Current source inspection is not proof that the active Electron bundle contains the same fixes. A completed replay is not proof of actual publication or successful notification.

### Benchmark comparison controls

Reported speed alone is not a benchmark. Pin provider, model, hardware, input size, output length, and completion quality before comparing results. Label a simplified Pluto notes pipeline as a one-pass ablation and measure it under the same conditions as the production pipeline.

### Hypotheses, not decisions

- Smaller default models may improve responsiveness and memory headroom.
- Deferring optional work and stabilizing runner settings may improve latency independently of model choice.
- A short streamed draft may improve perceived responsiveness without improving accepted-output latency.
- A compact notes model and a stronger idle-time consolidation model may beat a single-model policy; their switching cost and information loss may also erase that benefit.
- A separate Phi helper may isolate scheduling but still contend for shared memory/compute. Ollama is already local.

## 3. Non-goals and authority boundary

- No production settings/default changes, model pulls, regeneration, retranscription, entity mutation, or proposal acceptance in this documentation turn.
- Evaluation outputs stay in an explicitly selected private artifact directory; public reports contain only aggregates and non-sensitive configuration.
- Never run a new benchmark beside the main thread's active inference. A second server port still competes for the same hardware and is not isolation.
- No automatic process termination, machine reboot, memory purge, global Ollama environment changes, or private transcript upload.
- Do not weaken source validation, infer participant identities from names/calendar hints, or accept truncated content to improve success statistics.
- Do not implement the full scheduling/runtime redesign inside the evaluation PR. Use measured failures to define focused follow-up changes.
- Do not rewrite the existing notes-output-capacity proposal, MeetingView, CSS, or main-thread work. This plan is a separate local file; no worktree, commit, or issue mutation is needed to write it.

## 4. Experimental design

### Workload lanes

| Lane | Input and expected outcome | Main quality risk |
| --- | --- | --- |
| Quick chat | Live context or compact published evidence; short supported answer | Incorrect owner/date, unnecessary synthesis, missed abstention |
| Meeting notes | Complete finalized source; readable notes plus structured decisions/actions/evidence | Omitted late/middle material, tentative language converted into commitment |
| Cross-meeting Ask Pluto | Two to six chronological meetings; explain changes with citations | Mixing projects, outdated facts, invented causal links |
| Project synthesis | Relevant meeting evidence; supported goal/action grouping | False project merges, duplicate initiatives, vague topical association |
| Dreaming | Existing baseline, corrections, multiple notes; evidence-backed independent proposals or no-change | Reintroducing rejected claims, evidence laundering, speculative links presented as facts |

Run two downstream tracks: (A) fixed human-reviewed notes to isolate the consolidation model; (B) each candidate's generated notes to measure end-to-end error propagation. A strong dreaming model cannot reliably recover information that an earlier notes stage discarded. Inspect links back to original transcript evidence in track B, not only quotation from generated notes.

### Candidate ladder

Screen first, promote selectively; do not execute an unbounded full Cartesian product.

| Candidate | Initial role | Condition for more testing |
| --- | --- | --- |
| Gemma `gemma4:12b` | Current notes/deep/dreaming control | Always retain as paired baseline, including failures |
| Phi `phi4-mini:3.8b` | Current quick-chat control; cheap notes probe | Continue notes lane only if fidelity screen passes |
| Llama `llama3.2:3b` | Small-model comparison baseline | Pin actual available digest/quantization before execution |
| Qwen `qwen3.5:4b` | Small-default challenger | Full notes + downstream quality screen |
| Ministral `ministral-3:8b` | Medium-size fidelity challenger | Continue if small candidates fail quality or this wins cost/quality |
| Qwen `qwen3.5:9b` | Historical Pluto comparator | Reserve; run if first screen is inconclusive |

Record resolved weights, quantization, tokenizer/template, context, output limit, sampling, thinking setting, backend, and exact digest. A tag is not a reproducible model identity. Verify current availability without assuming catalog size equals runtime RAM. Do not copy one family's recommended sampling settings blindly to another. First compare the fixed production contract, then permit a separately recorded, development-only tuning budget of at most two configurations per finalist.

### Sequential experiments

1. **E0: Measurement validation.** Fake transport and synthetic data only. Prove routing, event accounting, privacy, deadlines, and evaluator rejection behavior.
2. **E1: Fixed-pipeline model screen.** Same current Pluto notes pipeline, validators, source set, and resource conditions. Start with six diagnostic cases per candidate, one run each. Stop a candidate on a hard safety breach; record failures rather than rerunning until success.
3. **E2: Finalist fidelity.** At most two challengers plus Gemma; full held-out suite with three repetitions. Distinguish random variability from deterministic regressions.
4. **E3: Pipeline ablations.** On finalists only: current multipart JSON; one-pass Markdown with full source where it fits; Markdown with evidence-bearing sections and separately costed structured extraction; fewer model-review passes with unchanged deterministic guards. No silent source clipping in a promotable variant. A head/tail-clipped control is diagnostic-only and must count omitted material as lost coverage.
5. **E4: Scheduling/residency.** Hold model and pipeline constant. Compare current scheduling against an explicit approved prototype: cached navigation, idle-only optional enrichment, stable context buckets, one active heavy generation, bounded physical restarts. Test model switches separately from same-model context changes.
6. **E5: Runtime comparison, conditional.** Compare Phi via Ollama and a dedicated helper only if E4 shows switching/queue overhead materially limits chat. Match weights/quantization and prompt settings where feasible; disclose any mismatch. Test Phi alone and Phi with Gemma resident, both sequential and deliberately concurrent. No assumption that native packaging implies Neural Engine execution.
7. **E6: Integrated acceptance.** Test the chosen complete configuration, not just its individual best components. Produce the final decision report before proposing a default change.

### Cold, warm, mixed, and contaminated runs

- Cold means the target runner is not resident, not that the OS disk cache was purged. Record file-cache state as uncontrolled.
- Warm means the same model/configuration remains resident. Repeated identical prompts may benefit from prompt caching; report those separately from warm runs with new prompts.
- Mixed means browser and meeting application are open with a fixed, documented workload. Use the same baseline application set for paired comparisons.
- Record a 60-second idle resource baseline; sample resources every second during a run and for 60 seconds afterward.
- Randomize or counterbalance candidate order within each session; reuse case order and declared seeds across candidates. Seeds do not guarantee equivalent sampling across engines.
- Mark a run contaminated if an unplanned inference client, sleep, or workload appears. Keep it in the ledger, exclude it from isolated latency ranking, and rerun only under a separately recorded replacement ID. Sleep-injection scenarios are intentional and remain valid for recovery analysis.
- Global background inference may be difficult to observe completely. If attribution is uncertain, label the result mixed/unattributed rather than isolated.

## 5. Corpus and review protocol

### Dataset inventory

- **Development:** six single-meeting cases and four cross-meeting bundles for harness checks and the fixed tuning budget. Never report these as held-out acceptance.
- **Held-out notes:** twelve cases: three short (5–15 minutes), four ordinary (20–40 minutes), three long/dense (45–90 minutes), and two adversarial/sparse cases. Include the known segmented/truncated meeting privately if eligible; synthetic counterparts must cover the same failure.
- **Held-out consolidation:** eight bundles of three to six meetings, covering chronology, cancellation, owner handoff, correction fingerprints, same-name entities, no-change, unrelated-project negatives, and evidence insufficiency.
- **Held-out chat:** thirty questions, five each for factual recall, decisions/actions, scoped summary, comparison, exact wording, and missing/conflicting evidence.
- Include facts located in the beginning, middle, and end. Label source characters, actual input tokens, segmentation, language, duration, and density; duration alone is not the complexity measure.
- Fixtures not supported by the initial product language promise are exploratory, not silently included in the supported-language claim.

### Gold labels

For each case, privately record source-backed facts, decisions, actions, owner/deadline explicitness, conditions, negations, withdrawals, required citations, and forbidden claims. Mark critical facts before seeing outputs. Consolidation labels include expected new proposals, legitimate no-change cases, and forbidden merges/causal assertions. Independent reviewers may find valid additional proposals; adjudicate against evidence, not exact string matching.

Model names are hidden during scoring. Use a human evidence review; an LLM judge may help triage but cannot be the sole acceptance authority. Review all critical claims and all held-out outputs. Double-review at least 25% of outputs and every disputed or critical-error case. If only one reviewer is available, label the result provisional and block broad default promotion.

Score separately:

- Atomic-claim precision: supported factual claims / emitted factual claims.
- Action/decision recall: correctly represented gold actions/decisions / all gold actions/decisions.
- Critical-fact recall, source-location coverage, owner/date accuracy, modality preservation.
- Cross-meeting relationship precision and recall; correct abstention on negative bundles.
- Readability/usefulness on a 1–5 anchored rubric: 1 unusable, 2 major editing, 3 useful with corrections, 4 useful with minor edits, 5 ready to use.
- Structural validity, completion rate, model-review coverage, and deterministic-fallback frequency.

Empty/failed outputs score zero recall and fail completion; their precision is undefined, not 100%. Report per-case and macro averages, counts, denominators, and every hard failure. A terse output cannot win by avoiding difficult claims. Correlated repetitions are not independent new meetings.

## 6. Measurement contract

Each run has an immutable manifest: suite/config ID, source commit and dirty-diff hash, bundle hash if used, model digest, provider version, OS/chip/RAM, workload condition, corpus/gold-label versions, seed, start/end times, and artifact privacy classification.

Each physical request records: run ID, logical stage/part ID, physical attempt ID, requested/actual model, task/work class, endpoint category, prompt/schema hashes, source size, context/output settings, enqueue/admit/send/first-content/end timestamps, reported input/output token counts, termination reason, cancellation cause, and accepted/rejected outcome. Distinguish visible output from reasoning tokens and transport progress.

Required derived metrics:

- App queue wait; request wall time; first usable content; draft completion; accepted-in-replay completion; actual publication/notification only in the disposable integration profile.
- Ollama-reported load duration, prompt-evaluation time, and decode time as separate raw fields. Load duration is not automatically disk/model startup time; correlate server runner events where possible and otherwise label scheduler/startup time unresolved.
- Physical attempts versus logical calls, discarded generated tokens, repartitions, retries, model/context switches, completed-part reuse, review calls/fallbacks.
- Peak process RSS, separately reported Ollama residency, system memory pressure, swap-in/out deltas when observable, swap-occupancy delta, thermal state, battery/AC state, and output throughput over time. Missing telemetry is null with a reason, not zero.
- Source coverage and semantic quality, alongside all timing fields.

Use monotonic time for within-process intervals and wall time for correlating logs. Never add overlapping wall/prompt/decode durations into a fictitious total. Report timeouts as failures at their observed/capped duration; do not calculate a speed winner only from survivors. Report empirical p95 only when at least 20 observations exist in that comparable cell; otherwise show n, median, range, and paired case results. Do not pool short and long notes or cold and warm runs to manufacture a p95.

Private replay vocabulary must use `accepted_in_replay`, not `published`. The existing latency harness uses `published` for a returned document despite read-only DB access; retain backward compatibility in legacy reports but translate it explicitly in the evaluation report.

## 7. Failure-mode register

| ID | Failure / injection | Required behavior and evidence |
| --- | --- | --- |
| F01 | Output ends for length, including syntactically plausible Markdown | Never mark partial output complete; record termination, preserve prior accepted output, bounded recovery only |
| F02 | Input exceeds context or source-part ceiling | Reject/decompose explicitly; no invisible middle/tail loss; source coverage audit detects omissions |
| F03 | Completed malformed JSON or bad schema | Bounded supported repair; unknown citations and unsafe claims never rescued by format repair |
| F04 | Fluent notes omit late decision or change conditional into commitment | Quality gate fails even if all structural checks pass |
| F05 | Incorrect identity/owner/date or same-name project merge | Critical hard failure; no promotion for that lane |
| F06 | Candidate notes introduce a false fact later cited by dreaming | End-to-end original-source review catches it; quoting generated notes alone is insufficient |
| F07 | Repeated foreground preemption | Count every physical attempt; bounded wall deadline; reuse valid completed stages; no infinite restart loop |
| F08 | Navigation repeatedly requests optional work | Cached view stays responsive; requests coalesce; optional work yields; no escalating queue |
| F09 | Same-model context changes or Phi/Gemma switching | Count runner starts and residency; separate switch cost from inference cost |
| F10 | Other app/benchmark shares Ollama or GPU | Mark contamination; never call a second port hardware isolation |
| F11 | Sustained memory/thermal pressure or low battery | Pause/stop experiment safely; no user process killing; resource failure retained in report |
| F12 | Sleep/wake, runtime crash, app restart | Distinct interruption category; no stale publish or false ready notification; explicit resume/retry state |
| F13 | Source edited/deleted during generation | Reject stale result and invalidate incompatible cached stages; preserve authoritative user edits |
| F14 | User correction conflicts with repeated evidence | Correction remains authoritative; no rejected claim resurrected through dreaming |
| F15 | Model unavailable, wrong alias, silent model override | Fail preflight/wire assertion; never silently benchmark Gemma under a candidate label |
| F16 | Private content or credentials enter logs/artifacts | Fail privacy tests; stop publication; report only content-free aggregates |
| F17 | Benchmark alters pipeline while claiming model-only comparison | Manifest mismatch invalidates paired attribution; classify as system comparison |
| F18 | Small model wins by abstaining on everything | Recall and positive/negative cases jointly gate promotion |
| F19 | Preview is shown quickly but reviewed result fails much later | Report preview and accepted-output latency separately; preview cannot feed canonical intelligence |
| F20 | Warm-cache or tuned-fixture advantage | Separate cache conditions; holdout remains untouched; disclose tuning history |
| F21 | Summary pipeline drops evidence needed downstream | Cross-meeting track B fails even if standalone readability passes |
| F22 | LLM transport timeout classified as user cancellation | Preserve timeout phase/cause; failure statistics cannot hide behind cancellation counts |

## 8. Acceptance criteria

### Non-negotiable safety/integrity gates

- Zero observed corrupted/lost recording chunks, stale publications, canonical mutations from private replay, private-data leaks, or unsupported critical identity/commitment claims in the held-out and injected-failure suites.
- All accepted citations resolve to supplied evidence. All critical gold actions/decisions, conditions, and reversals are preserved.
- Every deliberate missing-evidence/no-change/forbidden-link fixture behaves correctly. No candidate can compensate for a critical error with speed.
- Source/prompt/model/policy revisions are included in cache identity; an old result cannot be silently reused across an incompatible configuration.
- Every run ends as accepted, rejected, failed, timed out, cancelled, or contaminated within a declared ceiling. No abandoned run is omitted from reporting.

These are observed-suite gates, not a claim of a zero real-world error rate.

### Proposed quality gates

- Atomic factual precision at least 98%; action/decision recall at least 95%; critical-fact recall 100% on the labelled suite.
- No more than two percentage points regression against paired Gemma results in any non-critical recall metric. A weak baseline does not waive absolute thresholds.
- Cross-meeting relationship precision at least 98%, recall at least 90%, and 100% correct behavior on designated forbidden-link/correction cases.
- At least 95% accepted completion across supported ordinary cases and repetitions, with every supported case completing at least twice out of three. Long/out-of-capacity cases are reported separately, not silently removed.
- Median human usefulness at least 4/5 and no critical case below 3/5. Disclose how many outputs received only deterministic review.

### Proposed responsiveness/resource gates

| Scenario | Promotion target |
| --- | --- |
| Cached navigation under active inference | p95 actionable content within 500 ms; no inference required to show cached data |
| Warm quick chat, bounded evidence | p95 first useful content within 3 s; final short answer within 10 s |
| Quick chat during background notes | p95 first useful content within 5 s; lower-priority work stops/adapts within 2 s of confirmed priority request |
| Ordinary notes, 20–40 min and within declared source capacity | Median accepted time at most 120 s, empirical p95 at most 240 s; at least 30% lower paired median than current control unless control already meets the absolute target |
| Cross-meeting comparison, 2–6 bounded meetings | p95 first useful content within 5 s; accepted answer within 30 s |
| Dreaming, bounded 3–6 meeting bundle | Completes or yields within declared 180 s active-compute budget; queued idle time reported separately |
| Sustained 30-minute mixed workload | No serious/critical thermal state for over 30 s; no sustained critical memory pressure; no more than 512 MiB swap-occupancy growth from settled baseline, with paging deltas inspected where available |
| Recording plus permitted intelligence | Zero lost synthetic markers/chunks; no more than 10% regression in p95 live-transcript delay against transcription-only control |

These targets must be approved/frozen before ranking candidates. If none passes, report that honestly and decide whether to narrow supported hardware/workload, reduce work, or revise the product target explicitly. Do not relax thresholds after seeing a favored model's score. Do not require zero pre-existing swap. Treat unobservable thermal/pressure metrics as missing acceptance evidence, not a pass.

Resource stop rule: stop new inference admission immediately on critical pressure, recording integrity failure, or a privacy breach. Stop optional evaluation after serious thermal state persists for 30 seconds. Preserve diagnostic data and mark the outcome; do not automatically resume that run.

Evaluation ceiling: 10 minutes per ordinary notes case, 20 minutes per long case, 12 physical starts per notes run including preemption/recovery, 2 minutes per chat request, and 3 minutes active compute per dreaming bundle. These are evaluator safety ceilings, not proposed production UX budgets. A model that reaches a ceiling fails its lane. At most two challengers advance past screening.

## 9. Implementation work packages

These packages implement evaluation infrastructure and evidence collection, not production default changes. Use a dedicated implementation worktree only after execution is authorized. Follow TDD for new evaluator logic. Each package ends in a focused commit; do not stage unrelated files.

### Task 1: Freeze the protocol and inventory existing harnesses

**Read:** `package.json`, `vitest.manual.config.ts`, `vitest.benchmark.config.ts`, `scripts/run_meeting_notes_latency_benchmark.ts`, `tests/manual/meetingNotesQualityBenchmark.test.ts`, `tests/manual/meetingNotesSystemComparison.test.ts`, `scripts/run_ask_pluto_benchmark.ts`.

- [ ] Attach approved scope/thresholds to the tracking issue before implementation; record chip/OS scope and owner for human quality review.
- [ ] Record source/bundle identity and dirty files. Do not rebuild or restart the user's app as an implicit preflight action.
- [ ] Verify installed runtimes read-only; resolve model digests only for installed candidates. Record missing candidates as requiring a separately approved download.
- [ ] Map existing harness behavior to this protocol. The quality harness carries historical `notes-v6` baseline data; the system-comparison harness changes historical pipeline and model together and logs raw synthetic streams; the chat harness currently contains two simple fixtures. None is the entire acceptance suite.
- [ ] Verify wire routing before real tests: settings alone are not enough because notes/dreaming have model-specific routing. Assert actual model, schema, pipeline mode, context, and output settings.
- [ ] Produce a configuration/corpus manifest in the private evaluation directory. Use actual snapshot paths, not live-write DB handles.

Read-only commands (run from the selected checkout):

```sh
rtk git rev-parse HEAD
rtk git status --short
rtk proxy curl -s http://localhost:11434/api/version
rtk proxy curl -s http://localhost:11434/api/tags
rtk proxy curl -s http://localhost:11434/api/ps
rtk proxy sysctl hw.memsize vm.swapusage
```

**Acceptance:** A second engineer can identify the exact system being tested; no inference or production mutation occurred during preflight. Recheck dependencies: `tsx` is currently declared in package.json, so older notes saying it is absent must not drive setup.

### Task 2: Add a shared evaluator contract and privacy boundary

**Create:** `scripts/lib/local_intelligence_evaluation.ts`, `tests/unit/localIntelligenceEvaluation.test.ts`.

**Reuse:** `scripts/lib/meeting_notes_latency_benchmark.ts`, `scripts/lib/privateEvaluationFile.ts`; keep legacy report readers compatible.

- [ ] Write failing tests for unknown model/digest, missing source revision, duplicate attempt ID, terminal event without start, private text in public report, null resource telemetry, contaminated runs, and replay results mislabelled as published.
- [ ] Implement manifest/event validation and content-free report projection using explicit allowlists. Reject arbitrary extra fields rather than spreading raw provider responses into reports.
- [ ] Implement paired aggregation: failed/timeout cases remain in completion denominators; censored runs do not disappear from latency tables; p95 is withheld for n < 20.
- [ ] Add a fake-clock test where one logical stage has three physical starts and two preemptions. Expected: logical=1, physical=3, preemptions=2, and no accepted output until the last validated result.
- [ ] Verify ordinary/long deadline and physical-start ceilings without waiting in real time.
- [ ] Run the focused tests, verify expected failures before implementation and passing results afterward, then commit only the evaluator and tests.

Test command:

```sh
rtk pnpm exec vitest run tests/unit/localIntelligenceEvaluation.test.ts
```

**Acceptance:** F07, F10, F15–F17, F20, and F22 have deterministic coverage before any real inference.

### Task 3: Build a production-path replay adapter

**Create:** `tests/manual/localIntelligenceEvaluation.test.ts`, `tests/manual/fixtures/localIntelligenceEvaluationCases.ts`.

**Reuse:** `UnifiedLLMProvider` from `electron/llm/unifiedProvider.ts`; notes source/prompt/guardrails; `electron/dreaming/prompt.ts`, `electron/dreaming/validateDreamingOutput.ts`; existing chat evidence/prompt builders. Use a test-local adapter, not a new production runtime abstraction.

- [ ] Make the manual suite opt-in with `RUN_LOCAL_INTELLIGENCE_EVALUATION=1`; without it, all real-provider tests skip. Require an absolute `LOCAL_INTELLIGENCE_EVALUATION_MANIFEST` path when enabled.
- [ ] Add dry-run mode `LOCAL_INTELLIGENCE_EVALUATION_DRY_RUN=1`: validate manifests, build requests, assert wire intent, and fail if any generation endpoint is invoked.
- [ ] Add request-local candidate selection at the evaluation boundary, without editing production defaults. Record requested and actual wire model; abort on mismatch. Preserve production schema, source mapping, and semantic validators.
- [ ] Run notes through the same compact/editor options as the pinned production path. Do not assume the existing latency CLI's flags select that exact path; compare requests in dry-run assertions.
- [ ] For dreaming, use `buildDreamingGenerationRequest` and `validateDreamingOutput`; do not invoke canonical proposal acceptance. For chat, distinguish fixed-evidence model testing from actual retrieval-inclusive testing.
- [ ] Record every generation HTTP start, including internally restarted requests; retain provider-reported times without relabelling load time as disk I/O.
- [ ] Store raw inputs/outputs only in owner-only private artifacts. Existing raw-stream synthetic comparison logging must never be reused unchanged for private cases.
- [ ] Add fake-transport tests proving truncation, wrong citation, changed source revision, unavailable model, and transport failure cannot become accepted replay results.

Opt-in command shape after the adapter exists (paths are supplied through the approved environment/manifest, not hardcoded production IDs):

```sh
rtk proxy env RUN_LOCAL_INTELLIGENCE_EVALUATION=1 LOCAL_INTELLIGENCE_EVALUATION_DRY_RUN=1 pnpm exec vitest run --config vitest.manual.config.ts tests/manual/localIntelligenceEvaluation.test.ts
```

**Acceptance:** Default test execution causes no inference; dry-run verifies model/pipeline identity; production tables and published notes remain unchanged.

### Task 4: Encode the gold corpus and failure scenarios

**Modify:** `tests/manual/fixtures/localIntelligenceEvaluationCases.ts`.

**Create:** `tests/unit/localIntelligenceEvaluationCases.test.ts`.

- [ ] Add explicitly labelled development and held-out partitions, using synthetic public fixtures and privately mapped real cases. Do not commit private meeting IDs, text, titles, or content hashes to public reports.
- [ ] Encode each gold item with evidence spans and modality/owner/date requirements; mark critical items and forbidden claims.
- [ ] Add a beginning/middle/end case where the middle contains the only commitment and the end withdraws it. A head/tail-only summary must fail full-source coverage.
- [ ] Add cross-meeting cases for ownership transfer, conditional approval, rejected correction, same-name unrelated projects, valid association without causation, and genuinely unsupported/no-change evidence.
- [ ] Validate label integrity automatically: evidence resolves, case IDs are unique, train/holdout membership does not overlap, and each required failure ID has at least one case.
- [ ] Freeze corpus and rubric hashes before finalist evaluation; document human review assignments and disagreement resolution.

```sh
rtk pnpm exec vitest run tests/unit/localIntelligenceEvaluationCases.test.ts tests/unit/localIntelligenceEvaluation.test.ts
```

**Acceptance:** F01–F06, F13–F14, F18–F19, and F21 have explicit gold expectations; a pleasing but incomplete summary cannot pass.

### Task 5: Execute the controlled screening and finalist runs

**Outputs:** private request/event ledger, source-grounded blinded scorecards, content-free aggregate report. No production writes.

- [ ] Obtain a quiet execution window and authorization for required downloads/process isolation. Stop if the main thread or another user workflow owns active inference; do not terminate it.
- [ ] Run E0 and dry-run first. Validate a synthetic known-good result and deliberate wrong-model/truncated results through the full reporting path.
- [ ] Run E1 sequentially using one candidate at a time. Record cold startup separately from warm new-prompt calls.
- [ ] Apply hard gates before promoting at most two challengers. Record eliminated candidates and reasons.
- [ ] Run E2 with three repetitions and blinded review. Collect enough comparable chat/ordinary-note samples for the proposed p95 gates or explicitly mark insufficient evidence.
- [ ] Run E3 only on finalists. Pair model-only and pipeline-only contrasts; report any joint change as a system result, not an isolated model effect.
- [ ] Run downstream tracks A and B. Candidate notes plus Gemma dreaming is a separate configuration with full switching/resource costs included.
- [ ] Compare paired per-case accepted latency, quality, physical attempts, and memory; retain contaminated/failed runs in the ledger.

**Acceptance:** Reproducible ranking exists by workload lane, including the option that no candidate meets the targets. No candidate is promoted merely for faster first text.

### Task 6: Validate scheduling, lifecycle, and optional runtime variants

**Reuse tests:** `tests/unit/meetingNotesScheduler.test.ts`, `tests/unit/meetingNotesCancellationContext.test.ts`, `tests/unit/idleDreamingCoordinator.test.ts`, `tests/unit/dreamingProductionRequest.test.ts`.

**Create:** `tests/manual/localIntelligenceMixedWorkload.test.ts` as an opt-in integration harness using a disposable app profile and synthetic recordings. Any production scheduling prototype belongs in a separately scoped change linked to #695/#699.

- [ ] Exercise recording + short chat; notes + repeated navigation; notes + chat at 15-second intervals for two minutes; four back-to-back completed meetings; idle dreaming + new recording; and source edit during generation.
- [ ] Inject runtime crash and sleep/wake only in the authorized disposable environment. Test replay recovery separately from actual app publication/notification.
- [ ] Compare current versus approved scheduling prototype without changing the model. Verify optional tasks do not starve automatic notes, and sustained foreground usage leaves a truthful deferred state rather than an infinite retry loop.
- [ ] If justified, run E5 with one matched Phi workload, then the mixed Gemma/Phi workload. Record total memory, switching, chat latency, notes slowdown, capture quality, helper crash recovery, and idle resource use.
- [ ] Reject a separate-runtime proposal if it improves chat by making recording unsafe, notes unbounded, or sustained resource gates fail. Document packaging/update/model-license work before recommending shipment.

**Acceptance:** F08–F12 have actual integration evidence, not only mocks. Starting a new recording remains reliable under the chosen configuration.

### Task 7: Publish the evaluation decision, not a premature default change

**Create after execution:** `docs/research/2026-09-06-local-intelligence-16gb-evaluation-results.md` with content-free results. Update the tracking issue when authorized. Record an approved durable policy in `docs/decisions.md` only after the decision is made.

- [ ] Report supported hardware/software, exact configurations, corpus sizes, all failed gates, isolated versus mixed results, quality distributions, review coverage, and confidence limitations.
- [ ] Produce one recommended configuration per workload, plus an overall integrated configuration and memory policy. Explain why rejected alternatives lost.
- [ ] Separate immediate low-risk improvements from conditional model/default/runtime changes. Define focused follow-up issues/PR scopes rather than one combined rewrite.
- [ ] Specify a selected-meeting opt-in canary, no bulk historical regeneration, versioned cache invalidation, preserved prior notes, and an explicit return-to-baseline configuration.
- [ ] Review artifact privacy and validate the plan's requirement-to-evidence mapping. Document gaps instead of declaring completion from passing unit tests.
- [ ] Run evaluator-focused tests, TypeScript, and repository lint for the implementation PR. Record unrelated failures without modifying other work. If Node tests required a SQLite ABI rebuild, restore Electron compatibility before any app verification.

```sh
rtk pnpm exec vitest run tests/unit/localIntelligenceEvaluation.test.ts tests/unit/localIntelligenceEvaluationCases.test.ts
rtk pnpm exec tsc --noEmit
rtk pnpm run lint
rtk git diff --check
```

**Acceptance:** The report supports an explicit decision without suggesting that a benchmark has shipped a product change. Default changes remain gated on integrated and human-reviewed acceptance.

## 10. Final decision rules

1. Reject any configuration with a hard integrity/privacy/recording failure for its proposed lane.
2. Among passing configurations, prefer the smallest operational footprint meeting absolute responsiveness and quality targets, not simply the fastest decode rate.
3. If small notes + Gemma consolidation wins, preserve provenance and price in model switching, background delay, and error propagation. Do not load both permanently on 16 GB without the mixed-workload memory evidence.
4. If one smaller model passes every lane, prefer the simpler one-runtime/one-resident-model configuration.
5. If a model is excellent for notes but weak at cross-meeting reasoning, allow a scoped notes-only role. If notes omit critical source facts, do not promote it even when prose is attractive.
6. If Markdown improves first-visible time but not accepted-output latency or semantic quality, treat it as a preview/UI experiment, not a replacement for trusted structured intelligence.
7. If no configuration meets the frozen targets, retain current defaults and report the limitation. Choose the next bounded change from the observed dominant cost: excess passes, prompt volume, queueing, memory, or decode—not intuition.

## 11. Plan completion checklist

- [ ] Protocol, hardware scope, and numerical targets approved before execution.
- [ ] All model/pipeline identities verified on actual wire requests.
- [ ] Development/held-out split and human review completed.
- [ ] Every F01–F22 has automated or manual evidence, or an explicit blocking gap.
- [ ] Fixed-notes and candidate-notes downstream tracks both reported.
- [ ] Failed, timed-out, cancelled, and contaminated runs retained.
- [ ] Resource and recording gates verified on the integrated configuration.
- [ ] Performance comparisons use pinned configurations and measured results, not unsupported speed/quality claims.
- [ ] Local artifacts remain private; public reports are content-free.
- [ ] Final decision, follow-up scope, canary, and rollback agreed before any default migration.

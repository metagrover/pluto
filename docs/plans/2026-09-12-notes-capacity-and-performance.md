# Meeting-notes capacity without a performance regression

Status: Draft for review. Implementation and inference benchmarks have not started.

## Objective

Support ordinary meetings currently rejected by the compact-notes planner while preserving or improving time to trusted notes. Keep the work inside the existing planner, writer/editor pipeline, run coordinator, and failure presentation.

Performance is a release gate. Increasing a timeout does not count as fixing performance, and producing fewer accurate commitments does not count as improving it.

## Confirmed problem

The reported meeting has 727 source segments and 27,308 source characters. Its persisted plan requires four leaves, exceeds the three-leaf limit, and fails before inference. Eight retained attempts hit this same error. The retained 100-run history spans 15 meetings; this particular error is recorded for one meeting, while other historical failures have separate causes.

Current production constraints in `electron/llm/meetingNotesPipeline.ts` are three leaves, six model calls, one recovery split, and 8,000 source characters per leaf. Planning also accounts for request context and editor output. `electron/meetingAnalysisRuns.ts` supplies a 16,384-token context and twelve-minute absolute deadline. Writers run before optional editors. Compatible writer output can be reused through the existing memory cache.

The September 4 bounded-notes decision deliberately imposed this admission rule. A replacement must update that decision and the test asserting that every four-leaf plan fails.

## Constraints

- Preserve the configured production model, context size, six-call ceiling, and twelve-minute deadline during candidate evaluation. The deadline is a safety ceiling, not a latency target.
- Preserve existing direct and already-supported partitioned behavior unless a measured change improves it without reducing quality.
- Add no mandatory inference stage, model merge, concurrent local inference, or extra background workload.
- Preserve exact source references, commitment checks, cancellation, source/run revision checks, and atomic publication. Existing notes remain available during regeneration.
- Use the current stage cache, scheduler, and composition path. Durable job storage, resumable scheduling, and a new analysis architecture are outside this change.
- Keep private sources and outputs in protected local artifacts. Repository reports contain only aggregate measurements and opaque case labels.

## 1. Establish the workload and latency baseline

Run planning only across eligible saved meetings using their current production source projection and context. This pass makes no model calls and changes no saved meetings. Record direct/partitioned routing, section counts, request estimates, and the reason each section stops growing: source-character cap, writer context, or editor reserve. Reuse production planning logic; add only a small diagnostic seam if needed.

Select a small representative replay set: direct meetings, supported two/three-section meetings, the reported four-section case, and larger or denser cases found by the planning pass. Include different segment densities and meetings with commitments changed later in the discussion. Do not select only cases that fit the candidate.

Use the existing private production replay tooling after verifying its current route and encrypted-database compatibility. Separate queue wait, model load, writer/editor time, first useful preview, and time to validated final notes. Record calls, token counts where available, cache hits, peak memory/swap, and failures. Failed attempts remain in the denominator. Capture warm and cold conditions separately, and pair before/after runs on the same source and hardware conditions.

Deliverable: a compact capacity distribution and baseline table, with a proposed supported workload range expressed in source/request size rather than duration alone. Choose an absolute latency target for newly supported cases from this evidence before implementation; retain observed spread rather than claiming a representative p95 from a tiny sample.

## 2. Evaluate one focused budget change

Replace admission based solely on leaf count with admission based on the finite execution plan under the existing call budget. Account explicitly for required writer calls, the cost of the existing bounded recovery, optional editor calls, and compatible cache reuse. Required source coverage must be achievable before spending calls on review. Preserve current behavior for previously admitted cases.

The primary candidate permits additional writer sections by allocating the existing budget across writers and optional review. A four-section meeting does not automatically require eight calls. The exact admission boundary and recovery reserve come from the workload measurements; do not substitute a hard-coded four-section ceiling for the current three-section ceiling.

Review coverage is a quality constraint. More writers can leave fewer editor calls. Existing deterministic fallback does not establish semantic equivalence. Record which sections receive review, assess later corrections and missing/duplicated commitments, and reject the candidate if its allocation loses important meaning or systematically harms later sections.

Investigate packing only if the planning pass identifies avoidable overhead. Keep per-request context checks and output safeguards. Change the 8,000-character cap only with real evidence that larger packets improve end-to-end latency without truncation or quality loss. Fewer calls alone are not proof of better performance.

Retain mechanical composition and final validation. Do not introduce reconciliation inference to compensate for a failed candidate. If useful coverage and quality cannot fit the fixed resource envelope, report that measured limit and the smallest specific tradeoff needed before widening scope.

## 3. Make terminal outcomes actionable

Classify capacity rejection separately from transient provider failure. Explain unsupported capacity without suggesting that an identical retry will help. Keep transient retry available, preserve existing notes, and continue using the existing preview and progress mechanisms.

Record the admitted plan and actual calls/review fallbacks in existing run metrics where possible. This should make the next failure diagnosable without logging meeting content or adding a telemetry subsystem.

## 4. Verify and decide whether to ship

Focused regressions cover actual partitioning at the supported boundary, dense/fragmented sources, complete source-span coverage, four-plus-section admission or explicit rejection, recovery budget accounting, review fallback, cache hit/miss behavior, cancellation, stale input, and unchanged publication guarantees. Include the renderer's capacity/transient distinction. Update relevant existing pipeline, budget, coordinator, and presentation suites; run TypeScript and applicable lint checks.

Run paired private replays only after focused checks pass:

- Previously supported cases: no added required model calls or inference stages, and no reproducible regression in first preview or final-note latency. Repeat apparent differences enough to distinguish them from baseline variability; do not hide a slower case in a faster average.
- Newly supported cases: complete within the predeclared latency target and existing call/deadline ceilings, with all source sections processed. Compare successful outcomes; the old immediate rejection is not a useful latency baseline.
- Quality: source-reviewed actions, decisions, conditions, owners, deadlines, late reversals, and duplication meet the existing acceptance standard. Schema and citation validity alone are insufficient.
- Resources: no new swap growth, sustained pressure, or responsiveness regression attributable to the candidate. Keep local inference serialized.

Passing the replay gate permits implementation delivery and an explicit update superseding the old capacity decision. Perform the reported meeting's real Retry analysis as a separate acceptance check through the app and verify persisted notes and run metrics. Private replay success is not publication evidence.

## Expected change surface and completion

Primary files: `electron/llm/meetingNotesPipeline.ts`, relevant planner tests, and `src/components/features/meetingFailurePresentation.ts`. Touch `meetingNotesBudget.ts` only for evidenced packing work and `meetingAnalysisRuns.ts` only for needed plan/metric plumbing. Reuse existing replay scripts and test suites.

Complete when the supported range is measured, the reported meeting succeeds within the fixed resource envelope, existing successful paths retain their performance and quality, unsupported workloads receive a truthful outcome, and the decision record reflects the implemented policy. If those gates cannot be met, deliver the evidence and unresolved tradeoff rather than increasing budgets silently.

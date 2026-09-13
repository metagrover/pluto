# Meeting-notes capacity and quality

Status: Approach revised after PR #826. Further capacity changes are not ready to ship.

## Objective

Support ordinary 30-minute through two-hour meetings without sacrificing material facts, correct commitments, or responsiveness. Duration is a workload sampling criterion; admission must account for transcript size, fragmentation, request context, and output capacity.

Keep changes within the current planner, writer/editor pipeline, run coordinator, and source-grounded publication path. Do not change production model routing or introduce concurrent local inference.

## What is established

The reported 29-minute-35-second meeting contains 727 segments and 27,308 source characters. Historical attempts required four leaves and failed before inference under the former three-leaf admission rule. PR #826 now admits four leaves by reserving two of the six model calls for one possible writer recovery split.

This fixes an admission boundary, not general long-meeting support. Five or more leaves still fail. Four successful writers can leave only two editor calls; recovery can consume those remaining calls. Unit tests of call accounting do not establish notes completeness or equivalent semantic quality.

The 8,000-character per-leaf limit was introduced after actual writer output truncation. The current 2,048-token writer output allowance does not grow when the input packet grows. Input fit is therefore not evidence that a larger packet is safe.

Mechanical source validation checks cited claims. It does not establish that all important source facts were included or that a commitment was not reversed later in another leaf. Current mechanical leaf composition has no whole-meeting semantic reconciliation.

A planning-only diagnostic covered 83 readable exports, with two invalid/empty sources excluded. It found longer, denser meetings that still exceed admission. This diagnostic used empty user notes and hints, rather than each meeting's exact production context; it is workload evidence, not an exact reproduction or a quality evaluation.

Two attempts to replay the reported source returned no notes: one stopped after a power-source change; the next stopped on macOS memory-pressure warning after one request. Neither counts as successful inference, a latency baseline, or quality acceptance. No production notes were modified.

## Approach correction

Withdraw the experimental removal of the character cap and the writer-only packing fallback. They have no completed quality or performance evidence. The fallback also consumes editor headroom and can leave no recovery allowance.

Retain existing production inference behavior while evaluating a replacement. Restoring manual retry for a persisted capacity failure is independent: a historical error cannot establish current capacity after an app or model change. Describe the previous failure truthfully, keep automatic retry limits, and do not promise that another attempt will succeed.

The six-call ceiling is an existing implementation constraint, not the user's definition of performance. Do not silently raise it, but do not force longer transcripts into oversized packets or remove review merely to preserve that number. A proposed replacement must explain required work and demonstrate acceptable latency and quality. Supporting more speech may require more inference; fewer calls alone are not a speed result.

## 1. Establish reference quality and performance

Use the existing read-only replay tooling with protected local source and output artifacts. Reproduce the app's source projection, confirmed speaker evidence, user notes, terms, template, provider and context before treating a replay as the production baseline. Record any mismatch explicitly.

Select a small representative set with short already-successful cases, the reported failure, and dense 60/90/120-minute cases. Include commitments revised or cancelled late, conditional offers, owners, deadlines, numbers, and repeated topics across leaf boundaries. Do not select only transcripts that a candidate admits. Use a separate held-out set for the final decision.

Before inspecting candidate output, record a source-based checklist of material facts and commitments with exact evidence, including late corrections. Compare generated notes against this checklist and the full transcript. Existing generated notes are a performance baseline, not ground truth.

Record writer/editor and total time, time to useful preview, physical requests, truncations, cache state, reviewed leaf coverage, resource stops, and failure outcomes. Compare the same sources under comparable power/load conditions; separate warm and cold/cache cases. Avoid running builds or tests during timed measurements. Retain interrupted and failed attempts in the denominator.

Set an explicit latency target for newly supported workloads from successful baseline measurements before selecting a candidate. A previous immediate rejection is not a useful performance baseline.

## 2. Evaluate the smallest evidenced change

Start with request/output measurements to identify the actual bottleneck. Preserve the character cap, editor context reserve, and recovery allowance unless a specific tested replacement performs better.

Use the existing planner and cache. If a bounded allocation of writers, review and recovery can cover longer sources without degrading quality or responsiveness, implement that allocation with an explicit workload limit. Reject candidates that systematically skip later reviews, omit important facts, or retain superseded commitments.

If cross-leaf corrections fail, establish a focused counterexample before choosing a remedy. Reuse existing source-grounding and inherited-commitment checks where they apply. Do not add an unconditional model merge or revive the full expensive hierarchy without measured justification.

Keep direct and previously successful paths unchanged unless paired evidence supports the change. Add no speculative background workload, persistent job system, new model, or timeout increase as a substitute for the capacity fix.

## 3. Regression and release gates

Focused tests must use realistic partitioning and nonempty drafts, rather than only mocked leaf counts or empty notes. Cover exact span coverage including split segments, context and output limits, call/recovery accounting, optional review behavior, cache invalidation, cancellation, stale source/run revisions, and atomic publication.

Real model evaluation is a separate gate:
- No critical omissions, invented commitments, wrong owners/deadlines, lost conditions, or retained cancelled commitments against the source checklist.
- Compare review coverage and errors by leaf position; aggregate scores must not hide worse late-meeting notes.
- Existing successful cases show no reproducible latency or responsiveness regression.
- Newly supported cases meet the declared latency target with complete, useful notes; schema/citation validity alone does not pass.
- Resource guards remain enabled. A stopped replay is a stopped replay, not a notes-quality result.

Do not weaken source validation or publish truncated/partial output to turn a failure into a success. Retain existing notes during regeneration.

Open implementation PRs with the measured workload, quality findings, timing spread, and remaining limitations. Do not mark general long-meeting support ready on planner tests alone. Update the accepted capacity decision only when the replacement has this evidence.

Finally run Retry analysis for the reported meeting through the app and verify persisted output and run metrics. Private replay is not publication acceptance.

## Current delivery boundary

The follow-up change restores the manual retry action and corrects the historical-capacity message. It changes no inference, packing, review, recovery, or publication behavior. General long-meeting support and quality/performance acceptance remain outstanding; the resource-stopped replays do not justify widening production capacity.

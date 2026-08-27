# Gemma schema reliability: acceptance record

Issue #674. Local-only implementation and synthetic evaluation; no default-model switch or production meeting regeneration.

## Predeclared evaluation

The previous report remains unchanged in `2026-08-27-local-notes-guardrails-evaluation.md`. Its successes and failures are not retroactively rescored.

Compare the same three short cases (personal conversation, qualified publication, accepted request/privacy) and one new longer exhibition-planning conversation at seeds 41 and 73. The new fixture checks early and late commitments, a conditional courier booking, an unrelated withdrawn promise, an unaccepted offer, a numeric decision and personal/contextual coverage. Exact expectations are in `tests/manual/fixtures/meetingNotesGemmaReliabilityCases.ts` before inference. It is a longer direct-input synthetic test, not evidence of real-recording or hierarchical acceptance.

The content prompt, model, sampling and per-stage output budgets stay fixed. Only generation structure is constrained. Existing source decoding, semantic validation and one repair per stage remain active. Short cases keep their prior 270-second case limit; the new longer case has a predeclared 600-second limit. No retries outside the pipeline to select favorable samples.

Report three separate outcomes: transport completion, accepted response structure, and source-level content quality. A mechanical pass is not a semantic pass. Inspect raw responses before decoding, all final visible claims, supported ownership/deadlines/prerequisites, cancellation, decisions, narrative coverage and invented details. Unexpected faithful paraphrases can be explained separately without changing assertions after observing output.

## Runtime and configuration

Verified before inference on 2026-08-27:

- Ollama 0.32.15 at the local loopback endpoint.
- Installed `gemma4:12b`, digest `4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`, 11.9B Q4_K_M.
- Thinking disabled; temperature 0.1 for notes, seeds 41/73, eight threads, 16,384-token capacity. Actual bounded request context/output is recorded per attempt.
- Installed model parameters include top_k 64 and top_p 0.95. Notes temperature overrides the model's default 1.
- The shared server was serving Qwen work for another client during preflight. It is not an isolated runtime. Do not stop other clients, unload their model explicitly or alter server settings for this test. Elapsed times are observations, not model speed comparisons.

Ollama supports a JSON Schema object in its local `format` field, distinct from requesting generic JSON. This supplies structural constraints, not factual evidence. See [official structured-output documentation](https://docs.ollama.com/capabilities/structured-outputs).

## Deterministic implementation checkpoint

Implementation commit `ceb351524`; prospective acceptance cases/harness commit `2028c6a46`. Independent specification and quality reviews approved the change. Test-first verification reproduced missing schema transport, missing explicit response contracts and the stale persistent generation fingerprint before fixes.

The complete unit/DOM suite passed **230 files / 2,486 tests**. TypeScript and scoped Biome passed. Node tests required rebuilding SQLite; Electron 40.8.0 bindings were restored and an in-memory query verified ABI 143 afterward. The manual suite also collected all four cases without inference when the opt-in flag was absent. Existing PostCSS module-type warnings and an unavailable optional lengthy-meeting fixture were logged; these are not evidence of a real-meeting acceptance run.

The unchanged compact content prompt is still three examples. Writer/merge, audit and editor schemas enforce only structure and request-local label membership. Source meaning, ownership, complete review targets, terminology authority, cancellation and commitment conservation still pass through existing checks. Non-notes and hosted generation behavior is unchanged. The shared notes-v14/v15 constants also update the persisted generation fingerprint, preventing reuse of pre-schema notes stages.

## Frozen seed 41 results

[Raw responses, metrics, hashes and final output](../../../tests/manual/fixtures/meetingNotesGemmaSchemaSeed41.json). Four cases, ten requests: nine completed responses and one audit transport timeout. All nine returned payloads independently validate against their exact request schemas. One final document returned. These are results at `2028c6a46`, before the captured-output corrections; they are not retroactively rescored.

| Case | End-to-end outcome | Independent source review |
| --- | --- | --- |
| Personal | Audit timed out at 270s; no final | Correct attribution, bread/radio facts and no fabricated tasks/gender. Satisfaction and frustration omitted. “Hindered” adds a mild inference beyond the stated hum. |
| Qualified publication | Rejected after one audit repair; ~160s | Writer meets the content criteria. First audit wrongly removes screenshot cancellation; repair restores it. Code rejects faithful “declining” morphology and incorrectly borrows “if useful” from the declined offer as a condition on the settled decision. |
| Accepted request/privacy | Returned, two calls, no repair; ~48s | Bea's Monday task, destination, Niko recipient and full privacy policy/rationale retained. This is live confirmation of the earlier decision-preservation fix. Preparation responsibility/requester attribution remain omitted from visible notes. |
| Longer exhibition | Rejected after one audit repair; ~275s | Writer preserves both current commitments and their distinct prerequisites, ownership/deadlines, catalogue choice and withdrawn task/reason. Guardrails falsely report the cancelled camera task and already-present floor-plan task as missing. Repair then introduces a genuine duplicate-point/missing-verdict error. Emotional/contextual coverage is compressed too far; recent-win impact loosely connects inspection to the welcoming room. |

The first audit in the long case applies correctly before guardrails run. Its courier replacement is identical to the writer's action. The subsequent model repair inserts `s3:item:2` without its required verdict; that final contract rejection is valid even though false-positive guardrails caused the repair. Neither the code defect nor model repair error should be hidden by a single pass/fail label.

## Frozen seed 73 results

[Raw responses, metrics, hashes and final output](../../../tests/manual/fixtures/meetingNotesGemmaSchemaSeed73.json). Four cases, eleven completed responses, two final documents. All eleven payloads independently validate against their exact request schemas. Source content, prompt and schemas are unchanged from seed 41.

| Case | End-to-end outcome | Independent source review |
| --- | --- | --- |
| Personal | Returned, no repair; ~57s | Same writer as seed 41, unchanged audit. Correct attribution/no invented tasks; satisfaction and frustration remain omitted. |
| Qualified publication | Returned after one repair; ~110s | Retains the settled static choice/rationale, declined offer, screenshot cancellation/reason and conditional Wednesday action. Two distinct decisions are legitimate. Overview foregrounds only Marin's unaccepted offer, which is misleading in isolation even though the body records its rejection. |
| Accepted request/privacy | Rejected after one repair; ~66s | Core policy, permission, confidentiality rationale, ownership/recipient and Monday metadata are faithful. Strict grounding rejects only the shortened leading framing “Decision not …” versus “The decision is not …”; the remaining normalized predicate is identical. Preparation/requester details remain omitted. |
| Longer exhibition | Rejected after one repair; ~261s | Both audits apply correctly, including complete verdict coverage. Guardrails still falsely demand the explicitly cancelled camera task. Both current commitments, distinct conditions/deadlines, catalogue choice, withdrawal/reason and unaccepted offer are retained. Emotional/contextual coverage remains incomplete; recent-win “feasibility” is inferred. |

Across both frozen seeds: **20/20 completed responses match their exact schemas; 3/8 executions return final documents; four end in validation failure and one in audit timeout.** These counts are separate. Root and independent review checked raw JSON against the request schema hashes and original source. These samples support structural reliability, not complete source fidelity or default-model readiness.

## Bounded corrections identified by the round

The deterministic false positives were corrected in `23c7b88b2`, with exact captured responses and adversarial controls rather than changing the original model output:

- A settled decision must not inherit a condition belonging only to a clearly rejected neighboring offer. The correction is decision-only and requires exact normalized choice/rationale and explicit rejection of the sole adjacent offer. Wrong tasks, actors, recipients, polarity and real prerequisites remain rejected; original citations are not narrowed or rewritten.
- Permission expressed by the source's explicit decision can use abbreviated leading “Decision” framing, but the entire remaining normalized predicate must still match. Tentative decisions and changed content/conditions are not admitted.
- Explicit “withdrawing my promise to …” is an alternative cancellation form, not a new task. A trailing purpose clause can be excluded from task identity only under the bounded repeated-recipient rule; real task metadata and separate commitments remain material.

The tests also expose a pre-existing permissive standalone action-grounding case. It is explicitly recorded as an expected-failure control, not fixed by the decision-only correction. This is another reason not to claim general semantic safety or promote the model from these tests alone.

The exact repaired publication output, first long-case audit and seed-73 privacy output now publish in deterministic replay without changing their text or citations. Replay is regression evidence, not a fresh model-quality result. The new decision evidence view is kept separate from ownership authority. Wrong actors, recipients, compound offered tasks, real decision conditions and unrelated “declining sales” remain negative controls. The compact prompt and schema are unchanged; corrected generation/cache identities are notes-v16/v17 and guardrails-v2/schema-v1.

Independent specification review found two ambiguities in the initial correction: a second offer after the first offer's condition could be hidden by condition scoping, and a separate “I commit/promise to” clause could disappear inside the omitted purpose text. Follow-up `d13e73212` adds conservative abstention at those boundaries. Seven new regressions were observed failing before the correction and passing afterward; neither the prompt nor general action extraction was broadened.

## Final deterministic verification

At `d13e73212`, the full unit/DOM suite passed **233 files, 2,551 tests plus one explicitly expected pre-existing failure**. The expected failure is the standalone action-grounding counterexample described above; it must not be counted as corrected behavior. TypeScript, scoped Biome (23 changed code/test files) and diff checks passed. Electron SQLite bindings were restored after Node tests and verified with an in-memory query (Electron 40.8.0, ABI 143). Raw hashes and exact schema hashes for all 20 frozen responses were independently rechecked successfully.

Independent specification review approved `d13e73212` after its own 318 passing tests plus the expected baseline failure. Subsequent independent quality review approved the full corrective range after 313 passing tests plus that expected failure. Neither review found remaining blocking findings in this bounded change; neither is a production-readiness certification.

## Delivery boundary

The bounded implementation, frozen evaluation and single post-correction check are complete locally. Code is committed on `codex/674-source-grounded-notes`, not merged or pushed, and issue #674 remains open. No production meeting was regenerated; the original transcript, saved notes and configured model remain unchanged. Synthetic tests do not establish rendered-app, real-recording or hierarchical acceptance. Gemma remains a local evaluation candidate, not a promoted default.

## Single post-correction live check

[Raw responses, hashes, metrics and final notes](../../../tests/manual/fixtures/meetingNotesGemmaSchemaPostFix.json). Run at `d13e73212`, qualified-publication case, seed 41, unchanged 270-second limit. Exactly one run; no further sampling was performed.

- **Transport/structure:** Two completed responses, both schema-valid. Both request prompt hashes, schema hashes and raw-response hashes are identical to the first two attempts of the frozen seed-41 case.
- **Pipeline completion:** One writer and one audit; no repair. Final notes returned in 111,148 ms, versus a validation failure after three calls in the frozen run. Because the actual two responses are byte-identical, this demonstrates a code-path correction rather than improved model generation. Shared-server elapsed time is not a speed benchmark.
- **Retained content:** Settled static-introduction decision and rationale, explicit rejection of the animation offer, and Cleo's Wednesday publication task with the accessibility prerequisite remain correct. No screenshot task or accepted animation task is invented.
- **Remaining semantic failure:** The audit removes the screenshot cancellation and its reason, even though the writer had included them. The overview highlights only the unaccepted offer, not the settled outcome. Thus mechanical acceptance passes but full source-fidelity acceptance fails. The earlier false rejection happened to trigger a repair that restored the cancellation; that incidental repair is not a reliable coverage mechanism.

Independent source review confirmed these findings and the identical source/prompt/schema/raw hashes: structural/completion pass, source-fidelity fail. The result supports the narrower claim that the reproduced validator false rejection is fixed. It does not establish complete notes or model readiness. Next acceptance work must address omitted/cancelled context and misleading overviews, retain the known action-grounding counterexample as an explicit safety gap, and include real/long-source checks before any default-model promotion. No further stage, prompt expansion or model switch is part of this checkpoint.

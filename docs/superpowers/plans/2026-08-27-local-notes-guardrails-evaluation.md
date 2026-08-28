# Compact local notes guidance: verification record

Issue #674. Implementation and the bounded verification checkpoint are complete locally; production acceptance is not met. Synthetic local-model tests only: no production meeting regeneration, default-model switch, download or hosted inference.

## Evaluation boundaries

- Preserve historical raw outputs and historical assertions. Explicit choices not to proceed may now be decisions; absence of an assignment alone is not a choice. Do not silently turn old zero-decision gates into passes.
- Inspect raw content separately from parsing, inferred metadata and final projection. A structural pass does not establish semantic accuracy.
- Seed 41, thinking disabled, Ollama 0.32.15. Exact model digests, inherited sampling settings, request configuration, raw responses and hashes are in the artifacts below. Latencies are non-isolated observations, not speed benchmarks.
- The first comparisons use compact prompts at `f617358ab`, before guardrail integration and before flattening the schema shorthand. They cannot establish final pipeline reliability.

## Prompt-only source reconciliation

Artifacts: [three-case comparison](../../../tests/manual/fixtures/meetingNotesCompactPromptEvaluation.json), [seven-case expansion](../../../tests/manual/fixtures/meetingNotesCompactPromptBroadEvaluation.json). Baselines remain in the existing alternative-model and reconciliation evaluation artifacts.

| Model / sample | Historical gates | Independent raw review |
| --- | --- | --- |
| Gemma 4 12B, three previous failures | 0/3 | All three retain the correct qualified action; prior missing prerequisite and unaccepted-offer action defects improve. Failures are an old decision-count policy, a regex missing “withdrew”, and a whole-evidence decision guard. Decision owners remain null; one unsupported gender pronoun remains. |
| Qwen 3.5 9B, same three cases | 0/3 | Conditional case loses Ava's action entirely; withdrawal case still promotes Ben's offer. Reassignment removes duplicate action but introduces an unconditional decision claim and wrong attribution. These are substantive content defects, not merely gate disagreements. |
| Gemma 4 12B, seven additional cases | 3/7 | Personal conversation, accepted-request ownership and source-defined acronym pass. Interview and rejected-alternative cases omit decision citations and lose/misclassify content. Brainstorm fails a narrow wording regex; replacement case fails old zero-decision policy. |

Gemma's sampled action handling is more promising than Qwen's, but neither the single-seed comparison nor the source-stage results establish a reliable general-purpose notes pipeline. No automatic model promotion follows from these results.

## Pre-integration complete-note baseline

[Raw writer attempts and timings](../../../tests/manual/fixtures/meetingNotesCompactEditorBaseline.json) record three Gemma editor-pipeline cases at `e1d9aaaf9`: conditional promise, accepted request, and withdrawal plus qualified publication. All three fail in the writer before the editor or final semantic scorer runs. Each initial response nests item text/sources inside `text`; some also use the unsupported kind `discussion`. Each one-repair attempt repeats the initial payload exactly. Total model-request elapsed times are approximately 76, 46 and 129 seconds respectively.

This prompted a general schema clarification: spell out the flat Item/Action/Decision fields instead of using `Text +` shorthand. It does not authorize parser normalization, extra retries or additional semantic examples. Post-clarification complete-note results are separate from this baseline.

## Deterministic safeguards

The pure source-check module passed 66 tests plus independent specification and quality reviews at `e1d9aaaf9`. Covered cases include empty action output, omitted prerequisites, linked cancellation, renewal, ownership isolation, task identity independent of deadline, source-window scope, quoted/reported speech and personal commitments.

The checks deliberately abstain on recognized compound conditional promises, including omission detection for those sentences. Task verbs, adjacent acceptance and lexical equivalence are bounded. These are correction signals, not a complete semantic extractor. Cancellation matching is clause-bounded; equivalent unless/if-not conditions are accepted, while opposite polarity is rejected.

Integration reuses one existing repair attempt per stage, preserves exact inherited commitments, and prevents publication after unresolved validation failure. After final review fixes at `fab6005a3`, the full regression checkpoint passed 229 files / 2,447 tests, followed by restoration and an in-memory verification of Electron 40.8.0 SQLite bindings (ABI 143). Typecheck, scoped Biome and changelog checks also passed. Review covered lost predicates, prerequisites and recipient scope in negative choices, exact repeated promises without borrowing pre-cancellation evidence for a renewal, and audit-supported commitments silently discarded by grounding. All implementation changes passed independent specification and quality review.

## Integrated candidate, before final review fixes

[Candidate raw attempts](../../../tests/manual/fixtures/meetingNotesCompactEditorCandidate.json) record the same three editor cases at `76b555887`. Historical semantic gates remain 0/3. The flat schema clarification resolved nested text fields: the conditional case reached the editor but failed on an explicit leave-unassigned decision, and omitted the unaccepted offer throughout. The accepted-request case returned a final document in two calls with the correct owner, recipient and deadline, but lacked narrative content and failed the historical narrative gate. The withdrawal case retained the correct content in raw output but still used unsupported `discussion` item kinds and failed both writer attempts.

Subsequent changes add a narrowly source-matched negative-choice check, explicit retention of material unaccepted offers, and a stage-specific instruction to encode discussion as `kind: "point"`. These changes are not credited to the saved candidate results. Content guidance remains three examples; no parser coercion or extra retry was introduced.

## Prospective final local sample

The following criteria are declared before new inference. Use new names and task objects, seed 41, already-installed local models only. Record structural results independently from semantic review; preserve failures rather than relaxing historical assertions. This small sample cannot establish general reliability.

1. Personal conversation: Jun's first sourdough was flat and the second rose; Esme's radio restoration has a frustrating persistent hum. Preserve attribution, progress and emotions without fabricated help tasks, decisions, questions or gender.
2. Qualified publication: Cleo withdraws a screenshot replacement because existing images are accurate, rejects Marin's offered animation in favor of a static introduction because animation distracts, and commits to publish a captioned demonstration on the support portal by Wednesday once accessibility review passes. Exactly one active action, owned by Cleo with prerequisite and deadline. Preserve the settled static-introduction choice, rationale, withdrawn task and reason. One or two decisions are legitimate only if the second is the distinct screenshot cancellation, not a duplicate of declining animation.
3. Accepted request and privacy: Tariq asks Bea to upload an anonymized survey table to the research workspace by Monday for Niko; Bea explicitly accepts and Niko is the intended user, not owner. Exactly one action, owned by Bea with destination, recipient and deadline. Preserve the settled policy against publishing individual responses and allowing aggregate counts only, with confidentiality rationale. One combined or two complementary decision records are legitimate. Do not create an aggregate-publication task.

For collective/passive decisions, null decision owner is legitimate; a reporting speaker is not automatically the decision maker. Review all visible claims, not only hidden evidence. Prerequisites, due dates and recipients must attach to the relevant action. A historical promise is acceptable only when explicitly withdrawn. Unfamiliar faithful paraphrases may receive a separate manual adjudication, never a rewritten automated result.

The initial fresh Gemma audit attempt was stopped by the controller during loading, before any model response, after final code review found a repeated-promise coverage regression. It receives no semantic score. Its log remains `/tmp/pluto-674-final-gemma-audit-aborted-before-output-41.log`; the server and running app were not stopped. Final measurements must use the reviewed correction, not this aborted run.

## Fresh default-audit results at `832cd111e`

The actual completed run order is Qwen, then Gemma. Seed 41; no prompt tuning between cases. The shared runtime was servicing other generation and model loads, so elapsed times must not be used to compare model speed.

[Qwen raw attempts, exact configuration, hashes and metrics](../../../tests/manual/fixtures/meetingNotesLocalGuardrailsQwenEvaluation.json): three cases, six writer requests, zero final documents returned. Every case exhausted its one writer repair; no audit or final mechanical assertions ran.

| Qwen case | Raw content review | Failure / repair |
| --- | --- | --- |
| Personal | Correct speaker/experience association, sourdough progress and experimentation. Invents Esme's gender, changes ongoing radio restoration to completed work, and manufactures mutual agreement/a decision. | Initial malformed section entry becomes an invalid recentWin object. Repair adds satisfaction but preserves the unsupported claims. ~161s total. |
| Qualified publication | Correct sole active action with Cleo, Wednesday, destination and review prerequisite; retains withdrawal/reason, declined animation and static-choice rationale. Invents Cleo's gender. | Repair restores collective decision wording and Marin attribution, but drops the citation supporting “today” and leaves overview as a string. ~144s. |
| Accepted request / privacy | Core claims are faithful: Bea's upload, Monday, research workspace, Niko's use, aggregate-only policy and confidentiality rationale. Preparation status and requester attribution are omitted from visible notes. No invented publication task. | Parsed repair content is unchanged; string overview and missing decision fields remain. ~200s. |

These results do not establish reliable note generation. Faithful raw action content is not a returned final note, and failure-safe rejection is not a semantic success. The privacy case is chiefly a format/coverage failure, not a hallucinated commitment.

[Gemma candidate raw attempts and final output](../../../tests/manual/fixtures/meetingNotesLocalGuardrailsGemmaEvaluation.json): three cases and six requests. Two final documents were returned; one passed mechanical assertions and one failed them. These historical results precede the supported-decision preservation correction below and are not rewritten after it.

| Gemma case | Raw/final content review | Mechanical outcome |
| --- | --- | --- |
| Personal | Source-faithful speakers and experiences, no fabricated gender/decision/task. Satisfaction and frustration omitted by writer and unchanged audit. | Returned; count/field/source checks pass, but coverage incomplete. Two calls, no repair; ~141s. |
| Qualified publication | Both raw attempts preserve every required content element, including condition, recipient/destination, withdrawal/reason and declined offer. | Writer fails: singular `source` remains on items after repair partly fixes titles. No final or audit. ~173s. |
| Accepted request / privacy | Writer preserves correct Bea action and complete privacy policy; requester/preparation detail omitted. Audit supports both unchanged. Code then removes the policy and rationale, leaving only action and generic overview. | Returned, but decision-count check correctly fails. Two calls, no repair; ~108s. |

The privacy loss was a code defect, not a model omission: `applyNotesAudit` silently filtered a supported commitment when `groundSourceReviewedItem` rejected it. The modal check saw permission word “may” without recognizing the explicit “The decision is” construction already allowed by another decision check. This prompted the bounded correction and targeted replay below; original raw outputs remain unchanged.

## Preservation correction and final checkpoint

Implemented and reviewed at `fab6005a3`. Audit-supported actions and decisions rejected by deterministic grounding now enter the existing repair/failure path instead of disappearing. Explicit unsupported/uncertain audit removals remain unchanged. The permission exception is decision-only, requires an initial explicit decision marker and full punctuation-normalized source equality, and rejects proposal language or unfinished decision status; genuine publication prerequisites remain intact. Global action-resolution cues and prompts did not change.

The captured real writer/audit regression now returns the original privacy decision and its evidence alongside Bea's Monday action, with zero repairs. Inverted policy fails after one repair; an invalid supported offer can be repaired into source-backed discussion. The final full suite passed 229 files / 2,447 tests, typecheck and scoped Biome passed, and Electron SQLite ABI 143 was restored and verified. Independent specification and quality reviews approved the fix.

[Post-fix live replay](../../../tests/manual/fixtures/meetingNotesLocalGuardrailsGemmaPostFix.json) used the same Gemma model, prompt and seed. Its writer was byte-for-byte identical to the historical response (SHA256 `50b8ebcd5430c608596c86176600bec64f32f34cd6b8adedf1577c7c1a33ecae`). The shared-runtime run reached the 270-second case limit during audit transport, before any audit response or final document. This is **inconclusive live verification**, not a semantic pass or failure. The captured-response regression proves the code correction; it does not turn this timed-out run into a live success.

### Delivery boundary

- Compact guidance and bounded safeguards are implemented and committed locally on `codex/674-source-grounded-notes`.
- Fresh model evidence remains mixed: Gemma's raw publication content is faithful, but schema errors still prevent some notes; personal/requester detail can be omitted, and Qwen retains unsupported claims in some cases.
- Remaining acceptance work is reliable local schema output, narrative coverage, and complete live verification after the preservation correction. No large-source editor/reconciler or rendered-app acceptance is claimed.
- Issue #674 remains open. No merge, push, production regeneration or model promotion was performed. No hosted/API baseline is required.

# PR #676 bounded relative-improvement pass

The user approved the revised review-step fix and explicitly accepts meaningful improvement over the previous model/prompt without requiring perfect notes. Keep every historical score unchanged. No serious new factual/task regression, privacy change, weakened validator, or unexplained runtime regression is acceptable.

## One implementation revision

Use test-first implementation and independent specification then quality review. Strengthen the existing audit and its existing single repair, not the shared writer policy or runtime architecture:

- Check final notes against every source turn, not merely the draft targets. Put every accepted operation, prerequisite, deadline, owner and recipient in the action itself; a summary mention is insufficient.
- Preserve material completed-work attribution/timing and explicit personal feelings/reasons as discussion. Do not infer missing facts.
- Distinguish settled choices from clarifications of task scope. Correct every instance of a reported kind error, not just the first parser target.
- Correct wording, kind and supporting sources together. Include antecedent task scope and acceptance where necessary. Use only relevant exact descriptors, but inspect all permitted later turns for reversals; never hide contradictory evidence by narrowing citations.
- Return actual replacements/insertions and corresponding verdicts. Keep schemas, validators, one-writer/one-audit normal path, repair limits and source boundaries unchanged. No withdrawal exception.
- Bump identities to notes-v26/v27. Test prompt contracts and the actual one-repair request; deterministic replays do not constitute model-quality evidence.

Freeze this candidate before live evaluation. No further prompt tuning after seeing comparison output.

## Comparison

Run the four unchanged original cases once per system, seed 41, thinking disabled, installed models only. Previous system is the main-checkout Qwen 3.5 9B / notes-v9 implementation; candidate is Gemma 4 12B / notes-v26. Record the baseline commit and code hashes, and validate imports without inference before beginning. Preserve each system's production stage, sampling and context behavior: this compares complete systems, not an isolated model or prompt effect. No production DB/settings calls.

Use the same source turns and original source-fidelity criteria. Retain all raw responses and failures, final notes, stage counts, settings/hashes and latency. Bound each system/case to 600 seconds with cancellation, no outside retries, one local-model evaluation at a time. Stop if cancelled; don't replace bad samples. No concurrent builds or unrelated inference during timed comparison.

Independent review judges completion, material omissions, incorrect claims, action/decision correctness and readability. Report strict historical criteria separately from relative preference. Missing conditions, wrong owner, invented commitments or reversed decisions are serious and cannot be traded for nicer prose. Consider smaller context/attribution omissions as recorded follow-up work when the candidate is clearly preferable overall. Do not call an inconclusive/timed-out baseline a win.

## Finish decision

Run focused and full code checks, build/runtime verification and restore Electron bindings. If comparison supports improvement without serious regressions, finish the remaining representative/hierarchy/integration checks before landing. Otherwise stop this attempt, retain the verified checkpoint as draft, and give a direct recommendation. No additional approval/tuning loop. Preserve main-checkout dirty/ahead work and all production notes/settings/model defaults.

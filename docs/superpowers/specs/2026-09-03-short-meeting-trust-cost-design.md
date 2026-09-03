# Measure the cost and value of trusted meeting notes

**Status:** Approved direction, awaiting written-spec review

**Issue:** [#739 — Make short-meeting trusted notes meaningfully faster](https://github.com/metagrover/pluto/issues/739)

**Related:** #701 owns capture-time incremental reuse; #698 owns the existing latency metrics and benchmark harness.

## Outcome

Before changing Pluto's production notes path, measure what each trust layer contributes on short synthetic meetings and how much recorded model time it costs. The result should tell us whether the final semantic audit catches defects that cheap deterministic checks miss.

This first iteration is diagnostic only. It does not change notes generation, persistence, UI, prompts, models, scheduling, or publication eligibility.

## Inputs

Reuse committed synthetic evaluation artifacts that already contain:

- transcript source and reviewed expectations;
- captured writer and audit attempts;
- final analysis or stable failure category;
- content-free stage timings and token counts.

Do not run a model or read a private meeting in this iteration. Reject artifacts without the required synthetic source, stage identity, and reviewed expectations rather than guessing.

## Comparison

Add a small pure evaluator that reports three checkpoints per case:

1. **Writer output:** the validated first writer response.
2. **Deterministic boundary:** the writer response after existing schema, source-reference, guardrail, and commitment-conservation checks that do not call a model.
3. **Audited result:** the final result after the captured semantic audit and any recorded repair.

For each checkpoint, report only aggregate quality facts already supported by the synthetic fixture:

- exact-evidence support;
- false-positive and false-negative counts;
- reviewed semantic checks passed;
- retained decisions and actions;
- stable rejection category when a checkpoint is unusable.

Report recorded writer, audit, and repair time separately. Never infer time for missing stages.

## Output

Expose the comparison through a repository script that prints deterministic JSON. The report includes fixture name, model and prompt-version identifiers, aggregate counts, stage durations, and a conclusion code:

- `audit_added_unique_value` when the audit catches a reviewed defect that deterministic checks retained;
- `deterministic_checks_sufficient_for_fixture` when the audited result adds no reviewed correction;
- `writer_unusable` when no valid writer checkpoint exists;
- `insufficient_fixture_evidence` when the comparison cannot be made safely.

The report must not include raw transcript, prompts, model responses, evidence text, participant names, or private paths.

## Implementation boundary

- Write failing unit tests for checkpoint classification and privacy-safe serialization before implementation.
- Reuse the existing quality scorer and parsers; do not create a second semantic taxonomy.
- Keep the evaluator independent from the production generation and publication path.
- Make no provider calls and add no feature flag.
- Do not alter historical fixture contents.

## Verification

The iteration is complete when:

- focused tests fail before implementation and pass afterward;
- the script produces the same report on repeated runs, with no wall-clock timestamp because the report is a comparison artifact;
- an automated privacy test rejects forbidden text-bearing fields;
- TypeScript and Biome pass for touched files;
- the result is summarized on #739 before deciding whether any production audit can be removed.

## Decision after measurement

No production change follows automatically. If the audit adds unique value, retain one final semantic audit and optimize elsewhere. If deterministic checks are sufficient across the reviewed short-meeting fixtures, design a separate benchmark-only audit-ablation experiment. Intermediate hierarchy audits remain out of scope for this iteration.

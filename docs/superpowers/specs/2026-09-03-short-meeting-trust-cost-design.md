# Measure trust cost across the meeting-intelligence pipeline

**Status:** First diagnostic iteration implemented in [PR #740](https://github.com/metagrover/pluto/pull/740)

**Issue:** [#739 — Make short-meeting trusted notes meaningfully faster](https://github.com/metagrover/pluto/issues/739)

**Related:** #701 owns capture-time incremental reuse; #698 owns the existing latency metrics and benchmark harness.

## Outcome

Before changing Pluto's production pipeline, identify where repeated model work, duplicated source context, and defensive retries add cost without adding commensurate accuracy. Measure the stop-to-trusted-notes path separately from background enrichment so an improvement in one is not mistaken for an improvement in the other.

This first iteration is diagnostic only. It does not change notes generation, persistence, UI, prompts, models, scheduling, or publication eligibility.

The working hypothesis is that Pluto's inexpensive trust boundary remains valuable, while repeated semantic interpretation of the same evidence may be excessive. The measurement must be capable of disproving that hypothesis.

## Pipeline boundaries

Classify existing work into five zones:

1. **Capture seal:** accepted stop through durable capture-journal seal.
2. **Canonical source:** audio materialization, final ASR, channel reconciliation, speaker attribution, transcript validation, canonical commit, trust admission, and revision identity.
3. **Primary notes:** writer, hierarchy, semantic audits, repairs, merges, and guarded publication.
4. **Publication trust kernel:** schema, allowed-source, commitment-conservation, revision, and transactional checks that do not call a model.
5. **Secondary intelligence:** value signals, entities, commitment reconciliation, MID generation, and later knowledge refresh.

Report four top-level timing boundaries rather than one aggregate:

- **stop_to_sealed_capture:** accepted stop through durable capture-journal seal;
- **sealed_to_canonical_transcript:** media materialization through validated canonical commit;
- **canonical_to_trusted_notes:** notes generation, review, deterministic checks, and guarded publication;
- **post_publication_compute:** work that enriches People, Projects, commitments, search, or knowledge after notes are available.

Within `sealed_to_canonical_transcript`, retain content-free stage measurements when the input artifact records them: `materialize_mic`, `materialize_system`, `build_mix`, `transcribe_mic`, `transcribe_system`, `reconcile_channels`, `attribute_speakers`, `validate_transcript`, and `commit_canonical`. Keep queue time separate from active time and retain attempt/resume state when recorded. Missing boundaries or stages are `null`; never infer them or fold them into another boundary.

Finalization recovery remains owned by #718/#446. This issue measures that boundary without changing or bypassing the canonical transcript gate.

## Inputs

Reuse committed synthetic evaluation artifacts that already contain:

- transcript source and reviewed expectations;
- captured writer and audit attempts;
- final analysis or stable failure category;
- content-free stage timings and token counts.

Do not run a model or read a private meeting in this iteration. Reject artifacts without the required synthetic source, stage identity, and reviewed expectations rather than guessing.

## Cost and value ledger

For every observable pipeline stage, report:

- zone and stage identity;
- whether it calls a model;
- recorded input and output tokens when present;
- recorded duration when present;
- source material consumed, expressed only as safe counts or hashes;
- whether the source is repeated from an earlier stage;
- trust invariant or product consumer served;
- stable failure category and whether failure blocks note publication;
- reviewed defects uniquely caught, when the committed fixture supports that claim.

Never infer timing, token counts, or quality effects for missing evidence. Mark them unavailable.

Classify recovery work separately so cascades remain visible:

- malformed-contract repair;
- transient leaf retry;
- compact retry after truncated output;
- source or draft repartition;
- context-overflow replanning.

Report the number of attempts, model time spent before the final successful attempt, and terminal outcome. Existing hierarchy limits are safety ceilings, not evidence that a recovery sequence is efficient.

## Audit comparison

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

This comparison addresses the first candidate optimization: deterministic validation at intermediate hierarchy nodes with one semantic audit at the final document. It does not assume that the candidate is safe.

## Output

Expose the ledger and audit comparison through a repository script that prints deterministic JSON. The report includes fixture name, model and prompt-version identifiers, aggregate counts, stage durations, pipeline totals, and a conclusion code:

- `audit_added_unique_value` when the audit catches a reviewed defect that deterministic checks retained;
- `deterministic_checks_sufficient_for_fixture` when the audited result adds no reviewed correction;
- `writer_unusable` when no valid writer checkpoint exists;
- `insufficient_fixture_evidence` when the comparison cannot be made safely.

The report must not include raw transcript, prompts, model responses, evidence text, participant names, or private paths.

The report may include only committed synthetic fixture identifiers and content-free production metric aggregates. It must not open or summarize a private meeting.

## Implementation boundary

- Write failing unit tests for checkpoint classification and privacy-safe serialization before implementation.
- Reuse the existing quality scorer and parsers; do not create a second semantic taxonomy.
- Keep the evaluator independent from the production generation and publication path.
- Make no provider calls and add no feature flag.
- Do not alter historical fixture contents.
- Do not combine capture, canonical-finalization, primary-note, or secondary-processing duration.
- Do not treat asynchronous publication as evidence that total compute decreased.

## Verification

The iteration is complete when:

- focused tests fail before implementation and pass afterward;
- the script produces the same report on repeated runs, with no wall-clock timestamp because the report is a comparison artifact;
- an automated privacy test rejects forbidden text-bearing fields;
- the report distinguishes all four timing boundaries and marks unavailable capture/canonical/secondary evidence as `null`;
- repeated model consumption of the same source is visible as counts, without exposing that source;
- TypeScript and Biome pass for touched files;
- the result is summarized on #739 before deciding whether any production audit can be removed.

## Small experiment sequence

Each later experiment requires its own reviewed design adjustment and failing tests before implementation:

1. **Intermediate-audit ablation:** compare the current hierarchy with deterministic intermediate checks plus one final semantic audit.
2. **Bounded recovery policy:** compare the current repair/repartition cascade with deterministic preflight partitioning and a measured per-meeting model-call budget. Preserve at most one contract repair where it demonstrably recovers a valid result; prevent repair, compact retry, overflow replanning, and repartition from cascading without a shared budget. Exhaustion must fail closed and retain resumable diagnostics rather than publish degraded notes.
3. **Notes-first secondary extraction:** compare entities, actions, and value signals extracted from grounded structured notes against the current transcript-first path, using the transcript only for exact-evidence verification.
4. **Short-meeting model readiness:** measure warm versus cold model startup independently from notes quality; do not precompute or persist provisional analysis in this experiment.
5. **Production change:** select only the smallest candidate that demonstrates a meaningful efficiency gain while meeting the existing reviewed accuracy bar.

## Decision after the first measurement

No production change follows automatically. If the audit adds unique value, retain one final semantic audit and optimize elsewhere. If deterministic checks are sufficient across the reviewed short-meeting fixtures, design a separate benchmark-only audit-ablation experiment. Intermediate hierarchy audits remain out of scope for this iteration.

Secondary intelligence is also out of scope for production changes in this iteration. The ledger may identify it as expensive, but a notes-first replacement must preserve entity/action recall, false-positive limits, exact-evidence rules, and reversible persistence before it can ship.

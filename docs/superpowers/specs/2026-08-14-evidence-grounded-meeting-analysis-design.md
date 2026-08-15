# Evidence-grounded meeting analysis design

**Issue:** [#594](https://github.com/metagrover/pluto/issues/594)
**Status:** Approved direction

## Outcome

Given a validated transcript, Pluto produces concise analysis that distinguishes settled decisions and committed actions from proposals, questions, and discussion. Every user-facing settled item resolves to exact transcript evidence, and unsupported attribution fields never survive as fact.

## Shared taxonomy

1. A settled decision requires explicit agreement, selection, approval, rejection, declaration, or resolution of a concrete path. An explicit rejection is recorded as the rejected option or accepted alternative using the resolving clause, not a nearby cue.
2. A committed action requires explicit personal commitment, accepted request, explicit assignment, or clearly mandated follow-up.
3. Proposals and recommendations remain in summaries or key points until explicitly settled.
4. Open questions remain in `open_questions` while unresolved.
5. Factual and exploratory discussion informs the summary without creating commitments.

Single-pass, per-topic, and JSON-repair prompts use this exact policy. Extraction volume is not a quality target.

## Grounding boundary

- Each retained decision/action must include a short verbatim evidence slice.
- Evidence resolves within one transcript line after NFKC Unicode normalization, case folding, punctuation folding, and whitespace collapse.
- The claim must conserve at least 80% of its normalized content tokens in the resolved evidence slice. Whole-transcript token overlap cannot establish support.
- Unsupported settled items are removed.
- Assignee, due date, decider, and rationale survive only when the resolved source line directly contains the field value after the same normalization.
- Topic arrays are authoritative. Top-level rollups are rebuilt and deduplicated from grounded topic items.
- Diagnostics retain privacy-safe category names and counts, never evidence, transcript text, identities, or meeting metadata.

## Ollama policy

- Structured JSON requests explicitly set the thinking capability, defaulting to disabled.
- A deterministic seed can be configured for evaluation.
- Capability settings are explicit provider configuration, not model-name substring checks.
- Prompt version and generation settings are persisted in analysis metadata.

## Quality gate

The local benchmark invokes the production `UnifiedLLMProvider` and exact production prompts. It runs the four reviewed fixtures plus deterministic courtesy, exploration, explicit decision/commitment, missing-field, competing-proposal, rejected-decision, and unaccepted-request cases. Three seeded repeats are the default.

The aggregate report is content-free and records provider, model, prompt/fixture version, generation settings, format/fallback counts, false-positive counts, exact-evidence support, quality score, latency, process RSS, and resident model memory when Ollama exposes it.

Release requires zero fallback, evidence on every retained settled item, all precision cases passing, improvement above the 30/48 reviewed baseline with no fixture regression, and acceptable latency/memory on the supported 16 GB Apple Silicon baseline. A one-repeat preflight runs first; the three-repeat release gate runs only for a candidate that passes every preflight quality requirement.

## Preflight result

The 2026-08-14 one-repeat production-provider preflight used prompt `notes-v5`, thinking disabled, seed 42, four reviewed fixtures, and eight synthetic precision cases:

| Model | Reviewed score | Precision cases | False positives | Exact evidence | Average case latency | Resident model |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `phi4-mini:3.8b` | 29/48 | 5/8 | 0 | 2/2 | 6.9 s | 3.1 GB |
| `qwen3.5:9b` | 31/48 | 7/8 | 0 | 9/9 | 15.2 s | 5.5 GB |

Neither candidate passed the release gate, so the three-repeat release run and foreground default-model change were correctly skipped. Qwen remains a promising idle/background candidate, not the foreground analysis default. A targeted Qwen run with structured thinking enabled returned no usable strict-JSON response, confirming that structured thinking stays disabled unless a separately budgeted two-pass design is validated.

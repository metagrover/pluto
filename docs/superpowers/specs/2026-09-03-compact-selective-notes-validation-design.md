# Compact writer and editor meeting notes

**Status:** Approved for implementation

**Issue:** [#739 — Make short-meeting trusted notes meaningfully faster](https://github.com/metagrover/pluto/issues/739)

## Outcome

Generate trusted notes for direct meetings with two bounded calls to the same
model: one compact writer and one complete-document editor. Keep Pluto's
mechanical trust boundaries, but remove repeated whole-document verdicts,
repairs, merges, and semantic routing machinery from the direct path.

This is one production entry point. During the first rollout, inputs that cannot
fit the direct two-call budget continue through the existing long-meeting path.
That compatibility path is not redesigned in this change.

## Why this design

The compact-writer benchmark on one validated 14-minute meeting cut warm runtime
from 116.6 seconds to 55.6 seconds and roughly halved output tokens. It was not
safe to publish alone: one run omitted a useful follow-up and another promoted a
tentative preference and review suggestions into commitments.

The earlier selective-validation proposal tried to address those failures with
deterministic semantic triage, a coverage scanner, ambiguity packets, and a
reason-code taxonomy. That would recreate a second meeting-understanding engine
in code. Ordinary meetings also contain enough pronouns, hedges, and cross-turn
context that the supposedly optional reviewer would usually run anyway.

Pluto already has a complete-document editor contract. Reusing it gives the
model one explicit opportunity to correct omissions and semantic mistakes while
keeping the system small.

## Direct-meeting pipeline

```text
validated canonical transcript
          |
          v
compact source-backed writer
          |
          v
complete-document editor (same model)
          |
          v
mechanical source and trust checks
          |
          v
revision-checked transactional publication
```

### Compact writer

The writer returns section titles and useful items. Each item contains only its
kind, concise text, and one to three request-local source labels. Code derives
IDs, title evidence, overview, owner, and deadline where the evidence permits.

The writer gets one attempt. Malformed or truncated output fails the direct run;
there is no model repair call.

### Complete-document editor

The existing editor receives the canonical source and expanded writer draft. It
returns one complete corrected document rather than patches or a verdict for
every block. It must:

- restore material omissions;
- distinguish suggestions, willingness, questions, and completed work from
  commitments;
- preserve conditions, deadlines, cancellations, replacements, polarity,
  attribution, names, and numbers;
- keep useful personal and brainstorming context as discussion;
- use only supplied source labels.

The editor uses the same configured model as the writer and gets one attempt.
Malformed, truncated, over-budget, cancelled, or semantically unsafe output
fails closed. There is no model repair or third rewrite.

### Mechanical validation

Code performs checks that do not require broad interpretation:

- strict JSON and response-schema parsing;
- exact decoding of request-local source labels;
- rejection of unknown or out-of-range sources;
- existing narrow commitment, condition, owner, deadline, source-label, and
  contradictory-wording guards;
- canonical source-revision and cancellation checks;
- deterministic derivation of rollups;
- atomic replacement of existing notes only after all checks pass.

Code does not classify every item as accepted, rejected, or ambiguous. It does
not scan the transcript to author missing notes. The semantic use cases below
are evaluation cases for the editor, not a runtime rules engine.

## Semantic quality cases

The writer/editor pair must preserve these distinctions:

| Source shape | Required result |
| --- | --- |
| Explicit future promise | Action with supported owner and timing |
| Request followed by acceptance | Action owned by the accepting speaker |
| Request without acceptance | Discussion or question, not an action |
| “I can/could” without acceptance | Willingness, not a commitment |
| “Let's” suggestion without settlement | Discussion, not a commitment |
| Tentative preference | Discussion, not a decision |
| Explicit settled or negative choice | Decision with complete polarity and scope |
| Conditional promise | Action only when the condition is retained |
| Cancellation or replacement | Old task inactive; current replacement retained |
| Past completed work | Discussion, not a future action |
| Reported or quoted promise | Not assigned to the quoting speaker |
| Named third-party assignment | Owner only when explicitly supported |
| Passive need | Not a commitment without acceptance |
| Ambiguous speaker or pronoun | Neutral wording and unknown owner |
| Conflicting numbers or later correction | Preserve the supported final state |
| Open question or brainstorm | Question or discussion unless later settled |

## Direct versus oversized input

Capacity planning uses the compact writer and editor budgets. If both complete
requests fit, the two-call direct path runs. If they do not fit, the same public
analysis operation delegates to Pluto's existing long-meeting implementation
without enabling the compact contract there.

This change does not add a new user mode, model, database, or provider. A later
issue may simplify long meetings after the direct path has production-quality
evidence.

## Failure behavior

- Writer failure: preserve existing notes and expose the existing stable writer
  failure category.
- Editor failure: preserve existing notes and expose the existing stable editor
  or audit failure category.
- Source or guardrail failure: preserve existing notes.
- Cancellation or stale transcript revision: discard the result.
- Direct capacity failure discovered during planning: use the existing
  long-meeting path.
- Unexpected input overflow during a direct model call: fail closed; do not
  recursively replan the direct run.

No direct-path failure triggers a model repair, merge, compact retry, or
repartition loop.

## Performance and observability

For direct meetings, record the existing content-free stage events and metrics:

- writer and editor model-call counts;
- writer and editor elapsed/model time and token counts when available;
- direct versus hierarchical mode;
- final status and existing stable failure code.

Do not add semantic routing counters or a new metrics schema. Prompt caching is
allowed only as a measured optimization; correctness cannot depend on it.

## Implementation and acceptance

Implementation follows TDD:

1. Prove a compact writer can feed the existing editor in exactly two calls.
2. Prove malformed writer and editor responses fail without repair calls.
3. Make the compact writer/editor pair the product default for direct inputs.
4. Prove oversized inputs still use the unchanged hierarchy behavior.
5. Run focused tests after every behavior change, then the full verification
   suite.
6. Run the independent eight-case semantic acceptance corpus with fixed seeds.
7. Only after synthetic acceptance, run an explicitly authorized recent meeting
   read-only and compare time-to-trusted-notes and output quality.

Promotion requires:

- exactly two model calls for a successful direct meeting;
- zero direct-path repair, merge, or repartition calls;
- no new serious error across the semantic acceptance corpus;
- no unsupported action or decision;
- supported owners, deadlines, conditions, cancellations, and replacements
  retained;
- every direct failure leaves persisted notes unchanged;
- material latency improvement over the current audited path;
- unit tests, TypeScript, Biome, changelog validation, dependency audit,
  packaged-runtime validation, and read-only production-data checks pass.

## Deferred and excluded

Deferred:

- redesigning or replacing the existing long-meeting hierarchy;
- cross-meeting prompt-cache optimization;
- People and Projects extraction changes.

Excluded:

- deterministic semantic triage or coverage scanning;
- ambiguity packets, per-item audit verdicts, and new reason-code taxonomies;
- a second model, hosted fallback, or user-selectable notes mode;
- transcript, diarization, capture, or canonical-finalization changes;
- provisional note publication or an intermediate fact database;
- weakening exact-source, stale-run, persistence, or downstream trust gates.

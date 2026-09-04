# Compact meeting notes with selective semantic validation

**Status:** Proposed; implementation requires written-spec approval

**Issue:** [#739 — Make short-meeting trusted notes meaningfully faster](https://github.com/metagrover/pluto/issues/739)

**Mode:** Hold scope. Replace repeated whole-document interpretation with one
coherent notes pipeline. Preserve or improve the current quality boundary.

## Outcome

Generate useful trusted notes faster without treating schema validity, citation
presence, or lexical overlap as semantic correctness. The compact writer remains
responsible for drafting. Deterministic code proves narrow, unambiguous claims.
One focused same-model review resolves everything code cannot prove and checks
for high-value omissions. No ambiguous action, decision, owner, deadline,
condition, cancellation, or attributed statement becomes trusted silently.

The production destination is one pipeline, not separate fast and trusted
modes. Direct meetings normally require one writer call and at most one focused
review call. Oversized meetings use the same contracts across deterministic
source partitions and one final focused review; they do not start repair,
repartition, or model-merge cascades.

## Premise and alternatives

The real outcome is trustworthy re-entry into a meeting, not the lowest latency
number. The compact benchmark cut a warm 14-minute run from 116.6 seconds to
55.6 seconds and roughly halved output tokens, but two identical-seed runs made
materially different commitment judgments. One omitted a useful follow-up; the
other promoted a tentative preference and review suggestions. Code reported no
issues. Deterministic-only publication therefore fails the quality requirement.

Three approaches were considered:

1. **Full source audit after every writer.** Smallest conceptual change and the
   strongest existing baseline, but it preserves large prompts, verbose
   verdicts, truncation, and recursive recovery. Effort: small. Risk: low quality
   regression, high reliability and latency risk.
2. **Compact writer plus selective semantic review.** Reuse exact-source and
   grounding code, prove only narrow cases deterministically, and send one small
   ambiguity-and-coverage packet to the same model. Effort: medium. Risk: medium
   until semantic acceptance passes. This is the selected design.
3. **Evidence-atom compiler.** Replace prose drafting with a new fact graph and
   generate the document deterministically. It is a cleaner ideal architecture,
   but it is a larger product and persistence redesign with substantial recall
   risk. Effort: large. Risk: high.

Doing nothing retains an observed eleven-minute failure mode. Shipping the
deterministic-only benchmark would improve speed by lowering quality. Neither is
acceptable.

## Quality contract

Every final block follows one of two routes:

- **Code-proven:** strict deterministic checks establish the claim from its
  cited source.
- **Model-reviewed:** the focused reviewer resolves an ambiguous candidate, and
  the result then passes the same deterministic source checks.

The pipeline never equates a clean JSON response with a trusted note. It fails
closed and leaves existing notes unchanged when any required review is missing,
truncated, malformed, over budget, stale, or still ambiguous.

Quality covers both precision and recall:

- no unsupported action, decision, name, number, polarity, condition, owner, or
  deadline;
- no settled commitment silently lost when the source scanner can identify it;
- no cancelled or superseded commitment left active;
- material personal context, explicit feelings and reasons, completed work,
  questions, and brainstorming remain discussion instead of disappearing or
  becoming tasks;
- later corrections override earlier claims;
- unknown ownership, timing, identity, and intent remain unknown.

## Use-case matrix

| Source shape | Trusted result |
| --- | --- |
| “I will send it Friday” | Action; source speaker is owner; Friday retained |
| “Could you send it?” followed by explicit acceptance | Action owned by the accepting speaker |
| Request without acceptance | Discussion or question, never an action |
| “I can/could do it” without acceptance | Willingness as discussion |
| “We will do it” | Collective action |
| “Let’s do it” | Ambiguous until context establishes acceptance |
| “I probably will keep it” | Tentative preference, not a decision |
| “We decided/agreed/approved…” | Decision when predicate and scope are supported |
| Explicit choice not to proceed | Negative decision with complete scope |
| Promise with if/unless/once/after | Action only with the condition preserved |
| Earlier promise followed by cancellation | No active action; retain cancellation context |
| Cancelled task replaced later | Only the replacement remains active |
| Past completed work | Discussion, not a future action |
| Reported or quoted promise | Never assigned to the quoting speaker |
| Named third-party assignment | Named owner only when the cited turn assigns them |
| Passive “needs to be done” | Not an action without commitment evidence |
| Ambiguous pronoun or confidence-zero speaker | Neutral wording and unknown owner |
| Conflicting numbers or polarity | Reject or review; never normalize silently |
| Open question or brainstorm | Question/discussion unless later settled |

These are semantic classes, not a phrase whitelist. Lexical rules may prove a
narrow safe case or detect risk, but the focused reviewer owns contextual cases.

## Architecture

```text
validated canonical transcript
           |
           v
deterministic one-time partition plan
           |
           v
compact writer candidate(s)
           |
           v
strict parser + exact source decoding
           |
           v
deterministic semantic triage + coverage scan
     | accepted     | rejected     | ambiguous/uncovered
     |              |              v
     |              |       one focused same-model review
     |              |              |
     +--------------+--------------+
                    v
       final deterministic revalidation
                    |
                    v
     revision-checked transactional publication
```

### 1. Source planning

Plan source partitions once from measured context capacity. Direct meetings use
one partition. Oversized meetings use stable, overlapping partitions with the
existing exact source-span identities. The plan never changes in response to
model output, so there is no recursive repartition loop.

### 2. Compact writer

The writer returns section titles plus items containing only `kind`, `text`, and
one to three request-local source labels. Code derives IDs, title provenance,
overview, owner, and deadline. Action wording contains the task, recipient,
condition, and timing but not an inferred owner name.

For multiple partitions, code concatenates source-backed items, preserves source
order, removes exact duplicates, and routes possible semantic duplicates or
conflicts to review. It does not call a model merely to merge prose.

### 3. Deterministic triage

Triage produces `accepted`, `rejected`, and `ambiguous` candidates with stable,
content-free reason codes.

Code may accept a commitment without model review only when the cited evidence
contains a narrow explicit settlement form, the complete task is supported,
polarity and numbers match, all conditions are retained, and ownership/timing
can be derived without ambiguity. Near-extractive narrative can be accepted when
names, numbers, polarity, attribution, and claim coverage all match.

Hedges, proposals, `let’s`, reported speech, cross-turn acceptance, pronouns,
mixed settlement and uncertainty cues, replacements, semantic duplicates,
conflicts, and lower-confidence paraphrases always go to focused review. A
rejected commitment may become discussion only when the discussion wording
preserves its original modality; code never rewrites a failed commitment into a
stronger claim.

### 4. Coverage scan

Reuse the existing source guardrails to find uncovered explicit promises,
accepted requests, decisions, conditions, withdrawals, replacements, questions,
personal feelings/reasons, and salient named or numeric claims. The scanner does
not author notes. It contributes source bundles to the focused review when the
writer did not cover a detected obligation.

The scan deliberately over-routes uncertainty rather than inventing or silently
dropping content. It is not presented as proof that every possible narrative
detail was found.

### 5. Focused semantic review

At most one review request receives:

- ambiguous writer candidates;
- rejected candidates eligible for safe discussion wording;
- uncovered source bundles from the coverage scan;
- only the cited or adjacent source turns necessary to resolve them;
- stable reason codes describing what code could not prove.

It returns a bounded list of decisions: retain, correct, downgrade to discussion,
insert from uncovered evidence, or remove. Every returned item uses the same
compact item contract and exact source labels. The reviewer cannot change
code-proven blocks, add uncited facts, or mutate the transcript.

If there are no ambiguous or uncovered candidates, the review call is skipped.
If the complete review packet cannot fit one bounded request, the run fails with
`notes_selective_review_context_exhausted`; it does not partition the review or
fall back into a retry cascade.

### 6. Final trust and publication

Apply review decisions to the candidate document, then rerun the strict parser,
allowed-source checks, commitment conservation, condition/cancellation checks,
owner/deadline grounding, and source-revision check. Code derives rollups only
from retained items. Persistence remains transactional and replaces existing
notes only after the whole result passes.

People, Projects, commitments, MID, and knowledge enrichment remain downstream
consumers of trusted notes. They are not added to the writer or reviewer output.

## Errors and rescue behavior

| Error | Trigger | Result |
| --- | --- | --- |
| `notes_compact_writer_invalid` | Malformed or unknown writer contract | Fail; preserve existing notes |
| `notes_compact_writer_truncated` | Writer reaches its output bound | Fail; no model repair |
| `notes_selective_review_invalid` | Malformed review contract or unknown candidate/source | Fail; preserve existing notes |
| `notes_selective_review_truncated` | Reviewer reaches its output bound | Fail; no compact retry |
| `notes_selective_review_context_exhausted` | One complete review packet cannot fit | Fail; no repartition |
| `notes_selective_review_unresolved` | Required candidate lacks a final decision | Fail; never publish partial trust |
| `notes_commitment_conservation_failed` | A detected current commitment disappears without supported disposition | Fail |
| `notes_stale_source` | Transcript revision changes during generation | Discard result and leave current state retryable |
| cancellation/timeout/provider failure | Existing bounded transport failure | Abort and preserve existing notes |

Mechanical normalization may repair only known lossless JSON shapes before
parsing. It never changes wording, kind, sources, modality, ownership, or timing.
There is no model-authored repair call.

## Data, security, and state

- The canonical transcript remains the only evidence source.
- Source labels remain request-local and decode to exact allowed spans.
- Prompt injection inside transcripts remains data, never instruction.
- Empty source, empty model output, unknown fields, duplicate candidate IDs,
  unknown labels, and oversized arrays fail validation.
- Generated candidates remain in memory until final publication; no provisional
  draft becomes canonical notes.
- No database migration or new user-facing mode is required.
- Persist only existing notes plus bounded content-free run metrics.
- Cancellation, app restart, navigation, or a newer run cannot publish stale
  output.

## Performance and observability

Direct meetings have a hard maximum of two model calls: one compact writer and
one optional focused reviewer. Oversized meetings have one writer per planned
partition and one optional final reviewer. They have zero model merge, repair,
or repartition calls.

Record content-free metrics for:

- writer and reviewer input/output tokens and active time;
- partition count and total model-call count;
- deterministically accepted, rejected, ambiguous, and uncovered counts;
- reason-code counts;
- whether selective review was skipped;
- final status and stable failure code;
- cold versus reused prompt-evaluation time when the provider reports it.

Prompt caching is an optimization, not a correctness dependency. Keep stable
instructions before source data and retain the existing one-hour model residency,
but do not claim cross-meeting cache savings until directly measured.

## Test and acceptance strategy

Implementation proceeds in small TDD slices:

1. Add synthetic regressions for the use-case matrix, beginning with the two
   failures from the private meeting: a hedged preference and unaccepted
   `let’s` review suggestion.
2. Implement deterministic triage only; prove each candidate is accepted,
   rejected, or routed to review without changing production.
3. Add the focused review schema/parser and captured-response tests.
4. Connect one bounded review call in the private benchmark path.
5. Run the existing eight-case independent semantic acceptance corpus with at
   least two fixed seeds. Compare serious false positives, false negatives,
   conditions, owners, deadlines, reversals, narrative coverage, and latency
   against the current production pipeline.
6. Run at most one explicitly authorized private meeting after synthetic
   acceptance passes.
7. Add the one-time hierarchy planner and deterministic aggregation only after
   the direct path passes; validate long-source commitment conservation before
   production routing changes.

Promotion requires:

- no new serious semantic error across the reviewed synthetic cohort;
- no unsupported trusted action or decision in either fixed seed;
- all required owners, deadlines, conditions, cancellations, and replacements
  preserved;
- malformed, truncated, unresolved, capacity, provider, cancellation, and stale
  cases leave persistence unchanged;
- a material latency reduction for direct meetings and no repair/repartition
  cascade;
- full unit suite, TypeScript, Biome, changelog, high-severity audit, packaged
  runtime, and read-only production-data validation;
- an explicit reviewed decision before changing the production default.

Unit and schema success alone cannot satisfy semantic acceptance. One private
meeting cannot establish general quality parity.

## Deferred and excluded

Deferred until the direct path passes:

- deterministic aggregation for oversized meetings;
- broader private-meeting cohort evaluation;
- cross-meeting prompt-cache optimization.

Not in scope:

- another model or hosted provider;
- People or Projects generation in the notes call;
- UI modes, provisional-note publication, or trust badges;
- transcript, diarization, capture, or canonical-finalization changes;
- an intermediate fact database;
- model repair, merge, or recursive repartition loops;
- weakening source, revision, persistence, or downstream trust gates.

## Decision summary

The compact writer is retained because it demonstrated real output and warm
latency savings. Deterministic-only publication is rejected because the private
benchmark demonstrated both omission and false promotion. The proposed system
uses deterministic checks as a proof and routing layer, not as a substitute for
semantic understanding. Ambiguity pays for one focused same-model review; clear
content does not. Production remains unchanged until semantic parity is proven.

# General-purpose meeting terminology reconciliation

**Issue:** [#672](https://github.com/metagrover/pluto/issues/672)
**Generated:** 2026-08-26
**Status:** Implemented in #672
**Mode:** Product

## Problem statement

Pluto is a general-purpose meeting recorder. Its analysis must work across professional, academic, medical, personal, and unfamiliar domains without accumulating prompt rules for individual meetings or industries.

The current analysis pipeline can preserve valid JSON while still losing substantive topics, strengthening tentative language, merging unrelated material, or dropping explicit commitments during grounding. Recognition variants for unfamiliar names and terms can also flow into notes as if they were authoritative. Prompt restraint helps, but it cannot determine the intended spelling of an unfamiliar term by itself.

Pluto needs two coordinated improvements:

1. A general analysis contract for coverage, modality, topic cohesion, and evidence-close commitments.
2. A bounded terminology reconciliation step that supplies analysis with supported term aliases while leaving canonical transcript evidence unchanged.

## Product outcome

After final transcription and before meeting analysis, Pluto creates a meeting-scoped terminology artifact. It combines bounded candidate discovery, known local context, and one small LLM reconciliation call. The artifact can recommend a preferred term for analysis, but it never rewrites the canonical transcript.

Analysis receives the raw transcript plus the terminology artifact. Summaries may use a supported preferred term; evidence remains verbatim raw transcript text. Grounding understands approved aliases so that a corrected name does not cause an otherwise supported action or decision to be discarded.

Uncertain terminology remains raw. Only consequential uncertainty should ask for user attention. Explicit user confirmation is authoritative for future synthesis but is not retroactively presented as meeting evidence.

## Premises

1. The canonical transcript is evidence and remains immutable after validation.
2. Generated notes are a reading projection and may use supported terminology overlays.
3. LLM confidence alone is never sufficient for silent correction.
4. Prompt instructions should describe reasoning behavior, not vocabulary from a meeting or domain.
5. Known people, prior entities, participant names, and user-confirmed terms are useful context but not independent evidence for a meeting claim.
6. A long transcript must not be reread in an unbounded additional local-model call.
7. Absence of a confident correction is not an error; preserving the raw term is the safe result.

## Approaches considered

### A. Prompt-only glossary pass

**Effort:** Small
**Risk:** Medium

Ask the analysis model to normalize terminology while producing notes.

Advantages:

- Small implementation surface.
- No new artifact or persistence contract.

Drawbacks:

- Mixes correction with synthesis and makes failures difficult to inspect.
- Encourages silent guesses.
- Cannot safely relax grounding for corrected terminology.
- Corrections cannot be reused or confirmed independently.

### B. Bounded meeting-scoped reconciliation

**Effort:** Medium
**Risk:** Low

Discover candidate terms while Pluto already processes bounded transcript windows, consolidate those candidates once, and run one small structured reconciliation call before topic analysis.

Advantages:

- Separates terminology decisions from note synthesis.
- Adds only one bounded generation call to the local multi-pass path.
- Preserves raw evidence and exposes provenance.
- Creates an evaluation boundary for false-correction resistance.

Drawbacks:

- Requires an alias-aware grounding seam.
- Meeting-local corrections do not automatically improve future meetings.

### C. Persistent personal terminology memory

**Effort:** Large
**Risk:** Medium

Extend B with durable user-confirmed terms scoped to people, projects, and the user's personal vocabulary.

Advantages:

- Improves recognition and notes across recurring context.
- Makes explicit corrections compound in value.

Drawbacks:

- Requires conflict resolution, deletion, scope precedence, and correction UI.
- A bad global correction can contaminate unrelated meetings.

## Recommended approach

Ship B first, with contracts that can extend to C. Do not ship A as an independent shortcut.

The first release should persist meeting-scoped proposals and automatically apply only proposals supported by deterministic evidence in addition to the LLM recommendation. User confirmation and cross-meeting learning can follow after proposal quality is measured.

## Analysis prompt contract

The prompt policy remains general-purpose and applies to single-pass, per-topic, repair, and editorial prompts.

### Coverage

- Every substantive segmented range must appear in a final topic or have an explicit internal omission reason such as duplicate, small talk, or housekeeping.
- Generic absence prose is never content. A pass with no supported content returns an empty topic payload, not a sentence claiming nothing happened.
- Editorial consolidation may merge only ranges about the same subject and outcome. Shared participants, adjacency, or broad organizational context are insufficient.
- When the editorial pass cannot fit, deterministic compaction preserves one concrete sentence and any settled items from each substantive topic before enforcing the display cap.

### Modality

- Generated language must not be stronger than the source speech act.
- Targets, intentions, preferences, recommendations, predictions, conditions, and possible consequences retain that status in topics and the overview.
- Only explicit resolution becomes a decision. Only explicit accepted follow-through becomes an action.
- Future-tense overview statements must inherit the strongest supported modality from their source topic.

### Commitments

- Extract the evidence clause first, classify it second, and produce minimally normalized text last.
- Preserve the evidence clause verbatim, including the subject, modal verb, negation, and condition.
- Action and decision wording stays close to the evidence vocabulary. Compression cannot introduce a stronger verb or a new object.
- The final top-level rollups are rebuilt from retained topic items; they are never independently invented.

### Topic cohesion

- A topic represents one coherent subject and outcome, not a fixed amount of transcript.
- A title names the distinctive subject and its state without claiming more certainty than the summary.
- A topic that contains unrelated implementation, equipment, and policy material must be split even when it falls inside one transcript window.

### Terminology

- Raw transcript spellings are hypotheses, not facts or errors.
- Prompts receive a separate terminology map with supported aliases and provenance.
- Summaries use an applied preferred term consistently. Evidence always quotes the raw transcript.
- Proposed or ambiguous aliases are not injected as truth.

## Terminology reconciliation pipeline

### 1. Candidate discovery

Candidate discovery is added to existing bounded topic-segmentation work rather than implemented as another full-transcript generation pass.

Each transcript window may return up to a small fixed number of candidate records:

```ts
type TerminologyCandidate = {
  rawText: string;
  segmentIndexes: number[];
  context: string[];
  kind: 'name' | 'organization' | 'product' | 'acronym' | 'domain_term';
  reason: 'variant' | 'ambiguous' | 'known_term_match' | 'spoken_definition';
};
```

Deterministic code then:

- discards common words and malformed spans;
- protects numbers, dates, URLs, negation, and speaker labels;
- groups case-insensitive and punctuation-only variants;
- adds matches against explicit participants, selected transcription vocabulary, and known local entities;
- keeps representative contexts rather than the whole transcript;
- caps the reconciliation request by candidate count, occurrences per candidate, and total characters.

Candidate discovery is intentionally recall-oriented. It does not apply corrections.

### 2. One bounded reconciliation call

The configured analysis provider receives candidate clusters, representative context, and bounded known-term matches. It returns valid JSON only:

```ts
type TerminologyProposal = {
  rawForms: string[];
  preferredTerm: string | null;
  segmentIndexes: number[];
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  signals: Array<
    'repeated_context' |
    'known_person' |
    'known_entity' |
    'spoken_definition' |
    'variant_consistency'
  >;
  disposition: 'apply' | 'propose' | 'preserve_raw';
};
```

The model is instructed to correct spelling only. It cannot reinterpret the meeting, expand an acronym without support, or change grammatical content around a term.

### 3. Deterministic application gate

An alias is automatically applied to the analysis projection only when:

- the proposal is structurally valid;
- the preferred term changes only the candidate span;
- protected content is unchanged;
- the model reports high confidence; and
- at least one independent signal exists beyond the model's own contextual guess, such as an exact known term, a spoken definition, or repeated consistent variants.

LLM confidence without an independent signal produces `propose`, not `apply`.

Conflicting proposals, ordinary-word replacements, unsupported expansions, and changes involving protected content produce `preserve_raw`.

### 4. Analysis integration

The raw transcript remains the prompt's evidence source. Applied aliases are supplied in a compact terminology block:

```text
Terminology for synthesis only:
- Raw forms: "...", "...". Preferred term: "...".
- Use the preferred term in summaries. Quote raw transcript wording in evidence.
```

Grounding receives the same applied alias map. Claim-token comparison may map a preferred term back to its raw forms, but evidence validation still requires a verbatim raw transcript slice. Alias handling cannot relax numeric, negation, owner, deadline, or modality checks.

### 5. Persistence and provenance

The meeting stores a versioned terminology artifact separate from canonical transcript JSON:

```ts
type MeetingTerminologyArtifactV1 = {
  schemaVersion: 1;
  generatedAt: string;
  provider: string;
  model: string;
  policyVersion: string;
  proposals: Array<{
    rawForms: string[];
    preferredTerm: string | null;
    segmentIndexes: number[];
    confidence: 'high' | 'medium' | 'low';
    signals: string[];
    status: 'applied' | 'proposed' | 'confirmed' | 'rejected' | 'preserved';
  }>;
};
```

Raw terminology is local meeting data and must not appear in production diagnostic logs. Operational metadata may record only policy version, proposal count, applied count, and confirmed count.

For the first release, this artifact is meeting-scoped. A later personal terminology table may store only explicit user confirmations with scope and provenance. Existing knowledge claim corrections remain claim corrections; they should not be overloaded as a terminology dictionary.

## User experience

The first implementation does not need a terminology-management screen.

- Automatically applied, strongly supported aliases appear naturally in notes.
- Material proposed terms may use the existing restrained analysis-quality notice and a small review affordance in a follow-up slice.
- A review shows raw wording, suggested term, and representative context.
- Confirm applies to this meeting by default. Broader reuse must be an explicit later choice.
- Reject prevents the proposal from being silently reintroduced during regeneration.

Only terms that affect a title, overview, action, decision, person, project, or repeated key point deserve interruption. Low-impact uncertainty remains raw.

## Failure and recovery behavior

- If candidate discovery fails, analysis proceeds with the raw transcript.
- If reconciliation times out or returns invalid JSON, analysis proceeds with the raw transcript and records a content-free quality category.
- If every proposal is rejected by the deterministic gate, that is a valid no-op, not a failure.
- Regeneration replaces automatic proposals but preserves explicit confirmations and rejections.
- Cancellation reaches the terminology call through the existing analysis abort signal.
- The terminology artifact and analysis generation metadata are persisted atomically with the regenerated analysis so timestamps and lifecycle state remain truthful.

## Verification strategy

### Contract tests

- Prompt policy is shared by single-pass, topic, repair, and editorial paths.
- Candidate and proposal schemas reject protected-field mutations and unbounded output.
- Alias-aware grounding accepts a corrected term only when its raw evidence remains verbatim.
- Canonical transcript JSON is byte-identical before and after reconciliation.

### Quality fixtures

Fixtures cover:

- repeated variants that resolve to a known participant, entity, or product;
- ambiguous unfamiliar terms that must remain raw;
- ordinary words that resemble a known term but must not change;
- acronyms with and without a spoken definition;
- numbers, dates, negation, owners, and deadlines near a candidate term;
- long meetings whose substantive middle topics survive editorial compaction;
- tentative targets, intended reviews, recommendations, and possible consequences;
- explicit accepted actions whose wording remains close enough to evidence to survive grounding;
- unrelated adjacent topics that must remain separate.

### Runtime evaluation

Measure rather than assume:

- additional local generation calls and elapsed time;
- candidate, proposal, applied, and rejected counts;
- supported correction precision;
- unsafe-correction count;
- substantive-topic coverage;
- explicit action and decision recall;
- modality-strengthening regressions;
- unchanged transcript and evidence hashes.

The reconciliation request is capped at 24 candidate clusters, up to 4 representative contexts per cluster, and a small structured output budget. These are safety bounds, not quality claims; benchmark evidence may justify changing them.

## Delivery sequence

1. Add general prompt contracts and regression fixtures for coverage, modality, topic cohesion, and evidence-first commitments.
2. Add terminology candidate/proposal types, parsing, deterministic gates, and false-correction tests.
3. Extend bounded segmentation output with terminology candidates.
4. Add one global reconciliation call and inject applied aliases into topic/editorial analysis.
5. Make grounding alias-aware while keeping verbatim evidence checks unchanged.
6. Persist versioned meeting terminology metadata atomically with analysis.
7. Run provider-independent tests and a local Qwen benchmark on representative meetings.
8. Evaluate a separate lightweight confirmation UI only after proposal precision is measured.

## Success criteria

- No prompt or fixture contains vocabulary from a single private meeting as a production rule.
- Supported unfamiliar terms are consistent in generated notes without changing canonical transcript evidence.
- Ambiguous terminology remains raw unless the user confirms it.
- No automatic correction changes protected numbers, dates, negation, speaker attribution, owners, deadlines, or surrounding grammar.
- Every substantive segmented range survives into final notes or yields a truthful quality issue.
- Tentative language is not promoted to commitment, policy, schedule, or certainty.
- Explicit evidence-backed actions and decisions survive grounding and appear in final rollups.
- The extra terminology work is one bounded reconciliation call on the local multi-pass path.
- Regeneration persists analysis content, terminology provenance, generation timestamps, error categories, and terminal lifecycle state consistently.

## Open questions

- Whether terminology artifacts belong in a dedicated meeting column or a separate meeting-artifact table.
- Which independent signals should qualify for initial automatic application after benchmark calibration.
- Whether proposal review belongs directly in Meeting View or in a broader correction inbox.
- When user-confirmed terms should become eligible for future transcription vocabulary, given its stricter false-bias risk.

## Follow-up boundary

Evaluate a confirmation UI or cross-meeting terminology memory only after proposal precision is measured across more saved meetings. The first release remains meeting-scoped and does not silently learn from unsupported guesses.

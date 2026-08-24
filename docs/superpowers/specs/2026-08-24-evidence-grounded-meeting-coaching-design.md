# Evidence-Grounded Meeting Coaching

**Outcome issue:** [#654](https://github.com/metagrover/pluto/issues/654)
**Depends on:** [#62](https://github.com/metagrover/pluto/issues/62) and
[#614](https://github.com/metagrover/pluto/issues/614)
**Status:** Draft product specification
**Date:** 2026-08-24

## Product Intent

Pluto should help a user learn from meetings it already remembers. A user can ask
what they did well, what they could improve, and what to try next without
replaying the meeting or receiving generic encouragement.

This is private reflection for the user. It is not participant evaluation,
employee scoring, personality assessment, or employer analytics.

## Desired User Outcome

After asking for coaching, the user should leave with:

1. A specific understanding of what worked.
2. At most one or two useful opportunities to improve.
3. Direct access to the meeting evidence behind each observation.
4. A clear sense of why the behavior mattered in that conversation.
5. One small experiment to try in the next relevant meeting.

The experience succeeds when it reduces reflection effort while preserving the
user's judgment. It does not succeed merely because Pluto always produces a
positive and a negative observation.

## Product Principles

### Evidence Before Evaluation

Pluto describes observable meeting behavior before interpreting it. Every
behavioral claim must have a navigable source moment, and the strength of the
language must match transcript integrity and speaker-attribution quality.

### Useful Over Complete

Pluto may return one strong observation instead of filling every section with
weak material. It should say when no meaningful improvement is supported by the
record.

### Participation Before Leadership

Leadership is a contextual role, not a trait. Pluto may use leadership-specific
language only when the meeting record, metadata, or user correction supports
that the user led the meeting. Otherwise, it discusses the user's participation.

### Private By Default

Coaching is for the user who requested it. It is not automatically written into
shared notes, people records, project records, performance summaries, or
content-bearing telemetry.

### One Next Experiment

The response should lower the effort required to improve. It ends with one
small, observable behavior to try, not a broad self-improvement program.

## Entry Points

### Ask Pluto

Ask Pluto supports questions across one or more completed meetings. Pluto names
the meetings used and keeps each observation traceable to its source.

This entry point is best for questions such as:

- `What patterns do you notice in how I close meetings?`
- `What have I been doing well when leading product reviews?`
- `What is one facilitation skill I should practice next?`

Cross-meeting coaching should not launch until #62 can provide cited,
correction-aware answers with clear weak-evidence states.

### Meeting-Scoped Chat

Meeting-scoped chat defaults to the selected completed meeting. The user should
not need to restate the meeting title, participants, or timeframe.

This is the first recommended delivery surface because its evidence boundary is
narrower and easier for the user to inspect. It depends on #614.

### Recent Win

The dashboard's `Open moment` action may open the source meeting with a coaching
prompt focused on why the moment was surfaced. The dashboard itself should show
only the concise win, not a full coaching analysis.

## Suggested Reflection Questions

Suggested prompts reduce blank-page effort without turning coaching into a
survey. Show a small context-sensitive set rather than every available prompt.

### General Participation

- `What did I do well in this meeting?`
- `What could I have done better in this meeting?`
- `Where did I help create clarity or momentum?`
- `Where did the conversation lose clarity or momentum?`
- `What is one thing I should try in the next meeting?`

### Meeting Leadership

Show only when the user's leadership role is supported or user-confirmed:

- `How effectively did I lead this meeting?`
- `What did I do well as the meeting lead?`
- `What could I have done better as the meeting lead?`
- `How well did I close decisions, owners, and next steps?`

### Prompt Eligibility

- Use only completed meetings with sufficient analysis and transcript integrity.
- Suppress leadership prompts when the user's role is unknown.
- Suppress behavior-specific prompts when speaker attribution is unreliable.
- Do not imply that Pluto found a problem before the user asks for reflection.
- Do not use streaks, scores, or comparative language in prompt copy.

## Coaching Response Contract

Every successful coaching response uses this order:

### 1. Strengths

One or two specific behaviors or choices that worked. Describe what happened,
not a personality trait.

Good: `You paused after presenting the tradeoff and invited Maya to challenge
the assumption.`

Avoid: `You are an inclusive leader.`

### 2. Improvement

At most one or two concrete opportunities. Improvement is optional when the
record does not support one.

Good: `The final decision was clear, but no owner was named before the topic
changed.`

Avoid: `You need to be more decisive.`

### 3. Evidence

Attach a source meeting and relevant quote, evidence span, or timestamp to each
behavioral observation. The user must be able to open the moment in context.

For cross-meeting coaching, each pattern must cite more than one meeting or be
described as a single-meeting observation rather than a recurring pattern.

### 4. Impact

Explain the observed or strongly supported effect on the conversation, such as
clarity, participation, alignment, decision quality, or momentum. Do not claim
an internal emotional or motivational effect that the record cannot establish.

### 5. Next Experiment

Offer one small behavior that can be observed in a future meeting.

Good: `Before changing topics, name the decision and ask, "Who owns the next
step, and by when?"`

Avoid: `Work on becoming a stronger communicator.`

## Evidence And Role Contract

Before generating coaching, Pluto determines:

1. Whether the meeting is complete enough to analyze.
2. Whether transcript integrity is sufficient for the requested observation.
3. Whether the user's speech can be attributed reliably.
4. Whether leadership-specific framing is supported.
5. Whether each observation has a navigable evidence span.

The response must distinguish:

- **Observed:** Directly supported by an attributed meeting moment.
- **Interpretation:** A limited explanation derived from one or more observed
  moments.
- **Insufficient evidence:** Pluto cannot make the requested claim safely.

User correction overrides inferred meeting role for future coaching on that
meeting, but it does not repair missing transcript evidence or ambiguous speaker
attribution.

## Guardrails

### Empty Praise

- Do not produce praise merely because the user asked what went well.
- Do not use generic affirmations that could apply to any meeting.
- Prefer `I could not identify a well-supported behavioral observation` over a
  flattering unsupported claim.

### Personality And Intent

- Do not infer personality, competence, emotion, motivation, intent, or
  protected traits.
- Do not diagnose communication, leadership, or psychological conditions.
- Describe meeting behavior and its supported conversational effect only.

### Employee Evaluation

- Do not score, rank, grade, or compare participants.
- Do not generate manager-facing evaluations or hidden performance analytics.
- Do not turn questions about another participant into unsolicited coaching or
  employment assessment.
- Keep the request centered on the requesting user's own participation.

### Unsupported Leadership Claims

- Speaking time, seniority, invitation ownership, or agenda placement alone does
  not prove that the user led the meeting.
- Ask for role clarification when leadership context materially changes the
  answer and available evidence is ambiguous.
- Use participation language when clarification is unnecessary or unavailable.

### Trust Failures

- Constrain or decline coaching for incomplete processing, low transcript
  integrity, ambiguous speakers, or absent evidence.
- Never silently fall back to uncited general advice while presenting it as
  analysis of the meeting.
- General advice may be offered only when clearly labeled as general and kept
  separate from meeting-derived observations.

## Interaction States

### Ready

Show a small set of eligible reflection prompts and accept freeform coaching
questions.

### Processing

Explain that coaching will be available after transcript and meeting analysis
finish. Do not provide premature behavioral judgments from partial content.

### Limited Evidence

State what is missing or unreliable and offer a narrower supported question when
possible. For example, Pluto may discuss documented decisions when speaker
attribution is too weak for participation coaching.

### No Supported Improvement

Return supported strengths and state that the record does not justify a useful
improvement claim. Do not manufacture criticism to preserve visual symmetry.

### User Correction

Allow the user to correct whether they led the meeting and mark an observation
as `Useful` or `Inaccurate`. Corrections should affect subsequent answers without
rewriting the underlying transcript.

## Privacy And Retention

- Use Pluto's existing local-first meeting and retrieval boundaries.
- Do not place transcript excerpts, coaching text, or user feedback content in
  telemetry or diagnostic logs.
- Do not publish coaching into shared surfaces automatically.
- Treat any future longitudinal coaching history as a separate consented product
  capability with its own retention and deletion controls.

## Delivery Sequence

1. Complete the cited, correction-aware answer contract in #62.
2. Establish the meeting-scoped conversation surface in #614.
3. Deliver meeting-scoped coaching with prompt eligibility, role gating,
   evidence checks, the response contract, and user feedback.
4. Extend the same contract to cross-meeting Ask Pluto questions.
5. Connect the dashboard Recent Win `Open moment` action after that dashboard
   concept ships.

This order reuses one retrieval, citation, and correction system. Coaching should
not introduce a parallel answer path.

## Acceptance Criteria

1. Users can request coaching in both Ask Pluto and meeting-scoped chat.
2. Meeting-scoped requests use the selected completed meeting by default.
3. Cross-meeting answers name and cite the meetings used.
4. Successful responses follow the five-part coaching response contract.
5. Every behavioral observation has a navigable source moment.
6. Leadership language is withheld when the user's role is unsupported.
7. Weak transcript integrity, ambiguous speakers, and incomplete analysis produce
   truthful constrained states.
8. Responses do not contain empty praise, personality judgments, employee
   scoring, participant comparisons, or unsupported leadership claims.
9. Users can correct their role and mark observations as useful or inaccurate.
10. Coaching content does not enter content-bearing telemetry or logs.

## Required Quality Evaluation

Before enabling coaching broadly, use a reviewed set of representative meetings
covering:

- A clearly user-led meeting with strong attribution.
- A meeting where the user participated but did not lead.
- An ambiguous leadership role.
- Ambiguous or overlapping speakers.
- Low transcript integrity.
- A meeting with no defensible improvement opportunity.
- A request likely to trigger generic praise.
- A request to score or judge another participant.

Reviewers should evaluate citation correctness, role correctness, specificity,
usefulness, proportionality, and guardrail compliance. Synthetic prompt tests are
necessary for prohibited-output checks but are not sufficient evidence of
coaching quality.

## Non-Goals

- Real-time coaching during an active meeting.
- Personality profiles or communication, leadership, and employee scores.
- Manager dashboards or organization-level people analytics.
- Automatic publication into meeting notes, projects, or people records.
- Longitudinal growth tracking, recurring goals, or trend claims in the first
  release.
- A separate retrieval or citation system for coaching.

## Open Questions

- Should the first release support only user-initiated questions, or may Pluto
  suggest one coaching prompt after a completed meeting?
- How long should coaching conversation history persist per meeting?
- Should `Inaccurate` feedback require a reason, or remain a one-click signal?
- Which existing transcript-integrity states are sufficient for behavioral
  coaching versus decision-only questions?

# Pluto Dashboard Content Brief

**Primary issue:** [#59](https://github.com/metagrover/pluto/issues/59)
**Related outcome:** [#586](https://github.com/metagrover/pluto/issues/586),
proposal-first Memory Dreaming and knowledge consolidation
**Coaching outcome:** [#654](https://github.com/metagrover/pluto/issues/654),
private, evidence-grounded meeting coaching
**Status:** Draft information architecture for product review
**Date:** 2026-08-23

## Purpose

The dashboard is Pluto's synthesized briefing, not an inbox, meeting archive, or
activity feed. It should make the user feel that Pluto has been paying attention,
has connected relevant context, and has reduced the amount they need to remember
or organize themselves.

The dashboard should answer, in order:

1. What deserves my attention now?
2. What have I committed to?
3. What went well?
4. What changed or became connected while I was away?
5. Why does Pluto believe any of this?

## First-Viewport Content

The first viewport should contain three primary sections. They are different
forms of intelligence and must not be flattened into one generic task list.

### 1. Top Of Mind

A short, ranked briefing containing the few things most likely to matter now.
This is the highest-value output on the dashboard.

An item can qualify when it is:

- A material blocker or risk with a clear consequence.
- A decision that is holding up an active stream.
- A commitment that is due, overdue, or aging.
- A meaningful change that alters the user's understanding of a project,
  person, plan, or topic.
- A repeated signal across multiple conversations that now warrants attention.
- A time-sensitive preparation need for an upcoming conversation.

Each item should contain:

- **Read:** A concise conclusion, written as useful context rather than a label.
- **Why now:** The new event, deadline, repetition, dependency, or staleness that
  caused Pluto to surface it.
- **Consequence:** What may happen if it is ignored, when known.
- **Suggested move:** One clear next action, or `No action needed` when the value
  is awareness.
- **Evidence:** A path to the supporting meetings, notes, quotes, or extracted
  records.
- **Trust state:** Directly supported, inferred, weak, or stale.

Rules:

- Show no more than three items by default.
- Prefer a useful synthesized sentence over a category heading plus raw bullet.
- Do not fill the section to meet a quota. A calm `Nothing needs your attention`
  state is a successful outcome.
- Do not promote routine work merely because it has a due date.
- Do not use urgency language without evidence of urgency or impact.

### 2. My Commitments

A dependable view of promises the user has made, separated from model-suggested
follow-ups. This section answers, "What am I responsible for remembering?"

Include:

- Confirmed commitments explicitly made by the user.
- Commitments accepted or created by the user in Pluto.
- Commitments that are overdue, due soon, blocked, or have gone quiet.
- Commitments where another person is likely waiting on the user.
- Commitments whose surrounding context changed after they were made.

Each commitment should contain:

- **Commitment:** The exact obligation in concise language.
- **Context:** The project, person, or stream it belongs to.
- **Timing:** Due date when known; otherwise a factual freshness label.
- **State:** Active, blocked, waiting, overdue, or completed.
- **Why it matters now:** Deadline, dependency, waiting person, or changed context.
- **Source:** The conversation or note where the commitment was established.
- **Action:** Complete, open context, update, snooze, or correct.

Possible follow-ups must appear in a separate `Needs confirmation` disclosure.
They must never look completable until the user confirms they are real
commitments.

The user can also add a commitment directly from the dashboard. Capture should
feel as fast as a scratchpad without turning the dashboard into a freeform notes
surface:

- `Add commitment` opens one inline, single-line input.
- The commitment text is the only required field.
- A due date is optional at capture time.
- User-authored items are confirmed commitments immediately.
- Rich organization, editing, and the complete list live in Projects.
- The dashboard re-ranks after creation and still shows no more than three items.

Rules:

- Show no more than three commitments.
- Rank user-owned commitments above generic extracted tasks.
- Keep blocked commitments visible with the actual blocker reason.
- Distinguish `waiting on me` from `waiting on someone else`.
- Do not turn the dashboard into a full task manager. Show the commitments that
  benefit from memory and context; link to the complete execution view.
- Do not keep a persistent textarea, project form, owner picker, or priority
  system open on the dashboard.

### 3. Recent Win

A single evidence-backed positive moment from a recent meeting or captured
context. This section should make the dashboard feel humane and help the user
notice progress that is easy to overlook.

A win can be an outcome or a behavior:

- A decision was reached or a blocker was resolved.
- A customer, collaborator, or stakeholder responded positively.
- A commitment was completed with a meaningful result.
- The user led a meeting clearly and effectively.
- The user clarified a confusing topic or summarized a decision well.
- The user created space for others, handled disagreement constructively, or
  moved a stalled conversation forward.

Each win should contain:

- **Win:** A one-line or two-line description of what went well.
- **Why it counts:** The observed outcome or behavior that supports the claim.
- **Source:** The meeting, note, or evidence moment where it occurred.
- **Action:** `Open moment` and `Celebrate`.

Rules:

- Show exactly zero or one recent win, never a feed or carousel.
- Prefer no win over vague encouragement or manufactured praise.
- Behavioral wins require direct conversational evidence and reliable speaker
  attribution.
- Do not infer that the user led a meeting solely because they spoke the most.
- Do not use scores, streaks, leaderboards, trophies, or comparative rankings.
- `Celebrate` triggers a brief full-window confetti effect, then returns the
  dashboard to its resting state without moving content.
- Respect reduced-motion preferences with a quiet sparkle or check acknowledgment
  instead of confetti.

## Supporting Intelligence

These sections may appear below the first viewport or inside a secondary detail
area. They support the primary briefing but should not compete with it.

### What Changed

Meaningful deltas since the user's last review:

- A decision was made, reversed, or superseded.
- A commitment changed owner, date, state, or blocker.
- A project or personal stream gained or lost momentum.
- A previously open question was answered.
- New evidence strengthened or weakened an existing synthesis.
- A new connection changed how an existing item should be understood.

Do not show routine ingestion, processing, transcription, or meeting-created
events here.

### Connections Pluto Made

High-confidence cross-context relationships that materially improve recall:

- Two conversations are advancing the same underlying decision.
- A new commitment depends on an older unresolved item.
- Feedback from different people points to the same pattern.
- A recent decision conflicts with a prior constraint.
- A personal, research, or work stream shares relevant context with another.

Each connection should explain what was connected and why the connection matters.
A network visualization or source-count badge alone is not useful.

Connections originating from Memory Dreaming must also expose whether they are
accepted knowledge, a pending proposal, or an unresolved conflict. A proposal
must never be written as an established fact.

### Waiting On Others

External dependencies that affect the user's active commitments or decisions:

- Who or what the user is waiting on.
- What the response unblocks.
- When it was requested or last discussed.
- Whether a follow-up is now warranted.

This section should stay hidden when nothing consequential is waiting.

### Upcoming Context

Preparation only when Pluto can improve an imminent interaction:

- The previous unresolved topic with a person or group.
- Commitments either side made in the last relevant conversation.
- Decisions or changes that affect the upcoming discussion.
- One or two suggested questions grounded in existing context.

Do not show a generic calendar or a list of future meetings.

## Meeting Growth And Coaching

Pluto can extend from memory assistance into private, evidence-grounded meeting
coaching. The opportunity is to help users understand how they participated,
recognize strengths, and practice one useful improvement without turning Pluto
into an employee-scoring or surveillance product.

The full product contract, including prompt eligibility, response structure,
evidence requirements, interaction states, and safety boundaries, lives in
[`2026-08-24-evidence-grounded-meeting-coaching-design.md`](./2026-08-24-evidence-grounded-meeting-coaching-design.md)
and outcome issue [#654](https://github.com/metagrover/pluto/issues/654).

### Entry Points

Coaching is on demand through:

- Ask Pluto across the user's meeting history.
- Meeting-scoped Pluto chat after a meeting.
- A win's `Open moment` action when the user wants to understand why it was
  surfaced.

Suggested questions include:

- `What did I do well in this meeting?`
- `How effectively did I lead this meeting?`
- `What could I have done better as the meeting lead?`
- `What could I have done better in this meeting?`
- `Where did the conversation lose clarity or momentum?`
- `What is one thing I should try in the next meeting?`

Pluto may tailor the framing when evidence supports that the user was the meeting
lead. If leadership is uncertain, it should discuss the user's participation
without claiming a role.

### Coaching Response

A useful coaching response should contain:

1. **What worked:** One or two specific strengths.
2. **What could improve:** At most one or two concrete opportunities.
3. **Evidence:** Linked moments, quotes, or timestamps supporting each observation.
4. **Why it mattered:** The effect on clarity, participation, decisions, or
   momentum.
5. **Next experiment:** One small behavior to try in the next relevant meeting.

The tone should be candid, supportive, and proportionate. Pluto should not force
criticism when no meaningful improvement is supported by the evidence.

### Evidence And Safety Boundaries

- Ground every behavioral observation in the meeting record.
- Account for transcript integrity and speaker-attribution confidence.
- Distinguish observation from interpretation.
- Never infer personality, competence, emotion, intent, or protected traits.
- Never diagnose communication, leadership, or psychological conditions.
- Do not compare coworkers or produce hidden performance rankings.
- Do not turn third-party participation into unsolicited employee evaluation.
- Keep coaching local and private under Pluto's existing data boundaries.
- Let the user correct who led the meeting and whether a coaching observation was
  useful or inaccurate.

### Longer-Term Opportunity

With explicit user intent and enough evidence, Pluto could help the user revisit
recurring personal growth goals, such as asking clearer questions, closing with
owners, balancing participation, or handling disagreement. This should remain a
private coaching history owned by the user, not an employer-facing analytics
surface. Longitudinal coaching remains outside #654 and requires a separate
outcome issue, consent model, and quality evaluation before implementation.

## Memory Dreaming And Consolidation

Issue #586 gives Pluto a proposal-first path for consolidating knowledge across
meetings. The dashboard may consume the value of that work, but it must preserve
the Dreaming Engine's evidence, review, and reversibility boundaries.

### Accepted Knowledge

Ordinary dashboard reads may use:

- Existing deterministic knowledge state.
- User-approved Dreaming changes.
- Automatically applied narrative refreshes only after the risk policy and
  required quality benchmarks explicitly permit them.

The dashboard should not add special Dreaming chrome when the result is trusted,
accepted knowledge. It should still retain the normal evidence and freshness
path.

### Pending Proposals

A Dreaming proposal may appear on the dashboard only when reviewing it could
materially change the user's understanding of active context. Examples include:

- Two active projects may be the same stream.
- Recent evidence may supersede an older project state.
- Two commitments may be duplicates.
- A new relationship may connect previously separate context.
- Conflicting sources require the user to decide what Pluto should retain.

These items belong in the Dream Log. Only a proposal that materially changes an
active `Top of mind` read may create a compact `Memory proposal needs review`
cue on the dashboard. It must include:

- A visible `Proposed` or `Needs review` state.
- The proposed change in plain language.
- Why the change matters to current context.
- The affected people, projects, commitments, or knowledge.
- Evidence sources and any ambiguity.
- A route to the Dream Log for accept, reject, or detailed inspection.

The dashboard must not offer a one-click approval for entity merges,
relationship rewrites, temporal transitions, correction overrides, archival, or
deletion. Those changes require the full Dream Log review flow initially.

### Unresolved Conflicts

When Dreaming returns `unresolved`, the dashboard may surface the conflict as a
question when it affects an active decision, commitment, or read. It should state
what disagrees and what information is missing. Ambiguity is a valid result, not
a failure Pluto must disguise.

### Operational States

Queued, running, cancelled, rejected, reverted, and failed Dreaming runs do not
belong in the normal dashboard briefing. Surface them only when they make a
specific displayed insight stale or untrustworthy. Runtime details, model names,
resource usage, and background progress belong in the Dream Log or settings.

### Dashboard Trust Rules

- Never rank a proposal as a confirmed decision, commitment, relationship, or
  current state.
- Never use model confidence as evidence.
- Never hide conflicting or incomplete evidence behind confident summary copy.
- Never let a late, cancelled, rejected, or reverted proposal influence the
  dashboard read.
- Preserve immutable source evidence and the route back to it.
- When a reviewed change is reverted, remove or refresh dependent dashboard
  conclusions rather than leaving stale derived claims visible.

## Content Anatomy

Every surfaced intelligence item should use the same underlying contract even if
its visual treatment differs.

| Field | Requirement |
| --- | --- |
| Kind | Commitment, decision, risk, blocker, question, pattern, change, or connection |
| Read | A concise user-facing conclusion or question |
| Why now | The reason this item deserves attention at this moment |
| Relevance | The affected person, project, plan, or topic |
| Next move | A useful action, or an explicit awareness-only state |
| Evidence | One or more inspectable source references |
| Confidence | Direct, inferred, emerging, weak, or stale |
| Freshness | When the item was created or last reinforced |
| Lifecycle | Active, snoozed, dismissed, resolved, or superseded |
| Knowledge state | Established, proposed, unresolved, or reverted when Dreaming is involved |

Metadata should be omitted when unavailable. Pluto must not invent owners,
deadlines, consequences, or relationships to make an item look complete.

## Ranking Principles

Dashboard ranking should consider:

1. Clear impact or blocking consequence.
2. Explicit user commitment or decision responsibility.
3. Time sensitivity.
4. Repetition across independent sources.
5. Connection to an active person, project, or stream.
6. Meaningful change since the last review.
7. Evidence strength and freshness.
8. User feedback such as pinning, snoozing, dismissal, or correction.

Ranking should penalize:

- Weak or single-source inference presented globally.
- Stale items that have not been reinforced.
- Generic summary prose.
- Repeated restatements of the same underlying issue.
- Routine tasks with no meaningful context.
- Items the user dismissed, resolved, or corrected.

The result should be diverse by meaning, not artificially diverse by category. If
the three most important items are commitments, Pluto should show three
commitments rather than inserting a weak pattern to balance the layout.

## Dashboard Exclusions

The dashboard should not show:

- Raw meeting audio or an audio-processing inbox.
- A chronological list of recent meetings.
- Transcription or analysis pipeline activity during normal operation.
- Every extracted task, decision, person, project, or topic.
- Generic source counts without a useful conclusion.
- A feed of everything Pluto processed.
- Metric tiles such as total meetings, hours recorded, or entities extracted.
- A large document-like summary that pushes actionable intelligence below the
  fold.
- Separate cards that restate the same signal as a risk, task, project update,
  and synthesis.
- Confident AI recommendations unsupported by inspectable evidence.
- Pending Dreaming proposals blended into ordinary synthesized truth.
- Background Dreaming progress, model status, or run history unless it affects
  the trustworthiness of a visible insight.

Raw meetings, recordings, transcripts, and notes remain available in their
dedicated product surfaces. Their presence on the dashboard must be earned by a
meaningful conclusion, commitment, change, or connection.

## States

### Healthy

Show the highest-value briefing available. Empty sections collapse instead of
leaving decorative placeholders.

### Nothing Needs Attention

Say so plainly, then show one or two useful changes or connections if available.
Do not manufacture urgency to keep the dashboard populated.

### Thin Evidence

Explain that Pluto lacks enough trustworthy context for a broad read. Offer a
path to inspect sources or add context without presenting raw captures as the
dashboard itself.

### Stale Synthesis

Keep confirmed commitments usable, identify which synthesized claims may be
stale, and avoid treating old conclusions as current.

### Processing Or Degraded

Keep healthy sections interactive. Mention processing only when it prevents a
specific expected insight from being current.

## First-Viewport Budget

At a typical desktop size, target:

- Up to three `Top of mind` items.
- Up to three confirmed commitments.
- Zero or one `Recent win`.
- One collapsed `Add commitment` action.
- Evidence and next actions available without opening a separate dashboard mode.

This is a content budget, not a requirement to fill every slot.

## Success Test

After scanning the dashboard for thirty seconds, the user should be able to say:

- "I know the few things that matter right now."
- "I know what I promised and what is slipping."
- "Pluto noticed something that went well."
- "I can see why Pluto surfaced each item."
- "I do not need to sort through meetings to reconstruct my own context."

If the dashboard primarily communicates what Pluto recorded or processed, it has
failed. It should communicate what Pluto understood and what that understanding
means for the user now.

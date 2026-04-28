# Pluto Second Brain Knowledge Base PRD

## Status

Draft for product alignment.

## Product Thesis

Pluto is a personal second brain that proactively organizes a user's captured conversations, notes, and meeting context into an honest, readable knowledge base.

The Knowledge surface should feel less like a database browser and more like an executive brief or personal newspaper: a place the user opens to quickly understand what is happening across their life and work streams, what patterns are emerging, what deserves attention, and what Pluto can prove from source material.

Pluto should not assume that only work meetings matter. A user's meaningful context may include product reviews, team standups, therapy notes, travel planning, hiring loops, family logistics, research calls, YouTube lectures, or solo voice memos. The product's job is to organize and rank those streams, not hard-code one domain as important and another as noise.

## Problem

Captured meetings accumulate quickly, but raw accumulation does not become memory by itself.

Users currently face three related failures:

- Too much source material: dozens of meetings can exist without a clear current read.
- Low-quality synthesis: weak one-off statements, dummy recordings, or transcript artifacts can dominate the dashboard.
- Misclassification: action items, personal reminders, project risks, and durable decisions can all be presented with the same urgency.

When that happens, Pluto stops feeling like a second brain and starts feeling like a pile of semi-random extracted facts.

## Target User

Primary users are people who want memory assistance across repeated conversations and captured context:

- Founders and operators tracking many workstreams.
- Managers and ICs who need continuity across meetings.
- Students and researchers capturing lectures, videos, and study notes.
- Creators or consultants tracking client context.
- People using Pluto for personal planning, relationships, healthcare conversations, travel, or life admin.

The product must support work-heavy users without becoming work-only software.

## Core Promise

When a user opens Knowledge, Pluto should answer:

1. What is going on across my captured context?
2. Which streams are active right now?
3. What decisions, commitments, risks, and patterns should I remember?
4. Why does Pluto believe this?
5. What is missing, stale, noisy, or not trustworthy yet?

## Product Principles

### 1. Include Meaningful Context, Then Classify It

Pluto should not globally exclude personal, travel, routine, or non-work material. Those may be the user's primary reason for using the app.

Instead, Pluto should classify content into the right conceptual lanes:

- Durable decisions
- Active workstreams
- Follow-ups
- Risks and blockers
- Open questions
- Recurring patterns
- Reference context
- Low-confidence or noisy material

A travel itinerary reminder belongs in Follow-ups. A pending production approval belongs in Follow-ups or Risks depending on impact. Neither should be silently discarded.

### 2. Rank By Importance, Recency, Breadth, And Evidence

The Knowledge page should prioritize items that are:

- Repeated across multiple meetings or notes.
- Recently active.
- Connected to active projects, people, or commitments.
- Explicitly stated as decisions, blockers, or follow-ups.
- Supported by citations or strong extracted evidence.

Single-meeting claims can appear, but should not become the main headline unless the meeting itself is the current scope.

### 3. Keep The System Honest

Pluto must distinguish between:

- "Pluto knows this from sources."
- "Pluto inferred this from related evidence."
- "Pluto has weak evidence."
- "Pluto has source material but no trustworthy synthesis yet."
- "Pluto may be showing stale context."

Every important claim should have a visible "why?" path back to source meetings, quotes, and extraction metadata.

### 4. Be Proactive Without Being Pretend-Smart

Pluto should line things up for the user: cluster streams, surface unresolved commitments, detect repeated topics, and suggest what needs attention.

It should not invent certainty from thin data, inflate routine tasks into critical risks, or hide weak synthesis behind confident copy.

### 5. Treat Knowledge As A Living Brief

Knowledge is not a static document archive. It is a living synthesis that changes as new meetings arrive.

The user should be able to tell:

- What changed since the last synthesis.
- Which streams are gaining momentum.
- Which commitments are aging.
- Which topics are fading.
- Which items were newly promoted or demoted.

## Primary Experience

The Knowledge Home page should act as the user's compiled brief.

### Current Read

The top section gives the shortest trustworthy read across the selected scope.

It should include:

- A concise headline.
- 2-4 supporting bullets when available.
- Freshness status.
- Source count.
- Cited item count.
- Cited meeting count.
- Clear weak-evidence or stale-state messaging.

Good examples:

- "API context work is moving from architecture into validation, while demo readiness still depends on UAT and instrumentation."
- "Berlin planning has concrete itinerary, biking, and shopping follow-ups; no date decision has been captured yet."
- "The last three product reviews point to the same issue: Knowledge needs better synthesis quality and stricter evidence ranking."

Bad examples:

- "Global Knowledge Context."
- "Commit to exploring opportunities with major VCs." when it is a one-off item among many sources.
- "The team discusses transitioning preferences and other data into the database..." as a headline.
- "Indexed knowledge needs a stronger synthesis" with no useful supporting context when source evidence exists.

### Active Streams

Pluto should identify the major streams in the user's memory.

Examples:

- "Knowledge Dashboard Quality"
- "Advisor Agent Deployment"
- "Berlin Trip Planning"
- "Hiring Pipeline"
- "Fitness Rehab Notes"
- "LLM Research Videos"

Each stream should show:

- Current status or short read.
- Last touched date.
- Source count.
- Open follow-ups.
- Decisions or unresolved questions.

### Needs Attention

This section shows the few items most likely to need user action or awareness.

Items may be:

- Critical risks
- Blockers
- Pending approvals
- Stale commitments
- Follow-ups
- Missing owners
- Failed or stale synthesis that affects trust

The section must not label all follow-ups as critical risks.

Required item fields:

- Title
- Kind: risk, blocker, follow-up, dependency, stale context, project health, open question
- Severity: needs attention, watch, steady
- Why now
- Evidence path

### Patterns And Signals

Pluto should surface repeated or emerging themes:

- "Multiple meetings mention confusion around sprint deliverables."
- "The user keeps returning to local-first privacy as a product constraint."
- "Travel planning is active but lacks confirmed dates."
- "Several YouTube captures are research/reference material rather than meetings."

Patterns should be promoted only when they are supported by enough breadth, recency, or explicit user notes.

### Risks And Unknowns

This section should be reserved for items that can materially affect the user's plans.

Examples:

- "API instrumentation approval is still pending."
- "The Berlin trip has activity ideas but no confirmed date window."
- "Knowledge synthesis is relying on too few cited meetings."
- "A project has blockers but no owner has been captured."

Do not fill this section with routine todos just because they are unresolved.

### Evidence And Trust

Every surfaced item should support a "why?" detail view containing:

- Source meetings or notes.
- Quotes or extracted evidence.
- Relevant people/projects/topics.
- Whether the item was directly extracted or synthesized.
- Date captured and last reinforced.

The Knowledge page should make confidence legible without forcing the user to audit everything up front.

## Content Mechanics

### Source Quality

Pluto should filter obvious garbage without excluding legitimate domains.

Allowed source-quality filters:

- Very short recordings with no notes, no entities, and no analysis.
- Default untitled recordings like "New Meeting."
- Exact throwaway titles like "audio test" or "recording test."
- Failed or malformed analysis that has no usable fallback.

Disallowed source-quality filters:

- Excluding all personal meetings.
- Excluding all travel meetings.
- Excluding all routine meetings.
- Excluding any title that merely contains "test", because "testing strategy" may be a real meeting.
- Excluding YouTube/video captures solely because they are not meetings.

### Classification

Pluto should classify extracted items before ranking them.

| Source Signal | Default Classification | Notes |
| --- | --- | --- |
| Explicit decision | Decision | Demote "no decision made" boilerplate. |
| Action item | Follow-up | Escalate only when impact or blocking language is present. |
| Accountability risk | Risk or follow-up | Use wording and evidence to decide. |
| Repeated topic | Pattern | Requires breadth or repeated mentions. |
| Summary sentence | Reference context | Should rarely become a headline. |
| Pending approval | Follow-up, watch | Escalate to risk if it blocks active work. |
| Missing owner | Risk or open question | Depends on project impact. |

### Headline Selection

Current Read headline selection should prefer:

- Concise synthesized statements.
- Multi-source claims.
- Durable decisions or strong patterns.
- Active risks with clear impact.

Headline selection should penalize:

- Imperative task phrasing.
- Long meeting-summary prose.
- One-off career/personal/todo claims in global scope.
- Raw IDs.
- Generic statements like "the team discussed..."

### Noisy Corpus Handling

If the user's corpus contains dummy recordings, test captures, or videos, Pluto should not require manual cleanup before becoming useful.

Expected behavior:

- Keep noisy sources out of top-level reads unless they contain real notes or extracted signal.
- Group research/video captures as reference streams when appropriate.
- Show "source quality is thin" when synthesis cannot support strong claims.
- Let the user inspect or exclude noisy sources later.

## Scope Behavior

### Global Scope

Global Knowledge should behave like the front page of the user's second brain.

It should emphasize:

- Cross-stream patterns.
- Active streams.
- High-impact risks.
- Follow-ups that are timely or repeated.
- Gaps in knowledge quality.

### Project Scope

Project Knowledge should answer:

- What is the current state of this project?
- What decisions shaped it?
- What is blocked?
- What changed recently?
- What should happen next?

### Person Scope

Person Knowledge should answer:

- What is the relationship/context with this person?
- What was last discussed?
- What commitments involve them?
- What topics recur?

### Research Or Reference Scope

For lectures, videos, podcasts, readings, and solo notes, Pluto should answer:

- What concepts were captured?
- What is worth remembering?
- How does it connect to existing streams?
- What follow-up exploration is suggested?

## User Controls

Users should eventually be able to:

- Rename streams.
- Merge or split streams.
- Mark a source as noisy or excluded.
- Pin an important stream.
- Promote or demote a surfaced item.
- Correct classification.
- Ask Pluto why something was ranked highly.

These controls are not required for the first iteration, but the mechanics should not prevent them.

## Non-Goals

- Do not build a generic task manager as the primary product.
- Do not make Knowledge a raw graph visualization.
- Do not make the user manually curate everything before synthesis works.
- Do not pretend every meeting is equally important.
- Do not optimize only for the founder's current corpus.
- Do not hide uncertainty.

## Acceptance Criteria

Pluto's Knowledge base is working when:

- A user with mixed work, personal, travel, and research recordings sees all meaningful streams represented appropriately.
- Routine follow-ups appear as follow-ups, not critical risks.
- True blockers and high-impact unresolved items are promoted above routine todos.
- The Current Read is concise and cites enough evidence to be trustworthy.
- Weak synthesis states explain what is missing without making the page useless.
- Raw IDs, transcript artifacts, and default dummy recordings do not become user-facing knowledge.
- A user can click "why?" on important claims and understand the source basis.
- Adding more meetings improves the brief instead of merely increasing source counts.

## Product Quality Bar

The Knowledge page should feel like:

- "Pluto has been paying attention."
- "Pluto understands what is separate and what is connected."
- "Pluto is careful about what it knows."
- "Pluto helps me re-enter my context quickly."

It should not feel like:

- A pile of extracted bullets.
- A meeting archive with nicer cards.
- A task list pretending to be intelligence.
- A dashboard optimized for one user's current test data.

## Implementation Notes

This PRD should guide future work in:

- `electron/knowledgeSynthesis.ts`
- `electron/knowledgeChunking.ts`
- `electron/db.ts`
- `src/components/KnowledgeGraph/knowledgeDocument.ts`
- `src/components/KnowledgeGraph/MainStage.tsx`
- future stream/topic clustering and source-management modules

Implementation should be test-driven for non-UI logic. In particular, tests should cover:

- Mixed-domain source inclusion.
- Follow-up versus risk classification.
- Headline ranking.
- Source-quality filtering.
- Weak-evidence states.
- Evidence/citation preservation.

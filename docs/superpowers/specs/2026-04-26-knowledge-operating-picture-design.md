# Knowledge Operating Picture Design

## Problem

The current Knowledge dashboard is hard to understand because it exposes the system's intermediate artifacts instead of answering a user question.

The screen currently mixes:

- synthesis failure state
- selected knowledge document
- memory scope switching
- person/project/team document chips
- related entity chips
- source meetings
- backlinks and timeline context
- raw rendered notes

That makes the page feel like an internal database browser. It asks the user to infer what matters from many disconnected objects. This is especially confusing because Pluto already has dedicated Projects and People pages, so Knowledge should not compete with those pages by showing another entity directory.

The product issue is not spacing or cards. The product issue is that the page does not have a clear job.

## Product Thesis

Knowledge should represent Pluto's **compiled operating picture**.

It should answer:

> What should I pay attention to across my active work, and why does Pluto believe that?

Knowledge is not primarily a document library, graph viewer, entity browser, or meeting-source list. Those are supporting tools. The first experience should be synthesis across meetings, projects, people, and time.

The user should open Knowledge when they want to understand:

- what is active
- what changed
- what is blocked or stale
- what patterns keep recurring
- what risks or unknowns are emerging
- what Pluto does not know yet

## Positioning

Pluto's main intelligence surfaces should have distinct jobs:

| Surface | Product Job |
| --- | --- |
| Dashboard | Daily capture, recent meetings, and app entry points |
| Projects | Execution objects: projects, tasks, blockers, completion |
| People | Relationship/context objects: people, conversations, roles |
| Knowledge | Cross-object synthesis: current read, attention, risks |

Knowledge should not be another Projects page or People page. It should synthesize across them.

## Goals

- Make the Knowledge tab understandable in the first five seconds.
- Put cross-project synthesis and risks before document browsing.
- Distinguish grounded claims from unavailable or failed synthesis.
- Keep raw evidence accessible from specific items without making it a landing-page section.
- Show failure and stale states calmly without turning the page into an error dashboard.
- Reuse existing knowledge data first: `getKnowledgeWorkspace`, `KnowledgeDoc.structured_json`, `project_cards`, `timeline`, `backlinks`, `graph`, and source meetings.

## Non-Goals

- Do not build a new graph visualization as the primary experience.
- Do not replace the Projects or People tabs.
- Do not show all knowledge docs as the default first screen.
- Do not invent compiled claims from fallback, malformed, stale, or unavailable structured data.
- Do not introduce backend schema changes for the first iteration unless the frontend cannot distinguish grounded claims from unavailable synthesis.
- Do not show raw source meetings, backlinks, or related entities as primary dashboard sections.

## Core User Promise

When the user opens Knowledge, Pluto should say:

1. **Here is the current read on your active work.**
2. **Here is what needs attention.**
3. **Here are the risks or unknowns worth tracking.**

If Pluto cannot produce a current read, the page should still be useful by explaining:

- whether synthesis failed, is stale, or lacks enough structured evidence
- when the last successful synthesis happened
- what raw memory is available
- what action would improve the state

## Information Architecture

The Knowledge landing page has a hard limit of three visible sections:

1. Current Read
2. Needs Attention
3. Risks and Unknowns

Empty sections are omitted. Evidence and memory browsing are not top-level landing sections.

### 1. Current Read

The top of the page should be a concise operating brief, not a document title.

It should contain:

- brief title: `Current Read`
- one-line executive read when available
- freshness metadata
- source count
- synthesis status
- last successful synthesis time
- confidence/grounding indicator

Current-data examples from the local Pluto database:

- "Three workstreams need attention: Infrastructure Scaling has open architecture choices, Context Studio is moving toward implementation, and Advisor Agent Deployment has coordination risk."
- "Infrastructure Scaling is the highest-attention thread: the latest review left concrete architecture choices open around persistent state, worker strategy, and how to present the infrastructure proposal."
- "Context Studio is moving from concept to implementation. The next meaningful milestone is validating the API/context-layer workflow with domain experts, including Neo4j-backed context and inspectable prompt/reasoning/snippet outputs."
- "Advisor Agent Deployment looks execution-heavy and coordination-sensitive. UAT setup, API instrumentation, mem0 architecture, and demo readiness are all in flight, so this thread needs clearer ownership and sequencing."
- "Memory quality needs cleanup in the background: project extraction includes noisy scopes like Omit and None specified, and person context includes low-value entities like Me and Them. These should not appear as primary dashboard signals."

Bad examples:

- "Global Knowledge Context"
- "No reliable compiled brief yet" as the entire hero
- "Latest synthesis failed" as the dominant message

### 2. Needs Attention

This is the action-oriented center of Knowledge.

It should show a short prioritized list of the most important things Pluto thinks need attention across active work. Items may be projects, risks, unresolved decisions, stale synthesis, ownership gaps, or cross-project dependencies.

Each row should answer:

- item or workstream name
- why it is surfaced now
- severity: needs attention, watch, steady, stale, failed
- evidence count or source count
- last touched / last synthesized
- optional next question Pluto should answer

Example rows from the current meeting data:

| Item | Why Now | Status |
| --- | --- | --- |
| Infrastructure Scaling | Recent design review produced decisions about persistent state, worker strategy, and scaling approach; follow-up proposal is still open | Needs attention |
| Context Studio / API Context Layer | Recent review identified the next build path: context service, prompt/reasoning/snippet inspection, domain expert feedback, Neo4j integration | Active |
| Advisor Agent Deployment | UAT setup, API instrumentation, mem0 architecture, and product leadership demo readiness are all active execution threads | Watch |

This section should not duplicate the Projects page. Rows can link into Projects or project docs, but the Knowledge landing page should not become a project tracker.

### 3. Risks and Unknowns

This section should contain only synthesized risks, unresolved decisions, missing owners, and unclear dependencies that are important enough to affect active work.

It should include:

- open architecture choices
- unclear ownership
- unresolved sequencing
- stale or failed synthesis that affects trust
- cross-project dependencies that may block progress

Each item should have:

- short claim
- why it matters
- small source count or "why?" affordance

This section should only appear when there are real items. Do not render empty cards or all four signal lanes by default.

### Item-Level Evidence

Evidence should exist only when the user asks "why?" on a specific item.

Clicking an attention item, risk, or signal opens a detail sheet with:

- source meetings
- citations
- related entities
- backlinks
- synthesis timeline

There should not be a standalone Supporting Evidence section on the Knowledge landing page. Even collapsed, a top-level evidence card adds cognitive weight and makes the page feel like an admin workspace.

### Memory Library

Document browsing is still useful, but it should be a secondary mode.

It should be behind:

- a small `Browse memory` control
- command/search
- or a separate secondary view within Knowledge

Groups:

- Workspace memory
- Project memory
- People memory
- Team tracker memory

This library is for inspection, not the default product read.

## States

### Healthy Compiled State

Show:

- Current Read
- Needs Attention
- Risks and Unknowns, if present

Tone: confident but grounded.

### Synthesis Failed

Do not make the failure the page.

Show:

- brief header: "Pluto has memory, but no current brief."
- compact status: failed
- last successful synthesis timestamp, if available
- source count
- needs-attention items if reliable data is available
- clear recovery action: retry synthesis

Do not show:

- giant red hero
- raw doc browser
- related entities as chips
- source meetings as the first page

### Stale Synthesis

Show:

- stale badge
- age of synthesis
- last known brief if available
- "This may be outdated" warning
- needs-attention items if reliable data is available

### No Structured JSON

Show:

- "Pluto has notes, but no structured brief yet."
- source count
- prompt to record more meetings or retry synthesis
- optional rendered note behind disclosure

Do not convert rendered markdown into confident project signals.

### No Docs

Show:

- empty state focused on capture:
  - record meetings
  - synthesize knowledge
  - return here for a memory brief

## Data Model For Frontend V1

The first implementation should be frontend-heavy and use existing APIs.

Inputs:

- `KnowledgeWorkspacePayload.docs`
- `KnowledgeWorkspacePayload.selected_doc`
- `KnowledgeWorkspacePayload.project_cards`
- `KnowledgeWorkspacePayload.timeline`
- `KnowledgeWorkspacePayload.backlinks`
- `KnowledgeWorkspacePayload.graph.nodes`
- `KnowledgeDoc.structured_json`
- `KnowledgeDoc.rendered_content`
- `getKnowledgeDocSources(docId)`

Frontend derived models:

- `KnowledgeBrief`
- `NeedsAttentionItem`
- `RiskOrUnknownItem`
- `ItemEvidenceDetail`

Structured JSON sections consumed:

- `chapters[]`
- `decisions[]`
- `topic_evolution[]`
- `open_risks[]`
- `signals[]`
- `dependency_suggestions[]`

## Trust Rules

Knowledge must be conservative.

Rules:

- Only structured, citation-backed fields can create compiled claims.
- Rendered markdown can be shown as saved notes, but not promoted into operating-picture claims.
- Failed synthesis can show last known content only if explicitly labeled as last known.
- Empty or malformed `structured_json` should produce an unavailable state, not generated insight.
- Citation affordances must tolerate missing citations without crashing.
- Source count should be visible when claims are shown.

## UX Principles

- One-column page.
- No primary three-column layout.
- No graph-first view.
- No giant document chip cloud.
- No noisy entity tags above the fold.
- No raw source-meeting list above the fold.
- Compact metadata over large status panels.
- Calm, utilitarian, premium workspace styling.
- Evidence and library controls should not appear as primary landing-page sections.

## Recommended First-Screen Layout

```text
Knowledge
Compiled Intelligence

[Current Read]
  Current read across active work
  Freshness · source count · synthesis status

[Needs Attention]
  Short list of workstreams, risks, or decisions that need attention

[Risks and Unknowns] if present
  Open architecture choices
  Ownership gaps
  Coordination risks
```

## Failure-State First-Screen Layout

```text
Knowledge
Compiled Intelligence

[Current Read Unavailable]
  Pluto has memory from recent project conversations, but no current compiled brief.
  Reason: global synthesis failed
  Last successful synthesis: Apr 26, 2026
  Sources available: from recent meetings such as Infrastructure Scaling Design Review,
    Context Studio and Knowledge Graph Review, and Advisor Agent Deployment

  Visible active threads:
    - Infrastructure Scaling
    - Context Studio / API Context Layer
    - Advisor Agent Deployment

[What Pluto needs next]
  Retry synthesis
  Confirm project/entity cleanup for noisy docs such as Omit, None specified, Me, Them
```

## Component Design

### `KnowledgeTab`

Responsibilities:

- Fetch workspace data.
- Track selected memory scope.
- Fetch source meetings for selected doc.
- Pass workspace payload into presentation components.

Should not:

- decide what is important
- filter saliency ad hoc in the UI
- render large dashboard sections directly

### `knowledgeDocument.ts`

Responsibilities:

- parse structured doc schema
- derive compiled brief lanes
- derive needs-attention items
- group memory scopes
- format status/freshness

This file should contain pure logic and unit tests.

### `MainStage`

Responsibilities:

- render the operating picture
- show failure/stale/unavailable states
- render the three-section landing surface
- route item-level evidence/detail requests to a side sheet or detail view

Should be split if it grows beyond readable size:

- `MemoryBriefHeader`
- `NeedsAttention`
- `RisksAndUnknowns`
- `ItemDetailSheet`

## Testing

Unit tests:

- parses structured knowledge docs
- malformed structured JSON returns unavailable compiled state
- compiled brief is created only from structured sections
- rendered markdown does not become compiled claims
- needs-attention items prioritize blockers over stale synthesis
- needs-attention items can include project-derived items without duplicating the Projects page
- grouping docs by scope remains stable

Render tests:

- healthy compiled brief shows current read + needs attention + risks when present
- failed synthesis does not show raw doc browser above the fold
- no structured data shows unavailable state
- supporting evidence is not a top-level landing section
- memory library is not a top-level landing section

Manual verification:

- desktop light mode
- desktop dark mode
- narrower viewport
- failed synthesis screenshot
- stale synthesis screenshot
- healthy compiled data screenshot

## Risks

- **Trust risk:** If Pluto overstates weak evidence, the Knowledge tab becomes unusable. Mitigation: strict trust rules and citation-backed claims only.
- **Overwhelm risk:** Too many secondary objects can recreate the current problem. Mitigation: the landing screen has a hard three-section maximum, and evidence/library views are accessed only through item-level detail or secondary navigation.
- **Duplication risk:** Projects and People pages become redundant. Mitigation: Knowledge only synthesizes across objects; it does not replace object-specific pages.
- **Empty-state risk:** A conservative system may look empty. Mitigation: show clear diagnosis, available data counts, and recovery actions.
- **Backend mismatch risk:** Existing structured docs may not contain enough signal metadata. Mitigation: start with frontend derivation, then add schema fields only after observing real gaps.

## Rollout Plan

### Phase 1: Product Reset

- Replace doc-browser-first layout with operating-picture layout.
- Make failed/unavailable state calm and explanatory.
- Remove top-level supporting context and memory library from the landing page.
- Keep graph/entity inspection available from item-level detail only.

### Phase 2: Grounded Needs Attention

- Use `project_cards`, project docs, status, source counts, and staleness to derive a short needs-attention list.
- Add tests for priority ranking.
- Link project-derived rows to Projects tab or project memory docs.

### Phase 3: Better Compiled Briefs

- Refine structured knowledge synthesis prompt/schema to produce:
  - attention signals
  - risks and failure modes
  - repeated patterns
  - cross-project dependencies
  - confidence/source metadata

### Phase 4: Recovery Actions

- Add retry synthesis action.
- Show last successful synthesis timestamp.
- Add item-level "why?" and "open project" actions.

## Success Criteria

The Knowledge tab is successful when a user can answer these within five seconds:

- Is Pluto's memory current?
- What needs attention?
- What risks or unknowns exist?
- What should I do if the brief is unavailable?

The tab is not successful if the user primarily sees:

- document chips
- person chips
- raw source meetings
- graph internals
- top-level supporting evidence sections
- top-level memory library sections
- large error states
- vague "no reliable brief" messaging without recovery context

## Resolved Decisions

- Keep the user-facing label as `Knowledge`. Do not use `Memory Brief` as the page title or nav label.
- Do not make Project Radar a primary landing concept. Knowledge may show project-derived attention items, but Projects remains the project tracker.
- Failed synthesis should show a retry button in v1.
- Defer the exact structured schema for confidence and source counts to a separate synthesis-schema spec.

# Real Data Homepage Design

Date: 2026-04-28
Status: Approved for implementation planning

## Context

Pluto's homepage currently presents a polished but stale dashboard. Several visible sections are hardcoded: the upcoming meeting card, action insights, contextual person spotlight, quick action chips, and live intelligence document cards. The app already has real data surfaces for meetings, action items, knowledge documents, project health, and graph statistics, so this work should connect the homepage to existing pipelines before introducing new backend tables or calendar-style assumptions.

The product direction is a hybrid homepage: immediate attention at the top, durable second-brain context below it.

## Goals

- Remove hardcoded sample content from the homepage.
- Use existing real IPC/data sources wherever possible.
- Preserve the premium dashboard feel while making every section evidence-backed.
- Rename or conditionally hide sections whose current framing depends on unavailable data.
- Ask before permanently deleting sections. For this pass, unsupported sections may be conditionally omitted instead of removed.
- Keep non-UI data shaping testable with TDD.

## Non-Goals

- Add calendar integration.
- Add new meeting scheduling concepts.
- Rework the full knowledge graph UI.
- Redesign the app shell or navigation.
- Change transcription, extraction, or synthesis pipeline behavior.

## Recommended Approach

Use a small renderer-side dashboard model layer that fetches existing IPC APIs and normalizes them into display-ready sections. This avoids a broad backend contract change while keeping the data shaping logic out of JSX and covered by unit tests.

If implementation discovers that a required data point is unavailable from existing APIs, prefer a narrow typed IPC addition over embedding database-specific assumptions in the renderer.

## Data Sources

The model should use existing sources:

- `GET_MEETINGS` for the latest meeting, meeting counts, and meeting navigation.
- `GET_OVERDUE_ACTION_ITEMS` for overdue work.
- `GET_STALE_ACTION_ITEMS` for stale active work.
- `GET_ACTION_ITEMS_BY_STATUS('active')` for active work when needed.
- `GET_KNOWLEDGE_WORKSPACE` for knowledge docs, selected doc, graph nodes and edges, timeline, backlinks, and project health cards.
- `GET_KNOWLEDGE_DOCS` if a lightweight docs-only read is preferable for document cards.
- `GET_KNOWLEDGE_GRAPH_STATS` if aggregate graph totals are useful for the hero or empty states.

## Dashboard Model

Create a pure TypeScript model builder that accepts raw meetings, actions, stale actions, workspace data, and optional graph stats. It returns a `DashboardHomeModel` with:

- `hero`: one primary signal with title, detail, severity, optional action, and source metadata.
- `actions`: real navigation or review actions.
- `latestMeeting`: latest meeting brief, or an empty state.
- `actionInsights`: ordered real action items, or an empty state.
- `spotlight`: high-signal person/project context when supported by real graph/workspace data, otherwise absent.
- `knowledgeDocuments`: document/project cards from real docs and project health data, or an empty state.
- `health`: loading/error/empty state flags for the UI.

The model must not contain hardcoded sample names, fake projects, fake dates, or synthetic meeting claims.

## Hero Priority

Hero selection should be deterministic:

1. Recording state: "Capturing Intelligence."
2. Overdue action item: highest urgency real action.
3. Stale action item: oldest stale active item.
4. Latest meeting: most recent saved meeting.
5. Stale knowledge document: real doc needing refresh.
6. Calm default: no urgent signal found.

Each hero action should open the relevant view when possible: meeting, projects, knowledge home, or Ask Pluto.

## Sections

### Quick Actions

Replace fake chips with real actions only:

- Ask Pluto.
- Review latest meeting, when a meeting exists.
- Open projects, when action/project data exists.
- Open knowledge home, when knowledge data exists.

### Latest Meeting Brief

Rename "Coming Up Next" to "Latest Meeting Brief" because no calendar integration exists. Use the newest meeting's title, date, summary or overview, and a button that opens the meeting.

If no meeting exists, show a polished empty state that invites the user to record a session.

### Action Insights

Back this section with overdue, stale, and active action entities. Prioritize overdue first, then stale, then active by due date or update time. The existing completed-task toggle can remain local UI behavior for now, but should not pretend to mutate pipeline status unless implementation wires status updates explicitly.

If there are no action items, show a calm empty state.

### Contextual Spotlight

Show this only when real data supports it. Preferred signals:

- a project health card with blockers, dependencies, recent changes, or staleness;
- a high-saliency person/project node from the workspace graph;
- a knowledge doc with source evidence and recent activity.

If none of those exist, omit the section for this pass rather than showing sample content.

### Live Intelligence Documents

Back this with knowledge docs and project health cards. Prefer project health cards for project cards and docs for team, person, or global cards. Card text should come from real titles, statuses, source counts, synthesis timestamps, or structured doc summaries.

If no docs exist, show an empty state explaining that recorded meetings will populate the knowledge base.

## Error And Loading States

The dashboard should load asynchronously and tolerate partial failures. One failed IPC call should not blank the entire homepage. Each section should support:

- loading;
- populated;
- empty;
- degraded/error.

For degraded states, use concise user-facing copy and log technical details to the console.

## Testing Plan

Use TDD for the non-UI dashboard model builder:

- It chooses overdue actions before latest meetings.
- It chooses stale actions when no overdue actions exist.
- It falls back cleanly when no meetings, actions, or docs exist.
- It maps real knowledge docs/project cards into document cards.
- It omits contextual spotlight when unsupported by real data.
- It never emits current sample literals such as "Sarah Chen", "Product Alignment", "Finalize Schema", or "API Migration Space".

After implementation, run focused unit tests first, then `pnpm run lint`, then the relevant broader test command if time and runtime allow.

## Open Decisions

- Permanent section deletion is out of scope until the user explicitly approves removal.
- Calendar-driven upcoming meeting behavior is out of scope until calendar data exists.
- Persisting action completion to the database is optional for this pass and should be treated as a separate behavior change if it expands scope.

## Implementation Handoff

The next step is an implementation plan that starts with tests for the model builder, then wires the dashboard component to the model, then verifies the homepage no longer renders hardcoded sample data.

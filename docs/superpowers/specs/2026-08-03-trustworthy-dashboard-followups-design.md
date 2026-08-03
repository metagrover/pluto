# Trustworthy Dashboard Follow-ups Design

## Issue

[Issue #562](https://github.com/metagrover/pluto/issues/562) makes the homepage Attention section distinguish extracted follow-up candidates from confirmed commitments before offering completion controls.

## Feature summary

People returning to Pluto need to know whether a dashboard follow-up is a commitment they accepted or a candidate Pluto extracted from a meeting. The first delivery slice adds a durable, fail-closed commitment state and uses it to make Attention reviewable without broadening into Knowledge synthesis, person-memory taxonomy, or Latest meeting copy.

## Primary user action

Review an unconfirmed follow-up against its source, then either confirm it as a task or reject it as not a task. Completion remains available only after confirmation.

## Design direction

- **Register:** Product.
- **Color strategy:** Restrained. Existing dark surfaces and semantic state colors remain unchanged.
- **Scene:** A founder or operator returns to Pluto between meetings on a desktop in a focused working session and needs to judge extracted commitments quickly without rereading every transcript.
- **Anchors:** Linear for compact action density, Apple Reminders for familiar task controls, and a careful executive brief for plain-language uncertainty.
- **Visual probes:** Skipped because this is a content and state refinement of an existing reviewed surface, not a new visual direction.

## Scope

- **Fidelity:** Production-ready.
- **Breadth:** Homepage Attention section plus the minimum persistence and creation seams needed to authorize its states.
- **Interactivity:** Shipped controls for source review, confirmation, rejection, and existing completion/blocker actions.
- **Delivery:** One focused PR with synthetic tests and issue/changelog traceability.

Deferred work includes Memory in motion taxonomy, person relationship wording, knowledge-summary rewriting, sentence-safe knowledge truncation, inline evidence expansion, extraction-quality scoring, malformed-text heuristics, and Latest meeting copy.

## State contract

Action entity metadata gains these optional fields:

```ts
type CommitmentState = 'possible' | 'confirmed' | 'rejected';
type ActionOrigin = 'extraction' | 'user';

interface ActionCommitmentMetadata {
  commitment_state: CommitmentState;
  origin: ActionOrigin;
  source_meeting_id?: string;
  reviewed_at?: string;
}
```

Rules:

1. New meeting extractions persist `commitment_state: 'possible'`, `origin: 'extraction'`, and the source meeting ID.
2. New manually created tasks persist `commitment_state: 'confirmed'` and `origin: 'user'`.
3. Legacy action entities without a valid commitment state fail closed to `possible`.
4. Confirmation merges metadata, sets `confirmed`, and records `reviewed_at` without discarding existing description or assignee data.
5. Rejection merges metadata, sets `rejected`, and records `reviewed_at`. It is not completion.
6. Rejected items are excluded before Attention counts and ranking.
7. Owner, due date, wording, alert severity, blocker state, relationship confidence, and stale age never authorize confirmation.

Metadata is used for this first slice instead of a database migration because it preserves forward compatibility while keeping the contract explicit. The update path must read, merge, and write metadata because the generic entity upsert replaces the complete metadata JSON.

## Layout and content

The existing Attention section and row rhythm remain. The header becomes state-aware instead of claiming that every row is a highest-value signal.

Summary copy:

- All possible: `{n} possible follow-up(s) need review before action.`
- Mixed: `{n} possible follow-up(s) need review; {m} confirmed commitment(s) need attention.`
- All confirmed: `{n} confirmed commitment(s) need attention.`
- Empty: retain the existing calm empty state.

Possible row:

- Badge: `Needs review`.
- Basis with source: `Possible follow-up · From {meeting title} · {date}`.
- Basis without source: `Possible follow-up · Owner and due date not confirmed`.
- Primary action: `Review source` when the persisted meeting exists; otherwise `Review task`.
- Secondary actions: `Confirm task` and `Not a task`.
- No leading checkbox, `Mark complete`, or `Resolve blocker`.

Confirmed row:

- Keeps `Overdue`, `Active`, `Blocker`, or a human-readable freshness status.
- Keeps `Mark complete` or `Resolve blocker` and existing blocker dismiss/snooze controls.
- `No due date` remains a factual field. A bare `stale` label must not be used as the explanatory basis for a possible follow-up.

## Interaction model

- `Review source` navigates to the exact persisted meeting through the existing meeting-selection path.
- `Review task` leaves the row in place when no source is available; the row already exposes all known evidence and review controls.
- `Confirm task` persists the confirmed state, refreshes dashboard data, and transforms the same row into the standard confirmed-task presentation.
- `Not a task` persists rejection, refreshes dashboard data, and removes the row from Attention.
- Existing loading, disabled, error, keyboard focus, and accessible-name behavior applies to the new controls.
- A possible item with a blocker alert remains possible. Blocker state does not restore completion controls.

## Data flow

1. Extraction and manual creation persist explicit origin and commitment state in action metadata.
2. The dashboard model parses metadata through one fail-closed helper.
3. Rejected entities are filtered before deduplication, counts, ordering, hero, and briefing projections.
4. The dashboard model emits presentation state, evidence target, summary counts, and allowed actions.
5. The renderer renders only model-authorized controls.
6. Confirmation and rejection call a narrow IPC mutation that merges action metadata and returns the updated entity.
7. The homepage query refreshes after successful mutation and reports errors without optimistic state invention.

## Key states and edge cases

- Possible with valid source meeting.
- Possible whose persisted source meeting is unavailable.
- Legacy metadata-free action.
- Confirmed user-created action.
- Possible action with active blocker attention.
- Rejected action.
- Mixed possible and confirmed rows.
- All possible, all confirmed, and empty Attention sections.
- Concurrent update/loading and mutation failure.
- Metadata containing existing full description and assignee fields.

## Accessibility

- Every review action uses visible text and a specific accessible name.
- Focus rings remain keyboard visible.
- State is communicated with text, not color alone.
- Busy rows disable every mutating control consistently.
- Removing the checkbox from possible rows prevents a misleading standard-task affordance.

## Testing

- Entity pipeline tests prove extracted actions persist possible state and source meeting.
- Manual creation tests prove explicit user tasks persist confirmed state.
- Metadata mutation tests prove confirm/reject merge existing fields and keep rejection distinct from completion.
- Dashboard model tests prove fail-closed classification, rejected filtering, blocker precedence, evidence targets, and mixed summaries.
- Renderer tests prove possible rows lack completion controls, expose accessible review controls, navigate to the exact source, and preserve confirmed routine/blocker regressions.
- Focused tests run red before production changes and green after each minimal implementation step.

## Durable decision

Pluto must authorize completion from explicit commitment state, never from inferred task characteristics. This decision belongs in `docs/decisions.md` because later surfaces should reuse the same lifecycle contract.

## Open questions resolved during implementation

- Legacy actions fail closed rather than being heuristically backfilled.
- Evidence navigation uses the source meeting rather than inline expansion in this PR.
- Knowledge/person synthesis remains a separate outcome slice.

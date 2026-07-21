# One Send-Ready Follow-up Design

## Issue

[#506 — Turn meeting context into one send-ready follow-up](https://github.com/metagrover/pluto/issues/506), under commitment and follow-up outcome #61 and the Trusted Attention phase of roadmap #65.

## Problem

Pluto already collects useful meeting context and can deterministically compose or optionally regenerate follow-up drafts. The current surface presents three equal editors for Client Email, Internal Summary, and Slack. Each template repeats nearly every available field and exposes Pluto-internal labels such as `Linked Context`, `Topic`, `Status`, and `Decided by` in prose a user is expected to send.

This makes the feature feel like a meeting-data export instead of a communication assistant. It also treats the absence of extracted action items and decisions as proof that no follow-up is needed, even when overview, discussion, or unresolved-question evidence could support a useful recap.

## Goals

- Put one concise, readable, send-ready draft in the first viewport.
- Treat Email, Internal, and Slack as alternate formats of the same follow-up.
- Prioritize the current read, consequential decisions, accountable next steps, and genuinely unresolved questions.
- Keep provenance and lifecycle metadata available to composition logic without leaking field labels into sendable prose.
- Make `Copy` the primary action and preserve user edits without silent replacement.
- Remain useful locally and without model credentials.
- Explain weak evidence honestly instead of producing filler or claiming that no follow-up is needed.

## Non-goals

- Sending email or Slack messages.
- Building recipient management, a generic task editor, or a delivery outbox.
- Changing attention-item lifecycle semantics or transcript validation gates.
- Replacing deterministic composition with an LLM requirement.
- Redesigning the rest of Meeting View.

## Chosen Product Shape

The surface has one active draft card with:

- an `Email`, `Internal`, and `Slack` segmented format switcher;
- one editable text area;
- a prominent `Copy` action with copied confirmation;
- a quiet saved-state indicator;
- secondary `Refine` and `Reset` controls behind progressive disclosure.

Switching format changes the active rendering of the same evidence packet. It does not display competing cards or discard edits in other formats. The default format is Email unless a saved selection exists.

The rejected alternatives are:

1. Keep three simultaneous editors and improve their prose. This reduces template noise but preserves choice overload and weak hierarchy.
2. Store only one text body and restyle it client-side for each format. This cannot preserve format-specific user edits and makes Email versus Slack differences too superficial.
3. Recommended: one active editor backed by three coordinated format variants. This preserves meaningful tone differences while presenting one decision at a time.

## Composition Model

Create a focused, non-React module beside `followUpDraftContext.ts` that converts the existing evidence arrays into a `FollowUpComposition`:

```ts
type FollowUpFormat = 'email' | 'internal' | 'slack';

type FollowUpComposition =
  | {
      availability: 'ready';
      recommendedFormat: FollowUpFormat;
      variants: Record<FollowUpFormat, string>;
      evidenceFingerprint: string;
    }
  | {
      availability: 'weak_evidence';
      reason: string;
      evidenceFingerprint: string;
    };
```

The module has one responsibility: select, clean, prioritize, and format sendable content. Existing context builders remain responsible for reconciling linked entities, attention lifecycle, owner and due information, and analysis fallbacks.

### Evidence priority

The deterministic composer uses evidence in this order:

1. The first non-empty overview line as the current read.
2. Up to three decisions, preserving their text but removing presentation labels from parenthetical metadata.
3. Up to five active next steps, ordered by the lifecycle priority already established in `buildFollowUpDraftContext`.
4. Up to three unresolved questions.
5. A small amount of discussion context only when no overview exists and it supplies a useful recap sentence.

Participant names appear only when already present in participant or accountable-owner evidence. Project and topic context may guide wording, but raw `Project:`, `Topic:`, `Linked Context:`, `Status:`, `Context:`, `Why:`, and `Decided by:` labels never appear verbatim in sendable output.

### Weak evidence

Composition is `ready` when at least one meaningful current-read, decision, next-step, unresolved-question, topic-summary, or discussion line exists. Participants and linked entity names alone do not make a follow-up useful.

When none of those signals exists, the surface collapses to a compact explanation: Pluto does not yet have enough meeting evidence to draft a useful follow-up. It does not say that no follow-up is needed and does not generate placeholder prose.

### Format behavior

- **Email:** A short subject, greeting, one recap paragraph, and only supported Decisions, Next steps, or Open questions sections.
- **Internal:** A direct team update without greeting ceremony, emphasizing decisions and accountable execution.
- **Slack:** The shortest variant, using restrained Markdown headings and no decorative emoji requirement.

Empty sections are omitted. `None recorded` never appears in sendable prose.

## Saved Draft Contract

Replace the unversioned `Partial<Record<DraftId, string>>` persistence shape with a backward-compatible versioned document:

```ts
type SavedFollowUpDraftsV2 = {
  schemaVersion: 2;
  selectedFormat: FollowUpFormat;
  evidenceFingerprint: string;
  variants: Record<FollowUpFormat, string>;
  editedFormats: FollowUpFormat[];
};
```

The existing `meetings.follow_up_drafts_json` column remains unchanged. Parsing behavior is:

- a valid version-2 document loads directly;
- the old `{ client, internal, slack }` object migrates in memory to Email/Internal/Slack variants and is written as version 2 on the next save;
- malformed or unsupported JSON falls back to the current deterministic composition and logs locally.

The evidence fingerprint is a deterministic hash-like string derived from normalized composition inputs; it contains no private content by itself. When meeting evidence changes:

- if no format has user edits, Pluto may refresh deterministic variants;
- if any format has user edits, Pluto preserves every saved variant and shows a quiet `Meeting context changed` notice with an explicit reset/regenerate choice;
- changing formats never resets another format's edits.

Text edits save after a short debounce and on blur. The UI shows `Saving`, `Saved`, or `Couldn’t save`; it removes the current primary-position `Save Drafts` button. Failed saves keep the local edit visible and offer retry.

## Optional Model Refinement

`GENERATE_FOLLOW_UPS` remains optional. Its prompt changes from “generate three distinct drafts” to “render one evidence-backed follow-up in three coordinated formats.” It receives the same evidence packet and returns named Email, Internal, and Slack variants.

Prompt rules require:

- concise output with omitted empty sections;
- no Pluto-internal metadata labels;
- no invented recipients, owners, decisions, or questions;
- the same underlying facts across all formats;
- valid JSON only.

Successful refinement replaces only unedited variants unless the user explicitly confirms replacing edited text. Failure leaves the deterministic or saved draft intact and surfaces a local refinement error; it never resets to defaults silently.

## Component and Data Flow

1. `MeetingView` continues to build reconciled follow-up context and passes it to `FollowUpDrafts` only for validated transcripts.
2. `FollowUpDrafts` asks the pure composition module for the current deterministic result.
3. The saved-document parser resolves versioned or legacy persisted drafts.
4. The component selects saved variants when present; otherwise it selects deterministic variants.
5. Editing updates only the active format and marks that format edited.
6. Debounced persistence writes the complete version-2 document through `SAVE_MEETING`.
7. Copy writes only the active format's text.
8. Optional refinement returns coordinated variants and respects edited-format replacement rules.

## UI Hierarchy

The ready state uses one premium, calm card rather than a grid:

- eyebrow: `Follow-up`;
- title: `Ready to send`;
- optional quiet status: `Saved` or `Meeting context changed`;
- segmented format control;
- one generous editor with readable line length;
- primary `Copy` button adjacent to the editor action edge;
- secondary `Refine` disclosure below the main action.

The weak-evidence state uses the same visual language at lower emphasis, with a short reason and no disabled editor. The component remains responsive as a single column; it does not introduce a new layout system.

## Error Handling

- Clipboard failure displays a local `Couldn’t copy` state instead of a false confirmation.
- Save failure preserves the in-memory edit and exposes retry.
- Refinement failure preserves the current variants.
- Malformed saved JSON falls back safely without overwriting the database until the user edits or explicitly resets.
- An empty refinement response is treated as failure, not as three blank drafts.

## Testing Strategy

Pure unit tests cover:

- ready versus weak-evidence selection without depending only on actions or decisions;
- omission of empty sections and internal metadata labels;
- priority and maximum counts for decisions, actions, and questions;
- coordinated Email/Internal/Slack variants from the same facts;
- deterministic fingerprint stability;
- legacy saved-draft migration;
- preservation of edited variants when evidence changes;
- replacement of only unedited variants after refinement.

Component tests cover:

- one editor visible at a time;
- format switching and per-format edit preservation;
- Copy targeting only the active variant;
- debounced save states and save failure retry;
- weak-evidence copy and wording;
- context-change notice without silent edit replacement.

Prompt tests verify coordinated variants, internal-label suppression, evidence fidelity, and safe empty-input instructions. Browser QA verifies first-viewport hierarchy, responsive behavior, keyboard focus, edit persistence, format switching, clipboard feedback, and both ready and weak-evidence states.

## Documentation and Shipping

The implementation PR adds one issue-scoped changelog fragment under `docs/changelog/entries/`. This is a focused realization of #61's existing product direction and does not require a new ADR. Any discovery that changes attention lifecycle or meeting persistence beyond the versioned JSON payload must be recorded in `docs/decisions.md` before the PR opens.

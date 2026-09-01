# Person Relationship Briefings Design

Issue: [#704](https://github.com/metagrover/pluto/issues/704)

## Outcome

People becomes a trustworthy re-entry surface for a relationship. Opening a person shows what Pluto can substantiate about recent shared context, explicit expectations, recent deliveries, and meeting history without turning the page into a CRM or presenting mentions as attendance.

## Product contract

Pluto uses a precision-first evidence ladder:

1. **Confirmed participation** comes from a user-confirmed speaker binding or, for the user's own profile, a locally captured meeting with the capture-time self identity.
2. **Expected participation** comes from an exact, unambiguous calendar attendee or organizer match. It is labeled as scheduled or invited, never attended.
3. **Mentioned-only context** comes from meeting entity extraction. It stays behind disclosure and never contributes to the confirmed-meeting count.
4. **Open expectations and deliveries** require a person ID assigned through the explicit user-owner boundary. Extracted names and fuzzy matches are insufficient.
5. **Insights** come only from a compiled person-context knowledge document with cited meetings. Failed or stale regeneration may preserve the last reliable snapshot, while thin or uncited synthesis produces no insight block.

Absence is preferable to a confidently wrong relationship claim.

## Interaction and hierarchy

The People directory retains the compact All Meetings row language. A row click selects the person and opens an inline dossier instead of opening the latest meeting.

The dossier contains:

1. A back control, identity, role, and compact evidence summary.
2. **Current context**, only when a reliable cited person-context brief exists. It shows one headline, at most two useful source-backed insights, freshness, and source-meeting links.
3. **Open expectations**, capped at three in the first view, with due state and source meeting.
4. **Recently delivered**, capped at three completed commitments from the last 60 days, with source meeting.
5. **Meetings together**, all confirmed meetings newest first, using the existing All Meetings date, duration, title, and row affordances.
6. Progressive disclosure for **Scheduled or invited** and **Mentioned in other meetings**. These sections use explicit weaker-evidence labels.

Empty sections are omitted. If no reliable relationship evidence exists, the profile teaches the distinction between confirmed, scheduled, and mentioned context without filler copy.

## Data boundary

Electron exposes one `GET_PERSON_BRIEFING` read model. It validates the person, classifies meeting evidence, returns explicit user-owned commitments, and includes the relevant person-context knowledge document plus working-memory snapshot. The renderer never reconstructs authority from display names.

The read model is source-preserving:

- Meetings carry `confirmed`, `scheduled`, or `mentioned` evidence kind.
- Commitments carry source meeting ID, source title, evidence quote, status, and due date.
- The knowledge brief retains its existing citation and freshness metadata.

## Processing boundary

Meeting processing publishes notes, value signals, entities, commitments, and MID as the meeting-scoped secondary stage. It then queues person, project, team, and global knowledge-document refresh rather than waiting for cross-meeting synthesis.

The background refresh coordinator:

- waits at least 15 minutes after the meeting is queued;
- requires at least 15 minutes of system input idle time;
- runs only on AC power with nominal or fair thermal state;
- runs only when capture, transcription, foreground downstream work, Ask Pluto, and other foreground LLM work are inactive;
- processes one meeting refresh at a time;
- aborts and retains work when foreground activity begins;
- uses the existing serialized LLM gate and generation fencing;
- never turns an intentional preemption into a failed knowledge document.

This is not the Memory Dreaming engine from #586. It refreshes existing evidence-backed knowledge documents only; it does not merge identities, rewrite relationships, or mutate semantic graph history.

## Failure and recovery

- A failed profile read shows a local retry state and does not affect the directory.
- A missing or weak knowledge document hides Current context while meetings and verified commitments remain available.
- A background refresh failure keeps the meeting queued for a bounded retry and retains the last reliable read.
- App shutdown aborts active background synthesis. Startup's existing stale-document initialization remains the recovery path.
- Foreground activity preempts background synthesis; late output is fenced by the abort-aware commit check.

## Accessibility and visual treatment

The profile uses Pluto's restrained neutral palette, one accent for interaction and selection, no nested cards, and no decorative motion. Section boundaries, whitespace, typography, and disclosure provide hierarchy. All rows are keyboard reachable, focus-visible, and labeled without relying on color. Narrow windows collapse metadata beneath titles without hiding evidence labels.

## Verification

- Pure evidence-classification and quiet-period coordinator tests are written first and observed failing.
- DB-facing profile tests cover confirmed, scheduled, mentioned, ambiguous-name, explicit-owner, delivery, and missing-person cases.
- DOM tests cover directory-to-profile navigation, hierarchy, progressive disclosure, empty evidence, source opening, and accessible labels.
- Focused tests, full `pnpm test`, lint, production build, changelog validation, and `git diff --check` run before completion.
- Electron is rendered and inspected at desktop and narrow width. If the runtime cannot be made available, that limitation is reported without claiming visual acceptance.


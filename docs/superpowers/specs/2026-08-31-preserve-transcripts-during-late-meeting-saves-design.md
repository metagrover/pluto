# Preserve transcripts during late meeting saves

Issue: [#665](https://github.com/metagrover/pluto/issues/665)

Status: Approved for implementation on 2026-08-31.

## Outcome

Late generic meeting saves can update titles, notes, analysis, and other ordinary
meeting metadata without erasing transcript-owned state that the caller did not
send. Transcript and finalization paths retain the ability to replace transcript
state intentionally. Live transcript text also remains contained when ASR emits
a long unbroken token.

## Persistence semantics

The generic `saveMeeting` database boundary distinguishes an omitted property
from an explicitly supplied value. Before executing the existing meeting upsert,
it loads the current meeting, when one exists, and creates one effective record.
For each transcript-owned field, an omitted incoming property inherits the
current stored value; an explicitly supplied value, including `null`, is used as
the intentional replacement.

The protected transcript-owned fields are:

- `audio_path`
- `system_audio_path`
- `mixed_audio_path`
- `transcript_json`
- `transcript_status`
- `transcript_integrity_json`
- `transcript_validated_at`

New meetings continue to use the current insertion defaults. Existing guarded
transcript validation, final transcription, recovery, and downstream run paths
retain their concurrency checks and explicit transcript updates. This change
does not weaken those guards or turn generic saves into transcript patches.

The effective merged record is used consistently for trust validation, the SQL
upsert, and meeting search-index refresh. The database row and search projection
must never observe different transcript values from the same save.

## Alternatives considered

SQL `COALESCE` assignments would be smaller but cannot distinguish an omitted
property from an explicit `null`, so they would prevent intentional clearing.
Adding presence flags for every protected SQL assignment would preserve that
distinction but would enlarge and obscure the positional upsert contract. A new
meeting-patch API would provide a cleaner long-term mutation model but expands
this regression fix across callers and IPC contracts. Merging at the generic
database boundary is the smallest centralized change with the required
semantics.

## Live transcript containment

Confirmed, tentative, and interim live transcript text may contain ASR tokens
without spaces. Their text containers use `overflow-wrap: anywhere` while the
existing vertical scrolling, typography, and live-edge behavior remain
unchanged. The transcript must not gain a horizontal scrollbar or widen its
recording workspace column.

## Error handling and compatibility

The merge applies only when a current row exists. If no row exists, insertion
behavior remains unchanged. Existing transcript trust validation runs against
the effective record so an ordinary partial save cannot fail merely because it
omitted trust fields, while an explicitly inconsistent transcript replacement
continues to fail as it does today.

No schema migration is required. Existing full-record callers remain compatible,
and explicit `null` retains its meaning.

## Test and acceptance plan

Non-UI persistence behavior follows test-driven development.

- A generic partial update that omits every protected field preserves all stored
  transcript and audio values.
- Explicit replacement values update the protected fields.
- Explicit `null` clears nullable protected fields rather than inheriting them.
- A partial save refreshes meeting search from the effective merged record.
- New-meeting insertion keeps its existing defaults.
- Guarded transcript/finalization paths retain their existing behavior and tests.
- Focused live-transcript coverage asserts containment styling for both recognized
  paragraph parts and interim text containing long unbroken tokens.
- Focused Vitest, lint, type checking, and the full relevant test suite pass.

## Durable records and shipping

This is a regression repair rather than a new long-lived architecture decision,
so it does not require an ADR or `docs/decisions.md` entry. Implementation adds a
uniquely named `#665` changelog fragment explaining that late meeting saves no
longer erase transcripts and that live ASR text remains contained. The pull
request links #665.

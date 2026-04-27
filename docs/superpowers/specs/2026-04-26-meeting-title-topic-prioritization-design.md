# Meeting Title Topic Prioritization Design

## Problem

Pluto can over-weight short social openers when generating meeting titles and insights. In the observed failure, a manager's brief personal check-in at the start of a work meeting caused the saved title and overview to focus on health and family concerns instead of the sustained work discussion.

The root cause is that title generation uses only the beginning of the transcript, while analysis prompts do not explicitly tell the model to down-rank brief rapport, travel, health, or family check-ins when the rest of the meeting is work-focused.

## Goals

- Future meetings should title and summarize the sustained meeting substance, not incidental openers.
- Brief personal check-ins should remain available as context, but should not dominate overview or topic structure unless they are the main sustained subject.
- Existing affected meetings should be repairable with an explicit backfill command.
- Tests must avoid using real participant names from the reported meeting.
- Backfill should resolve the app database path using Electron-compatible app data locations, with an override for unusual installs.

## Non-Goals

- Do not redesign the full meeting intelligence pipeline.
- Do not remove personal context from transcripts.
- Do not infer private health details beyond what is present in the transcript.
- Do not mutate any database unless the user explicitly runs a write mode.

## Future Meeting Design

Add a title transcript preparation helper that samples representative transcript context from the beginning, middle, and end of the full meeting. The title prompt will receive this balanced context rather than the first chunk only.

Update title prompt rules:

- Prefer sustained work topics over brief opening rapport.
- Treat short health, travel, family, schedule, and greeting exchanges as context unless they are the primary subject.
- If the meeting is a one-on-one with several topics, use the dominant work topic or a neutral one-on-one title.

Update structured analysis prompt rules:

- Rapport and personal check-ins may be captured as minor context.
- Do not create a major topic for a short opener when later segments contain the primary work discussion.
- The overview should reflect the practical purpose and outcome of the meeting.

## Backfill Design

Create a script that can repair existing meetings by regenerating title and analysis with the improved prompts. It should:

- Resolve the database path from `PLUTO_DB_PATH`, an explicit `--db` argument, or the default app support path.
- Support `--dry-run` by default and require `--write` for mutation.
- Accept either `--meeting-id` or a title search term.
- Print the old and proposed title, plus a short analysis preview.
- Update `meetings.title`, `meetings.enhanced_notes`, `meetings.analysis_json`, analysis metadata, and FTS rows only in write mode.

## Testing

- Unit test transcript title-context sampling with a neutral-name meeting that opens with a personal health check-in and then moves into work.
- Unit test that `getTitlePrompt` includes the down-ranking rules and balanced transcript context.
- Unit test the backfill database path resolver without touching a real database.
- Unit test backfill argument parsing defaults to dry-run and requires an explicit write flag.

## Risks

- Some real meetings are genuinely about health or personal topics. The prompt must not forbid those titles; it should only down-rank brief openers when later content is clearly dominant.
- Existing app databases may live outside the default support path during development. The script must allow an explicit path override.

# Local real-meeting regression

Run `pnpm test:e2e:meeting` from the main checkout. This opt-in test launches the
current source app in Electron with a new disposable profile. It generates fresh
notes, waits for secondary extraction, refreshes People and Projects, then asks a
question and follow-up through the real Ask Pluto IPC handler. It uses the real
database, providers, retrieval, and synthesis; none are mocked.

The private case lives at `.private/real-meeting-e2e/case.json`. This machine has a
saved meeting case; it is deliberately excluded from Git. Other machines must
create their own case. `REAL_MEETING_E2E_CASE` can select another case inside that
directory. `REAL_MEETING_E2E_PORT` changes the default debug port, 9367. Run one
case at a time, without another heavy inference workload.

To exercise a locally built package, set `REAL_MEETING_E2E_APP` to the absolute
path of `Pluto.app` and run the same command. The test launches that executable
with its own disposable profile and a loopback debugging port instead of starting
the development server. It uses the same source case and expectations. Verify the
package first with `pnpm run package:verify-runtime -- /absolute/path/Pluto.app`.
This checks the packaged intelligence pipeline; recording and visual acceptance
still require separate checks.

Each run retains its profile, owner-only runtime log, and `report.json` under
`.private/real-meeting-e2e/run-*`. The report includes the case/source hashes,
configured models, stage results, expected-check IDs, and actual output. Missing
content, provider refusals, failed synthesis, unavailable/partial chat, missing
source citations, and mismatched expectations fail the test. Console output
contains stage names and the report path, without meeting content.
Checks with `evaluated: false` and blocked stages were not reached; they are not
semantic failures or passes. The full source expectations and final persisted
meeting/run state are retained in the private report. Installed model digests are
recorded so a changed model can be distinguished from an app regression.

## Case format

The JSON contains `version: 1`, `meeting`, `model`, `fastModel`, `questions`, and
`checks`. Only local Ollama models are used; no production profile or credentials
are copied. Models must already be installed. Their normal memory admission rules
apply. The disposable database uses standard storage inside an owner-only run
directory; delete a run directory when its private evidence is no longer needed.

`meeting` accepts only `title`, ISO `started_at`, positive `duration_seconds`,
`transcript_json` (the original saved JSON with a nonempty `segments` array),
`transcript_status: "validated"`, and `finalization_status: "finalized"`. The seed
cannot contain generated notes, analysis, entities, or summaries. Never change an
untrusted transcript to validated merely to run this test.

Each question has a stable lowercase `id` and natural-language `query`. Questions
run in order in one conversation, with prior answers preserved.

Each check has an `id`, a `surface` (`notes`, `commitments`, `people`, `projects`,
or `chat`), `match`, optional `absent`, and literal `sourceQuotes`. All five
surfaces and every question require expectations. Quotes must occur in the source
transcript. Values in `match` and `absent` are case-insensitive regular expressions
keyed by dotted output paths; `$` means the whole record. JSON-valued string
fields such as entity metadata are decoded when following a path. Every `match`
must hold on the **same** record; no `absent` pattern may match that record.

For example, using fictional data:

```json
{
  "id": "conditional-report-owner",
  "surface": "commitments",
  "match": { "name": "report.*after.*approval", "status": "^active$" },
  "absent": { "name": "approved already" },
  "sourceQuotes": ["Sam will send the report after security approval."]
}
```

For chat checks, require `questionId: "^your-question-id$"` and an `answer` pattern.
Check owners, lifecycle state, deadlines, conditions, uncertainty, and omissions,
as appropriate. Use narrow fields and meaningful forbidden claims. Do not replace
gold expectations with generated output to make a failing run green.

## Interpreting a pass

Pattern checks catch specific regressions, not arbitrary semantic errors. Even a
green report remains `pending_source_review`: compare fresh outputs to the entire
source for attribution, final state, conditions, and unsupported claims. Record
that review locally beside the report. Case/source hashes let you tie the review
to the exact input. Keep model versions stable when comparing runs.

This starts from a saved validated transcript. It does not certify recording,
audio transcription accuracy, visual interactions, or a packaged release. It
does not alter the production database. The fast harness checks run in ordinary
unit tests: `pnpm exec vitest run tests/unit/realMeetingE2E.test.ts`.

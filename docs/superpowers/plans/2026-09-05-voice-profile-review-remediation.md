# Global Voice Profile Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents without user authorization.

**Goal:** Safely reuse eligible, explicitly identified speaker evidence across People profiles and future-meeting recognition, for every person, while respecting deletion and source validity.

**Architecture:** Keep a single local enrollment store as the authority for People and recognition. Route automatic reconciliation and direct enrollment through the same current-evidence and enrollment-policy checks; perform final checks and persistence atomically after asynchronous extraction. Recognition remains precision-gated and does not silently rewrite confirmed identities.

**Tech Stack:** TypeScript, Electron IPC, React, SQLite/better-sqlite3, Vitest, existing native speaker-evidence extraction.

**Tracking:** [Issue #768](https://github.com/metagrover/pluto/issues/768), [PR #773](https://github.com/metagrover/pluto/pull/773), reviewed head `f338a8f9645b3ce27ee6a33585e681f2922a3862`.

## Scope and evidence

The review reproduced two failures with synthetic fixtures: cached candidates enrolled after their source generation changed and transcript became pending; in-flight reconciliation recreated a profile after a concurrent enrollment and deletion. The 31 existing handler/modal tests passed. Actual People-page display and real-meeting recognition are not yet verified. These are separate acceptance gates, not implied by the unit results.

No person-specific repair scripts, hard-coded identities, private names, transcript excerpts, or meeting metadata in code, fixtures, issue updates, PRs, or screenshots. Do not alter production data during test development. Playable review audio alone is not evidence that enrollment passes quality gates.

## File responsibilities

- `electron/speakerVoiceHandlers.ts`: reconciliation, IPC orchestration, current binding/policy checks, sanitized responses.
- `electron/speakerVoiceStore.ts`: enrollment persistence, canonical profile projection, deletion/settings transaction.
- `electron/speakerEnrollmentCandidate.ts`: retained-audio, source fingerprint, transcript trust and candidate eligibility validation.
- `src/components/features/SpeakerIdentificationModal.tsx`: confirmation/enrollment outcome and refresh behavior.
- `tests/unit/speakerVoiceHandlers.test.ts`: synthetic lifecycle, source-invalidity and concurrency regressions.
- `tests/unit/SpeakerIdentificationModalVoice.dom.test.tsx`: visible enrollment outcomes and refresh regressions.
- Locate the existing People profile consumer and its tests with graph discovery before editing; keep changes limited to its voice-profile query/rendering path.

## Task 1: Preserve the failing cases as regression tests

- [ ] Add a handler test that saves an eligible candidate, changes the meeting capture generation and sets transcript status to pending, then requests profiles. Assert no enrollment, no active profile and no recognition eligibility from the old candidate.
- [ ] Add a deferred-builder test: start reconciliation, enroll the same person through direct IPC, delete that profile, then release reconciliation. Assert zero enrollment rows and a retained opt-out setting.
- [ ] Add a test for deletion followed by ordinary speaker confirmation. Automatic enrollment must not recreate the record; only an explicit re-enrollment action may clear the opt-out.
- [ ] Run the targeted tests and verify they fail for the intended assertions, not setup or ABI errors. Keep synthetic fixtures isolated from the production database.

Run with the currently installed Electron SQLite ABI, without rebuilding the user's running runtime:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/speakerVoiceHandlers.test.ts tests/unit/SpeakerIdentificationModalVoice.dom.test.tsx
```

## Task 2: Validate evidence consistently before enrollment

- [ ] Trace direct enrollment, cached-candidate reconciliation and freshly built reconciliation. Extract the smallest shared validation boundary needed; do not create a parallel enrollment system.
- [ ] Require a currently valid individual user binding to the intended person, an eligible candidate, current source generation, usable transcript trust and compatible evidence provenance. Reject missing/deleted sources. Exclude the workspace owner from remote enrollment.
- [ ] Apply equivalent checks to cached candidates and newly extracted candidates. A cache hit must not bypass source validation. Rebuild from current eligible retained evidence when possible; otherwise return a typed ineligibility/staleness result without saving a profile.
- [ ] Repeat current source/binding/policy checks immediately before the synchronous write transaction; asynchronous extraction must not authorize a later write by itself.
- [ ] Add cases for changed generation, withdrawn transcript trust, changed binding, removed meeting and incompatible provenance. Verify each yields no new enrollment; verify unchanged eligible cached and freshly extracted evidence still enroll.
- [ ] Run targeted tests, review the diff, and commit the source-validation change separately.

## Task 3: Make deletion durable and race-safe

- [ ] Persist enrollment removal and the automatic-enrollment opt-out in one SQLite transaction. Keep disabling a retained profile distinct from deleting its biometric records.
- [ ] Re-read opt-out status inside the enrollment transaction for both direct automatic enrollment and reconciliation. A deletion or disable that occurs during extraction must win over that pending automatic operation.
- [ ] Do not treat routine speaker confirmation as explicit re-enrollment. Provide or reuse a clearly labeled re-enrollment action; only that action may deliberately clear the deletion opt-out after fresh validation.
- [ ] Preserve original identity ownership of enrollment evidence while deriving canonical profiles through aliases. Add merge/restore tests so a restored person regains their own evidence instead of leaving it attached to the survivor.
- [ ] Verify repeated reads are idempotent, concurrent direct/backfill attempts do not duplicate identical enrollment evidence, deletion survives restart, and explicit re-enrollment succeeds only with valid current evidence.
- [ ] Run targeted lifecycle tests, review the diff, and commit the lifecycle change separately.

## Task 4: Make global reconciliation observable and keep reads responsive

- [ ] Stop making every People/suggestion response wait for an unbounded sequential scan of all historical speakers. Reuse existing job/refresh infrastructure where available; return existing profiles promptly and schedule bounded, deduplicated reconciliation work.
- [ ] Record distinct outcomes: enrolled, pending, source unavailable/ineligible, failed, or opted out. Do not swallow every exception into an indistinguishable empty profile.
- [ ] Avoid retrying unchanged ineligible evidence on every read. Retry when relevant evidence changes or through an explicit retry action; transient failures must remain retryable.
- [ ] Publish completion through the existing renderer refresh mechanism. People must re-query the authoritative store after enrollment/deletion/status changes, including completion of historical reconciliation.
- [ ] Add a deferred-extraction test proving an existing profile and current-meeting metadata remain available while unrelated historical work is pending. Verify one failing source does not prevent eligible peers from completing.
- [ ] Run the relevant handler and renderer tests, review the diff, and commit the reconciliation/refresh change separately.

## Task 5: Verify the complete product path

- [ ] In synthetic integration fixtures, confirm multiple distinct speakers through the identification modal, including selecting an existing person and creating a new person. Assert eligible enrollment persists and People shows the same profile and playable reference after navigation and restart.
- [ ] For confirmed speakers whose evidence is unavailable or fails quality gates, assert People explains the reason and does not falsely claim an enrolled profile. Preserve their meeting-scoped identity confirmation.
- [ ] Create a future meeting with compatible matching evidence. Assert only active eligible profiles participate, confident matches generate the intended recognition suggestion, and ambiguous/low-quality matches abstain. Recognition must not silently override user-confirmed identity bindings.
- [ ] Reconcile the existing issue's calibration/feature-flag contract with the implementation before changing recognition activation. Do not silently broaden the flag bypass or lower confidence thresholds to make the test pass.
- [ ] Test delete, disable, re-enable and explicit re-enrollment through the UI/IPC path; verify their effects in both People and future matching.
- [ ] In a disposable app profile, verify the full workflow visually. Separately inspect the user's running app version and database path before attributing an empty page to code; do not apply production repair writes. Any production extraction/enrollment run needs explicit approval for that acceptance step.

## Task 6: Delivery gate

- [ ] Run the focused tests above, the existing voice candidate/store/People tests identified during implementation, `pnpm exec tsc --noEmit`, `pnpm exec vitest run`, and `pnpm run lint`. Use the matching SQLite ABI for each runtime and restore Electron compatibility if a Node rebuild was required.
- [ ] Review final changes against both original regressions and the full product acceptance matrix. No merge recommendation until all required gates pass; disclose unavailable real-meeting evidence separately.
- [ ] When implementation/delivery is authorized, update issue #768 and PR #773 with privacy-safe acceptance evidence, preserve the issue-linked changelog entry and record any changed durable identity policy. Do not publish private meeting details.
- [ ] Report source commit, test results, disposable-runtime evidence, production evidence limitations and remote PR status separately. A passing mock match is not evidence of real-world acoustic recognition accuracy.

## Definition of done

Eligible confirmed voices appear consistently in People and participate in precision-gated future recognition; ineligible voices have an honest explanation. Cached stale evidence cannot create profiles. Deletion cannot be undone by pending or later automatic work. Multiple-person, merge/restore, restart and concurrent-action tests pass, and the actual UI flow has been observed in a safe runtime.

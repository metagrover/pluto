# PR #676 completion review

Issue #674. This continues the previously approved local-only, accuracy-first design on the isolated PR worktree. The complete PR remains a draft until semantic acceptance is met. Historical evaluations are unchanged.

## Deterministic corrections

- The standalone copied conditional-offer counterexample is now an ordinary passing regression, not an expected failure. The guard matches the complete normalized offered task and rejects unrelated later resolution. Exact task restatements and brief two-turn acceptance remain valid. This is deliberately not a general semantic classifier: paraphrased, reordered or embedded offers remain outside the new guard.
- Explicit, unambiguous promise withdrawals must retain source coverage in the notes body or overview. A heading alone does not count. The existing one audit repair is reused; repeated deletion fails rather than restoring unaudited writer text. Narrower/ambiguous cancellations are not newly treated as authoritative. Coverage is not proof that the wording or reason is faithful.
- Fallback overviews select each section's first reviewed decision/action, otherwise its first narrative item, before filling up to three items without duplication. Exact item text and provenance stay together. Explicit reviewed overviews are untouched. This prevents a leading unaccepted offer from displacing the same topic's settled decision; it does not guarantee a comprehensive summary.
- Secondary-only retries capture the current published row and run together after asynchronous provider initialization, then retain run/revision publication checks. A new run cannot lend its ID to an older document snapshot.
- Manual title edits use compare-and-set title IPC instead of saving a stale whole meeting. Conflicts and failures preserve the draft; replacing a concurrent title requires an explicit retry. Escape, navigation, unmount and late async responses are covered, including Strict Mode replay.
- Failed regeneration shows one immediate error notice; the persisted failure status returns after dismissal/reopening, aligned with the notes measure. Related-insight status uses the same measure.
- Repository metadata lets electron-builder resolve update metadata from a Git worktree. This does not configure publishing or change dependencies.

Shared content guidance now explicitly preserves attributed experiences, feelings and reasons without inferred emotions/consequences. Direct audits positively retain withdrawals as discussion and correct an active-action misclassification. The policy remains at most 350 words with exactly three instructional examples. The unintegrated reconciler's framing was shortened to retain its existing 3,000-character prompt budget. No stage, retry, provider default or sampling change was added. Final identities are notes-v22/v23 and guardrails-v3/schema-v1.

## Frozen completion baseline: notes-v18, seed 41

[Raw attempts, source, criteria, hashes and final documents](../../../tests/manual/fixtures/meetingNotesCompletionBaselineSeed41.json). Same four declared cases, installed `gemma4:12b`, digest `4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`, thinking disabled, temperature 0.1, context capacity 16,384. Short case limit 270 seconds; longer synthetic case 600 seconds. Shared runtime and concurrent builds make latency observations unsuitable for speed comparisons.

| Case | Mechanical result | Independent source review |
| --- | --- | --- |
| Personal | Returned, two calls, 109.7s | Still omits satisfaction/frustration; attribution and non-action status correct. |
| Qualified publication | Rejected after one audit repair, 110.3s | Both audits delete screenshot-withdrawal context. The new guard correctly blocks publication; this is not successful generation. |
| Accepted request/privacy | Returned, two calls, 52.4s | Core policy, rationale, owner, recipient and deadline retained; preparing the table remains omitted. |
| Longer exhibition | Returned, two calls, 215.5s | Commitments, conditions, cancellation and catalogue choice retained; substantial personal/observational coverage still missing. |

Nine completed responses, three final documents. These original results are not rescored after later projection or prompt corrections.

## Frozen compact-guidance run: notes-v20, seed 41

[Raw attempts, source, criteria, hashes and final documents](../../../tests/manual/fixtures/meetingNotesCompletionGuidanceSeed41.json). Same cases, seed, model digest, schema, sampling and time limits; only the compact content guidance and positive direct-audit instruction changed. No outside retries or sample selection. Nine completed responses; three final documents.

| Case | Mechanical result | Independent source review |
| --- | --- | --- |
| Personal | Returned, two calls, 66.9s | Preserves attribution, satisfaction, frustration and enjoyment without invented tasks or gender. Passes this case's source criteria. |
| Qualified publication | Returned, two calls, 97.0s | Preserves the conditional Wednesday action, static-introduction choice/rationale and screenshot withdrawal/reason. The logged fallback still foregrounds the earlier offer; the later outcome-first deterministic correction has replay coverage, not a rescore of this run. Refusal is implicit in the visible static-choice rationale rather than explicit in the offer point. |
| Accepted request/privacy | Returned, two calls, 43.3s | Correct policy/rationale, accepted upload task, owner, recipient and deadline. Preparation remains omitted, so complete source acceptance is not met. |
| Longer exhibition | Rejected after one audit repair, 335.2s | Better personal/context coverage, but writer invents “she” for Lena and both audits retain it. No final document was published; source fidelity and completion gates are not passed. |

The candidate is not ready for promotion. Passing the personal case is a real improvement in this fixed sample, not proof of general reliability. The full run was frozen before notes-v22/v23, whose only further analysis change is outcome-first fallback projection; model-facing content did not change again.

Independent offline replay locates the long-case mechanical error at `notes_audit_invalid_commitment:s3:item:1`. The camera-list cancellation is faithful and both audits have valid review targets. Its R12+R13 evidence fails scoped polarity, while the identical text with R12 alone passes: unrelated R13 insurance/courier negations contaminate the check. This is a validator false rejection, separate from the unsupported gender claim. Do not report the failed run as a successful safety rejection of the gender error.

This remaining validator issue is intentionally unresolved. The claim's generic `commitment` token occurs near the end of R13, stretching the min/max token window across unrelated negations. Dropping generic words or accepting any matching R12 clause could hide a later task-specific reversal or prerequisite. A safe correction needs clause-level actor/task/negation relationships, not another global lexical exception; it requires a separately reviewed validation design. No new matcher or broad polarity relaxation was added in this completion pass.

## Rendered-app scope

The worktree's production renderer and Electron main process were exercised with a disposable `/tmp` profile and synthetic saved notes. Recording-readiness IPC was stubbed only in the external QA wrapper; no recording readiness or live-audio acceptance is claimed. The first isolated attempt entered the automatic transcription preparation gate and was stopped; no normal-profile settings or files were changed.

Observed title-conflict draft preservation and explicit successful replacement after a concurrent SQLite title update. A deliberate unavailable local model produced a genuine Ollama 404 through the generation IPC. Existing notes stayed visible and the persisted analysis JSON SHA-256 stayed `1474b3e2adc4c58346d1a7c35743f02c46c4f5118b0bdbd95f782a93b3557e90` before and after failure. The run persisted `failed / notes_failed / notes_generation_failed`. This is failure-path and presentation evidence, not a successful real-recording regeneration or history-restore acceptance run.

That rendered pass exposed duplicate failure feedback and a status line outside the notes measure. The scoped correction passed a red/green DOM regression: hide the redundant status while the immediate alert is shown, then restore the persisted status when dismissed. The final visual recheck was blocked by the locked Mac; this last layout adjustment has DOM/build verification only. QA processes were stopped afterward.

## Remaining release gates

Source-level completeness and unsupported-detail review remain separate from structural validity, exact citation resolution and passing code tests. Representative real-recording and oversized hierarchical acceptance have not been completed. Do not merge, promote the candidate model or regenerate production notes based on deterministic replay or the synthetic UI profile alone.

## Final verification

- Full unit/DOM suite: **235 files / 2,606 tests passed**, with `pnpm exec vitest run --maxWorkers=2`. No expected-failure control remains for the original copied-offer defect.
- TypeScript and scoped Biome passed. Changelog validation passed for 142 fragments; the existing issue fragment was extended because the repository requires one fragment per issue.
- `pnpm run build --publish never` passed, including the macOS app, DMG and blockmap. Four packaged runtime executables passed `package:verify-runtime`. Signing is ad hoc; notarization and release publishing were not performed.
- Dependency audit found no high-severity advisories across 194 installed packages.
- Worktree SQLite bindings were restored after the final Node tests and verified with an in-memory query under Electron 40.8.0 / ABI 143. Main-checkout dependencies were not rebuilt.
- Both new evidence artifacts were compared to all 17 original log events each after JSON parsing; every raw response string is unchanged.
- Independent reviewers checked the bounded grounding/overview changes, publication race, title lifecycle and prompt change; the final long-case validator gap is explicitly unresolved, not silently waived.

An earlier full run during native-module rebuilding failed to load SQLite, and a busy run hit two 5-second App-test timeouts. The final run used a completed Node rebuild and two workers; test timeouts/assertions were not relaxed. These infrastructure/interference failures are separate from the reproducible live-model acceptance failures above.

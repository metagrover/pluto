# PR #676 final-fidelity continuation

Issue #674; follow-up to the [earlier completion review](2026-08-27-pr676-completion-review.md). **This is a draft checkpoint, not release approval.** Previous evaluations and their scores remain unchanged.

## What changed

- Refresh the saved document and source after asynchronous setup for automatic secondary retries as well as explicit retries. This prevents an older document being paired with a newer run.
- Fix an infinite partition-search loop at some emoji boundaries without splitting the character or changing capacity estimates.
- Resolve and pin the actual local model for the entire notes run, including metadata and cache identity. Already-cancelled calls still make no transport requests.
- Retain bounded local HTTP error bodies privately so context-overflow errors can use the existing bounded repartition path. Do not emit error bodies as generated tokens or log them.
- Strengthen compact guidance on complete operations, completed work, explicit offer status and supported person references. No new stage, retry allowance, schema or production model change. Candidate identities are notes-v24/v25, guardrails-v3/schema-v1.

## Rejected experiment

The approved narrow withdrawal witness fixed the frozen mixed-citation example, but independent adversarial review found that it could miss a later restart of the same task. Multiple revisions still accepted indirect restarts such as “We are doing it.” Fixing this safely would require a broader context interpretation design, not another phrase whitelist.

The entire witness and its override plumbing were removed. Grounding, audit, editor, guardrails and pipeline files are unchanged from the preceding committed checkpoint. Passing selected regressions was not treated as proof of safety. The original strict rejection remains in place.

A smaller alternative was proposed to the user: improve correction instructions inside the existing reviewer and its existing single repair so it fixes wording, task status and supporting citations from original source. It must account for later reversals even outside the item's citations; choosing narrower evidence must never hide a contradictory later turn. This alternative is **not implemented; revised approval is pending**.

## Fresh fixed-case evaluation

Installed `gemma4:12b`, seed 41, temperature 0.1, context 16,384, thinking disabled, unchanged four original cases and criteria. Model digest: `4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`. No outside retries or successful-sample selection. Structural completion and independent source review are reported separately.

| Case | Mechanical outcome | Independent source review |
| --- | --- | --- |
| Personal | Returned; two calls; 67.4s | Pass. Preserves attributed experiences, feelings and reasons without invented tasks or gender. |
| Qualified publication | Rejected after one audit repair; three calls; 114.0s | Genuine rejection: the action omits the accessibility-review prerequisite and neither audit repairs it. The screenshot withdrawal/reason survive, but Marin's offer rejection remains implicit. This is distinct from the earlier mixed-evidence false rejection. |
| Accepted request/privacy | Returned; two calls; 57.3s | Preparation now appears in summary/overview, but the action remains upload-only and fails the unchanged combined prepare-and-upload criterion. Owner, recipient, deadline, destination and privacy rationale are correct; no invented gender. |
| Longer exhibition | Returned; two calls; 233.7s | Both commitments, distinct conditions, withdrawal/reason and unaccepted offer survive without invented gender. However, Lena's relief and its reason (the lift worked, resolving the stairs concern) are absent. “Reading alone” adds unsupported specificity to a preference for reading. Source-fidelity criteria still fail. |

[Exact raw responses, source, criteria and request hashes](../../../tests/manual/fixtures/meetingNotesFinalFidelitySeed41.json): 17 events, nine completed responses, three returned documents and one rejected run. All events and response strings were checked byte-for-byte after JSON decoding against the original log. Only the personal case passes all original source-fidelity criteria; a returned document is not a semantic pass. The longer example now cites R12 alone, so it avoids rather than fixes the previously frozen R12+R13 false rejection. Historical artifacts and scores are unchanged.

## Prospective held-out evaluation

These six synthetic controls and criteria were frozen before inference. The same local model, seed, sampling and limits are used; no criteria are changed after seeing responses.

| Case | Mechanical outcome | Independent source review |
| --- | --- | --- |
| Log operations | Returned; two calls; 56.5s | Pass. Both accepted operations remain in Aren's Friday action for Vesper; completed dummy-data work is separate. |
| Completed calibration | Returned; two calls; 60.7s | Shipment-only action, completed calibration and certificate are correct, but Tavi's attribution and “yesterday” are omitted throughout. Frozen fidelity criteria fail. |
| Separate preparation owner | Rejected after one audit repair; three calls; 98.3s | A scope clarification is incorrectly classified as a decision. Repair corrects Ilan's item but leaves the same error in Sora's item. Completed proofreading/correction and Friday submission survive in the draft, but no reviewed document is returned. |
| Offer dispositions | Audit transport idle timeout; one completed writer response; 136.8s | No final document. The unaudited writer retains offer statuses, alternatives and reasons but omits Wren's attribution. A plausible draft is not successful acceptance. |
| Person references | Returned; two calls; 84.5s | Pass. Correct experiences/reasons and cousin attribution; no pronoun transfer, invented gender or tasks. |
| Renewed offer | Returned; two calls; 62.6s | Pass against frozen criteria. Prior refusal is explicitly withdrawn after completed approval; Elian owns the Friday recording action. Overview emphasizes history but does not misstate current status. |

[Frozen held-out artifact](../../../tests/manual/fixtures/meetingNotesFinalFidelityHeldoutSeed41.json): 25 events, 13 attempts, 12 completed responses, four returned documents, one validation rejection and one transport timeout. Three of six meet every predeclared fidelity criterion. All events and raw strings match the original log. Across both distinct batches: seven documents returned from ten runs, four strict fidelity passes. This small synthetic set does not establish real-recording reliability.

## Verification

- Complete final unit/DOM suite: **235 files / 2,619 tests passed**, two workers, 22.50s. This is the safe code after removing the witness; experimental test totals are not delivery evidence.
- TypeScript, scoped Biome (19 files), changelog validation (142 fragments), dependency audit (194 packages, no high-severity advisories), and diff checks passed.
- `pnpm run build --publish never` produced the app, DMG and blockmap. Four packaged runtime executables verified. Ad-hoc signing only; no notarization or upload.
- Independent specification and quality review covered each bounded implementation. A final integration scan found no new blocking code issue in the safe fixes and sampled publication/IPC/renderer boundaries. This is not blanket approval of the full PR.
- The first final rendered-app attempt failed before display because the worktree SQLite binding was still built for Node. The packaging step did not restore that binding. After both manual evaluations ended, explicit `fix-sqlite-abi` succeeded and an Electron 40.8.0 / ABI 143 in-memory query passed. Main-checkout dependencies were not rebuilt.

## Final isolated app check

The built renderer was inspected in Electron with the existing disposable synthetic profile. Recording readiness alone is stubbed; no recording or real-data regeneration is performed. The persisted failure notice is singular and aligned with the notes. During regeneration the old notes stay visible. The synthetic privacy example successfully published through the real writer/auditor path, and “Restore previous generated notes” visibly restored the prior content.

The stored prior-document SHA-256 was `c0152a0263f6e88e6a09b4d4481713a3007e533b931ec958868a39d39aefebf1`; the new document was `31ae4c887f9210ba483a9680dba7dd91602bc9ff38da10b5473ae0c1fe562f71`. The saved history snapshot and restored document both exactly matched the prior hash. This checks publication/history mechanics, not an additional scored model-fidelity sample. Before a new failure could be induced, the computer-use tool reported user interaction and the refreshed window was on the dashboard. Further clicks were paused and the test window was left open. The final immediate-error branch still has DOM coverage, not a new rendered pass; the persisted-error branch was visually checked above.

## Remaining gates and boundaries

The PR stays draft. Note fidelity is not complete, and the mixed-evidence false rejection is unresolved. Six prospective held-out fixtures were frozen before inference (SHA-256 `f88b7c01c41af1b7b06c33e265e99896504c363bf2ced11f55c144e39f556a67`); their evaluation is recorded above. Representative private-source and oversized hierarchical acceptance are not complete.

A read-only 240-turn source snapshot and seven predeclared criteria remain outside the repository. No private source or model response is posted or committed. No production meeting regeneration, model download/default change, main-checkout restart, merge, or production settings/data change. The unrelated dirty/ahead main checkout is preserved.

# PR #676: previous system versus one revised candidate

## Decision

Keep PR #676 draft; stop this tuning pass. The candidate produces materially better notes in three of four paired examples, but fails to deliver notes for the fourth after its allowed correction. This is real progress, not sufficient delivery reliability. Smaller context omissions are not the blocker, and perfect synthetic fidelity is not the threshold. Do not merge, change the production model, or begin another tuning/rerun loop on this evidence.

## Systems and method

- Previous: actual main-checkout commit `f549a25b6ae1607ce3636d6a5336938c86bb0915`, Qwen 3.5 9B, notes-v9, existing multi-step local implementation.
- Candidate: branch based on `03cdc7ee75a78d9bb1629404a6006cf4f968cd6e`, Gemma 4 12B, notes-v26, one writer plus one audit with existing single-repair limits. Only audit/repair instructions and version identities changed in this revision.
- [Frozen code/model manifest](../../../tests/manual/fixtures/meetingNotesRelativeComparisonManifest.json). Same four original conversations and criteria, seed 41, thinking disabled, no outside retries. Each system retains its production request defaults; actual context/output/sampling/schema values are captured per request. This compares complete systems, not model-only or prompt-only causality.
- Each case has a 600-second cancellation limit. Model runs are serial, with no intentional competing inference or build. Timings are observations from one local run, not a statistically controlled speed benchmark. One seed and four synthetic examples cannot establish general real-recording reliability.
- Every successful response and failed partial stream is retained before parsing. Original raw output, source, criteria, final documents and failures remain unchanged. Strict fidelity criteria and relative preference are separate judgments.

## Paired results

| Conversation | Previous system | Candidate | Relative judgment |
| --- | --- | --- | --- |
| Personal | 31.0s, one call. Readable but loses Jun's attribution/satisfaction, Esme's frustration, and generalizes Jun's enjoyment to all participants. No fabricated tasks. | 81.5s, two calls, no repair. Preserves both people and their feelings, no invented tasks/decisions/questions/gender. Strict pass. | Clear quality win; 50.5s slower (2.63x). No serious regression. |
| Qualified publication | 23.8s, one call. Action loses the accessibility prerequisite; static-choice decision is removed from final decision lists; Marin's declined-offer attribution disappears. Withdrawal/reason remain. | 124.6s, three calls including one audit repair. No final document: action still lacks the accessibility prerequisite. | Completion loss. Safer refusal than publishing the unconditional action, but not a quality win. |
| Accepted request/privacy | 39.1s, two calls. Final action and decision lists are empty, despite prose retaining the upload, owner/recipient/deadline and confidentiality policy. Preparation is absent throughout. | 69.7s, two calls, no repair. Correct Bea/Monday/Niko/workspace action and full privacy decision survive. Preparation remains only in summary; Tariq's requester role is absent. Strict fail. | Meaningful quality win despite inherited omissions; 30.5s slower. No new ownership, commitment or privacy error. |
| Longer exhibition | 578.9s, 17 calls. Contradictory camera-list promise and withdrawal; floor-plan task survives only as prose; invented gender; missing contextual details. Courier condition and catalogue decision survive. Overview is truncated. | 290.6s, two calls, no repair. Both correctly scoped Priya actions, consistent camera cancellation, catalogue decision, existing QR/PDF and unaccepted offer survive. Missing Lena's relief/reason and some context; unsupported minor detail “reading alone.” Strict fail. | Strong quality win, about half the time. No serious new factual/task regression. |

All four baseline cases returned documents, but none satisfied every original fidelity criterion. The long case's final editorial response hit its output limit and was invalid JSON; the returned document records editorial errors even though its `fallback_used` field is false. This was not a timeout. No candidate superiority is inferred from baseline failures alone.

[Previous-system raw evidence](../../../tests/manual/fixtures/meetingNotesRelativePreviousSeed41.json) preserves all 71 events, including 21 exact streams and their corresponding parsed response strings. Artifact events were checked against the original log without alteration.

[Candidate raw evidence](../../../tests/manual/fixtures/meetingNotesRelativeCandidateSeed41.json) preserves all 35 events, including nine exact streams, the three final documents and the failed publication attempt. No outputs or source fixtures were rewritten. Comparison test exit status is 1 because one candidate case failed; the baseline run exited 0. A passing structural test is not a fidelity score.

Relative result: three quality wins and one completion loss. Delivery is 3/4 candidate versus 4/4 previous; strict original criteria are 1/4 candidate versus 0/4 previous. These are different measures. Total observed time is 566.3s/9 calls candidate versus 672.8s/21 calls previous. The shorter three cases are individually slower on the candidate; the long case accounts for the aggregate reduction. No general latency or reliability claim follows from this one sample per case.

The candidate publication failure is a genuine condition omission, not a false withdrawal rejection. Every attempted action says to publish without the accessibility prerequisite. Source-based reconstruction identifies the conditional-evidence check for `s2:item:0`; the live log records only the outer `notes_audit_invalid` error. The repair alters screenshot citations instead of fixing that action. No rejected draft is counted as a delivered document.

## Implementation checks

- Test-first correction: observed failing prompt/version and actual-repair assertions before implementation, then 119 focused tests and 639 notes-suite tests passed.
- Independent specification and code-quality review passed; the latter independently ran 80 focused tests. Strict validators, schema, shared content policy, source boundaries and repair caps are unchanged.
- Full suite: 236 files / 2,623 tests passed in 25.18s; TypeScript and diff checks passed. Harness dry runs loaded each provider without inference, and an independent review verified both endpoint settings and partial-stream capture.
- The added audit instruction costs approximately 473 estimated tokens per copy. Existing capacity checks remain active; the repair contains an active copy plus its copy inside the prior prompt. Deterministic R12-only replay proves that a correct repair can pass, not that a model will produce it.
- Final build/package passed with `--publish never`; all four packaged runtimes verified. No upload, notarization or release. Dependency audit found no high-severity advisories across 194 installed packages; all 142 changelog fragments validated. Scoped Biome (13 files), TypeScript and diff checks passed after artifact formatting.
- Both systems' frozen code hashes remain unchanged, and both artifact event arrays exactly match the original logs after formatting. All historical fixture files remain unchanged.
- Electron bindings were explicitly restored after Node/manual tests; the Electron 40.8.0 / ABI 143 in-memory SQLite query passed. Production notes/settings and the unrelated dirty/ahead main checkout remain untouched; the disposable QA copy was closed before timed evaluation. No new rendered-app acceptance is claimed for this prompt-only revision.

## Delivery boundaries and remaining work

The default remains Qwen 3.5 9B. Gemma is an explicitly selected test candidate, so these gains must not be described as the quality of the unchanged production configuration. Representative private-recording and actual oversized-hierarchy acceptance remain unperformed, as does fresh full-branch Electron integration. No additional model experiments are run after the failed comparison.

A read-only branch inventory found an existing main-branch risk: a stale path-only user edit arriving after publication can mask regenerated text. Earlier tests cover edits saved before publication, not this ordering. This is not a newly introduced defect in the audit correction and was not modified in this bounded pass. Prior synthetic regeneration/history visual evidence remains historical evidence, not a fresh claim for this revision.

# Attribution accuracy and performance review

Scope: follow-up to local commit `9094c8dd4`, issue #725.

## Findings and corrections

1. The recovered-channel gate summed overlapping evidence intervals. Two overlapping local windows could incorrectly satisfy the 50% local-coverage threshold; two overlapping remote segments could incorrectly deny local ownership. The gate now merges intervals once and queries their union using a binary search followed by a scan of only overlapping intervals. Regression tests reproduce both incorrect labels on the baseline.
2. The gate treated any label other than Them or Unknown as a mic label. Historical speaker-label projection preserves labels when its new word evidence is insufficient, so an unresolved Remote Speaker or Local Speaker label could become Me. Only freshly resolved Me labels now enter the local-ownership gate; other unresolved historical labels become Unknown.
3. Even exact digital silence loaded and ran the diarization models. Existing energy analysis now runs first and bypasses diarization only for exactly zero System energy. Nonzero quiet audio retains the model pass. Tests cover both conditions and cancellation.

## Measurements

Before/after runtimes used the same pinned models and recorded files. Comparisons ran locally; SQLite was opened with `-readonly`, canonical commits were in memory, and analysis was disabled. No saved meeting or recording was changed. Gate numbers are medians of 30 iterations after five warmups, measured on the saved transcript and freshly derived energy evidence.

| Case | Result |
| --- | --- |
| Recent 31-minute dual-source recording | Fresh replay: 315 Me, 91 Them, 48 Unknown; 22 mic echo words removed. Counts match the previous replay. |
| Recent 17-minute mic-only recording | Fresh replay: 208 Me; zero remote turns. Counts match the previous replay. |
| 31-minute attribution gate | 1.41 ms baseline, 0.56 ms revised; output identical. |
| Native evidence on both real recordings | Energy windows and diarization turns equal using structural comparison. Both had nonzero System energy, so neither used the silence shortcut. |
| Generated 1012-second digital-silence fixture | Native evidence: 3447 ms baseline, 54 ms revised; zero turns in both. Revised diarization time: zero. |

The historical-label correction intentionally changes the result when unresolved saved v3 labels are passed directly to the gate: it abstains rather than assuming they are Me. That is distinct from replaying fresh mic/System evidence.

## Accuracy limits and remaining work

Validated status and aggregate labels are not ground truth. The earlier description of 48 Unknown segments as "genuinely ambiguous" was not established by listening or a human-reviewed reference. No WER or diarization-error-rate improvement is claimed. A specific misattributed phrase and meeting is needed to establish the remaining real-world attribution error and test any change to overlap thresholds.

Speech recognition remains the larger measured cost. One fresh 31-minute replay spent about 75 seconds on mic recognition/preparation and 15 seconds on System recognition. Those timings are workload-sensitive and are not a controlled before/after speed comparison. The interval optimization saves fractions of a millisecond on this recording; the digital-silence shortcut saves seconds only when its exact condition holds.

The main checkout had staged and unstaged overlapping work during this review. Changes and measurements were isolated in `.worktrees/725-identity-trust-bounded-notes`; this review does not establish that the running app contains them.

## Verification

- Full Vitest suite: 350 files, 3947 tests passed.
- Swift runtime suite: 159 tests passed.
- Focused finalizer/persistence tests passed after the final control-flow formatting change.
- Release native runtime built; TypeScript and lint checked; Electron SQLite ABI restored after Node tests.

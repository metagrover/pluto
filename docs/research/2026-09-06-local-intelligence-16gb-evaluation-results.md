# 16 GB local intelligence evaluation results

**Date:** September 6, 2026  
**Tracking:** [#695](https://github.com/metagrover/pluto/issues/695)  
**Verdict:** No candidate passes the frozen protocol. Keep production defaults unchanged. Phi is the only notes candidate worth a larger, human-reviewed follow-up, but it is not approved for promotion by this evaluation.

## Decision

| Workload | Decision | Why |
| --- | --- | --- |
| Quick chat | Keep the current policy; do not promote another model | Explicitly primed Phi and Llama were fast, but fresh-provider and model-switch runs repeatedly reached the 90-second transport timeout. The lifecycle path fails before model quality can justify a routing change. |
| Meeting notes | Keep Gemma in production; advance Phi only to a larger follow-up | Phi accepted all six replay attempts across the two diagnostic cases. Gemma accepted three of six and deterministically failed the withdrawal case at the notes audit. The evaluated corpus and review coverage are too small for a default change. |
| Cross-meeting comparison | No candidate | Ministral led at two of three cases but failed the association-without-causation case. Every other model passed at most one of three. |
| Project synthesis | No candidate | The evaluation included relationship/negative controls but not a distinct project-synthesis acceptance suite. |
| Dreaming | Keep Gemma | All five models passed the single rejected-correction/no-change safety case. One case without downstream track A/B or human review cannot support a model change. |
| Integrated configuration | Retain current production configuration, without treating it as protocol-approved | No candidate cleared screening across quality, lifecycle, and resource gates. E3 pipeline ablations and E6 mixed recording acceptance were therefore not used to promote a configuration. |

The immediate engineering priority is the Ollama residency/switch path, not a model-default change. Warm token generation substantially understates user-visible latency when a different large runner is resident.

## System under test

- Apple M1 Pro, arm64, 16 GiB unified memory
- macOS 26.5.2 (25F84)
- Ollama 0.33.2
- Pluto source `c592a997fb0103aec96756ea1086a817eec8bb5d`
- Evaluation branch base bundle hash: `bbfe91d842d51ec73fb00d16e851082ab1879f236587306b2199f91c9f7f0201` (bundle not exercised)
- Frozen public corpus hash: `21d36d3cfa1630aecff7b39c50fd6af3e3ec69f1786d9277326804907ee9ddd0`
- Seed 41, structured thinking disabled, production prompt builders, schemas, validators, notes writer/audit path, chat request path, and dreaming request/validator

Exact installed candidates:

| Config | Ollama tag | Quantization | Digest |
| --- | --- | --- | --- |
| Gemma control | `gemma4:12b` | Q4_K_M | `4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c` |
| Phi quick | `phi4-mini:3.8b` | Q4_K_M | `78fad5d182a7c33065e153a5f8ba210754207ba9d91973f57dffa7f487363753` |
| Llama small | `llama3.2:3b` | Q4_K_M | `a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72` |
| Qwen small | `qwen3.5:4b` | Q4_K_M | `2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd` |
| Ministral medium | `ministral-3:8b` | Q4_K_M | `1922accd5827ebe6829e536369195db25eaf664528dc66206d646ea3bb386b71` |

The production database was snapshotted read-only for inventory only. No production meeting content was sent to a model, no production database row was changed, and no replay result was published or accepted as canonical intelligence.

## Screening results

Counts include failures and timeouts. Times are end-to-end request/pipeline wall times. With fewer than 20 comparable samples in every cell, p95 is intentionally withheld.

| Model | Quick chat | Notes | Cross-meeting | Dreaming |
| --- | ---: | ---: | ---: | ---: |
| Gemma control | 1/2 accepted; 61.37-90.03s | 3/6; median 47.81s | 1/3; median 9.72s | 1/1; 10.21s |
| Phi quick | 1/4; 1.69-90.06s | **6/6; median 13.86s** | 1/3; median 3.86s | 1/1; 2.97s |
| Llama small | 1/1; 1.22s | 0/1; 12.69s | 1/3; median 2.48s | 1/1; 3.03s |
| Qwen small | 1/1; 5.05s | 0/1; 25.07s | 0/3; median 5.97s | 1/1; 4.93s |
| Ministral medium | 1/1; 7.02s | 0/1; 42.11s | **2/3; median 20.38s** | 1/1; 37.28s |

### Meeting-notes finalist repeat

| Case | Phi | Gemma control |
| --- | ---: | ---: |
| Middle commitment followed by withdrawal | 3/3 accepted; median 18.52s | 0/3; median 54.37s; all rejected by the notes audit |
| Conditional ownership | 3/3 accepted; median 8.42s | 3/3 accepted; median 35.05s |

Phi was 2.9-4.2 times faster on the paired accepted medians and preserved the labelled modality, owner, and withdrawal facts in all six attempts. This is a strong screening result, not a promotion result: it covers two concise synthetic cases, automated gold checks, and no independent blinded human usefulness review.

### Hard-gate failures

- **Residency/switching:** after Gemma residency, three fresh-process Phi quick-chat attempts each timed out at approximately 90 seconds. Explicitly primed Phi then completed the same case in 1.69 seconds. A subsequent fresh Gemma quick request also timed out at 90.03 seconds. This violates the bounded responsive lifecycle expected by F09 and makes isolated warm speed non-promotable.
- **Notes fidelity/acceptance:** Llama emitted structurally valid notes but lost the critical owner/action semantics. Qwen, Ministral, and Gemma failed the production notes audit on the withdrawal case. Phi alone cleared both diagnostic notes cases.
- **Cross-meeting integrity:** no model passed all ownership-transfer, same-name-negative, and association-without-causation cases. Ministral passed the first two but failed the third. Gemma, Phi, and Qwen also triggered the forbidden same-project wording in the same-name negative.
- **Evidence sufficiency:** the separate project-synthesis lane, expanded held-out sets, downstream generated-notes track, and human usefulness review were not completed because no integrated candidate cleared screening.

## Resource observations

All recorded before/after samples reported nominal thermal state and no critical memory-pressure state. These samples are not the one-second peak telemetry or 30-minute mixed workload required for a resource acceptance claim.

- Observed free-memory percentages ranged from 10% to 78% across model runs.
- In the settled Phi notes repeats, swap occupancy changed by 0 MiB or decreased; the first Phi notes run increased by about 156 MiB.
- Gemma notes runs showed swap-occupancy increases ranging from about 124 MiB to 906 MiB. The largest observation exceeds the proposed 512 MiB mixed-workload target, but it was not a controlled settled 30-minute baseline and is therefore a warning, not a causal attribution or formal gate result.
- Ollama reported Gemma residency of approximately 8.34 GB during the final switch failure.
- No Pluto app inference client was active during the isolated runs. Global GPU/inference attribution cannot be proven complete, so the result should not be generalized beyond this machine/session.

## Confidence and limitations

This report is a **provisional screening decision**, not full protocol acceptance:

- Public synthetic corpus: nine cases total (four development and five held-out), including two notes, three cross-meeting, one dreaming, and routing smoke coverage. It does not meet the planned 12-note, 8-consolidation, and 30-chat held-out inventory.
- Notes finalists received three repetitions per diagnostic case; other cells received one run except explicit lifecycle retries. Correlated repeats are not new meetings.
- Scoring used deterministic source-backed gold requirements and production validators. There was one reviewer and no independent blinded human usefulness review, so broad promotion is blocked by design.
- Chat exercised the production model request path with fixed evidence, not retrieval-inclusive end-to-end Ask Pluto.
- Resource capture used before/after snapshots rather than one-second samples; energy, battery, swap paging deltas, peak process RSS, and first-useful-content timing remain missing.
- Recording, sleep/wake, crash recovery, repeated navigation, publication/notification, 30-minute mixed load, and a separate Phi runtime were not exercised. Existing scheduler/lifecycle unit suites passed, but mocks are not integration evidence.

## Follow-up boundary

1. Fix or explicitly redesign model residency/switch admission so a bounded quick request cannot sit behind a resident runner until its 90-second timeout. Add F09 integration coverage with actual Ollama runner events.
2. Expand Phi-versus-Gemma notes evaluation to the frozen 12-case held-out inventory, three repetitions, with blinded human review and full source coverage. Preserve the production audit; do not tune around the withdrawal fixture.
3. Only if Phi passes that review, run candidate-notes downstream track B and the disposable recording/mixed-workload suite before considering specialized notes routing.
4. Keep Gemma for dreaming and deeper synthesis until a challenger passes all forbidden-link, correction, no-change, and causation controls.

Rollback is trivial because this evaluation changes no production model setting, runtime policy, database, or accepted intelligence. The private raw ledger remains owner-only under `.private/local-intelligence-evaluation/`; this committed report contains configuration and aggregate results only.

# 16 GB local intelligence evaluation results

**Date:** September 6, 2026  
**Tracking:** [#695](https://github.com/metagrover/pluto/issues/695)  
**Frozen September 6 verdict:** No candidate passes the frozen protocol. Keep production defaults unchanged. Phi is the only notes candidate worth a larger, human-reviewed follow-up, but it is not approved for promotion by this evaluation.

## September 7 source-first hardening implementation status

September 8 real-application follow-up: `scripts/run_phi_notes_application.mjs` now builds and launches actual Electron processes with a capability-guarded temporary profile, real renderer IPC, installed Phi/Gemma, SQLite publication, physical HTTP evidence, and one-second resource/run-state sampling. Initial publication, abrupt process kill after persisted start, startup recovery, and explicit retry passed. Three real cancellation trials preserved prior notes and converged after retry. The source-edit trial also preserved prior notes, but the changed-source retry failed: Phi promoted a reported status into a decision with an unsupported owner placeholder, rejected by the existing commitment validator as `notes_writer_invalid`. This remains a candidate failure; unsuccessful prompt-only clarifications were not retained. A regression test distinguishes the invalid decision classification from the valid sourced fact. A separate attempt was contaminated by a concurrent SQLite ABI rebuild; the driver now pins a verified Electron binding. These are instrumented development diagnostics, not held-out or latency-ranking evidence. Full UI navigation requires native readiness and explicit boot-probe opt-in; sustained recording and OS sleep/wake remain controlled-session work.

September 8 downstream follow-up: six paired development fixtures now exercise generated notes through the actual Gemma dreaming request, coordinator, validator, and SQLite proposal store. Fixture assertions cover correction, withdrawal, conditional tasks, same-name isolation, legitimate no-change/new proposals, and traceability from proposal excerpts through canonical note provenance to original transcripts. Negative mutations verify that the oracle rejects wrong current commitments and stale/unrelated sources. Two additional cases verify downstream cancellation on changed notes or foreground activity and successful explicit retry. All model responses for this coverage are scripted; model-generated downstream acceptance and the human-reviewed-notes comparison remain pending.

September 8 harness follow-up: the development integration suite now runs the real provider inventory/editor path through the coordinator and SQLite publication, checks downstream project note packaging and same-name isolation, rejects a wrong installed Phi digest, and verifies prior-note preservation plus retry after source edits, transport failure, cancellation, and database-module restart recovery. Gemma chat routing is checked on the same provider. A dedicated TypeScript configuration covers the harness and scripts omitted by application typechecking. These checks use synthetic transport; real inference and sustained app acceptance remain pending. See [harness commands and coverage boundaries](phi-notes-harness.md).

Issue #788 now has an experiment-disabled implementation of the source-first Phi notes path and its acceptance harness. The implementation scores visible note blocks through canonical source provenance, freezes a fresh semantic and capacity corpus, reconciles bounded leaf inventories before one mandatory meeting-wide editor, and isolates the added semantic guidance behind the explicit `phi-notes-source-first` configuration. The application coordinator exposes a disposable-integration-only activation seam and refuses publication when the returned model, pipeline version, or source revision does not match that candidate identity. Production Gemma routing and default prompt behavior are unchanged.

The version-2 owner-only manifest freezes both exact model digests, corpus and rubric hashes, settings, all 180 paired schedule rows, and cold/warm order. Its append-only JSONL ledger records a run before inference, records physical starts before send, and treats a crash-started run as interrupted rather than silently rerunning its ID. Protocol-valid dry transport reaches both the inventory writer and final editor without an Ollama request. A separate disposable mixed-workload dry entry verifies isolated profile/database/settings paths and freezes the downstream, sustained-load, and recovery scenario inventory without capture or inference.

This is implementation evidence, not promotion evidence. The 168 supported paired attempts plus expected-rejection runs, blinded human review, downstream generated-notes track, 30-minute recording control/mixed comparison, sustained resource acceptance, and complete fault-injection acceptance remain `incomplete`. Short real-application resource samples and the successful recovery cases above do not satisfy those gates. No result below is superseded, and Phi remains disabled for production notes until every frozen gate passes.

The first frozen-settings capacity measurement is a blocking result. At 16,384 context tokens, all eight declared 20–40 minute ordinary-capacity fixtures fail the source-first preflight before inference because the complete-source final editor cannot reserve the worst-case aggregate inventories, editor output, safety margin, and permitted recovery split. Planned initial leaf counts were `2, 2, 2, 2, 3, 3, 4, 3`; the four-leaf case also exceeds the three-leaf limit. The corpus records this result without shrinking the fixtures or increasing context after observation. The 168 supported-attempt schedule must not start until a separately reviewed capacity revision is supported by measured 16 GB resource evidence.

## September 8 controlled capture and read-only production-source follow-up

With explicit operator authorization, a read-only source extractor inspected 79
meetings marked finalized/validated without loading existing generated notes or
settings. It rejected pending WAL/journal writes and verified the production
database identity and hash remained unchanged after extraction. Source copies and
per-meeting results remain owner-only local artifacts; no meeting content was
committed. At the unchanged 16,384-token setting, **52 sources failed candidate
capacity preflight, 25 reached the generation boundary, and 2 were rejected by the
source parser**. The provider callback threw at that boundary, so this check made
zero physical model requests. These are development-source admission counts, not
generation completion or quality scores. Invalid sources remain in the denominator.

The real-app driver now has explicitly opted-in capture rehearsals using copied
native assets, a synthetic fake microphone, actual system-audio playback/tap,
rendered transcript/health sampling, native/Ollama RSS, notes/Ask attempt outcomes,
and finalization checks. The first attempt exposed a macOS native model-root alias
comparison bug; normalizing both sides identically fixes it without weakening
unrelated-root rejection. A 30-second rehearsal subsequently reached finalized,
validated transcription. A 240-second mixed rehearsal completed all four injected
Phi notes jobs and exercised actual Ask-driven notes preemption, but final
transcription failed with `speaker_attribution_rejected` at 0.571 confidence versus
the unchanged 0.80 threshold. That fixture replayed identical speech into both
channels at different offsets; it is retained as a failed attribution stress case,
not a clean workload comparison. The driver now accepts distinct microphone/system
fixtures so this confound need not be repeated.

A separate 240-second rehearsal with distinct, alternating channel fixtures reached
finalized/validated transcription with no integrity causes and completed all four
injected Phi notes jobs. All eight Ask attempts returned partial answers; first
content ranged from 2.67 to 13.27 seconds, with six exceeding five seconds. This
does not satisfy the minimum twenty comparable samples for the frozen p95 gate.
The native/app/model paths are real, but these short instrumented development runs
are not matched 30-minute controls or accepted recording-quality benchmarks.

An additional operator-assisted, non-recording sleep/wake trial observed actual
Electron OS suspend/resume events after a persisted notes start. The measured sleep
interval was **1.537 seconds**, not the requested fifteen seconds. The in-flight
notes job completed after wake and an explicit retry published with matching Phi
model, source-first pipeline, and current source revision. Resource sampling was
explicitly paused for sleep, never filled with zeros. Automatic wake was unavailable
without administrator access; the operator agreed to wake the Mac manually.

The two 30-minute comparison runs, marker/chunk-integrity adjudication, settled
resource gates, twenty-sample responsiveness gates, and complete fault matrix remain
incomplete. This brief OS event pair is not evidence for longer sleep, recording
across sleep, or every recovery condition. No production model routing or notes changed.

## September 7 residency repair and 12-case notes evaluation

[Issue #784](https://github.com/metagrover/pluto/issues/784) repairs the lifecycle blocker identified by the frozen evaluation. Before every serialized local generation, Pluto now asks Ollama which models are resident, retains an equivalent target, and unloads non-target residents before starting inference. Discovery and cleanup share a 40-second deadline and fail closed with explicit run failure codes. This changes lifecycle admission only; it does not change model selection or note acceptance policy.

Real production-path smoke runs completed a fresh-process Gemma-to-Phi switch in 2.82 seconds and a fresh-process Phi-to-Gemma switch in 7.03 seconds. Each observed exactly one non-target unload followed by one target generation, with only the target resident afterward. All four counterbalanced transitions during the notes evaluation also completed without a timeout, model mismatch, or residency failure. This resolves the reproduced lifecycle mechanism, but it is not a sleep/wake or sustained mixed-workload acceptance test.

The expanded comparison used 12 held-out synthetic semantic notes cases spanning short, ordinary, long/dense, and adversarial/sparse profiles. Each model ran every case three times in the counterbalanced sequence Phi, Gemma, Gemma, Phi, Phi, Gemma. The evaluated source was `4884ab0716dc94f9c6629caeac27f9102a9663db`; corpus hash `51dec66e5bfba96fd182fb92e676b362811d6c44fe2035f569631ffa25658ede`. Model digests and generation settings remained the same as the post-#777 addendum: seed 41, structured thinking disabled, `num_ctx: 16384`, `num_predict: 2048`, temperature 0.1, and eight threads. Raw artifacts remain owner-only under `.private/local-intelligence-evaluation-784/`.

| Model | Independent evidence review | Automated triage | Median latency | Range | Audit provenance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Phi `phi4-mini:3.8b` | **27/36 pass**; 9/12 unique outputs | 33/36 | **12.26s** | 5.63-22.58s | 24 complete; 12 warned |
| Gemma `gemma4:12b` | **24/36 pass**; 9/14 unique outputs | 33/36 | **51.46s** | 31.96-81.14s | 12 complete; 24 warned |

Phi was 4.2 times faster by overall median and about 4.0 times faster by summed case time. The independent evidence review was performed by separate review agents against the source fixtures, not by blinded human reviewers. It found that the automated triage overstated both models:

- Phi failed three case families across all repetitions. It omitted Lena's committed action in one case, attached a decision to evidence from an unrelated boundary while weakening Ravi's commitment in another, and omitted the unmet-compliance fact in the adversarial conditional case.
- Gemma failed four case families across all repetitions. It repeatedly dropped named owners Lena, Nia/Luis, or Ravi, and omitted the explicit conclusion that Noor had no archive-import action in the unmet-condition case.
- Neither model invented a wholly unsupported positive action or date. The dominant risk was semantic completeness and evidence association, especially owner retention and explicit negative outcomes.
- Repetition did not provide independent semantic confidence: Phi produced one semantic output per case across its three runs, and Gemma produced only 14 unique semantic outputs across 36 runs.

Latency by profile reinforces the efficiency result without changing the quality gate:

| Profile | Phi median | Gemma median | Phi evidence pass | Gemma evidence pass |
| --- | ---: | ---: | ---: | ---: |
| Short | 8.13s | 33.75s | 9/9 | 9/9 |
| Ordinary | 9.54s | 43.57s | 9/12 | 9/12 |
| Long/dense | 20.26s | 79.24s | 6/9 | 3/9 |
| Adversarial/sparse | 19.85s | 71.11s | 3/6 | 3/6 |

Resource snapshots are warnings, not peak or causal measurements. Phi's three passes ended with swap-occupancy changes of approximately -112 MiB, -112 MiB, and -176 MiB. Gemma's passes ended at approximately +1.44 GiB, +610 MiB, and +1.46 GiB, with observed free memory falling as low as 12%. Every snapshot reported nominal thermal state. The evaluation did not capture one-second peaks or a 30-minute recording workload.

**Updated decision:** merge the residency repair, retain #780 as the frozen baseline, and do not change production model defaults. Phi is the clear candidate for a specialized notes route—it is much faster, uses materially less observed memory pressure, and passed one more case family—but its 27/36 evidence result is below the promotion bar. The next gate is targeted pipeline work for owner/action completeness and cross-boundary evidence association, followed by blinded human review and the integrated recording/mixed-workload suite. Gemma should remain the production control until that candidate clears those gates.

## September 7 post-#777 notes addendum

[PR #777](https://github.com/metagrover/pluto/pull/777) changed the production notes system after the frozen evaluation: a compact Ollama run may publish a deterministically acceptable writer draft with `complete_with_warnings` provenance when its editor truncates or returns an allowed schema/guardrail failure. The original tables remain the result for source `c592a997fb0103aec96756ea1086a817eec8bb5d`; this addendum reports the same two notes cases on merged source `03967af69923802d035043b7f89732a51fb80b35`.

Both exact model digests, corpus hash `21d36d3cfa1630aecff7b39c50fd6af3e3ec69f1786d9277326804907ee9ddd0`, production prompt builders, schemas, deterministic validators, and compact writer/editor path were unchanged. The merged harness set structured thinking disabled; every one of the 24 physical starts recorded seed 41, `num_ctx: 16384`, `num_predict: 2048`, temperature 0.1, and eight threads. Each model ran the two diagnostic cases three times. Runs were grouped by model rather than counterbalanced, and raw artifacts remain owner-only under `.private/local-intelligence-evaluation-post-777/`.

| Case | Phi after #777 | Gemma after #777 | Frozen baseline |
| --- | ---: | ---: | ---: |
| Middle commitment followed by withdrawal | 3/3 accepted; median 13.84s; clean audits | 3/3 accepted; median 43.99s; all deterministic fallbacks with warnings | Phi 3/3 at 18.52s; Gemma 0/3 at 54.37s |
| Conditional ownership | 3/3 accepted; median 8.41s; clean audits | 3/3 accepted; median 35.16s; clean audits | Phi 3/3 at 8.42s; Gemma 3/3 at 35.05s |
| Both cases combined | **6/6 accepted; median 11.12s** | **6/6 accepted; median 39.61s** | Phi 6/6 at 13.86s; Gemma 3/6 at 47.81s |

Every post-#777 result passed its required gold items and critical checks with two physical model starts. Gemma's three withdrawal outputs were recovered through `notes_direct_audit_fallback:guardrail` and recorded `audit_status: complete_with_warnings`; its conditional-ownership outputs and all Phi outputs recorded complete audits without fallback. The changed Gemma outcome is therefore a **pipeline-plus-model system result**, not evidence that Gemma weights improved.

Phi is 3.2 times faster on the withdrawal median, 4.2 times faster on conditional ownership, and 3.6 times faster across the six accepted outputs. This removes Gemma's diagnostic acceptance deficit but strengthens—not weakens—the case for Phi as the next notes finalist when latency matters. It still does not authorize a production default change: these are two concise synthetic cases with automated scoring, no blinded human usefulness review, no 12-case held-out notes corpus, and no integrated recording/mixed-workload acceptance.

Resource samples remain observational. The first cold Gemma pair moved memory free from 80% to 12% and increased swap occupancy by about 2.2 GiB; later Gemma per-case swap changes ranged from about 29 MiB to 906 MiB. The first Phi pair followed the Gemma-to-Phi switch and coincided with a roughly 2.3 GiB swap-occupancy decrease, so it cannot be treated as Phi freeing that memory. Settled Phi cases showed changes between -16 MiB and 0 MiB. All samples reported nominal thermal state, but before/after snapshots are not peak telemetry or causal attribution.

**Updated decision:** keep #780 as the frozen baseline, treat #777 as a successful notes-reliability correction, and keep production model defaults unchanged. Advance Phi and Gemma to the planned 12-case blinded notes review only after the Ollama residency/switch path is bounded; quick-chat switching remains the integrated blocker and was not retested by this addendum.

## September 6 frozen decision

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

1. Treat the completed #784 residency repair and real switch smoke as the lifecycle prerequisite, while retaining sleep/wake and sustained-load coverage for integrated acceptance.
2. Improve owner/action retention and cross-boundary evidence association without weakening the production audit or tuning around individual fixtures. Add semantic checks that catch the observed automated false passes.
3. Repeat the Phi-versus-Gemma notes comparison with blinded human usefulness review. The independent agent review in the September 7 addendum is evidence, but it does not satisfy that human gate.
4. Only if Phi clears that review, run candidate-notes downstream track B and the disposable recording/mixed-workload suite before considering specialized notes routing.
5. Keep Gemma for production notes, dreaming, and deeper synthesis until a challenger passes the applicable evidence, resource, and integration gates.

Rollback is trivial because this evaluation changes no production model setting, runtime policy, database, or accepted intelligence. The private raw ledger remains owner-only under `.private/local-intelligence-evaluation/`; this committed report contains configuration and aggregate results only.

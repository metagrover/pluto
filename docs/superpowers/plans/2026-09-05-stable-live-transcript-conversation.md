# Stable Live Transcript Conversation Implementation Plan

**Issue:** [#670](https://github.com/metagrover/pluto/issues/670)
**Status:** Core feature-gated implementation complete; real Electron long-call acceptance remains outstanding.
**Baseline:** Implementation branch rebased onto `origin/master` at `44985401eca906f61ee47801ee8010aabb814393` on 2026-09-05.
**Goal:** Preserve local contributions and readable conversation order during dual-source loudspeaker meetings while preserving trustworthy raw capture, final transcripts, and notes evidence.

## Scope and governing decision

Ship #670 independently before #770. Retain multi-span echo reconciliation in this issue: the long mic hypothesis contains remote spans separated by local replies, so layout changes alone leave the reported duplication unresolved. Implement reconciliation and UI ownership in separate reviewable steps.

The original byte-immutable visible-history promise was incorrect. EOU confirmation commits a recognizer's lexical prefix; it does not mean echo reconciliation is complete. Acoustic evidence and the other channel's hypothesis can arrive later. Freezing presentation at commit permanently preserves duplicates or prematurely suppressed local words.

The corrected contract is stable row identity and relative order, with evidence-driven corrections in place. Tentative text revises in one draft region. Existing history rows never reorder or regroup. A later echo decision may change an affected row's retained ranges, with a quiet `Updated` qualifier. If an already displayed row becomes entirely duplicated, keep its keyed shell with `Duplicate removed`; restore original wording there if support is withdrawn. Preserve the reader's visible anchor through height changes. Accuracy takes precedence over pixel-identical layout.

Do not promise zero duplicates before sufficient evidence exists. Require supported echo spans to appear once after reconciliation. Genuine repeated phrases must survive even when their strings match.

## What already exists

| Seam | Verified behavior and reuse |
| --- | --- |
| `src/services/liveTranscription/eouTranscriptProjection.ts:61` | Checks source revisions and committed prefixes. Committed IDs use generation/source/commit revision; tentative IDs are stable per source. Reuse untouched. |
| `src/services/liveTranscription/eouTranscriptProjection.ts:111` | Raw rows sort confirmed-first and reach non-UI consumers. Sort only a derived reading copy; do not change upstream ordering for #670. |
| `src/services/liveTranscription/eouRendererSession.ts:109` | Echo-only callbacks refresh presentation without another recognition event. Both paths must reach the projector. |
| `src/services/liveTranscription/liveTranscriptReconciliation.ts:88` | Recomputes reversible annotations from raw rows. Reuse whole-row, bounded fuzzy, padded-word and exact-subsequence checks. |
| `src/services/liveTranscription/liveTranscriptReconciliation.ts:334` | Tracks one best span; local comparisons are bounded to 256 normalized tokens and six adjacent rows. Extend range enumeration without weakening individual checks. |
| `src/components/AudioManager.tsx:794` | Separates reading segments from raw evidence; echo-only updates return before persistence/notes. |
| `src/components/AudioManager.tsx:803` | Stored live candidates, context ingestion at line 814, and incremental notes at line 815 consume raw rows. Preserve these inputs. |
| `src/components/features/liveTranscriptPresentation.ts:80` | Existing paragraph layout and dynamic turn grouping. Reuse paragraph helpers; replace historical regrouping only on the new path. |
| `src/components/features/LiveTranscript.tsx:83` | Manual-scroll interruption and Return to live already work. Preserve the 48 px follow tolerance and keyboard behavior. |
| `electron/main.ts:3522` | Existing `GET_SETTING`/`SET_SETTING`; no new rollout IPC is needed. |

Graph discovery used Verify tier, project `Users-metagrover-Desktop-pluto`, generation `2026-09-05T23:05:24Z`. The graph indexed the separate voice branch; candidate-path coverage reported no recorded gap, which is not completeness proof. Direct worktree reads and an empty product diff against the pinned master are authoritative here.

Freshness note: the isolated implementation worktree was rebased onto `44985401eca906f61ee47801ee8010aabb814393` before product changes. Voice-profile behavior remains outside #670.

## Data flow and ownership

```text
mic/System PCM -> existing EOU session -> raw committed/tentative rows
                       |                          |
                       +-> echo evidence ---------+----------+
                                                  |          |
                RAW BRANCH (unchanged)             |          v
 stored candidates / context / incremental notes <-+    reading ranges
                                                           |
                                              meeting-scoped projector
                                               /                  \
                                       stable row shells        one draft
                                               \                  /
                                                App -> ZenMode -> UI

stop -> EOU finish -> journal seal -> sealed mic/System final transcription
     -> existing trust validation + canonical commit -> trusted notes
     (no reading ranges or conversation state enter this branch)
```

Own one projector in AudioManager for each meeting/capture generation. It survives navigation and ordinary React renders. Do not create stateful projectors during render. React keys preserve component identity; they do not prevent reordering or height changes. [React state guidance](https://react.dev/learn/preserving-and-resetting-state).

## Reading and state contracts

Define proposed renderer-local view types in new `src/services/liveTranscription/liveConversationProjection.ts`; define range results beside the reconciler. Do not add schema fields to raw EOU updates or persisted transcript JSON.

- Reading ranges reference the source segment ID, half-open original-word/character bounds, verified source times where available, and supporting System IDs. Explicitly map normalized tokens back to original text, including fillers and punctuation.
- Own history rows by committed raw source ID, not fragment bounds. A changed split must not create duplicate historical rows or strand restored words.
- Allocate visible order once, on first visible committed arrival. Sort newly arriving rows within that batch by source time and deterministic source/ID tie-breaks. Append older arrivals with `Earlier speech` and their original timestamp. This is arrival-stable history, not a claim of globally chronological delivery.
- Track fully suppressed rows which have not yet displayed. If restored later, append them as late speech. Already displayed rows retain their original keyed shell through suppression/restoration.
- Recompute retained parts of owned rows. An emitted-fragment set alone is insufficient: split changes would repeat or lose words.
- Preserve raw text, rawText, word timing, timestamps, and confirmed flags. Display corrections only remove/restore supported ranges; never paraphrase or invent timing.
- The draft holds the latest tentative rows from both sources, with source boundaries retained. One container may contain multiple labeled parts; do not concatenate overlapping voices into a fabricated sentence.
- Show at most **24 words in the collapsed draft**. Make full current tentative text keyboard-expandable in that same region. The limit is display clipping, not evidence deletion. Confirmed wording is never clipped; long committed suffixes enter history in full.
- Keep `You`/`Call` as existing source-level conventions, not confirmed personal identities. Use `Listening now` for mixed/unknown draft ownership.

```text
new generation -> empty history + no draft
recognition:
  stale owner/generation -> ignore
  tentative revision    -> replace tentative parts only
  new committed ID      -> append visible row once; remove superseded draft
echo-only:
  supported new range   -> correct its owned row + current draft
  support withdrawn     -> restore original owned words exactly once
finish:
  accept last EOU update -> full committed suffix -> clear tentative UI
unavailable:
  retain history -> mark draft unavailable -> capture/finalization continue
next meeting:
  reset projector, counters, expansion/follow state; fence old callbacks
```

## Conservative multi-span reconciliation

Add a range-returning entry point, proposed name `reconcileLiveTranscriptReading`, while retaining `reconcileLiveTranscriptSegments` for the fallback. Share candidate validation; do not copy lexical/acoustic thresholds into another matcher.

Enumerate individually supported disjoint ranges through the existing alignment helpers. Newly generalized interior suppression requires verified word timing and paired acoustic evidence for that span. Preserve negations, numbers, currency/sign tokens, unmatched local words and ambiguous overlap. Missing/ambiguous proof retains raw wording. Keep current legacy cases covered; not all existing whole-row and exact-prefix suppression requires paired acoustic proof.

Select deterministic non-overlapping candidates: strongest support first, then longest range, then start index and source ID. Reject conflicts; no combinatorial global optimizer. Retained parts partition the complement. Every suppressed range references an actually displayed System counterpart; withdrawal of a tentative counterpart restores mic words.

Keep the current 256-token/six-adjacent-row local limits. They do not bound total history scans or candidate combinations. Measure candidate/evidence work and long-meeting runtime before adding further caps. Budget exhaustion retains affected raw words and increments a content-free degraded counter; never truncate speech or block PCM dispatch.

## NOT in scope

- Native EOU model/commit timing, raw row sorting, and extra raw provenance fields: unnecessary for this UI ownership repair.
- Final transcription, attribution, capture journals, trust validation, context ingestion or incremental-notes semantics: protect their unchanged input contracts.
- New rollout IPC, database migrations, diagnostics services, general event sourcing or background workers: existing settings plus one projector suffice.
- Voice profiles or personal naming: independent #770 feasibility/quality gates.
- Claiming improved canonical transcript or notes accuracy from display cleanup: this change preserves their inputs.
- Global virtualization: profile first and add targeted rendering work only if measurements require it.

## Implementation Tasks

Use TDD for non-UI logic; commit green reviewable increments only when implementation is authorized. Estimates are planning ranges. This docs review makes no product changes.

- [x] **T1 (P1, human: 0.5–1 day / agent: 1–3 hours): Freeze causal regressions.** Create `tests/fixtures/liveTranscriptJumbledSources.ts` with invented words, a long mic hypothesis, three System turns, six supported disjoint spans and local interruptions. Extend `tests/unit/liveTranscriptReconciliation.test.ts`, `tests/unit/eouRendererSession.test.ts`, and `tests/unit/LiveTranscript.dom.test.tsx`. Cover late evidence after commit, tentative counterpart withdrawal, genuine repetitions, missing timing and event permutations. Assert original-word conservation, not string-level duplicate bans. Keep existing raw EOU ordering tests.
- [x] **T2 (P1, human: 1–2 days / agent: 3–6 hours): Produce supported reading ranges.** Modify `src/services/liveTranscription/liveTranscriptReconciliation.ts` and only necessary candidate enumeration in `src/services/liveTranscription/liveEchoSubsequenceAlignment.ts` / `src/services/liveTranscription/liveEchoTokenAlignment.ts`. Create `tests/unit/liveTranscriptReadingFragments.test.ts`. Return raw rows plus display ranges; retain the compatibility wrapper. Test range bounds, conflict resolution, normalization, padded final words, punctuation, six spans, local replies, exact limits and evidence removal. No uncalibrated confidence thresholds.
- [x] **T3 (P1, human: 1 day / agent: 2–4 hours): Implement source-owned history.** Create `src/services/liveTranscription/liveConversationProjection.ts` and `tests/unit/liveConversationProjection.test.ts`. Cover generation fences, stable committed IDs, append order, range correction/restoration, full commits, expandable draft and terminal states. Reuse unchanged row references for memoization. Add a short state diagram comment at the transition implementation.
- [ ] **T4 (P1, human: 1 day / agent: 2–4 hours): Wire without contaminating evidence.** Core wiring and failure containment are complete. A full mounted-AudioManager transport test remains to complement the source-boundary and navigation suites.
- [ ] **T5 (P1, human: 0.5–1 day / agent: 1–3 hours): Render stable corrections.** Keyed shells, draft expansion, correction labels, status announcements, focus, and manual-follow behavior are covered. Real Electron viewport-anchor and narrow-layout acceptance remain open.
- [x] **T6 (P1, human: 0.5 day / agent: 1–2 hours): Rollout and diagnostics.** Read proposed setting `stable_live_conversation_v1` once at capture start through existing GET_SETTING; missing/read failure uses fallback. Never switch algorithms mid-meeting. Keep counts/durations in projector/session state: corrections/restorations, late arrivals, degraded reconciliation, draft size and projection runtime. Create `tests/unit/liveConversationRollout.test.ts`; disabled/read-failure paths never construct the projector. Presentation failure retains prior view plus visible degraded status, while raw capture continues. During implementation update the existing #670 changelog fragment and add `docs/qa/live-transcript-stable-conversation.md`.
- [ ] **T7 (P1, human: 1–2 days / agent: 2–4 hours plus recording time): Causal and final acceptance.** Extend `scripts/run_private_parakeet_eou_replay.ts` and `tests/manual/parakeetEouCausalReplay.test.ts` so actual revisions/evidence exercise the projector in memory. Keep aggregate reports content-free. Compare enabled/disabled long sessions; verify stop, sealed artifacts, persisted final transcript, reload and trusted notes. Keep default-off and #670 open until all gates below pass.

## Test coverage and failure modes

```text
INPUT / DECISION                        COVERAGE
EOU prefix/revision/queue               existing projection/session suites
 + delayed echo-only callback          new causal integration regression
range candidates
 + disjoint supported spans            new reading-fragment unit tests
 + protected/ambiguous/missing timing   raw retention and immutability tests
 + counterpart withdrawn/restored      restoration conservation tests
projector
 + commit / long suffix / late row     ID/order/full-word tests
 + changed split / full retraction     same shell + restored words
 + reset / unavailable / finish        lifecycle tests
AudioManager -> App -> ZenMode -> UI    actual payload/navigation integration
 + projection throws                   raw consumers continue
 + scroll/correct/expand                DOM + real Electron anchor/focus QA
stop -> seal -> final -> reload         trusted artifact/notes Electron QA
```

New behavior is planned coverage, not already passing tests. Existing negative controls do not establish multi-span accuracy. No prompts change, so new LLM evals are unnecessary.

| Failure | Handling and visible outcome | Proof |
| --- | --- | --- |
| Late echo evidence changes committed mic row | Correct owned ranges with quiet qualifier; preserve reader anchor | T1–T5 delayed-evidence integration |
| Tentative System counterpart disappears | Restore original mic words once | T2/T3 withdrawal tests |
| Negation, local repetition, overlap or missing timing | Retain uncertain words; duplicates may remain | T2 negative controls/private cases |
| Range split changes fragment IDs | Raw committed ID owns correction; no duplicate local words | T3 conservation |
| Long hypothesis/commit | Full draft expandable; full commit retained | T3/T5 |
| Projection throws in recognition callback | Isolate UI failure; raw consumers/capture continue | T4 injected throw + final QA |
| Stale callbacks/navigation/new meeting | Owner fences; no view-remount reset; new-capture reset | T3/T4 |
| Correction above viewport changes height | Preserve visible row/offset and focus | T5 DOM + Electron |
| Long-session reconciliation exceeds budget | Retain raw wording, record degraded count; no PCM drop | T7 benchmark |
| Corpus missing or real test skipped | Acceptance NOT RUN; rollout stays off | T7 release evidence |

## Sequencing and parallelization

| Step | Modules | Dependencies |
| --- | --- | --- |
| T1 baseline/fixtures | tests | None |
| T2 ranges, T3 projector | src/services/liveTranscription, tests | T1; T3 waits for T2 contract |
| T4/T5 wiring/view | src/components, src/App, tests | T2/T3 |
| T6 rollout | recording integration, tests | T4/T5 |
| T7 acceptance | scripts, tests/manual, docs/qa | T1–T6 |

Prefer sequential implementation because range ownership and rendering share contracts/fixtures. Independent read-only corpus preparation can accompany T2/T3. Do not split AudioManager or reconciliation edits between worktrees. #770 offline measurements can be prepared separately; identity product integration waits for delivered #670 and voice-profile fixes.

## Validation and rollout gates

Run changed focused suites after each task, then during implementation:

```bash
pnpm vitest run tests/unit/eouTranscriptProjection.test.ts tests/unit/eouRendererSession.test.ts tests/unit/liveEchoEvidence.test.ts tests/unit/liveTranscriptReconciliation.test.ts tests/unit/liveTranscriptReadingFragments.test.ts tests/unit/liveConversationProjection.test.ts tests/unit/audioManagerLiveConversation.dom.test.tsx tests/unit/audioManagerParakeetEouWiring.test.ts tests/unit/liveConversationRollout.test.ts tests/unit/liveTranscriptPresentation.test.ts tests/unit/LiveTranscript.dom.test.tsx tests/unit/recordingWorkspaceModel.test.ts tests/unit/AppRecordingNavigation.dom.test.tsx tests/unit/transcriptTrustState.test.ts tests/unit/retryMeetingTranscriptValidation.test.ts
pnpm exec tsc --noEmit
pnpm run lint
pnpm run changelog:check
pnpm run test -- --run
pnpm run benchmark:private-parakeet-eou:validate
RUN_PARAKEET_EOU_CAUSAL_REPLAY=1 pnpm run replay:parakeet-eou
```

The last command also requires `PLUTO_PRIVATE_PARAKEET_EOU_MANIFEST` pointing to a consented local manifest. Without it the real test skips. Successful exit with skipped tests is not acceptance. The current runner checks EOU metrics; T7 must add projector checks before claiming #670 coverage.

Use fresh built Electron code and restore Electron SQLite ABI with `pnpm run ensure:sqlite-abi` after Node test rebuilds. Record consented headphones, remote-only loudspeaker, alternating local/remote, overlap, and sustained remote speech with short local interruptions, plus a long-session stress run and delayed/failed source. Review local audio to distinguish actual speech from echo; identical strings are not the oracle.

Require zero missing/duplicated owned confirmed words in synthetic conservation tests, zero unsupported suppression in the labeled private corpus, supported multi-span suppression, stable existing row order, at most one draft, correct restoration, and intact stop/seal/final/reload/notes behavior. Report raw ASR errors separately from display errors. Compare p50/p95 publication/reconciliation latency, queue depth (current limit: four outstanding per source), memory and scroll responsiveness against the same baseline. Fix numeric performance budgets from baseline before the release comparison; these are benchmark gates, not invented current thresholds.

Default enablement follows passing gates; retain emergency disable for one release. Remove fallback later after observed use. Update #670 acceptance wording and `docs/decisions.md` during implementation to record stable-order corrections. This review edits only plan artifacts and makes no external issue updates.

## GSTACK REVIEW REPORT

Verified findings: [P1, confidence 10/10] `eouRendererSession.ts:109` explicitly says `Acoustic corroboration can arrive after the final ASR revision`, contradicting frozen echo presentation. [P1, confidence 10/10] `AudioManager.tsx:814` calls `meetingContextIngestion.accept(segments)`, so display ranges must not replace that argument. [P2, confidence 9/10] `liveTranscriptReconciliation.ts:334` begins the single-result span path; multi-span behavior requires a new causal/conservation test, not a DOM-only assertion.

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| Engineering | Explicit plan review | Architecture, code quality, tests, performance | 1 | DONE_WITH_CONCERNS | Corrected immutable-history contradiction; kept bounded multi-span scope; removed raw-sort/new-IPC expansion; added conservation, failure-isolation, lifecycle and finalization gates |
| Outside voice | In-host Codex check | Avoid nested self-review | 0 | Skipped | No independent cross-model endorsement claimed |
| Design | Not invoked here | Rendered UX acceptance remains required | 0 | Not run | Corrections and scroll anchoring need Electron QA |

**VERDICT:** Ready for staged implementation; shipping/default enablement remains gated on T7 evidence. All engineering sections reviewed under the user's full-quality scope authorization. Gstack startup/metadata tooling is degraded in this temporary worktree. No product code or full product tests ran in this docs-only review.

**UNRESOLVED DECISIONS:**
- Fix numerical long-session performance budgets from baseline before release comparison; measured and private-corpus acceptance remain outstanding.

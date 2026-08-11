# Pluto Decision Log

This is the default home for durable product, design, process, and architecture decisions.

Use concise chronological entries. Link the source issue and PR whenever they exist. Create a full ADR under `docs/adr/` only when a decision has long-lived technical consequences, meaningful alternatives, and tradeoffs worth preserving in depth.

## Entry Format

```markdown
## YYYY-MM-DD - Decision title
- **Status:** Proposed | Accepted | Superseded
- **Source:** Issue #123, PR #456, or source document
- **Decision:** The choice we made.
- **Rationale:** Why this choice fits Pluto now.
- **Consequences:** What this enables, constrains, or requires later.
```

## 2026-08-10 - Split live, final transcript, and analysis latency on Apple Silicon
- **Status:** Accepted
- **Source:** [Issue #592](https://github.com/metagrover/pluto/issues/592), owner-approved 2026-08-10 direction
- **Decision:** Apple Silicon recording uses independent five-second MLX Whisper base-model chunks for live text, persists the best checkpoint transcript immediately when recording stops, validates captured sources with the medium model in the background, and starts local analysis only after the validated transcript is committed. Stop-time foreground work does not rerun whole-session ASR or speaker clustering; microphone and system-audio provenance supplies `Me` and `Them` attribution. Local meeting-analysis calls have a bounded timeout and knowledge-document generation retains its longer budget.
- **Rationale:** The user needs speech to appear continuously during a meeting, a transcript to remain available as soon as the meeting ends, and analysis to progress without blocking the transcript. Whole-session recognition and clustering in the stop path delayed useful content, unbounded or repeated local-model requests made analysis appear permanently stuck, and unconstrained MLX results could preserve repeated high-no-speech hallucinations outside the audio duration.
- **Consequences:** Live requests keep only the active chunk plus the newest pending chunk, avoid word timestamps and cross-chunk prompt conditioning, and may incur one cold model-load delay before warm requests become subsecond. Medium validation replaces provisional content when complete, rejects invalid timing and repeated high-no-speech output, and leaves analysis visibly loading in the background. Zoom and Google Meet auto-end invoke the same idempotent stop/finalization path as manual stop. Silent calls may lock only when a supported call tab or attached meeting audio process supplies explicit evidence; Zoom additionally requires its meeting-specific `CptHost` process so the persistent idle `caphost` helper cannot hold a recording open. A closed browser meeting tab is explicit exit evidence and uses the shorter grace window.

## 2026-08-09 - Make transcription Apple Silicon MLX-only
- **Status:** Accepted
- **Source:** [Issue #596](https://github.com/metagrover/pluto/issues/596), owner-approved 2026-08-09 direction
- **Decision:** Pluto supports transcription on Apple Silicon Macs through MLX Whisper only. Sherpa-ONNX remains the separate credential-free speaker-attribution runtime. PyTorch WhisperX, CPU/CUDA fallback, cross-platform packaging, engine selection, device selection, and compute selection are removed.
- **Rationale:** Maintaining two speech recognizers let historical CPU checkpoint settings reconfigure the shared sidecar away from the working MLX engine, causing recovery failures and meetings stuck in transcript validation. Pluto does not currently need the dependency weight or failure surface of cross-platform recognition.
- **Consequences:** Legacy non-MLX journal checkpoints are reprocessed from durable repair audio as a complete MLX provenance set before validation. Missing MLX fails explicitly, quality preset/model/language remain user intent, and future Intel, Windows, or Linux support requires a new explicit product decision rather than an implicit CPU fallback.

## 2026-08-09 - Seal recording evidence before derived transcript repair
- **Status:** Accepted
- **Source:** [Issue #592](https://github.com/metagrover/pluto/issues/592), [Issue #593](https://github.com/metagrover/pluto/issues/593), owner-approved 2026-08-09 investigation
- **Decision:** A clean stop seals valid durable capture evidence without invoking transcription. Missing or failed transcript checkpoints are derived processing work after the seal and reach a finite validated or needs-attention state through the existing retry coordinator.
- **Rationale:** Running checkpoint transcription inside `AUDIO_CAPTURE_JOURNAL_SEAL` made an unavailable recognizer look like recording corruption: the journal remained in `stopping`, the meeting was labeled `journal_seal_failed`, and transcript validation plus analysis never began even though every capture interval and activity snapshot was durable.
- **Consequences:** `recovery_required` remains reserved for failures of the capture proof itself. MLX selection is persisted only when Apple Silicon runtime health proves it is available, explicit backend choices remain authoritative, unavailable MLX fails explicitly, and transcript/analysis retries operate from sealed evidence without rewriting historical meetings.

## 2026-08-07 - Local Model Action Item & Decision Extraction with Evidence Grounding
- **Status:** Accepted
- **Source:** [Issue #594](https://github.com/metagrover/pluto/issues/594), `docs/superpowers/specs/2026-08-07-local-model-action-item-extraction-design.md`
- **Decision:** Shift action item and decision extraction and validation from rigid code-level keyword matching (`hasSupportInTranscript`) to local LLM extraction with prompt-based `evidence` quote grounding.
- **Rationale:** Hardcoded TypeScript keyword filters (`"i'll"`, `"send"`, `"draft"`) rejected 98.8% of LLM-extracted action items because natural LLM paraphrasing caused single-line token overlap to fall below 0.6. Relying on the LLM to extract tasks and supply transcript evidence quotes preserves high recall while maintaining hallucination safeguards.
- **Consequences:** Removes rigid keyword deletion from `applyTranscriptGrounding()`, adds optional `evidence` field to `ActionItemV3` and `DecisionV3` prompts/schemas, and flags low-support items in metadata without stripping them from user-facing notes.

## 2026-08-06 - Native Apple Silicon MLX Whisper Transcription Engine
- **Status:** Accepted
- **Source:** [Issue #593](https://github.com/metagrover/pluto/issues/593), `docs/superpowers/specs/2026-08-06-apple-silicon-mlx-whisper-design.md`
- **Decision:** Integrate Apple MLX (`mlx-whisper`) as the primary native transcription engine on Apple Silicon Macs (`darwin`/`arm64`) under the `local_alt_apple_silicon` backend identifier in `python/whisperx_server.py`.
- **Rationale:** Standard PyTorch WhisperX runs on CPU on macOS, leading to high CPU usage and slower finalization. A local content-free fixture confirmed that the installed MLX small model runs faster than real time on the development machine; transcript quality remains governed by the configured model and the recording-quality benchmark rather than an unverified equivalence claim.
- **Consequences:** Adds `mlx` and `mlx-whisper` Python dependencies on macOS arm64, exposes backend choice in Pluto settings, models `mlx` and `float16` explicitly in the shared contract, and reports an unavailable MLX runtime instead of silently claiming a CPU fallback is the selected engine.

## 2026-08-04 - Asynchronous Memory Dreaming and Knowledge Consolidation Engine
- **Status:** Accepted
- **Source:** [Issue #586](https://github.com/metagrover/pluto/issues/586), `docs/superpowers/specs/2026-08-04-memory-dreaming-engine-design.md`
- **Decision:** Pluto introduces an asynchronous, background Dreaming Engine that runs during idle power states (and on manual trigger) to perform incremental entity cluster extraction, temporal reconciliation, entity deduplication, and cross-meeting narrative re-synthesis.
- **Rationale:** Point-in-time post-meeting extraction accumulates fragmented snippets, conflicting temporal facts, and near-duplicate nodes over time. Offline background dreaming consolidates the knowledge graph while preserving complete user inspectability and single-click reversion via a Dream Log Drawer.
- **Consequences:** Adds `dirty` tracking on knowledge nodes/docs, adds `knowledge_dreaming_runs` to SQLite, implements Main-process dreaming processing coordinator with battery/activity safeguards, and introduces IPC channels and a React Dream Log Drawer.

## 2026-07-22 - Delegate routine Builder review, not human authority
- **Status:** Accepted
- **Source:** [Issue #546](https://github.com/metagrover/pluto/issues/546), `docs/superpowers/specs/2026-07-22-delegated-design-review-design.md`
- **Decision:** Builder uses fresh independent read-only sub-agents to review bounded engineering designs and committed written specs. Human approval remains required for unresolved product intent, privacy/legal/security risk, credentials or private evidence, spending, destructive or irreversible work, authority conflicts, and human-only evidence.
- **Rationale:** Independent review removes routine approval latency while preserving separation of duties and the owner-only decisions that protect Pluto's trust contract.
- **Consequences:** Design and committed-spec approvals are separate, revisions invalidate approval, reviewers cannot author or implement the artifact, and unresolved repeated or conflicting review outcomes escalate to the human owner.

## 2026-07-22 - Fail closed on recording trust, not meeting preservation
- **Status:** Accepted
- **Source:** [Issue #535](https://github.com/metagrover/pluto/issues/535), [PR #544](https://github.com/metagrover/pluto/pull/544), `docs/superpowers/specs/2026-07-22-recoverable-seal-failure-design.md`
- **Decision:** A capture-journal seal gates normal meeting finalization. If sealing fails, Pluto preserves the unsealed journal and a visible meeting marked `recovery_required` instead of discarding the meeting or presenting it as normally finalized.
- **Rationale:** Losing an entire meeting is worse than delaying an imperfect transcript, while silently treating unsealed evidence as complete would violate Pluto's recording-trust contract.
- **Consequences:** Finalized-evidence consumers defer recovery-required meetings, user-visible failure copy remains content-free, the only recovery source cannot be deleted from Meeting View, and automatic retry/recovery remains focused follow-up work.

## 2026-07-13 - Store new journal entries as changelog fragments
- **Status:** Accepted
- **Source:** [Issue #390](https://github.com/metagrover/pluto/issues/390), `docs/superpowers/specs/2026-07-13-changelog-fragments-design.md`
- **Decision:** New Pluto product/development journal entries are canonical, uniquely named files under `docs/changelog/entries/`. Ordinary pull requests never edit the archived aggregate journal or commit generated aggregate output.
- **Rationale:** Independent fragments preserve Pluto's rich Changed, Why, Replaced, and Notes context without forcing concurrent branches to modify the same newest date section.
- **Consequences:** Meaningful changes must add and validate a fragment, CI rejects malformed or duplicate fragments, existing history stays in `docs/CHANGELOG.md`, and combined post-migration views are generated on demand.

## 2026-07-10 - Make the homepage a living memory brief
- **Status:** Accepted
- **Source:** [Issue #59](https://github.com/metagrover/pluto/issues/59), approved dashboard redesign discussion
- **Decision:** The homepage leads with one synthesized current read and its provenance, then presents a deliberately small attention lane, recent memory, and continuation context. Task backlog volume no longer defines the page hierarchy, and recording remains a compact persistent action instead of a promotional sidebar card.
- **Rationale:** Pluto's defining value is helping someone re-enter accumulated context, understand what changed, and verify why it matters. Repeating overdue counts and action controls across equally weighted cards made the product read like a task manager with meeting data attached.
- **Consequences:** Homepage work should prefer working-memory or Knowledge synthesis for the lead narrative, keep evidence adjacent to important claims, limit visible attention items before overflow, and avoid reintroducing duplicated hero/focus regions or oversized capture chrome.

## 2026-07-13 - Extend the memory-brief hierarchy to Knowledge and People
- **Status:** Accepted
- **Source:** [Issue #389](https://github.com/metagrover/pluto/issues/389), approved Knowledge and People redesign discussion
- **Decision:** Knowledge defaults to an operating picture led by Current Read, attention, and risks, with streams and source inspection behind a secondary Browse memory disclosure. People is a relationship briefing ordered by recent conversation context, not a directory of identical profile cards.
- **Rationale:** Knowledge and People should help someone re-enter useful context as quickly as the homepage does. Equal-weight containers and generic contact cards hid the synthesis, recency, and relationship evidence that make Pluto distinct.
- **Consequences:** Both surfaces should use editorial hierarchy, compact divider rows, restrained actions, and useful empty states. Future People work should deepen commitments and relationship signals rather than add directory chrome; future Knowledge work should keep browsing secondary to the current operating picture.

## 2026-07-14 - Make re-entry briefings selective before they are complete
- **Status:** Accepted
- **Source:** [Issue #404](https://github.com/metagrover/pluto/issues/404), post-ship visual review of Knowledge, People, and Projects
- **Decision:** Re-entry surfaces prioritize a deliberately small first viewport before exposing complete history. People leads with open commitments and recent relationships, Projects leads with active or overdue work while collapsing completed history, and Knowledge keeps the last reliable read primary when a later synthesis update fails.
- **Rationale:** Complete lists and technical system state are useful for inspection but poor orientation. Pluto earns trust by helping the user understand what matters now, while keeping the evidence, archive, and failure detail available on demand.
- **Consequences:** High-volume directories, completed tasks, and provenance details should use progressive disclosure. Empty active-work states must not be labeled healthy or on track, missing metadata must become calm human copy, and synthesis failures must distinguish an unavailable read from a stale but still useful one.

## 2026-05-26 - Accept the Phase 0 trust spine contract
- **Status:** Accepted
- **Source:** [Issue #57](https://github.com/metagrover/pluto/issues/57), child issues [#86](https://github.com/metagrover/pluto/issues/86), [#91](https://github.com/metagrover/pluto/issues/91), [#94](https://github.com/metagrover/pluto/issues/94), and [#98](https://github.com/metagrover/pluto/issues/98)
- **Decision:** Pluto's shared trust contract now consists of six canonical trust states (`grounded`, `inferred`, `weak_evidence`, `stale`, `synthesis_failed`, `needs_review`), secure local storage for provider credentials, durable `knowledge_corrections` feedback that changes synthesized output, and cross-surface explanations anywhere Dashboard, Knowledge, or Ask Pluto presents a trust badge instead of direct provenance.
- **Rationale:** Trusted Attention depends on one durable explanation model for what Pluto knows, what it inferred, what looks stale, and what still needs human review. The earlier child slices landed the code; this decision records the accepted contract so later working-memory, attention, and briefing work reuses it instead of inventing new trust semantics.
- **Consequences:** Later roadmap work should reuse the existing trust-status vocabulary and explanation copy, keep commitment lifecycle state separate from `knowledge_corrections`, and treat trust/provenance gaps as product-visible states rather than hiding them behind confident summary prose.

## 2026-05-01 - Use GitHub Issues as the active product source of truth
- **Status:** Accepted
- **Source:** [Issue #55](https://github.com/metagrover/pluto/issues/55), agentic development setup discussion
- **Decision:** Active product and implementation work should start from outcome-sized GitHub Issues. Static repo docs preserve durable memory instead of steering active scope.
- **Rationale:** Pluto's direction changes as product understanding improves. Issues make divergence visible and discussable without requiring every change to rewrite a PRD.
- **Consequences:** Agents should find or create a relevant issue before planning implementation, update the issue when scope changes materially, and record durable decisions or shipped changes in the repo memory docs.

## 2026-05-01 - Use a decision log by default and ADRs selectively
- **Status:** Accepted
- **Source:** [Issue #55](https://github.com/metagrover/pluto/issues/55), agentic development setup discussion
- **Decision:** Record most durable decisions in this chronological log. Create ADRs only for high-impact technical decisions with meaningful alternatives and long-lived consequences.
- **Rationale:** Pluto needs low-friction memory for frequent product and design evolution, plus deeper records for architecture choices that future engineers will need to understand.
- **Consequences:** The decision log becomes the fast map of project direction. ADRs become detailed landmarks, not the default workflow.

## 2026-05-01 - Accept valid `gh` auth for PM automation preflight
- **Status:** Accepted
- **Source:** [Issue #67](https://github.com/metagrover/pluto/issues/67), PM housekeeping automation readiness
- **Decision:** Recurring PM housekeeping should accept any valid non-interactive `gh` authentication path, including keychain-backed login or `GH_TOKEN`/`GITHUB_TOKEN`, and run a preflight that verifies API reachability, issue listing, and repository write scope before mutating issues, labels, PRs, or milestones.
- **Rationale:** Pluto is run both from interactive desktop sessions and more automation-like contexts. Requiring environment tokens rejected working keychain-backed `gh` auth even when GitHub API access and repository permissions were already proven by the preflight itself.
- **Consequences:** PM automation runs should report auth, network, issue-list, permission-probe, write-permission, and mutation failures separately, should continue redacting token values from diagnostics, and should prefer repository capability checks over assumptions about how `gh` obtained credentials.
- **2026-05-09 update:** Recurring automation prompts and PM preflight should use `/Users/metagrover/Desktop/pluto/.builder.env` as the shared project-local bootstrap source, mirror `GH_TOKEN` and `GITHUB_TOKEN`, and keep `gh auth status` diagnostic-only. Successful repo-scoped `gh` checks are the readiness signal.

## 2026-05-09 - Prioritize Trusted Attention on a Cognitive Memory Spine
- **Status:** Accepted
- **Source:** [Issue #65](https://github.com/metagrover/pluto/issues/65), [Issue #76](https://github.com/metagrover/pluto/issues/76), second-brain roadmap discussion
- **Decision:** Pluto's next strategic milestone is Trusted Attention built on a Cognitive Memory Spine. The near-term roadmap should converge existing capture, graph, Knowledge, Ask Pluto, and proactive systems into one evidence-backed memory-and-attention loop before pursuing a full multi-agent platform rewrite or broad multimodal ingestion.
- **Rationale:** Pluto already has strong foundations for transcription, structured extraction, knowledge graph, Knowledge V2, retrieval, and proactive alerts. The highest-leverage product gap is making Pluto reliably tell the user what deserves attention, prove why, and learn from correction.
- **Consequences:** Roadmap issues should sequence trust/provenance, durable attention, signal unification, attention scoring, working memory snapshots, Knowledge integration, and briefings before later reflection, broader local artifact ingestion, and explicit agent/module boundaries.

## 2026-05-09 - Treat streams as derived, attention as future durable state
- **Status:** Accepted
- **Source:** [Issue #76](https://github.com/metagrover/pluto/issues/76), `docs/superpowers/specs/2026-05-09-cognitive-memory-spine-design.md`
- **Decision:** Pluto's Cognitive Memory Spine should keep raw capture, extracted graph state, knowledge docs, and correction feedback durable now; keep streams and working-memory reads derived for the current phase; and move canonical attention ownership into SQLite in Phase 1 rather than extending the in-memory proactive alert store.
- **Rationale:** The current codebase already has durable capture, graph, and synthesis primitives, but it does not yet have a trustworthy shared attention layer. Persisting stream identity too early would harden still-evolving heuristics, while leaving attention transient would block cross-surface continuity and correction-aware ranking.
- **Consequences:** Phase 1 work should add a durable attention queue, Phase 2 work should decide how to persist working-memory snapshots, and follow-up lifecycle work should keep explicit action state distinct from `knowledge_corrections` feedback.
# 2026-07-10: Active recording is a transcript-first command center

During capture, Pluto treats recording health and the live conversation as the primary workspace. A single persistent capture bar owns status, elapsed time, input health, title, and finish behavior; notes, participants, and diagnostics live in a collapsible secondary rail. Healthy capture stays visually calm, and processing or input failures use explicit text rather than duplicate spinners or decorative waveforms.

This keeps the user in the conversation, makes capture trust visible, and reserves the full-page note editor pattern for contexts where writing is actually the primary task.

## 2026-07-17 - Pin credential-free diarization and require acoustic near-end evidence
- **Status:** Accepted
- **Source:** [Issue #465](https://github.com/metagrover/pluto/issues/465), [Issue #509](https://github.com/metagrover/pluto/issues/509), [PR #510](https://github.com/metagrover/pluto/pull/510)
- **Decision:** Pluto will use `sherpa-onnx==1.13.4` as the credential-free local diarization runtime for issue #460, with the MIT-licensed pyannote segmentation ONNX artifact pinned by SHA-256 `d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d` and the Apache-2.0 TitaNet-S embedding artifact pinned by SHA-256 `ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e`. Diarization labels alone may not determine `Me`: #460 must combine diarization with microphone-exclusive near-end or acoustic-echo-cancellation evidence before assigning local identity.
- **Rationale:** The pinned stack runs locally on Apple silicon without model-hub credentials and passed the private evaluation without false `Me` attribution, but diarization alone merged a genuine 0.541-second local interruption into the remote speaker. That failure is exactly the case Pluto's separate microphone and system-audio evidence can resolve more reliably than speaker clustering.
- **Consequences:** #460 must treat recovery of the 0.541-second local turn as a hard acceptance case, preserve unknown identity when acoustic evidence is inconclusive, and keep model checksums plus redistribution review as production eligibility gates. The private benchmark result is recorded only as aggregate metrics: DER `0.1209`, false-`Me` `0`, missed-`Me` `0.541s`, short-local-turn recall `0`, remote-speaker F1 `0.9376`, runtime factor `0.0905`, and peak memory `381.125 MiB`; no private audio, paths, or transcript content enter the repository.

## 2026-07-30 - Derive transcript trust from explicit evidence-backed state
- **Status:** Accepted
- **Source:** [Issue #556](https://github.com/metagrover/pluto/issues/556), `docs/superpowers/specs/2026-07-30-transcript-trust-state-design.md`
- **Decision:** Recording recovery, transcript validation, retry, Meeting View, and downstream intelligence share one versioned transcript-trust envelope. User copy and action eligibility are resolved from explicit causes, available artifacts, content-free evidence provenance, and validation proof; recovery alone never means captured speech is missing, and downstream generation requires a persisted proof-backed `validated` state.
- **Rationale:** The previous projections let generic `needs_attention` states render as speech loss and allowed separate pipeline stages to infer trust differently. A single fail-closed resolver preserves the recording while distinguishing recoverable validation work, capture gaps, evidence failures, and proven transcript loss.
- **Consequences:** New writes use schema version 2, conflicting projections are rejected transactionally, legacy records remain readable without directly gaining generation eligibility, eligible unanalyzed meetings automatically validate before Pluto builds their standard analysis, existing analysis remains the primary Meeting View experience, recovery gaps require restoration before validation, and the privacy-safe recording-quality benchmark asserts the explicit capture-gap cause and aggregate recovery counts.

## 2026-07-31 - Finalize recordings from durable live transcript checkpoints
- **Status:** Accepted
- **Source:** [Issue #442](https://github.com/metagrover/pluto/issues/442), `docs/superpowers/specs/2026-07-31-resumable-live-transcript-finalization-design.md`
- **Decision:** New recordings use a versioned capture-journal interval ledger that durably links each accepted live transcript chunk and arbitration frame to its exact repair audio and resolved transcription configuration. Clean stop and interrupted recovery verify and reuse that chunk evidence; only unresolved captured tuples are transcribed again.
- **Rationale:** Live transcription was already producing useful text during recording, but the renderer discarded it and recovery rebuilt an empty transcript before running Whisper over the complete recording. That duplicated successful work, increased latency, and could replace a healthy live result with a failed validation pass.
- **Consequences:** Fully checkpointed recordings reach deterministic transcript validation without full-session transcription, clean-stop tail gaps are repaired before sealing, native system audio is downmixed and cropped to journal time, a targeted empty retry can establish per-source silence while canonical validation still checks whole-meeting coverage, interrupted work resumes at chunk boundaries, audio remains the recovery source of truth, capture gaps remain fail-closed, and the canonical transcript plus downstream analysis claim is generation-guarded and committed atomically.
- **2026-08-03 update:** Recovery must execute the finalization planner's `coverage_underfilled` request even when a checkpoint is structurally valid. Short speech-active empty checkpoints receive one targeted retry, while a valid acceptance frame that already attributes the speech to the other source prevents duplicate work.
- **2026-08-03 compatibility update:** Persisted repair audio is normalized to the trailing journal interval before recovery transcription so historical pre-roll cannot produce out-of-range checkpoint timestamps. Malformed optional word timings are dropped at the checkpoint boundary while valid segments remain authoritative. Once all available transcript evidence is resolved, explicit missing or unavailable capture sources may seal into a `needs_attention` recovered meeting; captured-source transcript failures, those capture gaps, and any remaining transcript requests still block proof-backed validation and downstream intelligence.

## 2026-08-03 - Require explicit commitment review before dashboard completion
- **Status:** Accepted
- **Source:** [Issue #562](https://github.com/metagrover/pluto/issues/562)
- **Decision:** Dashboard completion eligibility comes only from an explicit `confirmed` commitment state. Extracted suggestions and metadata-free legacy actions fail closed as possible follow-ups until reviewed; rejection is a separate commitment-review outcome, never a completion shortcut.
- **Rationale:** Extraction can identify plausible work without proving that someone actually committed to it. Completion and blocker controls would overstate that inference and let unverified suggestions enter settled-work lifecycle state.
- **Consequences:** Possible rows expose their model summary and evidence basis, link to the exact persisted source meeting when available, and offer confirm or reject review actions. Only confirmed rows receive completion and attention lifecycle controls; rejected rows leave the dashboard action queue without being marked complete.

## 2026-08-07 - Cancel speech monitoring immediately on stop to prevent false durability failure
- **Status:** Accepted
- **Source:** [Issue #594](https://github.com/metagrover/pluto/issues/594), [PR #595](https://github.com/metagrover/pluto/pull/595)
- **Decision:** `AudioManager.tsx` cancels the `requestAnimationFrame` speech monitoring loop immediately when a stop request is accepted, and `captureActivitySession.ts` discards zero-duration active speaker windows at session end without latching a durability failure.
- **Rationale:** During the 100–500ms of async audio recorder shutdown, frozen meeting elapsed timestamps caused ongoing speech monitor animation ticks to call `transitionSpeaker` with non-increasing timestamps, triggering false durability failures that degraded completed meetings into `recovery_required`.
- **Consequences:** Completed meetings finalize cleanly without falling back to recovery state, allowing transcript validation and AI meeting analysis to run automatically on session end.

## 2026-08-04 - Treat acoustic activity as a candidate and use one post-meeting worker
- **Status:** Accepted
- **Source:** [Issue #574](https://github.com/metagrover/pluto/issues/574)
- **Decision:** Sealed RMS/dominance windows are candidate acoustic activity, not proof that speech occurred. Pluto may clear those candidates only after explicit successful VAD evidence and verified source-duration coverage. Recording finalization persists the canonical transcript and then hands analysis, entity extraction, MID generation, and knowledge refresh to one app-wide resumable worker independent of meeting selection.
- **Rationale:** A real meeting retained durable audio and transcript segments but was rejected twice because long noise intervals were labeled as speech. The separate inline and retry pipelines also disagreed about progress and marked downstream work complete before required intelligence finished.
- **Consequences:** Empty transcript segments without an explicit VAD outcome remain fail-closed, proven no-speech can reject detector false positives, unavailable diarization models fall back without blocking transcription, and downstream completion is persisted only after entity extraction and knowledge refresh succeed.
- **2026-08-05 persistence update:** Whole-meeting writes must use in-place conflict updates, never SQLite replacement. Replacing the meeting parent fires foreign-key delete semantics and can erase entity associations while leaving copied MID and completion fields behind. Generic recovered or untitled rows are also incomplete until title generation succeeds; genuine capture-journal gaps remain fail-closed instead of receiving synthesized analysis.

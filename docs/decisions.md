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

## 2026-08-25 - Retire MLX transcription after Parakeet real-use verification

- **Status:** Accepted
- **Source:** [Issue #663](https://github.com/metagrover/pluto/issues/663), [ADR](./adr/2026-08-25-retire-mlx-transcription.md), owner direction on 2026-08-25
- **Decision:** Pluto removes the MLX transcription sidecar, dependencies, packaging, settings, IPC, replay comparisons, and rollback/shadow machinery. English Parakeet EOU remains the only live recognizer and sealed Parakeet TDT remains canonical.
- **Rationale:** Real meetings have verified the Parakeet path, while retaining MLX continued to impose setup, package, fallback, and diagnostic surfaces for a runtime the product no longer uses.
- **Consequences:** App transcription no longer depends on Python or MLX. Historical capture journals remain readable through a narrow legacy-checkpoint parser, but that compatibility code cannot execute MLX.

## 2026-08-24 - Make English Parakeet EOU the only live transcription engine

- **Status:** Superseded by the 2026-08-25 MLX retirement decision
- **Source:** [Issue #663](https://github.com/metagrover/pluto/issues/663), [ADR](./adr/2026-08-24-parakeet-eou-live-primary.md), owner direction on 2026-08-24
- **Decision:** Pluto uses independent English Parakeet EOU sessions for causal microphone and System PCM as its only visible live recognizer. Recording start requires EOU readiness; a mid-recording EOU failure leaves capture running and never starts MLX. Sealed Parakeet TDT finalization remains canonical until a separately evidenced decision changes it.
- **Rationale:** The pinned native stack already supports true 320 ms streaming, Pluto is English-only, and retaining an MLX fallback would hide EOU reliability failures while preserving two transcription runtimes.
- **Consequences:** Live input moves from five-second preview files to bounded causal PCM, EOU assets join the verified model lifecycle, and recording readiness no longer depends on the retired recognizer.

## 2026-08-19 - Use one editable meeting document for notes and analysis

- **Status:** Accepted
- **Source:** [Issue #641](https://github.com/metagrover/pluto/issues/641), owner-approved design direction on 2026-08-19
- **Decision:** Completed meetings open as one continuously editable notes document. Pluto normalizes legacy and current analysis into the same decisions-first structure, preserves the live scratchpad as user-authored content, and reveals transcript evidence contextually instead of switching to a competing transcript product.
- **Rationale:** Separate analysis versions, tabbed notes, dashboard cards, and raw topic inventories made the product feel generated rather than written. A calm document keeps outcomes scannable, protects the user's own notes, and makes generated claims easy to inspect without overwhelming the reading flow.
- **Consequences:** Decisions and next steps lead the document; repeated or housekeeping topics are omitted; every generated block can be edited; regeneration keeps a recoverable prior version; authorship and save state remain visible; the transcript stays available as a supporting record; future analysis formats must normalize into this product rather than add another viewer.

+## 2026-08-16 - Prefer transcript reconciliation over rolling AEC

- **Status:** Accepted
- **Source:** [Issue #629](https://github.com/metagrover/pluto/issues/629), owner direction on 2026-08-16
- **Decision:** Pluto will not build, package, or operate a rolling AEC runtime or dual-source-primary transcription path for ordinary transcript deduplication. It retains separate mic/System capture and transcript-level cross-channel bleed reconciliation.
- **Rationale:** Duplicate remote speech is a transcript-reconciliation problem already addressed by timestamped cross-channel collapse. The WebRTC AudioProcessing spike proved a maintained external library can build and produce deterministic residuals, but it did not establish the independent delay, drift, and local-speech-preservation evidence needed to use mic audio as local-speaker proof. That higher-risk attribution requirement is not needed for the current product outcome.
- **Consequences:** No new AEC dependency, DSP implementation, capture sidecar, or primary-transcription wiring will ship. System-only shadow work and the existing canonical finalization remain available. A future request to make local-speaker identity claims during overlap must begin as a separate, evidence-backed product decision.

## 2026-08-11 - Remove the Meeting View follow-up email draft surface
- **Status:** Accepted
- **Source:** [Issue #613](https://github.com/metagrover/pluto/issues/613), owner direction on 2026-08-11
- **Decision:** Pluto removes the Meeting View follow-up draft/export composer, including the Email/Internal/Slack variants and LLM refinement path, until a clearer business need exists.
- **Rationale:** The current email-shaped surface was weak enough to reduce trust and overlapped with the broader commitment lifecycle work in [Issue #61](https://github.com/metagrover/pluto/issues/61). Pluto should keep action-item accountability visible without presenting generic send-ready prose as a core meeting outcome.
- **Consequences:** Meeting View still shows extracted follow-ups and durable lifecycle controls, but no longer offers a follow-up email or draft editor. Legacy saved draft data remains inert for compatibility, and any future recap/export experience should start from an explicit user need with cited evidence and review semantics.

## 2026-08-11 - Make the Electron main process authoritative for active capture
- **Status:** Accepted
- **Source:** [Issue #601](https://github.com/metagrover/pluto/issues/601), [PR #604](https://github.com/metagrover/pluto/pull/604)
- **Decision:** Pluto grants at most one runtime capture lease from the Electron main process. The lease binds a recording key and renderer owner, transitions from recording to stopped only for that owner, remains held until seal finishes, and keeps native system-audio output bound to the recording owner.
- **Rationale:** Renderer-local state can reset during reload, remount, or secondary-window activity while capture resources continue independently. Main-process authority is the smallest boundary shared by every renderer and the singleton native audio process.
- **Consequences:** Conflicting starts fail before microphone acquisition, active recording pages prevent navigation, native chunks cannot move to another renderer, and an owner destroyed before finalization releases runtime resources while leaving its durable journal for existing recovery.

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
- **Decision:** Pluto will consolidate cross-meeting knowledge through a proposal-first background Dreaming Engine. Deterministic code owns cluster selection, evidence and identifier validation, graph invariants, transactional application, and restoration. `qwen3.5:9b` is the preferred background synthesis candidate to benchmark; it proposes evidence-backed changes but does not receive direct database authority. Entity merges, temporal transitions, correction overrides, archival, and deletion require review initially.
- **Rationale:** Point-in-time extraction accumulates fragmented snippets, conflicting temporal facts, and near-duplicate nodes. Background execution can tolerate Qwen's higher latency and benefits from its stronger observed evidence grounding, but local evaluation did not establish enough semantic precision for autonomous durable mutation.
- **Consequences:** The first implementation persists inspectable proposals, enforces risk tiers, preserves immutable episodic evidence, and stores complete before-and-after state for any applied change. Dreaming yields to recording and foreground analysis, checks memory pressure, rejects late cancelled results, and unloads its model after a run. Any broader auto-application policy requires dreaming-specific benchmark evidence and a later decision update.

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

## 2026-08-31 - Admit only exact incremental note leaves under capture headroom

- **Status:** Accepted
- **Source:** [Issue #701](https://github.com/metagrover/pluto/issues/701), approved meeting-notes performance continuation
- **Decision:** Pluto may precompute one closed meeting-note source leaf at a time during capture only when the active renderer owns the capture lease, the accepted live transcript is healthy, the Mac is on AC power with nominal thermal state and sufficient memory, and the request runs at background preemptible priority. The growing tail is excluded, provisional drafts remain in a bounded in-memory cache, and final generation reuses a draft only when its exact evidence, prompt, model, settings, user context, and source labels match.
- **Rationale:** Local note generation is too slow to begin entirely after a typical meeting, but unconditional capture-time Ollama work would violate Pluto's recording and transcription trust boundary. Exact closed-leaf reuse can move eligible work earlier without publishing provisional claims or weakening final review.
- **Consequences:** Incremental offers are latest-only and source-growth bounded; stop, owner loss, live-transcript degradation, foreground preemption, or failed headroom admission discards/cancels work. Final transcription changes normally invalidate unmatched leaves, all normal merge/audit/publication checks still run, the cache is capped at 64 drafts and one hour, and no latency improvement may be claimed before a live accepted meeting demonstrates actual reuse.

## 2026-08-11 - Give active capture an explicit local compute budget

- **Status:** Accepted
- **Source:** [Issue #603](https://github.com/metagrover/pluto/issues/603), capture thermal investigation
- **Decision:** While a capture lease exists, Pluto gives durable audio capture and live MLX transcription priority over decorative renderer work and queued local-LLM synthesis. Acoustic speaker classification runs at a fixed bounded cadence, the live word reveal updates only the active turn, and hidden legacy presentation work is not mounted.
- **Rationale:** Capture-time work previously included frame-rate-driven loops and background jobs whose cost was unrelated to new speech. A foreground resource lease makes the performance policy deterministic and keeps the live meeting responsive throughout long recordings.
- **Consequences:** Queued knowledge synthesis resumes only after all foreground pause reasons clear; transcript completeness and capture-journal evidence remain unchanged; performance tests and logs use synthetic inputs and content-free aggregate measurements.

## 2026-08-11 - Hint local transcription with bounded known-person context

- **Status:** Accepted
- **Source:** [Issue #602](https://github.com/metagrover/pluto/issues/602), `docs/superpowers/specs/2026-08-11-known-person-transcription-vocabulary-design.md`
- **Decision:** Each recording resolves one local `known_person_v1` vocabulary snapshot: explicit participants first, then a deterministic saliency/recency/frequency ranking of linked person entities, capped at 12 sanitized names and 240 prompt characters. The snapshot is passed only to MLX `initial_prompt`; transcript text is never rewritten after recognition.
- **Rationale:** Pluto already has relevant person context, while MLX supports a bounded prompt that can disambiguate acoustically similar names. A deterministic local hint improves recognition without sending the graph elsewhere or asserting a name when the audio does not support it.
- **Consequences:** Live and normal final transcription share the immutable recording snapshot; empty context omits the prompt; production logs and persisted transcript metadata retain only policy version and hint count; synthetic ambiguity and negative-control replays gate quality claims.

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
- **2026-08-11 stop-boundary update:** An accepted stop must let `MediaRecorder` publish and journal its final partial interval before live-queue admission closes. Pluto drains the active and newest queued interval for at most 2.5 seconds, then fences and cancels unfinished work. A normal warm MLX stop can therefore seal complete checkpoints without making an unbounded transcription request part of the stop critical path.

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

## 2026-08-14 - Keep canonical transcript evidence immutable across generic saves

- **Status:** Accepted
- **Source:** [Issue #622](https://github.com/metagrover/pluto/issues/622), [Issue #616](https://github.com/metagrover/pluto/issues/616)
- **Decision:** Generic meeting persistence must preserve canonical transcript bytes. Linguistic cleanup is never an implicit save side effect, and total transcript word volume cannot substitute for time-aligned channel evidence during integrity validation. Background correction work may ship only as an end-to-end, versioned pipeline with stable segment identity, provenance, bounded scheduling, persistence, UI state, cancellation, and final-analysis reuse.
- **Rationale:** Context-free filler rules changed valid meaning while retaining stale validation metadata, and isolated rolling-validation helpers created false confidence without participating in recording or finalization. Total word density also cannot prove that a missing activity interval was transcribed.
- **Consequences:** Cleanup requires an explicit controlled boundary and conservative rules; incomplete reconciliation and auto-learning stubs stay out of production; #616 remains open until its full lifecycle and thermal acceptance criteria are verified with synthetic, content-free evidence.

## 2026-08-14 - Validate sealed live chunks within the capture compute budget

- **Status:** Accepted
- **Source:** [Issue #616](https://github.com/metagrover/pluto/issues/616), `docs/superpowers/specs/2026-08-14-live-background-transcript-validation-design.md`
- **Decision:** Keep base MLX transcription on the first-paint path, then admit at most one medium validation of a sealed five-second source chunk after the live queue becomes idle and the 20-second cadence plus macOS battery/thermal policy allow it. A successful result replaces the matching capture-journal checkpoint once, remains linked to the same audio checksum, and updates the live draft through a monotonic time-aligned merge with stable IDs.
- **Rationale:** Whole-meeting rolling reconciliation is both thermally unsafe and difficult to bind to exact evidence. Sealed capture tuples already provide bounded audio, durable checksums, source ownership, and a finalization reuse seam.
- **Consequences:** Live work always wins; denied, failed, or cancelled background work leaves the preview untouched; acceptance frames remain immutable until stop-time finalization rebuilds stale links; validated medium checkpoints accelerate finalization without weakening canonical transcript trust.

## 2026-08-14 - Require evidence before presenting settled meeting intelligence

- **Status:** Accepted
- **Source:** [Issue #594](https://github.com/metagrover/pluto/issues/594), `docs/superpowers/specs/2026-08-14-evidence-grounded-meeting-analysis-design.md`
- **Decision:** Single-pass, per-topic, and repair analysis use one decision/action taxonomy. Every retained settled item must resolve to a normalized verbatim transcript line and substantially conserve its claim tokens; unsupported items are removed, unsupported attribution fields are cleared, and rollups are rebuilt from grounded topic arrays.
- **Rationale:** Prompt contradictions and whole-transcript token overlap let exploratory language and unsupported owners reach user-facing analysis even when quality metadata admitted the failure. A larger local model improved quoting but did not fix classification by itself.
- **Consequences:** Proposals and open questions remain visible without becoming commitments; structured Ollama thinking and evaluation seeds are explicit capabilities; default-model changes require a repeated real-provider quality, latency, and memory gate rather than a single anecdotal run.
- **Model promotion:** After the `notes-v6` rejection-pattern correction, Qwen passed the three-seed production-provider gate with 24/24 precision cases, 30/30 exact-evidence support, zero Phi-baseline fixture regressions, 15.9-second average case latency, and 5.5 GB resident memory. Qwen is the task-scoped structured-analysis default; Phi remains the default for other latency-sensitive Ollama tasks, and explicit user configuration still wins.

## 2026-08-15 - Separate live preview from canonical final transcription

- **Status:** Accepted
- **Source:** [Issue #441](https://github.com/metagrover/pluto/issues/441), `docs/adr/2026-08-15-parakeet-final-transcription.md`
- **Decision:** Keep bounded MLX Whisper base chunks for live preview and use a Pluto-owned FluidAudio/Parakeet Core ML child process for whole-meeting final validation. Microphone and system sources run sequentially, whole-session MLX is ineligible as fallback, and analysis starts only from a generation-guarded canonical commit.
- **Rationale:** Final quality needs a stronger recognizer while two whole-meeting unified-memory incidents froze the system near 12 GB. A native child gives Core ML acceleration, pinned local models, independent cancellation, and an enforceable memory boundary.
- **Consequences:** First use has a larger download and setup cost; provisional text remains available during validation; failures preserve capture truth and become retryable rather than silently promoting lower-quality text.
- **Private evaluation:** Two recent meetings and four source artifacts passed the production integrity path with zero timing failures, 0.0117 real-time factor, and 185.4 MiB peak child RSS. The old reference contained 112 out-of-audio segments and one timeline extending 679.63 seconds beyond its source. After excluding impossible evidence and conservatively collapsing exact three-word channel bleed, ten-second time-aligned proxy precision/recall were 67.90%/74.38%, while order-independent lexical precision/recall were 84.71%/79.13%. This is operational-fit and historical-integrity evidence, not human-ground-truth accuracy proof; reviewed excerpts remain a hard promotion gate.

## 2026-08-22 - Run receipt-bound Parakeet shadow transcription during every ready recording

- **Status:** Accepted
- **Source:** [Issue #651](https://github.com/metagrover/pluto/issues/651)
- **Decision:** Once recording readiness admits capture, Pluto automatically runs the existing dual-source Parakeet shadow coordinator over contiguous, non-overlapping receipt-aligned microphone and System-audio windows that seal when they reach the 30-second target. A shorter sealed tail flushes on stop. Its output is provisional operational evidence only: MLX remains the visible live draft and Parakeet finalization remains the canonical transcript path.
- **Rationale:** A development-only launch flag meant the fully implemented background path was absent from normal recordings, making its feasibility and resource behavior impossible to observe in the actual product flow. Capture receipts bind each background request to immutable source audio without allowing inference to block capture.
- **Consequences:** Recorder cadence may overshoot the target by one durable receipt because exact audio slicing is intentionally outside the metadata-only assembler. The existing resource/thermal fence, cancellation, rollback, temporary-audio cleanup, and content-free report are mandatory for every shadow run. Any shadow failure leaves the recording and its visible MLX preview intact, fences further shadow work, and cannot promote provisional output into the transcript.

## 2026-08-16 - Make recording readiness the first-run outcome

- **Status:** Accepted
- **Source:** [Issue #615](https://github.com/metagrover/pluto/issues/615)
- **Decision:** Pluto ships its signed native recording and transcription executables inside the application bundle, while large local model assets are downloaded, verified, and reused from Pluto's user-data directory. First-run onboarding owns that preparation and the microphone and system-audio permission requests; analysis-provider selection remains contextual settings rather than a recording prerequisite.
- **Rationale:** A fresh install previously started a large invisible model preparation before showing a window, then presented Python, speaker, and provider ceremony that did not truthfully represent packaged recording readiness. The installed application could also omit executables that production paths still invoked.
- **Consequences:** Onboarding has one welcome step and one actionable readiness surface. It completes only after local transcription and both capture permissions are ready, model failures are retryable, returning users still prepare Parakeet before recovery, and packaged builds have an executable contract that is verified from the final app bundle.

## 2026-08-17 - Present meeting artifacts by readiness, not pipeline state

- **Status:** Accepted
- **Source:** [Issue #632](https://github.com/metagrover/pluto/issues/632)
- **Decision:** After recording stops, Pluto opens the meeting detail page from the provisional save and reveals transcript and analysis independently. Internal transcript lifecycle, integrity validation, downstream leases, and automatic retries remain trust and scheduling boundaries; Meeting View renders ready artifacts, final-layout skeletons for unfinished artifacts, and plain-language terminal failures instead of those internal states.
- **Rationale:** Validation is required for trustworthy persistence and downstream generation, but it is not a user task during normal finalization. Exposing it as warning cards and manual recovery controls made every completed recording look broken and hid transcript content that was already useful.
- **Consequences:** Provisional transcript text is readable while canonical finalization continues, analysis replaces its skeleton in place, normal header/sidebar/content copy never exposes validation or recovery terminology, and fail-closed transcript-integrity and generation eligibility remain unchanged.

## 2026-08-18 - Separate transcript evidence from editorial meeting notes

- **Status:** Accepted
- **Source:** [Issue #627](https://github.com/metagrover/pluto/issues/627)
- **Decision:** Canonical transcript text remains immutable evidence. Local structured-analysis passes produce a grounded draft, then one meeting-wide editorial pass may consolidate overlapping topics, rebuild the overview and rollups, recover missed explicit commitments or decisions, and normalize terminology only when repeated meeting context supports it. Every retained settled item must still resolve to verbatim transcript evidence, and ambiguous wording or speaker identity stays ambiguous.
- **Rationale:** Topic-local generation preserves coverage on long meetings but cannot reliably see duplication, meeting-wide terminology, or commitments split across topic boundaries. Editing the transcript itself would hide recognition uncertainty and weaken provenance.
- **Consequences:** Short meetings use one structured pass to avoid unnecessary segmentation and latency; multi-topic analysis receives one bounded global synthesis pass. Invalid or failed editorial output falls back to the grounded local draft with an explicit quality category. Notes may display a high-confidence contextual spelling while quoted evidence preserves the raw transcript, and no interactive clarification workflow is introduced by this change. The provider gate evaluates semantic concepts rather than brittle exact wording and still requires exact transcript evidence, zero unsupported settled items, and zero missed explicit commitments across three deterministic seeds.

## 2026-08-18 - Use one local model for text intelligence

- **Status:** Accepted
- **Source:** [Issue #634](https://github.com/metagrover/pluto/issues/634)
- **Decision:** `qwen3.5:9b` is Pluto's single default Ollama model for structured notes, titles, value signals, entity extraction, knowledge synthesis, and queries. `ollama_model` is the sole task-independent Ollama override; the hidden `ollama_analysis_model` split is removed.
- **Rationale:** A validated meeting silently switched between Qwen for visible notes and Phi for adjacent intelligence tasks. The split made one pipeline depend on two models, introduced model swapping and terminology drift, and exposed a configuration distinction the product did not explain.
- **Consequences:** Default local text work consistently uses the model that passed Pluto's grounded analysis gate. Explicit user model overrides still win, historical Phi benchmark evidence remains for comparison, and Pluto does not automatically delete previously installed local models.

## 2026-08-18 - Scope note chat to the current meeting evidence

- **Status:** Accepted
- **Source:** [Issue #614](https://github.com/metagrover/pluto/issues/614), [Issue #62](https://github.com/metagrover/pluto/issues/62)
- **Decision:** Meeting-scoped Ask Pluto uses an orchestrated internal pipeline with separate context-building, bounded conversation, answer generation, and trust/citation packet assembly, but the scope boundary is the current selected meeting note. The pipeline must not silently pull global, project, or person memory while answering inside a meeting note.
- **Rationale:** Users expect note chat to build on the active meeting context like a bottom composer, while #62 requires Ask Pluto to avoid stateless search and unsupported citations. A scoped pipeline gives Pluto multi-agent separation of concerns without creating a second memory system or leaking unrelated context into a meeting answer.
- **Consequences:** First-release meeting chat is ephemeral, freezes a bounded active-transcript snapshot at submission, marks provisional evidence as weak, and returns typed answer packets. Zen Quick uses the bounded fast local `askPlutoLive` task with hidden thinking disabled so it can answer conversationally without widening scope or displacing transcription; provider failure returns a clearly labeled, deduplicated transcript fallback instead of presenting raw evidence as an answer. The dock keeps one responsive width across states and follows new turns only while the reader remains near the bottom. Completed-meeting chat remains model-backed; an explicit Deep action in Zen, durable completed-note chat, corrections, and broader project/person/global chat remain later #62/#612 slices.

## 2026-08-18 - Bound oversized meeting notes deterministically

- **Status:** Accepted
- **Source:** [Issue #637](https://github.com/metagrover/pluto/issues/637)
- **Decision:** When the transcript plus grounded topic draft cannot fit the meeting-wide editor's context budget, Pluto deterministically merges related topic clusters down to at most six meeting-level sections. The reducer favors substantive outcomes over housekeeping titles, keeps only a few key points and unresolved questions per section, and preserves grounded decisions and action items.
- **Rationale:** The previous all-or-nothing editor skipped synthesis on a real long meeting and exposed 46 window-level topics as the final overview. A second Qwen generation over the oversized draft repeatedly exceeded practical local-runtime limits, so another model call was not a reliable safety path.
- **Consequences:** Oversized meetings can no longer degrade into an unbounded topic inventory, and the fallback adds no model swap or generation latency. Normal meetings still receive the same Qwen editorial pass. Canonical transcripts and existing saved analyses are not rewritten automatically.

## 2026-08-18 - Make notes the primary meeting workspace

- **Status:** Accepted
- **Source:** [Issue #639](https://github.com/metagrover/pluto/issues/639)
- **Decision:** Pluto follows a Granola-like document model: the scratchpad is primary while recording, completed meetings open on Notes, and Transcript is a secondary tab. Generated notes use a small number of adaptive document sections with decisions, actions, edits, templates, and evidence in context instead of parallel dashboard cards.
- **Rationale:** A transcript-first recording layout and card-heavy analysis made it difficult to capture intent or read the meeting afterward. Long analysis could also expose housekeeping, spelling variants, and an inventory of dozens of topics instead of a useful document.
- **Consequences:** User notes remain autosaved meeting evidence and guide generation; template selection changes emphasis without selecting another model; transcript trust and entity context remain available outside the main reading path; source quotes are disclosed where grounded evidence exists.

## 2026-08-24 - Bound meeting coaching to private, evidence-grounded reflection

- **Status:** Proposed
- **Source:** [Issue #654](https://github.com/metagrover/pluto/issues/654), `docs/superpowers/specs/2026-08-24-evidence-grounded-meeting-coaching-design.md`
- **Decision:** Pluto may offer on-demand coaching through Ask Pluto, meeting-scoped chat, and a Recent Win source moment. Successful responses use a fixed strengths, improvement, evidence, impact, and next-experiment contract. Behavioral and leadership claims require reliable meeting evidence and user attribution; coaching must not infer personality or intent, manufacture praise, score or compare participants, or become employer-facing evaluation.
- **Rationale:** Meeting memory can reduce the effort of useful self-reflection, but unsupported praise and people evaluation would undermine Pluto's trust model and create a surveillance product instead of a private second brain.
- **Consequences:** #62 and #614 remain the retrieval, citation, correction, and conversation foundations. Weak evidence produces constrained coaching rather than generic advice presented as meeting analysis. Longitudinal growth tracking, scoring, and organization-facing analytics remain outside the outcome and require separate consent and quality decisions.

## 2026-08-24 - Bound analysis retries at the provider cancellation boundary

- **Status:** Accepted
- **Source:** [Issue #647](https://github.com/metagrover/pluto/issues/647)
- **Decision:** Every automatic analysis run carries a durable attempt number and a request identity shared by the renderer and Electron main process. Pluto permits at most two automatic analysis attempts for the same downstream failure state. When the analysis-stage deadline expires, the renderer requests cancellation, Electron aborts the active provider request, waits for it to settle, and only then persists a content-free terminal failure. A manual retry starts one new bounded attempt.
- **Rationale:** A renderer-only timeout left the Ollama request running behind the serialized generation gate, while the persisted failed state immediately became eligible for another automatic run. Longer timeouts delayed the collision but did not repair ownership or convergence.
- **Consequences:** Analysis can no longer create an unbounded automatic retry loop or leave an orphaned local generation competing with its replacement. Per-request Ollama timeouts remain bounded, later knowledge stages retain their own deadlines, and Meeting View continues to offer a deliberate retry without exposing transcript content in lifecycle metadata.

## 2026-08-24 - Prefer concise synthesis without weakening evidence safeguards

- **Status:** Accepted
- **Source:** [Issue #656](https://github.com/metagrover/pluto/issues/656)
- **Decision:** Local analysis may use smaller overlapping windows, a non-reasoning coverage check, and a four-key-point cap to reduce repetition. The existing settled-decision, committed-action, unresolved-question, lexical-precision, and exact-evidence rules remain mandatory. The global editorial pass may compress local material but cannot erase grounded local facts or settled items.
- **Rationale:** The preserved experiment identified useful ways to make notes more concise, but its shortened classification policy and removal of local merge safeguards reduced trust and broke the established analysis contract.
- **Consequences:** Coverage-check fields are discarded during parsing and never persisted or rendered. Editorial output remains concise, grounded local material is restored when omitted, foreground LLM work pauses background knowledge synthesis, and generated titles tolerate common model preambles without accepting conversational filler.

## 2026-08-24 - Calibrate cross-channel skew before removing Parakeet bleed

- **Status:** Accepted
- **Source:** [Issue #657](https://github.com/metagrover/pluto/issues/657), `docs/superpowers/specs/2026-08-24-parakeet-cross-channel-skew-dedup-design.md`
- **Decision:** Parakeet finalization may align microphone and System word clocks only when at least three independent, unique four-word anchors form a 75% dominant offset cluster and the absolute offset is no greater than 2.5 seconds. The existing exact consecutive-word collapse then runs first at the original timestamps and, when calibration passes, at the estimated offset. System words are never removed.
- **Rationale:** Real dual-source capture can contain the same playback speech on both channels with a stable delay just outside the direct matcher's tolerance. A larger fixed tolerance would erase legitimate nearby speech, while generic save-time cleanup would mutate canonical evidence without source-clock proof. AEC reduces future acoustic bleed but cannot reliably repair already sealed recordings.
- **Consequences:** Strongly evidenced skewed duplicates are removed during canonical reconciliation, ambiguous overlap remains intact, and content-free calibration provenance is persisted with new final transcripts. Historical Parakeet trust records without this optional provenance remain readable.

## 2026-08-24 - Preserve useful context on an empty daily briefing

- **Status:** Accepted
- **Source:** [Issue #658](https://github.com/metagrover/pluto/issues/658), `docs/superpowers/specs/2026-08-24-useful-empty-dashboard-design.md`
- **Decision:** When no supported item needs attention, Pluto states that once and guides the user through the strongest available real context. If suggested commitments remain, the status is `Nothing urgent`; `You're caught up` is reserved for a genuinely empty review queue. Suggested commitments use progressive disclosure with one resting review action and one primary decision. Recent Win remains a permanent engagement surface, using evidence-backed content when available and a truthful feature preview otherwise. Latest meeting or Knowledge re-entry sits beneath it as secondary context. Initial loading may reserve layout with skeletons; background refreshes preserve the resolved model and do not replace stable status copy.
- **Rationale:** Repeating empty messages across fixed regions made a data-bearing dashboard appear vacant, while a shared loading flag caused routine background meeting updates to flash a global refresh label.
- **Consequences:** Unsupported claims never appear, but Recent Win intentionally reserves a compact space to preserve the product's progress-recognition loop. Suggested commitments remain visibly distinct from confirmed work without presenting adjacent equal-weight decisions or contradicting a caught-up message, and refresh feedback belongs to initial load or the control that initiated a mutation rather than the whole dashboard.

## 2026-08-24 - Separate readable transcript text from canonical evidence

- **Status:** Accepted
- **Source:** [Issue #659](https://github.com/metagrover/pluto/issues/659), `docs/superpowers/specs/2026-08-24-readable-finalized-transcripts-design.md`
- **Decision:** Pluto removes exact same-source duplicates and strictly evidenced embedded one-letter microphone artifacts during final canonical reconciliation. Ordinary `um` and `uh` disfluencies remain in persisted transcript evidence and are suppressed only through a pure readable projection used by Meeting View and downstream text analysis.
- **Rationale:** Cross-channel reconciliation can prove some fragments are pipeline artifacts, but transcript text alone cannot prove whether an ordinary disfluency was spoken. Enabling generic save-time cleanup would improve appearance by silently rewriting evidence and could erase genuine meaning.
- **Consequences:** Existing meetings become easier to read without database rewrites, new transcripts persist content-free readability counts, analysis and title generation receive the same clean projection, and canonical timestamps, word arrays, raw audio, and source provenance remain available for evidence review.

## 2026-08-24 - Review suggested commitments beside persisted source synthesis

- **Status:** Accepted
- **Source:** [Issue #660](https://github.com/metagrover/pluto/issues/660)
- **Decision:** Suggested commitments use a single-open editorial accordion. Compact rows act as the disclosure control without repeated status pills or review buttons. The active row shows one clamped line from the best persisted source synthesis available; that line itself opens the source meeting. The active row then presents one primary `Add commitment` action and a quiet `Dismiss` action. Possible and confirmed work keep separate projection budgets, and a newly accepted suggestion moves to the top of `My commitments` with a brief `Added` acknowledgement. Confirmed commitments use one empty completion circle, omit the default `Active` badge, preserve a quiet source-meeting link, and place attention lifecycle actions in a keyboard-accessible secondary menu. The suggestions queue stays open by default when present.
- **Rationale:** A meeting link and provenance label did not provide enough context to decide whether an uncertain extraction should become a commitment. Requiring navigation before each decision hid Pluto's existing synthesis and made the review queue feel incomplete.
- **Consequences:** Dashboard review does not regenerate analysis or infer missing support. Topic summaries may provide the inline line when safely matched, otherwise the meeting overview is used. Full evidence stays in the meeting instead of expanding the dashboard queue, malformed or missing context is described truthfully, and confirmation and rejection keep their existing persistence contract. The general action-insight list remains bounded without hiding a just-confirmed commitment from its dedicated section. Routine commitment rows remain dense and calm, while overdue, stale, blocked, and newly added states retain explicit feedback.

## 2026-08-25 - Separate recording start, capture, and finalization presentation states

- **Status:** Accepted
- **Source:** [Issue #664](https://github.com/metagrover/pluto/issues/664), `docs/superpowers/specs/2026-08-25-trustworthy-recording-loop-design.md`
- **Decision:** Recording startup publishes a finite `starting` state before asynchronous local admission. Accepted stop freezes the visible meeting clock and immediately replaces the live workspace with a local document-shaped pending view; persisted Meeting View replaces it when provisional save completes. Live and saved transcript presentation may split long same-speaker runs at bounded time and character limits, but cannot rewrite canonical segments, words, timestamps, or speaker evidence.
- **Rationale:** A click without feedback resembles failure, a live timer after stop falsely implies capture continues, and unbounded same-speaker merging hides otherwise available punctuation and turns in walls of text.
- **Consequences:** Startup, recording, and finalization are honest user-visible phases. Users can leave finalization running without remaining trapped in capture UI, while canonical audio, transcript integrity, and downstream analysis contracts remain unchanged.

## 2026-08-25 - Make capture ownership independent from post-meeting intelligence

- **Status:** Accepted
- **Source:** [Issue #664](https://github.com/metagrover/pluto/issues/664), [Issue #663](https://github.com/metagrover/pluto/issues/663), and [Issue #647](https://github.com/metagrover/pluto/issues/647)
- **Decision:** One capture lifecycle controls the sidebar action, keyboard admission, unload protection, and renderer start guard. A stopped meeting releases that lifecycle only after its journal is sealed and a provisional row is durable; audio materialization and intelligence then continue without owning capture. On local Ollama, foreground meeting work may cooperatively preempt background knowledge generation, but the next request starts only after the aborted transport settles.
- **Rationale:** Analysis and materialization are not recording. Treating them as capture prevented back-to-back meetings, while queue priority alone left active knowledge generation free to consume its full timeout before analysis could begin.
- **Consequences:** New recording remains available during prior-meeting processing. Preempted knowledge documents become stale and resume through their normal queue rather than surfacing as failures. Transcript punctuation and neutral labels remain presentation concerns; raw recognizer text stays available for canonical persistence.

## 2026-08-25 - Resolve Ask Pluto's current meeting at query submission

- **Status:** Accepted
- **Source:** [Issue #62](https://github.com/metagrover/pluto/issues/62), `docs/superpowers/specs/2026-08-25-adaptive-reliable-ask-pluto.md`
- **Decision:** Ask Pluto resolves `current meeting` to the active recording when one exists and otherwise to the most recently started persisted meeting, including a meeting that is still processing or failed. Each request freezes that scope and its available evidence at submission. A later explicit reference to current/latest resolves again, while referential follow-ups inherit the prior resolved scope. Straightforward retrieval uses a fast non-thinking path; cross-meeting comparison, conflict, trend, rationale, risk, and advice use bounded deep reasoning.
- **Rationale:** Treating current meeting as only the selected or latest completed record makes the same phrase change meaning across recording, meeting view, and global chat. A blanket thinking choice also trades away either responsiveness or the synthesis required for cross-meeting questions without repairing missing context.
- **Consequences:** Live and processing evidence remains visibly provisional rather than silently falling back to an older meeting. The active meeting is pinned during current-versus-history retrieval, Ask Pluto carries bounded conversation and citations, and foreground queries must have a cancellable, observable lifecycle that can preempt background knowledge synthesis.

## 2026-08-25 - Bound Ask Pluto depth by visible-answer latency

- **Status:** Accepted
- **Source:** [Issue #62](https://github.com/metagrover/pluto/issues/62), `docs/superpowers/specs/2026-08-25-adaptive-reliable-ask-pluto.md`
- **Decision:** Synchronous Ask Pluto uses deterministic intent routing and disables hidden Qwen 3.5 thinking in both Fast and Deep modes. Deep retains a 16K context, a 2,048-token answer budget, pinned cross-meeting evidence, and stricter comparative citation requirements. Hidden thinking may return only if the local runtime exposes a reliably bounded budget that meets the visible-first-token contract.
- **Rationale:** On the target 16 GB machine, model classification added roughly nine seconds before every answer. A 2,048-token Deep thinking run produced no visible answer, and a 4,096-token run required 124,297 ms for its first visible token. Evidence-structured non-thinking Deep synthesis met both the latency and grounded-content benchmark.
- **Consequences:** Deep remains a product-level reasoning and retrieval mode rather than a transport-level chain-of-thought switch. Ask Pluto avoids a second classification generation, pauses background knowledge synthesis for the visible chat session, preempts background title work, keeps direct and cited follow-up prompts on frozen evidence, and does not trade live-chat reliability for hidden reasoning tokens.

## 2026-08-25 - Make development startup own recording readiness

- **Status:** Accepted
- **Source:** [Issue #650](https://github.com/metagrover/pluto/issues/650)
- **Decision:** `pnpm run dev` is the authoritative contributor startup command. Before Vite launches, it opens an in-memory database through Electron to verify the `better-sqlite3` ABI and conditionally rebuilds an incompatible binding, then builds any missing, unsigned, or stale Parakeet runtime, resource probe, and audio-capture executable. Model acquisition remains inside Pluto: the readiness status probe is read-only, while the explicit setup preparation downloads, loads, and verifies the pinned Parakeet ASR, CTC, and EOU bundle before the workspace is revealed. The preparation surface reports the exact pinned bundle size, aggregate downloaded bytes, and observed transfer speed, then labels integrity verification separately.
- **Rationale:** A clean checkout could build Parakeet but omit `audiocap`, leaving setup permanently blocked. The previous status probe also performed the large model download while the UI still said it was checking, making healthy first-run work look frozen.
- **Consequences:** Contributors no longer run `build-native` separately before development. Repeated startup skips current signed executables, packaged apps continue to bundle their native runtimes, and first-run model work remains measurable, visible, and retryable in setup and returning-user readiness surfaces.

## 2026-08-25 - Preserve Ask Pluto conversation text and structured scope

- **Status:** Accepted
- **Source:** [Issue #667](https://github.com/metagrover/pluto/issues/667), follow-up to [Issue #62](https://github.com/metagrover/pluto/issues/62)
- **Decision:** Ask Pluto carries both bounded conversation text and typed resolved scope on every assistant turn, including no-evidence and partial outcomes. Explicit current or temporal language resolves a new scope; referential and diagnostic follow-ups inherit the prior scope independently of citations. Relative dates use half-open local-calendar ranges before relevance ranking, and no-evidence remains an outcome rather than a trust state.
- **Rationale:** Conversation prose preserves meaning, but citations alone cannot preserve the scope of a refusal. Treating `today` or `what went wrong here` as global transcript keywords allowed old unrelated meetings to displace the user's intended context and made an abstention appear grounded.
- **Consequences:** Date-scoped retrieval cannot escape its selected meetings, diagnostic follow-ups explain the preceding result without running an unrelated search, and unsupported generated claims are removed before display. Provider tokens remain buffered at the trust boundary; only complete claims whose source references pass the final citation audit may stream into the chat. Meeting search remains derived data with one idempotently refreshed FTS document per canonical meeting.

## 2026-08-25 - Size Ask Pluto generation to supported chat output

- **Status:** Accepted
- **Source:** [Issue #667](https://github.com/metagrover/pluto/issues/667), follow-up to [Issue #62](https://github.com/metagrover/pluto/issues/62)
- **Decision:** Ask Pluto deduplicates all pinned retrieval sources by meeting ID before prompt assembly. Evidence excerpts are selected at sentence granularity so validation retains the passage that actually supports a claim, including support late in persisted analysis text. Local Fast generation can use an independently configured smaller chat model with a 4K minimum context and 192-token output budget. Deep continues to use the primary analysis model, starts at 4K, grows only with prompt size to a 12K cap, and uses a 256-token output budget. Both modes disable hidden thinking and keep deterministic routing. Large-scope prompts omit empty structured fields, cap aggregate evidence at 6,400 characters, and ask for no more than two rich, self-contained points.
- **Rationale:** Active use-case testing showed a 20-meeting temporal follow-up expanding to 40 context items, long evidence lines losing the supporting passage after a fixed prefix truncation, and 11–50 second answers that still collapsed to no evidence. The previous fixed 16K/2,048 Deep allocation paid for capacity that concise, citation-grounded chat should not consume.
- **Consequences:** Referential temporal queries carry each meeting once, supported bullets and comparisons survive validation more often, and local generation has less prompt and output work. A small Fast model can answer routine questions without displacing the larger model used for meeting preparation and Deep comparisons. Unsupported or contextless claims remain omitted, and cited bullets may stream as soon as their references pass validation even when the model omits terminal punctuation.
- **Usefulness boundary:** Summary and “what happened” requests reuse completed named-meeting analysis directly when it is already available. They do not spend model time paraphrasing prepared notes, and they omit generic-title analysis whose subject remains ambiguous. Follow-ups and comparisons still use bounded conversation-aware model synthesis.

## 2026-08-25 - Make Today's focus the dashboard's only daily priority surface

- **Status:** Accepted
- **Source:** [Issue #668](https://github.com/metagrover/pluto/issues/668)
- **Decision:** The dashboard anchors the daily ritual on the current date and one ordered list named `Today's focus`. The list remains capped at three, but the label emphasizes intent rather than turning Pluto into a generic task manager or requiring users to understand the three-item ritual before using it. Urgency remains an attribute Pluto may use when proposing priorities, not a competing top-level section. Users can author, reorder, and replace the three priorities; the order persists as date-scoped entity metadata and expires naturally on the next local calendar day. When no priorities exist, the former calm `Nothing urgent` treatment becomes the spacious empty state inside `Today's focus`, led by a project-owned gender-neutral relaxation illustration that is decorative to assistive technology.
- **Rationale:** A separate urgent surface made its relationship to the daily three unclear and forced users to reconcile two priority systems. A bounded, user-correctable list makes Pluto's recommendation legible while preserving user agency and a calm empty day.
- **Consequences:** Confirmed commitments outside the three remain available as a quiet backlog, no more than one fresh meeting suggestion appears at a time, and repeated generic category labels are removed. Five recorded meetings is an onboarding checkpoint that sets expectations for when Pluto can begin identifying positive events; it is never presented as a win. Recent Win and its reduced-motion-aware celebration appear only for supported meeting evidence such as praise, delivered work, closed business, or revenue won.

## 2026-08-26 - Separate valid analysis structure from trustworthy synthesis

- **Status:** Accepted
- **Source:** [Issue #671](https://github.com/metagrover/pluto/issues/671), follow-up to [Issue #594](https://github.com/metagrover/pluto/issues/594), [Issue #627](https://github.com/metagrover/pluto/issues/627), and [Issue #637](https://github.com/metagrover/pluto/issues/637)
- **Decision:** A structurally valid meeting-analysis document may remain usable when meeting-wide consolidation is limited or generated commitments fail transcript grounding, but Pluto must persist a privacy-safe quality issue and disclose that limitation in Meeting View. Deterministic oversized compaction treats generic empty-analysis prose as absence, never as substantive content, while preserving any grounded decision, action, or open question attached to the topic. Settled-item wording reuses the evidence clause's distinctive vocabulary, and ambiguous internal terms remain unexpanded unless repeated context or user notes confirm the correction.
- **Rationale:** Valid JSON proves that the document can be parsed, not that it is complete or appropriately certain. Silently presenting generic empty summaries, synonym-heavy commitments that grounding must discard, or confident terminology guesses undermines the evidence boundary even when formatting succeeds.
- **Consequences:** Long local analyses remain concise without allowing canned absence language to displace real content. Tentative targets, forecasts, recommendations, and possible consequences retain their modality. Usable degraded notes remain visible, exact-evidence requirements stay unchanged, and users receive one calm notice instead of either false confidence or a total analysis failure.

## 2026-08-26 - Reconcile dual-source live text as a reading projection

- **Status:** Accepted
- **Source:** [Issue #670](https://github.com/metagrover/pluto/issues/670)
- **Decision:** The live transcript presents microphone audio as `You` and computer audio as `Call` in one chronological feed. Source-local EOU token clocks are projected onto the meeting clock before comparison. Only strongly aligned microphone echo with remote-dominant acoustic activity is hidden from the reading surface; raw source rows remain available to provisional persistence and final canonical reconciliation. Committed punctuation and bounded paragraphs are presentation-only, and only the newest tentative source tail remains visible.
- **Rationale:** Identical `Speaker` labels, independent source clocks, loudspeaker bleed, mutable competing tails, and oversized recognition rows made the transcript difficult to follow during a meeting. A visible `Unclear` label or aggressive best-source guess would expose implementation uncertainty without improving comprehension and could erase genuine local interruptions.
- **Consequences:** The reader stays stable and source-legible without claiming remote diarization. Short, fuzzy, locally dominant, or otherwise ambiguous overlap remains visible rather than being silently removed. Final transcript evidence and its stricter reconciliation policy remain unchanged; live punctuation cannot add, remove, or reorder recognized words.

## 2026-08-26 - Derive commitment ownership from transcript evidence

- **Status:** Accepted
- **Source:** [Issue #673](https://github.com/metagrover/pluto/issues/673), follow-up to [Issue #672](https://github.com/metagrover/pluto/issues/672)
- **Decision:** Meeting analysis stores action ownership separately from action wording. Action text is normalized to a bare task phrase before evidence matching, while explicit first-person commitments derive their owner from the evidence turn's speaker, named third-person assignments retain the named owner, and explicit first-person-plural commitments use a collective owner. Generic `team` ownership is never accepted as a fallback, and unresolved ownership remains empty.
- **Rationale:** Prompt instructions alone did not prevent local models from producing phrases such as `the team will`, and literal-name grounding discarded clear ownership when the evidence was expressed as `I will` under a speaker label. Separating the task from its actor lets deterministic grounding correct model phrasing without rewriting transcript evidence.
- **Consequences:** Action rows remain concise and attributable across meeting types. Incorrect model-provided owners are replaced only when the evidence turn establishes a different owner and continue to emit an unsupported-owner quality category. Suggestions, passive needs, and unaccepted requests remain outside the commitment list; canonical transcript text and quoted evidence remain unchanged.

## 2026-08-26 - Write meeting notes once and audit against original source

- **Status:** Accepted; latest approved delivery policy below supersedes the earlier perfection-based promotion gates. Release evidence is tracked separately.
- **Source:** [Issue #674](https://github.com/metagrover/pluto/issues/674), following [#672](https://github.com/metagrover/pluto/issues/672) and [#673](https://github.com/metagrover/pluto/issues/673)
- **Decision:** Replace provider-mandated local topic fragmentation with a capacity-routed workflow: one source-linked writer and one bounded source audit when the conversation fits; source-preserving hierarchical processing only for oversized inputs. The audit can recover omitted commitments, correct narrative meaning and attribution, and propose grounded terminology aliases. Code applies constrained changes and derives the existing v3 rollups. Keep the configured analysis model, immutable original evidence, and general-purpose meeting scope.
- **Rationale:** The reviewed notes had zero actions despite explicit promises, overstated conditional advice, and confused chronology. More prompt clauses and deterministic ownership cleanup cannot recover information that was omitted or fix misleading summaries outside the action array. Source-grounded review is a bounded responsibility, not an open-ended self-correction loop or an intermediate fact database that replaces access to the conversation.
- **Consequences:** The local implementation uses one capacity policy, source-linked hierarchy, revision-checked publication, edit reconciliation, and separately retryable secondary intelligence. Failed audits retain existing notes; failed extraction is not empty success. Real-provider verification remains a delivery gate: well-formed output did not establish commitment recall, and current runtime contention prevents a clean latency comparison. The user's running app and production database remain unchanged.
- **Implementation refinement (2026-08-27):** Model-facing references are opaque request-local labels, expanded by code to exact original spans and validated against the allowed source set. This removes model arithmetic without relaxing evidence. A strict JSON-schema grammar experiment was rejected after three synthetic recall failures; bounded JSON parsing/repair remains. The current audit prompt includes distinct narrative and complete-item replacement examples. No trusted glossary is inferred from model confidence.
- **Audit-kind correction (2026-08-27):** A complete, source-reviewed NotesItem may be reclassified between point/action/decision/question. Rejecting all kind changes prevented the audit from correcting conditional discussion and withdrawals. Narrative/title-to-item shape mismatches remain invalid; promoted commitments still pass owner/date/modality checks, and hierarchy still requires explicit conservation/dispositions. Concrete writer examples were removed after a synthetic run copied one as an unsourced claim; the source gate rejected that output.
- **Approved accuracy-first revision (2026-08-27):** Replace the patch/verdict audit with a complete source-based editor only after independent semantic acceptance. Accuracy, readable coverage and reliability take priority over latency; the former 30-second acceptance target is superseded. The editor remains an internal opt-in prototype because real-provider tests still miss conditional promises and retain unaccepted or withdrawn commitments. Unit tests validate mechanics, not semantic quality. Neither reasoning nor hiding draft classifications resolved the failures. A successful simple prose diagnostic prevents attributing these failures to universal model incapability. Further pipeline-stage or model changes require a new bounded decision; no promotion, production regeneration, merge or push is authorized by this checkpoint.
- **Approved source-reconciliation evaluation (2026-08-27):** The user authorized a focused source-only stage before prose composition, superseding the fixed two-pass constraint. The flat reconciler and independent raw-output harness were implemented, but baseline, grammar-free and documented Qwen sampling profiles all failed the first three semantic cases. The prototype is not integrated. Structural review and unit success do not override action/withdrawal errors; retain the exact failing artifacts and evaluate a different generation model/runtime only with authorization. No production model or notes were changed.
- **Approved alternative-model evaluation (2026-08-27):** Evaluate feasible local alternatives using synthetic sources only, with the same prompt, source contract and independent semantic fixtures; do not switch the production default. Record model digests, inherited sampling settings, raw responses and the first failure stage. A guard rejection is not automatically a semantic failure: separately document demonstrable validator false positives and taxonomy disagreements. The reproduced equivalent-condition vocabulary gap is corrected with positive and negative regression tests, without rewriting model output or weakening the independent semantic gates. See `docs/superpowers/plans/2026-08-27-meeting-model-evaluation.md` for measured results and the production-promotion boundary.
- **User-confirmed local-only scope (2026-08-27):** The user declined API models. Continue within local models; a hosted-provider key or reference run is not a prerequisite. The next requested work is a holistic prompt review with concise general guidance, a few contrasting examples and targeted omission/condition safeguards. That design is pending approval; no model switch, new download, production regeneration or additional pipeline stage is implied. Preserve previous evaluation evidence and distinguish mechanically enforceable checks from semantic completeness that still requires local-model verification.
- **Approved compact local guidance and checks (2026-08-27):** The user approved the shared general content policy, three contrasting examples, source-based omission/conflict checks, commitment preservation and one bounded correction attempt described in `docs/superpowers/specs/2026-08-27-local-notes-guardrails-design.md`. Implement on the isolated #674 branch with local synthetic evaluation. Explicit choices not to proceed may be decisions; merely lacking an assignment is not itself a decision. No default-model switch or production regeneration is authorized by implementation approval.
- **Compact guidance implementation (2026-08-27):** Shared the three-example policy across stages, clarified the flat response schema, and connected conservative source-derived omission/condition/cancellation signals to the existing single repair per stage. Composition must conserve already-grounded commitments exactly; unresolved failures do not publish partial success. Explicit negative choices retain their predicate, prerequisites and recipient scope. Prompt/cache identity advances to notes-v12 (audit) and notes-v13 (editor), with legacy readers unchanged. The small lexical guardrail deliberately abstains on recognized compound conditional promises and does not establish semantic completeness. Final local evidence is recorded in `docs/superpowers/plans/2026-08-27-local-notes-guardrails-evaluation.md`; no hosted baseline, model promotion, production regeneration, merge or push is part of this checkpoint.
- **Supported-commitment preservation (2026-08-27):** Fresh Gemma output retained a privacy policy and its audit approved it, but deterministic grounding silently discarded it because permission wording used “may”. Retained audit-supported actions/decisions now require repair or explicit failure when grounding disagrees; unsupported/uncertain audit removals remain explicit. A decision-only, full-normalized-source-copy allowance recognises an initial “The decision is” statement without changing global action-resolution cues, and rejects tentative or unfinished decision status while preserving actual policy prerequisites. The exact captured response is a regression fixture. This closes a demonstrated code-loss path; it does not solve remaining model formatting or coverage failures.
- **Local schema-constrained notes (2026-08-27):** Gemma 4 12B is the primary local evaluation candidate, not a newly promoted production default. Local notes generation now supplies stage-specific JSON schemas to Ollama, including exact request-local source labels, while hosted/non-notes requests retain their prior behavior. Writer/merge, audit and optional editor response contracts are selected explicitly and retained through the existing single repair. The compact prompt, parsers, semantic grounding and original transcript remain unchanged. Shared notes-v14/v15 identities invalidate pre-schema generation/cache fingerprints without changing legacy readers. Structural conformity does not certify completeness or truth; prospective two-seed synthetic evaluation is recorded separately in `docs/superpowers/plans/2026-08-27-gemma-schema-evaluation.md`.
- **Captured-output validation corrections (2026-08-27):** Frozen Gemma schema evaluation returned 20 structurally conforming responses, but only 3/8 final documents: four validation failures and one audit timeout. Exact captured replays reproduced code false positives in rejected-offer condition scope, explicit promise withdrawal, repeated-recipient purpose clauses and abbreviated explicit-decision framing. Correct these narrowly, preserving original output/citations and actor, recipient, prerequisite and polarity checks; ambiguous extra offers or promises must not disappear into a scoped-away clause. Shared identities advance to notes-v16/v17 and guardrails-v2/schema-v1; the compact three-example prompt and inference-stage budget remain unchanged. Replay success does not rescore the frozen runs. Narrative omissions and a pre-existing permissive standalone action-grounding control remain separate acceptance gaps; the model stays unpromoted and the local implementation remains unshipped.
- **PR completion hardening (2026-08-27):** Resume the approved local-only scope in PR #676. Reject complete copied conditional offers when unrelated resolution is borrowed, require body/overview coverage for explicit unambiguous promise withdrawals, and prefer a topic's first reviewed outcome in the three-item fallback overview without losing narrative-only topics or provenance. Capture secondary retry rows after asynchronous initialization. Title-only compare-and-set writes preserve drafts on conflict and invalidate old async sessions across navigation/unmount; failed regeneration retains published notes. Compact general guidance now explicitly preserves attributed feelings/reasons and asks audits to retain withdrawal discussion, without adding stages or retries. Notes-v22/v23 and guardrails-v3/schema-v1 distinguish the corrected generation. Fixed-seed raw evaluations and isolated synthetic Electron QA are recorded separately; none certifies real-recording/hierarchy fidelity or authorizes production model promotion. PR remains draft while release gates are open.
- **Final fidelity continuation (2026-08-27):** Preserve every material operation and current status, explicit offer dispositions, and source-supported person references in the compact shared policy (notes-v24/v25). Full-PR review also corrected the automatic-secondary snapshot race, Unicode partition progress, actual local-model identity across stage requests, and private bounded Electron HTTP-error classification. A proposed canonical withdrawal polarity witness was implemented experimentally but failed independent adversarial review on later restarts and unresolved references. Remove it; do not treat selected passing tests as a finality guarantee or expand a fixture-shaped whitelist. Retain guardrails-v3 and the existing one-repair fail-closed path. A citation-repair alternative needs revised approval; no extra stage, retry, model promotion, production regeneration, or merge is implied.
- **Bounded relative improvement (2026-08-27):** The user approved improving the existing audit/repair and accepts meaningful progress over the previous model/prompt without requiring perfection. Freeze one notes-v26/v27 correction revision; retain guardrails-v3, all source/repair limits and historical results. Compare the actual previous Qwen/notes-v9 system with the candidate on identical original conversations, preserving each system's production defaults and all failures. Review practical latency, material completeness and correctness separately; new serious task/ownership/condition/reversal errors block promotion, while smaller documented gaps may become follow-up work. Do not infer model-only causality from a whole-system comparison, silently change the production model, or start another tuning loop after the bounded results. See the relative-comparison plan for the stop/ship decision.
- **Approved useful local baseline (2026-08-28):** The user explicitly approved shipping incremental improvement with Gemma 4 12B for meeting notes, rather than continuing model comparisons or requiring perfect output. Keep the existing writer/audit and one correction attempt. On the repaired local production audit, recognized content-quality disagreements become recorded warnings and unverifiable or source-conflicting confirmed tasks/decisions are excluded. Missing coverage is not repaired by inventing content. Complete the entire source hierarchy before publication and preserve warnings from every section. Schema, audit-contract, source-reference, cancellation, transport and capacity failures still fail; hosted and opt-in editor behavior remain strict. The shared notes-v28/model identity applies to requests, metadata and run reuse; generic model settings and non-note tasks are unchanged. No model download, settings/database rewrite or production regeneration is part of this change. Saved-response replay proves code behavior only, not new model quality or complete output for previously interrupted private meetings. See `docs/superpowers/specs/2026-08-28-recoverable-local-notes-design.md` and the linked issue approval. Earlier evaluation scores and decisions remain historical evidence, not current promotion requirements.

## 2026-08-27 - Ship Ask Pluto assistance modes independently

- **Status:** Accepted
- **Source:** [Issue #614](https://github.com/metagrover/pluto/issues/614), `docs/superpowers/specs/2026-08-26-zen-ask-pluto-chat-design.md`
- **Decision:** Meeting Ask Pluto grows through independently testable assistance modes: Recall, Understand, Advise, Organize, Create, Act, and Clarify. Recall ships first and deterministically distinguishes catch-up, factual, decision, and action recall without a second model request. Its route adds an evidence-first policy to the existing bounded meeting prompt; unsupported future modes continue through general meeting chat until their own contracts ship.
- **Rationale:** A generic prompt can answer a transcript question but does not reliably identify the job the user needs done. One model call solely for classification would add latency and compete with live transcription, while shipping all assistant behaviors together would make grounding and product quality difficult to evaluate.
- **Consequences:** Recall answers lead with supported meeting facts, distinguish decisions from proposals, avoid invented exact quotes, and omit unsupported owners or deadlines. Future modes may add deeper reasoning, context, or tools one at a time without widening the first Recall slice. The Zen dock remains right-aligned and keeps its minimized choice for the lifetime of the active recording session.

## 2026-08-27 - Keep meeting context embedded, source-linked, and append-only

- **Status:** Accepted
- **Source:** [Issue #614](https://github.com/metagrover/pluto/issues/614), `docs/superpowers/specs/2026-08-26-zen-ask-pluto-chat-design.md`
- **Decision:** Pluto stores structured meeting-context events and versioned rolling snapshots in its existing embedded SQLite database. Every event has a stable meeting-scoped key and one or more transcript-segment references; retries return the original row instead of rewriting it. Rolling state is stored as immutable revisions, with unchanged states reusing the latest revision. Active-meeting rows do not require a pre-existing persisted meeting record.
- **Rationale:** Ask Pluto needs sequential context that can survive long or noisy calls without repeatedly sending the full transcript, but a separate service, vector database, or model request would add avoidable runtime and deployment cost. Source linkage and immutable history preserve the ability to audit or correct derived context later.
- **Consequences:** The schema can accept context while capture is active, isolate it by meeting, and support future incremental reducers and bounded retrieval. This foundation does not yet extract events, build snapshots automatically, alter Ask Pluto prompts, or make answers more intelligent; those producers and consumers ship as separately tested slices.

## 2026-08-28 - Reconcile commitments by obligation meaning

- **Status:** Accepted.
- **Source:** [Issue #679](https://github.com/metagrover/pluto/issues/679), user-approved semantic comparison and reversible pending-queue cleanup.
- **Decision:** Before publishing extracted commitments, compare them with pending and reviewed history through a bounded, schema-validated provider pass. Equivalence requires the same obligation, including owner, outcome, deliverable, source/project and temporal scope. Text overlap does not establish identity. Exact retry aliases include source context; otherwise the semantic pass decides.
- **Rationale:** Regeneration rephrases tasks, so description hashes alone repeatedly reopened confirmed and dismissed obligations. Similar wording can also describe genuinely different tasks.
- **Consequences:** Reuse canonical entities without overwriting edits, completion or review state. Retain original extraction descriptions as durable aliases. Retire only unreviewed extracted duplicates; restoration restores the source record and removes unsupported alias-created associations. Uncertain matches stay separate. Invalid responses, cancellation, source changes and concurrent user edits prevent stale publication and remain retryable. Semantic model acceptance is distinct from structural/unit-test success.
- **Local-model isolation:** Real Qwen evaluation exposed cross-candidate contamination despite valid JSON and IDs: the model borrowed a review action from another candidate while judging a publishing action. Assess one candidate per inference, with earlier incoming commitments appended after established history. A validated identity match ends that candidate's search in canonical-preference order; unmatched and uncertain candidates search all history without text-overlap filtering.
- **Real-data safety gate:** A private preview also proposed merging distinct actions because they shared meeting context; none of that preview was applied. Every proposed identity needs a fresh one-to-one fulfillment check. Unresolved owner identities remain separate, and reviewed status cannot override scope or ownership conflicts. Failed verification continues the search for another match. Maintenance plans carry a review-contract version so older unverified proposals cannot be applied.

## 2026-08-28 - Evidence-backed identity and optional About you profile

- **Status:** Accepted.
- **Source:** [Issue #679](https://github.com/metagrover/pluto/issues/679), approved general identity resolution and approachable onboarding/profile extension.
- **Decision:** Resolve ownership to stable, workspace-local person IDs before semantic commitment comparison. Store explicit meeting speaker corrections, immutable capture-time self provenance, and independently verified source evidence. Names, roles, team membership and generic channel labels never establish identity alone. Preserve uncertainty instead of silently merging people.
- **Profile UX:** Add one skippable About you screen to onboarding, reuse it in Settings, and offer existing users a dismissible invitation. Capture preferred/alternate names plus optional work, study or personal use, role/field and industry. Keep aliases person-scoped; context-only and skipped profiles are valid. Do not hardcode personal identities or infer profile settings from developer conversations or operating-system names.
- **Scope:** Declared aliases inform source-grounded identity interpretation. Work/study context is stored but does not enter identity prompts or change transcription/terminology processing in this release. Terminology adaptation requires a separately validated follow-up. Configured model providers may receive relevant identity candidate names; local storage is not a promise that all processing remains local.
- **Lifecycle:** Revisioned, resumable background jobs re-evaluate affected extraction suggestions and reversible aliases after source or identity corrections. Foreground work preempts these jobs. Retain reviewed records and raw evidence; revoke unsupported derived aliases safely. Source deletion removes cached source quotes and capture provenance, while unrelated meeting deletion preserves people referenced by surviving identity records.

## 2026-08-28 - Use Gemma 4 generally and Phi only for Quick chat

- **Status:** Accepted.
- **Source:** [Issue #681](https://github.com/metagrover/pluto/issues/681), user-directed model routing update.
- **Decision:** `gemma4:12b` is Pluto's default local model for all general-purpose text intelligence, including meeting preparation, commitment and identity reconciliation, titles, entities, knowledge synthesis, and Deep Ask Pluto. `phi4-mini:3.8b` is the default only for Quick Ask Pluto and its intent-classification request. Explicit configured general and fast-model overrides remain supported.
- **Rationale:** The earlier task-independent Qwen default outlived the approved Gemma notes direction and caused new general-purpose evaluations to inherit Qwen accidentally. Picking an arbitrary installed text model also made blank settings nondeterministic.
- **Consequences:** Blank model settings now have stable product meaning instead of auto-detection. Pluto does not silently substitute Qwen or another installed model when Gemma or Phi is absent; the missing configured default surfaces through the existing provider error path. Historical Qwen comparison fixtures remain evidence, not current defaults.

## 2026-08-27 - Preserve both sides of the live conversation

- **Status:** Accepted; supersedes the newest-tentative-only and remote-volume-veto portions of the August 26 #670 reading projection decision.
- **Source:** [Issue #670](https://github.com/metagrover/pluto/issues/670), user-approved repair after the August 27 recording review.
- **Decision:** Distinct provisional speech from both sources remains visible. Every new utterance may complete without clearing cumulative native text, tokens, decoder state, or meeting-relative timing. Microphone volume is supporting evidence for short exact matches, not proof that a long duplicate is local speech. Echo suppression requires ordered containment with aligned boundaries and preserves contradictory numbers/negations and unmatched local words. Without reliable word-level alignment, a partly matching mic segment stays visible in full.
- **Live-edge refinement:** Committed history always renders before mutable source tails, regardless of the tails' first-token timestamps. Tentative turns keep their evidence timestamp but display `Live` instead of an unexplained backwards clock value. If the EOU model leaves append-only partial text open for 45 seconds, Pluto checkpoints only through the last proven SentencePiece word boundary and keeps the unfinished word provisional. Native EOU callbacks use the same boundary rule, holding their final word until a later word-start token proves the committed prefix immutable. Pending time advances on every audio frame, including callback-free silence, and ordered callback batches let a partial trailing an EOU start a fresh pending run. The decoder, token timing, raw audio, and final-transcription path remain unchanged.
- **Rationale:** The previous one-tail policy hid call content. A one-way native EOU latch accumulated long mutable transcripts after the first utterance, while RMS dominance confused loudspeaker bleed with the user's voice. Re-arming fixed the latch but did not guarantee timely EOU boundaries in a long real meeting, so 23-minute provisional buffers still appeared above newer statements. Aggressive fuzzy suppression could also hide a real correction.
- **Consequences:** Completeness takes priority over removing every duplicate. Raw evidence and finalization remain unchanged, and each source can retain one unfinished word at the live edge rather than committing a subword fragment. Repeated-utterance, word-safe bounded-no-EOU, callback-free silence, ordered-batch, intermediate-visibility, one-edge ordering, rendered live-label, and contradiction regressions supplement real-audio replay; a rendered long loudspeaker call remains a separate acceptance gate before #670 can close.

## 2026-08-28 - Qualify project scope before presenting a project

- **Status:** Accepted.
- **Source:** [Issue #677](https://github.com/metagrover/pluto/issues/677), user-approved Projects repair.
- **Decision:** An automatically qualified project needs an independent outcome and at least two distinct constituent work items, grounded in source quotations. Classification is separate from lifecycle. Missing tasks cannot imply completion. Task/topic scope and uncertain legacy entries remain accessible outside the primary overview; user-confirmed scope takes precedence.
- **Rationale:** Named activities and recurring topics were being promoted into projects without evidence of independent scope. Co-occurrence links then made unsupported organization appear authoritative.
- **Consequences:** Extraction and bounded legacy review share the same validation boundary. Review updates metadata, preserves entity identities and source material, and retries transient failures. It checks for concurrent source and entity changes before saving. Parent grouping requires a known qualified parent and a direct source statement. Uncertainty is retained rather than replaced by heuristic name-based merges. Project dossiers show actual scope and source meetings instead of permanent loading placeholders.

- **Project review failure isolation (#677, 2026-08-28):** A malformed or truncated candidate response is a retryable review failure, never a completed classification. Constrain request-local candidate/source IDs with a JSON schema and validate the response at runtime. Continue other candidates once per overview session, reconcile exclusions against refreshed data, and retry skipped records only on explicit Retry. Infrastructure failures stop the run. Preserve source-grounding requirements and user corrections; incomplete review copy must not imply active discovery or an empty corpus.
- **Project review history and retry refinement (#677, 2026-08-28):** Review scope from bounded relevant excerpts across all linked validated conversation history, while validating quotations against the complete selected source. A legacy unresolved result receives one pass under the current review contract. Model uncertainty, evidence rejection, missing sources, and malformed output retain distinct reasons; malformed output records a failed attempt without becoming a qualification. Each candidate is attempted once per pass, and current-contract unresolved results wait for explicit Retry across navigation or reload. Entity, source, and user corrections always win over an in-flight result.
- **Scope-review capacity refinement (#677, 2026-08-28):** Schema-constrained Ollama generation can buffer until a complete JSON object closes. Give project-scope review a bounded three-minute first-packet allowance beneath the existing five-minute caller cap; retain the one-minute idle deadline after progress. A no-packet timeout remains a failure, never an empty or uncertain assessment.
- **Source-grounded initiative discovery (#677, 2026-08-28):** When conservative review correctly classifies legacy labels as phases or workstreams, inspect one validated conversation at a time for one cohesive goal and at least two contributing actions. Create a new deterministic project entity only after exact full-transcript quote validation and link it to that source. Persist source-revision progress, publish qualified results immediately, and never rename, merge, delete, or automatically parent existing entities. A model may propose up to three actions; discard an unsupported optional action only when at least two other non-overlapping action quotes remain grounded. Planning-oriented scheduling and extracted labels help retrieval only and cannot establish scope.

## 2026-08-29 - Treat a project page as an evidence-backed briefing

- **Status:** Accepted.
- **Source:** [Issue #685](https://github.com/metagrover/pluto/issues/685), user-approved Projects redesign.
- **Decision:** A qualified project page is a calm re-entry briefing, not an entity record or metric dashboard. It leads with a short user-editable display title while preserving detected identity, then shows deterministic meeting and attendance facts, a conservative current read, explicit milestones, recurring rhythm, commitments, and linked source meetings. The overview reuses the same vocabulary and prioritizes projects needing attention.
- **Trust boundary:** Attendance ignores synthetic speakers and discloses source coverage. Recurrence requires at least three consistently spaced observations. “Falling behind” requires overdue confirmed linked work; “Appears on track” requires recent confirmed completion. Sparse evidence remains “Not enough evidence.” Model-derived attention only affects health when it carries source citations.
- **Project identity:** Users may merge a detected project into a canonical project after reviewing meetings, milestones, commitments, and the retained alias. Merging is reversible canonicalization, never deletion: original entities and evidence remain stored, future extraction resolves aliases to the canonical project without overwriting its title, and project-scoped synthesis reads the whole active alias family. Undo restores nested aliases to their prior project.

## 2026-08-29 - Keep project milestones user-controlled and evidence-legible

- **Status:** Accepted
- **Source:** [Issue #691](https://github.com/metagrover/pluto/issues/691), following [Issue #685](https://github.com/metagrover/pluto/issues/685)
- **Decision:** User-authored milestones are stored as versioned metadata on the canonical project entity and remain explicitly distinct from read-only checkpoints derived from confirmed commitments or meeting evidence. Project analytics summarize observed meetings, open and completed commitments, freshness, and evidence coverage; Pluto does not generate a composite progress score or claim improvement from activity counts alone.
- **Rationale:** Projects need visual weight and user planning controls without becoming a generic dashboard or allowing inferred data to masquerade as user intent. Reusing project metadata preserves local-first persistence and avoids a schema migration while atomic main-process mutations protect unrelated qualification, title, and provenance fields.
- **Consequences:** Users can create, edit, complete, delete, and restore milestones across restarts. Both milestone sources can share one project path, but provenance is always visible and only user-created milestones are editable. Sparse data remains an explicit evidence limitation, and the complete meeting and commitment history stays available behind progressive disclosure.

## 2026-08-30 - Read meeting context from the native macOS calendar store

- **Status:** Accepted and implemented.
- **Source:** [Issue #617](https://github.com/metagrover/pluto/issues/617), `docs/superpowers/specs/2026-08-30-native-calendar-context-design.md`
- **Decision:** Pluto's first calendar integration reads one user-selected calendar through macOS EventKit instead of operating a Google OAuth client or hosted synchronization service. Calendars already configured on the Mac can include Google/CalDAV, iCloud, Exchange, local, and subscribed sources. Pluto requests native Calendar access only after an explicit user action, queries a bounded local window, persists only minimal meeting-context fields, marks calendar provenance separately from transcript evidence, and exposes no event mutation operation.
- **Rationale:** A shared one-click Google OAuth client requires production verification and a stable public project domain, while bring-your-own credentials are not a one-click product. EventKit preserves the intended one-click, local-first, free open-source experience and delegates provider authentication and remote synchronization to macOS.
- **Consequences:** Apple requires full Calendar permission to read events because EventKit has no read-only authorization level; Pluto must disclose that honestly and enforce read-only behavior in its bridge contract. `Last read from this Mac` cannot claim remote-provider freshness. Direct Google OAuth, cross-platform calendar providers, multiple selected calendars, event editing, invitations, and generated pre-meeting briefs remain outside the first release.
- **Dashboard shape:** Upcoming meetings occupies the top of the dashboard's secondary rail and shows at most two compact rows before an inline `See more` action. Recent win moves beneath it. The lower-value continuation card is removed so calendar context does not increase dashboard density.

## 2026-08-31 - Make saved Ask Pluto notes-first and inference-coordinated

- **Status:** Accepted.
- **Source:** [Issue #699](https://github.com/metagrover/pluto/issues/699), `docs/superpowers/specs/2026-08-31-notes-first-ask-pluto-design.md`, informed by the runtime evaluation in #694.
- **Decision:** Saved-meeting Ask Pluto searches a dedicated, rebuildable notes evidence index and does not use transcript-derived ranking, snippets, prompt context, or citations by default. Transcript evidence is allowed only for explicit exact-wording intent or a disclosed fallback when no usable notes exist. Active-meeting chat remains transcript-backed. Global and meeting-scoped chat share the same policy and evidence packet.
- **Answer path:** Safely renderable summaries, decisions, action items, owners, and dates may bypass model generation. Other saved-meeting synthesis uses Gemma over compact notes evidence; Phi remains the fast model for active-meeting chat rather than causing routine completed-chat model swaps.
- **Runtime:** A provider-neutral coordinator in Electron's main process owns priority, cancellation, model residency, and content-free timing. Pluto initially retains serialized Ollama inference, enforces one packaged production-profile instance, and isolates development profiles. Direct MLX, llama.cpp, and same-model parallel decoding remain benchmark candidates that must pass full production-path semantic, latency, memory, cancellation, and contention gates before promotion.
- **Rationale:** The existing mixed notes/transcript index and separate transcript context paths made notes preference advisory, while long transcript context, model switching, and independently running Pluto processes inflated latency. Prior direct-runtime evidence improved some raw timings without clearing trusted quality and memory gates.
- **Consequences:** The derived notes index can be rebuilt without changing source notes or transcripts. User edits and corrections remain authoritative. Partial notes never trigger silent transcript supplementation. Performance claims must include retrieval and queueing and report cold model load separately from warm response latency; private meeting content stays out of telemetry, fixtures, and GitHub.

## 2026-08-31 - Group Settings by user intent with horizontal tabs

- **Status:** Accepted and implemented.
- **Source:** [Issue #643](https://github.com/metagrover/pluto/issues/643), `docs/superpowers/specs/2026-08-31-settings-information-architecture-design.md`
- **Decision:** Settings uses four horizontal categories: Personal, Meetings, Intelligence, and Advanced. It shows one category at a time with standard keyboard tab behavior. Categories represent the user's intent rather than mirroring each implementation section; Calendar stays with recording, appearance stays with identity, and destructive maintenance remains isolated.
- **Rationale:** The existing application sidebar already provides primary navigation, so a second left rail would make Settings feel administrative. A single scrolling page continued to expose every control at once, while a tab for every feature would create category sprawl. Four intent-based tabs keep the visible choice count within a manageable range and preserve room for related settings to grow.
- **Consequences:** Personal is the default whenever Settings mounts, and the selected category lasts only while the page remains mounted. Existing settings, defaults, persistence, setup states, and destructive confirmation behavior remain unchanged. Future controls should join one of these intent categories unless a distinct user task justifies revisiting the information architecture.

## 2026-08-31 - Bound meeting-note work before claiming latency improvement

- **Status:** Implemented mechanics; performance and semantic promotion remain unaccepted.
- **Source:** [Issue #698](https://github.com/metagrover/pluto/issues/698), private read-only 30-minute meeting benchmark, and the existing production-provider quality gate.
- **Decision:** Admit one primary meeting-notes run at a time with manual-first FIFO scheduling, expose queue position separately from active generation, size source leaves independently from concrete merge work, and recover truncated leaf or merge work locally without discarding completed siblings. Persist only bounded content-free timing and hierarchy metrics. Preserve source-grounding, cancellation, publication revision checks, existing notes, and all output-quality contracts.
- **Measured checkpoint:** On one 1,803-second legacy-source meeting, the prior implementation failed with `notes_output_truncated` after 1,055,706 ms and nine model calls. The candidate published after 590,123 ms and seven calls, with 6 ms queued, one bounded repair, and no repartition. This is a 44% shorter successful run than the failed baseline, not a representative average or proof of the 50% median target. Persisted production history currently has fewer than three samples in every duration bucket.
- **Strict-corpus rejection:** A new read-only manifest now contains one roughly 15-minute, four roughly 30-minute, and two roughly 45-minute meetings with strict `parakeet_final_v1` provenance. Three warm attempts on the first strict 30-minute case all failed with `notes_context_exhausted`: 577,718 ms and four calls, 1,111,099 ms and ten calls, and 1,079,743 ms and ten calls. Queue time was at most 19 ms, while the source contained 490 segments and 28,635 source characters. An uncommitted diagnostic that locally repartitioned an oversized contract-repair prompt advanced farther but still failed `notes_audit_invalid` after 3,037,615 ms, 27 calls, six repairs, and three repartitions, so it was rejected rather than shipped. Duration alone is not an adequate predictor; source density, audited node count, and repair pressure dominate. Do not run the remaining repeated or burst cases until the harness records planned leaf and task/outcome counts and a bounded hierarchy/audit experiment is explicitly approved.
- **Quality checkpoint:** A one-seed real-provider run retained exact evidence for 14/14 cases and had no format failures or false negatives, but produced one false positive and reviewed 39/48 semantic checks. The default three-seed run did not finish within the bounded execution window. Do not weaken the gate, present this as a quality promotion, or infer general meeting-note latency until the frozen corpus supplies the required repeated and burst samples.
- **Consequences:** The scheduler makes parallel requests predictable rather than parallelizing local inference: waiting work consumes no model capacity, manual requests precede automatic work, FIFO is stable within each class, duplicates coalesce, and cancellation remains explicit. Queueing improves responsiveness and resource stability but does not make an isolated model call faster. The strict-corpus rejection blocks the speed claim and redirects the next measured work toward hierarchy and audit amplification; audit-count changes still require separate semantic-parity evidence.

## 2026-08-31 - Make People an evidence-backed relationship briefing

- **Status:** Accepted and implemented.
- **Source:** [Issue #704](https://github.com/metagrover/pluto/issues/704), `docs/superpowers/specs/2026-08-31-person-relationship-briefings-design.md`
- **Decision:** A People profile is a calm relationship dossier, not a jump to the latest meeting or a broad model-generated biography. It separates confirmed participation, exact unique-name calendar matches, and mention-only associations. Expectations and recent deliveries require a user-confirmed stable person owner. Displayed relationship insights require fresh, direct, high-confidence synthesis whose every citation points to a confirmed conversation; otherwise Pluto omits the section.
- **Capacity policy:** Meeting-scoped extraction and durable secondary fields complete with the meeting run. Cross-meeting knowledge documents wait until Pluto and macOS have both been quiet for 15 minutes, the Mac is on wall power, thermals are nominal or fair, and no foreground pause reason is active. Capacity is rechecked during generation. Foreground activity, battery power, unsafe thermals, or capture/transcription work aborts and retains the refresh for retry.
- **Consequences:** Sparse profiles remain useful through disclosed meeting provenance without invented summaries. Calendar invitations never imply attendance, mentions never imply participation, display-name matches never assign work, and failed or interrupted cross-meeting synthesis cannot block publication of the meeting's primary notes and extraction. This policy schedules existing cross-meeting documents; it does not add a new dreaming graph or infer durable person facts without source evidence.

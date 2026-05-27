# Pluto Product/Development Journal

This is Pluto's human-readable development journal. It is not a formal release-notes file.

Use it to capture shipped changes, meaningful experiments, reversals, and changes in product direction. Good entries explain what changed, why it changed, and what assumption or previous direction it replaced.

## Entry Format

```markdown
## YYYY-MM-DD

### Short change title
- **Issue:** #123
- **PR:** #456
- **Changed:** What shipped or changed.
- **Why:** The product or technical reason.
- **Replaced:** The prior assumption, workflow, behavior, or plan this supersedes.
- **Notes:** Follow-up context future agents should know.
```

## 2026-05-26

### Let Knowledge Needs Attention read from the durable queue
- **Issue:** [#118](https://github.com/metagrover/pluto/issues/118)
- **PR:** Pending.
- **Changed:** The global Knowledge main stage now loads active durable attention items and uses them as the source of truth for the `Needs Attention` lane when they exist. Queue-backed items preserve their severity, reason, and citations, while non-global docs and empty-queue states still fall back to the existing Knowledge-doc and project-health heuristics. Focused unit coverage now proves both the queue-backed and fallback paths.
- **Why:** `#81` promises that Knowledge can read from the durable attention queue when available. Before this slice, Pluto already persisted ranked attention items from Knowledge V2 synthesis and the action tracker, but the Knowledge surface still rebuilt a disconnected heuristic list instead of reflecting the same prioritized queue.
- **Replaced:** Treating the global Knowledge `Needs Attention` lane as a local reconstruction from doc sections and project cards even when a durable ranked attention queue already existed.
- **Notes:** This slice is intentionally read-only. It does not add lifecycle controls inside Knowledge or redesign the page layout.

### Prefer working-memory snapshots in the Dashboard workspace memory brief
- **Issue:** [#107](https://github.com/metagrover/pluto/issues/107)
- **PR:** Pending.
- **Changed:** The Dashboard home model now loads the persisted global working-memory snapshot and prefers its headline, source count, and trust metadata for the global Workspace Memory card when the snapshot matches the current global Knowledge doc. The Dashboard still falls back to the existing Knowledge-doc path when the snapshot is missing, stale, malformed, or sourced from a different doc, and focused tests now cover both the snapshot-backed card path and fallback behavior.
- **Why:** `#81` needs durable working-memory consumers beyond the Knowledge main stage so Pluto's re-entry surfaces stop depending only on transient doc JSON. The Dashboard is the next smallest consumer because it already renders the global memory card and uses that card for its fallback briefing state when no meeting or urgent action should dominate.
- **Replaced:** Treating the Dashboard's global Workspace Memory summary as a direct read of Knowledge-doc JSON even after Pluto had begun persisting and consuming a durable working-memory snapshot elsewhere.
- **Notes:** This slice intentionally keeps the Dashboard's priority rules unchanged: overdue or stale actions and the latest meeting still outrank memory cards, and broader Ask Pluto or non-global consumers remain follow-up work under `#81`.

### Prefer working-memory snapshots in global Knowledge Current Read
- **Issue:** [#105](https://github.com/metagrover/pluto/issues/105)
- **PR:** Pending.
- **Changed:** The global Knowledge Current Read now prefers the persisted working-memory snapshot created in `#102` when one is available and valid. The main Knowledge stage fetches that durable snapshot for the global doc, compiles the headline/streams/risks from the snapshot payload, and falls back to the existing Knowledge V2 document path when the snapshot is missing, stale, or malformed. Focused tests now cover snapshot-backed compilation plus stale and invalid fallback behavior.
- **Why:** `#81` needs downstream Knowledge surfaces to read from durable working memory instead of transient synthesis output. Using the first persisted global snapshot proves the consumer path without widening scope into dashboard, Ask Pluto, or non-global memory consumers yet.
- **Replaced:** Treating the global Knowledge brief as a transient read of the doc JSON even after Pluto had started persisting an inspectable working-memory snapshot.
- **Notes:** This is intentionally limited to the global Knowledge surface and stacks on the snapshot foundation branch from `#102` / PR `#103`.

## 2026-05-22

### Persist the first global working-memory snapshot
- **Issue:** [#102](https://github.com/metagrover/pluto/issues/102)
- **PR:** Pending.
- **Changed:** Added a durable `working_memory_snapshots` persistence layer plus a global snapshot builder that stores the current read, active streams, open loops, patterns, risks, evidence index, and trust/freshness metadata derived from the canonical global Knowledge V2 document. Global knowledge synthesis now refreshes that snapshot automatically, and the branch adds a small IPC/API read surface plus focused unit coverage for idempotent regeneration.
- **Why:** `#80` needs a real durable substrate before dashboard, Ask Pluto, briefings, or later scoped snapshots can share one inspectable memory state. Reusing the global Knowledge V2 document avoids inventing a second synthesis pipeline while still giving Pluto a persistent working-memory record.
- **Replaced:** Recomputing Pluto's global operational state only from transient Knowledge V2 synthesis output with no durable snapshot layer for downstream consumers or debugging.
- **Notes:** This slice is intentionally global-only. Project/person-scoped working-memory expansion remains under `#80`.

### Add durable attention-item lifecycle transitions
- **Issue:** [#100](https://github.com/metagrover/pluto/issues/100)
- **PR:** Pending.
- **Changed:** Added a durable attention-item status mutation path, exposed it through the Electron attention IPC surface, and taught queue upserts to preserve resolved, dismissed, snoozed, and pinned lifecycle states when the same attention signal syncs again unchanged.
- **Why:** Pluto's follow-up loop could not become trustworthy while automated queue sync kept resetting handled items back to `active`. This foundation lets later dashboard, Meeting View, and draft work build on stable lifecycle state instead of one-off heuristics.
- **Replaced:** Treating the durable attention queue as effectively read-only user state and allowing unchanged automated sync inputs to clobber prior lifecycle decisions.
- **Notes:** This slice is intentionally non-UI; it establishes the persistence and sync contract that later follow-up surfaces can call.

### Explain trust badges across Pluto surfaces
- **Issue:** [#98](https://github.com/metagrover/pluto/issues/98)
- **PR:** Pending.
- **Changed:** Reused the shared trust-status metadata to surface explanatory copy anywhere the current dashboard memory cards, Knowledge current read, and Ask Pluto citation cards already show trust badges.
- **Why:** Phase 0 trust work promised that important claims would show provenance or explain why provenance is unavailable. Badge labels alone were too terse to help users judge whether a claim was direct, inferred, weak, stale, or needs review.
- **Replaced:** Treating trust badges as mostly decorative labels without consistent cross-surface explanation text.
- **Notes:** This is intentionally a narrow explanatory UX slice; it does not reopen trust-status semantics, secure-storage migration, or correction-overlay behavior.

## 2026-05-11

### Add deterministic attention scoring
- **Issue:** [#79](https://github.com/metagrover/pluto/issues/79)
- **PR:** Pending.
- **Changed:** Added a deterministic attention-scoring module with explicit urgency, recency, repetition, commitment, evidence, project relevance, feedback, and penalty breakdowns; persisted those score breakdowns on `attention_items`; and routed the current knowledge, action-tracker, and proactive attention producers through that scorer with focused unit coverage.
- **Why:** Trusted Attention needs explainable ranking before Pluto can safely build richer queue controls and briefing surfaces on top of it. This pass makes urgent commitments, repeated blockers, stale weak claims, and pinned or dismissed feedback behave predictably instead of relying on source-specific hard-coded scores.
- **Replaced:** Fixed per-source attention scores and severity heuristics that could not explain why one item outranked another.
- **Notes:** Low-confidence knowledge signals are still suppressed at the sync layer for now; this issue focuses on deterministic ranking and persisted breakdown metadata rather than new UI.

## 2026-05-10

### Apply knowledge corrections to synthesized output
- **Issue:** [#94](https://github.com/metagrover/pluto/issues/94)
- **PR:** Not opened yet.
- **Changed:** Made Knowledge V2 synthesis apply durable `knowledge_corrections` overlays before saving or progressively flushing docs, so stream renames/pins and item promote/demote/classification corrections now change the synthesized output instead of only persisting in SQLite.
- **Why:** Pluto already stored correction feedback as part of the trust spine, but most of that feedback was inert because synthesis only honored source exclusion. Trusted Attention needs user corrections to shape the shared memory layer before ranking and explanations depend on it.
- **Replaced:** Persisting stream/item correction records without feeding them back into synthesized Knowledge state.
- **Notes:** `exclude_source` still filters source meetings before synthesis, while the new overlay path handles stream/item corrections on both partial and final V2 documents.

### Normalize trust status across Knowledge and Ask Pluto
- **Issue:** [#91](https://github.com/metagrover/pluto/issues/91)
- **PR:** Not opened yet.
- **Changed:** Added a canonical trust-status model shared by Knowledge V2, dashboard knowledge cards, and Ask Pluto citation results, normalizing them around grounded, inferred, weak-evidence, stale, synthesis-failed, and needs-review states.
- **Why:** Pluto already had evidence-quality metadata and citation audits, but each surface interpreted trust independently. Trusted Attention work needs one deterministic trust vocabulary before ranking and explanation logic can build on top.
- **Replaced:** The ad hoc mix of freeform trust messages and Ask Pluto's one-off verified/flagged citation badge without a shared cross-surface contract.
- **Notes:** This slice is intentionally UI-light: it reuses existing evidence fields and surfaces the normalized status without adding new persistence or redesigning the broader Knowledge experience.

### Unify durable attention inputs behind the queue
- **Issue:** [#78](https://github.com/metagrover/pluto/issues/78)
- **PR:** Pending.
- **Changed:** Added a deterministic attention-sync layer that projects global Knowledge V2 `needs_attention` and high-confidence risk/question signals plus overdue/stale action-item lifecycle signals into the SQLite `attention_items` queue. Global knowledge synthesis now reconciles those queue rows after each refresh, and app startup plus post-meeting processing refresh the action-tracker slice without removing the existing dashboard/proactive compatibility paths.
- **Why:** `#78` is the first Trusted Attention integration step after the durable queue foundation. Pluto needed one persistent prioritization backend for knowledge and action signals before scoring, lifecycle controls, and briefing surfaces can rely on the same state.
- **Replaced:** Keeping Knowledge V2 attention and action-lifecycle urgency in separate read paths that never reconciled into the durable attention queue.
- **Notes:** This pass deliberately leaves current UI consumers intact while introducing suppression for low-confidence knowledge items, stale-item resolution when signals disappear, and unit coverage for queue reconciliation behavior.

### Add a durable attention queue foundation
- **Issue:** [#77](https://github.com/metagrover/pluto/issues/77)
- **PR:** Pending.
- **Changed:** Replaced the session-only proactive alert array with a SQLite-backed attention queue that stores durable items, deterministic dedupe keys, severity/score/status metadata, evidence references, and related meeting/entity/stream IDs. The proactive trigger pipeline now upserts duplicate-action, decision-conflict, and cross-reference signals into that queue, and the branch adds unit coverage for queue ordering, dedupe, meeting cleanup, and proactive idempotency.
- **Why:** `#77` is the canonical Phase 1 substrate for later signal unification, scoring, lifecycle controls, and briefing work. Pluto needed a durable attention model before more features could safely stack on top of ephemeral trigger output.
- **Replaced:** Keeping proactive intelligence in an in-memory array that disappeared on restart and could create duplicate entries on repeated synthesis runs.
- **Notes:** This PR does not migrate dashboard or Knowledge UI surfaces to the queue yet; it establishes the persistent backend contract those follow-up issues can consume.

### Clear the high-severity dependency audit gate
- **Issue:** [#87](https://github.com/metagrover/pluto/issues/87)
- **PR:** [#88](https://github.com/metagrover/pluto/pull/88)
- **Changed:** Upgraded the direct `electron` and `vite` versions and pinned vulnerable transitive `picomatch`, `lodash`, and `@xmldom/xmldom` packages through `pnpm.overrides`, bringing `pnpm audit --audit-level high` back to green.
- **Why:** Pluto's pre-commit hook treats high-severity dependency advisories as a landing blocker, and that blocker was preventing normal roadmap and runtime PRs from shipping cleanly.
- **Replaced:** Accepting a permanently failing audit hook that forced code changes to stop or bypass verification.
- **Notes:** The current lockfile still carries low and moderate advisories, but non-docs code work is no longer blocked on the high-severity gate.

## 2026-05-09

### Define the Cognitive Memory Spine
- **Issue:** [#76](https://github.com/metagrover/pluto/issues/76)
- **PR:** Not opened yet.
- **Changed:** Added a source-of-truth design for Pluto's Cognitive Memory Spine, defining raw memory, structured memory, semantic memory, working memory, attention items, evidence, freshness, trust status, and correction feedback against the current codebase. Locked the Phase 0 architecture choice that streams remain derived for now while the future attention queue becomes a durable SQLite-owned layer.
- **Why:** The roadmap needed one accepted model that explains how meetings, entities, Knowledge, Ask Pluto, proactive signals, and future briefings fit together before building Trusted Attention features on top.
- **Replaced:** Treating Knowledge V2, proactive alerts, dashboard briefings, and action lifecycle logic as adjacent systems without one explicit memory-and-attention contract.
- **Notes:** This change intentionally defers the 10-agent rewrite and broader ingestion expansion until the local evidence-backed loop is trustworthy.

### Move provider credentials into secure settings
- **Issue:** [#86](https://github.com/metagrover/pluto/issues/86)
- **PR:** Not opened yet.
- **Changed:** Routed `gemini_api_key`, `openai_api_key`, `claude_api_key`, and `hf_token` through an Electron secure-settings layer that reads encrypted values first, migrates legacy plaintext values on first successful read, and keeps the renderer IPC API unchanged.
- **Why:** Pluto's trust foundation cannot leave provider credentials in plaintext SQLite while claiming local-first privacy and evidence-backed memory.
- **Replaced:** Storing these secrets directly in the `settings` table as ordinary plaintext values.
- **Notes:** If encrypted persistence is unavailable or fails, Pluto keeps the plaintext fallback in place and logs a named secure-settings failure instead of silently dropping the user's working configuration.

### Align automation GitHub auth preflights
- **Issue:** [#67](https://github.com/metagrover/pluto/issues/67)
- **PR:** Not opened yet.
- **Changed:** Updated PM GitHub preflight to load `.builder.env`, mirror `GH_TOKEN` and `GITHUB_TOKEN`, and treat repo-scoped issue/permission checks as authoritative even when `gh auth status` is noisy. Aligned the live PM and Engineering Housekeeping automation prompts with the same bootstrap and classification rules.
- **Why:** Recurring automations were failing early because some runs used stale keyring/auth-status checks or missed the project-local token env that had already been configured.
- **Replaced:** Treating `gh auth status` as a blocking source of truth for automation readiness.
- **Notes:** `pnpm run pm:github-preflight` now reports token variable names only, keeps token values redacted, and succeeds locally with `viewerPermission: ADMIN`.

### Improve contributor DevEx and onboarding path
- **Issue:** [#56](https://github.com/metagrover/pluto/issues/56)
- **PR:** Not opened yet.
- **Changed:** Split environment-coupled local probe tests out of the default Vitest suite, added a `pnpm run test:manual` path for those probes, refreshed contributor docs around the explicit setup/build/verification flow, and made the meeting insert SQL assertion resilient to schema growth.
- **Why:** The default contributor verification path should be green from a normal checkout without requiring a warmed personal database, a provider-backed LLM setup, or brittle test maintenance after routine schema additions.
- **Replaced:** Treating local database / LLM probes as ordinary unit tests and relying on a fixed column count in the meeting insert SQL guard.
- **Notes:** `pnpm run lint` and `pnpm test -- --run` are now the contributor-safe baseline checks. Manual probe tests still exist under `tests/manual/` for local debugging.

## 2026-05-01

### Simplify dashboard briefing and action priority
- **Issue:** [#59](https://github.com/metagrover/pluto/issues/59)
- **PR:** Not opened yet.
- **Changed:** Reworked the dashboard hero/briefing layout into a tighter daily-briefing flow, surfaced secondary actions in the hero, and sorted action insights by urgency plus due-date/recency so the most time-sensitive work appears first.
- **Why:** The real-data dashboard still made users scan too much chrome and could bury the most urgent action behind insertion order instead of actual priority.
- **Replaced:** The denser multi-panel briefing layout and unsorted action insight ordering from the initial real-data homepage pass.
- **Notes:** Action insight deduplication still preserves overdue items over stale/active duplicates, with tests covering the bucket ordering rules.

### Add PM housekeeping GitHub preflight
- **Issue:** [#67](https://github.com/metagrover/pluto/issues/67)
- **PR:** Not opened yet.
- **Changed:** Added a `pm:github-preflight` check that verifies valid `gh` auth, API reachability, issue listing, repository write scope, and optional mutation smoke checks without logging token values.
- **Why:** Recurring PM automation needs to distinguish missing secrets, invalid auth, network failures, and mutation failures before grooming issues.
- **Replaced:** Blind trust in auth configuration without confirming live GitHub access and repository permissions.
- **Notes:** The default permission check uses GraphQL `viewerPermission`, so recurring runs can verify write access without leaving test comments behind. The preflight now accepts either keychain-backed `gh` login or env-backed tokens as long as the live checks pass.

### Adopt issue-driven agentic development
- **Issue:** [#55](https://github.com/metagrover/pluto/issues/55)
- **PR:** Not opened yet.
- **Changed:** Added an Issues-first workflow for active product and implementation work, with repo docs reserved for durable memory.
- **Why:** Pluto's product direction evolves as the app becomes more real. GitHub Issues provide a better live surface for divergence, discussion, scope updates, and acceptance criteria than static PRDs.
- **Replaced:** PRD-first planning as the default source of truth for active work.
- **Notes:** This first version intentionally uses templates and agent ritual rather than CI enforcement.

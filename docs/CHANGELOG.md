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

## 2026-05-30

### Persist team-tracker working-memory snapshots
- **Issue:** [#145](https://github.com/metagrover/pluto/issues/145)
- **PR:** Pending.
- **Changed:** Pluto's working-memory snapshot layer now supports `team_tracker` Knowledge docs in the same way it already supported global and project scopes. Team tracker synthesis now persists durable snapshots for both empty and populated Knowledge V2 documents, and focused unit coverage proves build and persist behavior for the new scope.
- **Why:** `#80` defines working memory as the durable substrate shared by Knowledge, Ask Pluto, briefings, and attention. Before this slice, team tracker docs could synthesize shared people-group context but could never persist that context into the snapshot store, leaving the scope outside Pluto's durable memory path.
- **Replaced:** Treating `team_tracker` Knowledge docs as synthesis-only views while the working-memory snapshot contract remained hardcoded to global and project scopes.
- **Notes:** This slice only extends the snapshot substrate. Team-tracker-specific UI consumption and broader downstream readers remain separate follow-up work under the Phase 2 roadmap.
### Persist person-context working-memory snapshots
- **Issue:** [#143](https://github.com/metagrover/pluto/issues/143)
- **PR:** Pending.
- **Changed:** Expanded the durable working-memory snapshot layer to support `person_context` Knowledge docs in addition to `global` and `project`, added builder/persist helpers for that scope, and wired person-context Knowledge synthesis to refresh those snapshots automatically using the existing snapshot payload contract. Focused unit coverage now proves person-context build, persist, and stable upsert behavior.
- **Why:** Pluto already auto-refreshes people-focused Knowledge docs when meetings mention active participants, but those docs still could not persist durable memory state because the snapshot layer was hardcoded to only two scopes. Landing one more existing scope advances the Working Memory substrate without reopening Knowledge UI work.
- **Replaced:** Treating `person_context` docs as transient synthesized views even after global and project docs had a durable working-memory path.
- **Notes:** This slice is intentionally foundation-only. Person-context snapshot consumption in Knowledge, Ask Pluto, and briefing surfaces remains later work under `#81`, `#62`, and `#82`.
## 2026-05-29

### Expose the durable attention queue to renderer code
- **Issue:** [#141](https://github.com/metagrover/pluto/issues/141)
- **PR:** Pending.
- **Changed:** Added a typed renderer API wrapper for Pluto's existing durable attention queue IPC handlers. Frontend code can now list attention items, filter them by meeting, clear meeting-scoped items, and update lifecycle state through one shared module, with focused unit coverage for the contract.
- **Why:** `#61` still needs more follow-up surfaces to consume real durable attention state, but the renderer had no dedicated API layer for the queue even though `electron/main.ts` already exposed the IPC handlers. This foundation lets later UI slices reuse the same typed path instead of hard-coding channel strings or rebuilding action heuristics.
- **Replaced:** Treating durable attention access as an ad hoc IPC concern in future UI work rather than part of Pluto's normal frontend data layer.
- **Notes:** This slice is intentionally non-UI and avoids overlapping the active Meeting View, Dashboard, and Knowledge PRs.
## 2026-05-31

### Include decision owners in Meeting follow-up drafts
- **Issue:** [#173](https://github.com/metagrover/pluto/issues/173)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now preserve `decided_by` context from `v3.all_decisions` when it exists, formatting recap decision bullets with the decision owner while keeping the existing plain-text fallback for decisions that have no recorded owner. Focused unit coverage now locks the formatting and fallback behavior.
- **Why:** `#61` still treats follow-up drafts as the first local accountability surface, and the analysis schema already carries who made explicit decisions. Dropping that context made recap drafts less specific even when Pluto had the attribution locally.
- **Replaced:** Flattening `v3` meeting decisions to bare text before the default drafts and regenerate prompt were built.
- **Notes:** This slice stays inside the existing Meeting View draft flow. It does not redesign the draft UI or add outbound sending behavior.
### Include decision rationale in Meeting follow-up drafts
- **Issue:** [#171](https://github.com/metagrover/pluto/issues/171)
- **PR:** Pending.
- **Changed:** Meeting View follow-up draft context now prefers linked `decision` entities when they exist, carrying rationale into the default draft templates and regenerate payload as `Why:` context while preserving the prior plain decision-text fallback when rationale is unavailable.
- **Why:** `#61` calls for follow-up generation that reflects Pluto's real meeting context. Current `master` still flattened decisions to bare text even when the analysis/entity layer already preserved why the team made that decision, which made recap drafts less actionable at re-entry.
- **Replaced:** Treating decision context in follow-up drafts as a plain checklist of outcomes with no explanation of the reasoning behind those choices.
- **Notes:** This slice stays inside Meeting View and the existing draft editor. It does not add sending integrations or redesign the draft surface.
## 2026-06-01

### Include owner role context in meeting follow-up drafts
- **Issue:** [#202](https://github.com/metagrover/pluto/issues/202)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now reuse linked person role metadata when formatting action-item owner lines, so linked items read as `Owner: Name (Role)` when Pluto already knows that owner's role. Existing due-date formatting and bare-name fallback behavior stay unchanged.
- **Why:** `#61` calls for follow-up drafts to reuse existing meeting entities instead of flattening durable meeting context away. Before this slice, action-item owner attribution lost useful accountability context even when the linked person entity already carried a role/title.
- **Replaced:** Treating linked action-item owners as names only in follow-up drafts despite already storing role metadata on the matched person entity.
- **Notes:** This change is intentionally narrower than participant-role work. It only enriches owner attribution inside action-item lines and does not alter the attendee list or draft surface.
### Preserve action-item context in Meeting follow-up drafts
- **Issue:** [#200](https://github.com/metagrover/pluto/issues/200)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now carry linked `action_item` entity `context` alongside the existing owner and due-date metadata when Pluto already has that sentence-level meeting context. Focused draft-context coverage now proves the formatter preserves that existing context without changing items that do not have it.
- **Why:** `#61` calls for follow-up drafts to reuse the same durable meeting context Pluto already extracted elsewhere. Before this slice, Meeting View cards could explain what a follow-up was about while the draft generator flattened that same action into a bare task line.
- **Replaced:** Treating linked action items as title-plus-owner-plus-due only, even when the selected meeting already had richer action context attached to the same entity.
- **Notes:** This stays inside the current Meeting follow-up draft surface. It does not redesign cards, add new lifecycle states, or broaden into sending integrations.
### Preserve blocked follow-up context in recap drafts
- **Issue:** [#198](https://github.com/metagrover/pluto/issues/198)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now reuse linked attention-item blocker state when a meeting action is actively blocked, carrying the existing blocker reason into the draft action line alongside owner and due metadata. Focused draft-context coverage now proves blocked follow-ups render with that extra lifecycle context while non-blocked items keep their existing format.
- **Why:** `#61` treats blocked commitments as meaningfully different from routine next steps. Before this slice, Meeting View already knew when an action was blocked, but generated recap drafts flattened that work back into a normal action item and hid why it could not move.
- **Replaced:** Treating linked follow-up draft action lines as entity-only strings even when the durable attention queue already carried blocker context for the same commitment.
- **Notes:** This stays in the Meeting draft formatting path only. It does not redesign Meeting action cards or broaden blocker rendering to other surfaces.
### Keep overdue and stale follow-up urgency visible in drafts
- **Issue:** [#196](https://github.com/metagrover/pluto/issues/196)
- **PR:** Pending.
- **Changed:** Meeting View follow-up draft context now carries concise `Status: Overdue` and `Status: Stale` labels into linked action-item strings while preserving the existing owner and due metadata. Normal active items and fallback plain-text action items keep their previous wording, and focused regression coverage now proves the status-aware formatting.
- **Why:** `#61` requires Pluto's commitment lifecycle to distinguish ordinary active work from aging follow-ups. Before this slice, draft generation flattened overdue and stale linked items into neutral next steps, which hid urgency in the exact recap text users may send or copy.
- **Replaced:** Treating all still-active linked follow-ups as equivalent draft bullets even when Meeting View already knew which ones were overdue or stale.
- **Notes:** This is intentionally limited to draft-context formatting. Completion/dismiss/snooze suppression remains separate work in `#194` / PR `#195`.
### Keep follow-up drafts aligned with handled lifecycle state
- **Issue:** [#194](https://github.com/metagrover/pluto/issues/194)
- **PR:** Pending.
- **Changed:** Meeting follow-up draft context now excludes linked action items that are already completed or whose durable attention item has been dismissed or snoozed, while still keeping active linked follow-ups enriched with owner and due metadata and preserving fallback draft behavior when lifecycle state is unavailable.
- **Why:** `#61` requires Pluto's follow-up loop to respect the lifecycle state users already control. Before this slice, follow-up drafts could restate already-handled commitments as fresh next steps, undermining trust in the draft output.
- **Replaced:** Treating every linked follow-up as an open next-step bullet regardless of its existing lifecycle or suppression state.
- **Notes:** This stays scoped to the draft-context path and does not change queue lifecycle semantics or redesign Meeting View.
### Include participant roles in Meeting follow-up drafts
- **Issue:** [#192](https://github.com/metagrover/pluto/issues/192)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now preserve role/title metadata for linked participants when Pluto already has it, rendering participant lines like `Name (Role)` in both the default draft templates and the regenerate prompt while keeping the existing name-only fallback for missing or malformed metadata. Focused tests now cover role-aware participant serialization plus the malformed-metadata fallback.
- **Why:** `#61` calls for follow-up drafts to reuse existing meeting context rather than flattening it away. Participant names alone still left recaps less grounded than Pluto's current MID/entity data could support.
- **Replaced:** Treating participant context in follow-up drafts as a flat attendee-name list even when Pluto had already inferred or stored stable participant roles.
- **Notes:** This slice is intentionally narrow and keeps using Meeting View's current draft surface. It does not broaden into lifecycle controls, outbound sending, or the open decision/topic/entity context stack.
### Reuse linked project and topic context in Meeting follow-up drafts
- **Issue:** [#190](https://github.com/metagrover/pluto/issues/190)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now derive a concise linked-context block from meeting `project` and `topic` entities, pass that context into the default recap templates, and include the same block when regenerating drafts through the LLM prompt. Focused unit coverage now proves both the entity-context formatter and prompt wiring.
- **Why:** `#61` already required follow-up drafts to reuse existing meeting entities, but current `master` only carried participant names plus flat decisions and action items. That made recaps less grounded in the actual workstream when Pluto had already linked the meeting to concrete projects and topics.
- **Replaced:** Treating follow-up drafts as participant-and-action summaries only, even when the meeting knowledge graph already carried durable project and topic context for the same conversation.
- **Notes:** This slice intentionally limits linked context to deduped `project` and `topic` entities so it stays complementary to the existing participant and action-item blocks instead of duplicating them.
## 2026-05-31

### Add topic context to unresolved follow-up questions
- **Issue:** [#188](https://github.com/metagrover/pluto/issues/188)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now derive topic-labeled unresolved questions from V3 meeting analysis and carry that context through both the default draft templates and the regenerate prompt. Duplicate or blank question lines are removed so multi-topic meetings keep their open loops readable instead of flattening them into ambiguous bullets.
- **Why:** `#61` already has adjacent slices for decision, action-item, discussion-point, and summary context, but unresolved questions still lost their discussion thread when Pluto generated follow-up drafts. Topic labels keep recipients oriented on which thread each open loop belongs to without expanding the surface.
- **Replaced:** Treating unresolved questions as unlabeled flat bullets in follow-up drafts even when the meeting analysis already knew which topic each open loop came from.
- **Notes:** This slice stays inside Meeting View draft context. It does not add new lifecycle controls, sending integrations, or extra extraction passes.
## 2026-06-01

### Include topic summaries in meeting follow-up drafts
- **Issue:** [#186](https://github.com/metagrover/pluto/issues/186)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now carry per-topic V3 summary context through both the default draft templates and the regenerate prompt. Pluto dedupes empty or repeated topic summaries before formatting them into a compact `Discussion Context` block, so the LLM and saved drafts see the same grounded overview of each thread.
- **Why:** `#61` still calls for follow-up drafts that reuse the meeting context Pluto already extracted. Current `master` had decisions, action items, participants, key points, and open-question slices in flight or landed, but it still dropped the concise per-topic summaries that explain what each thread was actually about.
- **Replaced:** Treating follow-up drafts as lists of decisions and actions plus adjacent context fragments, without reusing the topic-level summary text already stored in the V3 meeting analysis.
- **Notes:** This stays inside the existing Meeting View draft surface. It does not redesign the UI or broaden into sending integrations or new follow-up surfaces.
### Include discussion context in meeting follow-up drafts
- **Issue:** [#184](https://github.com/metagrover/pluto/issues/184)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now derive topic-labeled discussion points from V3 meeting `key_points`, include that context in the default email/internal/Slack draft templates, and pass the same lines into LLM-based draft regeneration. Focused tests cover both discussion-point formatting and prompt wiring.
- **Why:** `#61` still requires follow-up generation to reflect the real meeting context Pluto already extracted locally. Before this slice, drafts only saw participants, decisions, and action items, which made recaps miss the supporting discussion threads that explain why the next steps matter.
- **Replaced:** Treating follow-up drafts as a recap of commitments only, without carrying over the key discussion evidence already present in the meeting analysis.
- **Notes:** This stays scoped to Meeting View draft context. It does not redesign the panel, alter lifecycle scoring, or add delivery integrations.
### Add decision topic context to Meeting follow-up drafts
- **Issue:** [#182](https://github.com/metagrover/pluto/issues/182)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now derive topic-aware decision lines from V3 meeting analysis topics, so default drafts and regenerate prompts can preserve which workstream each decision came from instead of flattening everything to bare text. Focused tests now cover both topic-aware decision formatting and prompt propagation.
- **Why:** `#61` calls for follow-up generation that uses Pluto's existing meeting context. Current `origin/master` already preserved decisions under topic sections, but draft generation dropped that structure, which made recaps less clear when multiple threads produced separate decisions in the same meeting.
- **Replaced:** Treating follow-up draft decisions as an unstructured list even when the selected meeting already had topic-linked V3 decision context.
- **Notes:** This slice stays inside Meeting View follow-up drafts. It does not redesign the draft editor, add sending integrations, or overlap the separate open PRs for decision owner/rationale context.
## 2026-05-31

### Include meeting overview context in follow-up drafts
- **Issue:** [#177](https://github.com/metagrover/pluto/issues/177)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now preserve the selected meeting's overview/summary context in both the default templates and the regenerate prompt, while keeping the existing safe fallback when no usable overview exists. Focused tests now cover overview-aware draft formatting and prompt generation.
- **Why:** `#61` already expects follow-up drafts to reflect real meeting context, but current `master` flattened the draft input down to participants, decisions, and action items even when the analysis already had a usable meeting overview. Adding that overview keeps recaps anchored to the main thread of the conversation instead of reading like an isolated task list.
- **Replaced:** Treating follow-up drafts as context-light recaps that dropped the selected meeting's own framing once decisions and action items were extracted.
- **Notes:** This slice stays scoped to Meeting View draft generation. It does not redesign the editor or add sending integrations.

### Preserve action-item topics in Meeting follow-up drafts
- **Issue:** [#175](https://github.com/metagrover/pluto/issues/175)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now preserve `ActionItemV3.topic` when analysis provides it, carrying that topic label into the default draft templates and the regenerate prompt alongside existing owner and due-date details. The shared draft-context helper also strips those known metadata labels when deduping fallback action items against linked `action_item` entities, so topic-aware fallback bullets do not repeat the same commitment twice.
- **Why:** `#61` requires follow-up drafts to stay grounded in Pluto's existing meeting context. After participant context and action-item owner/due details landed, current `master` still flattened commitments from different discussion threads into one generic list even though the v3 analysis schema already preserved topic context.
- **Replaced:** Treating Meeting follow-up draft action items as plain task strings once they left the analysis document, which blurred together commitments from separate topics and risked duplicate bullets when linked entity metadata was also present.
- **Notes:** This slice stays inside the existing Meeting View draft flow. Decision rationale and decision-owner context remain in the separate open PRs tied to `#171` and `#173`.

## 2026-05-29

### Surface blocked follow-ups in the durable attention queue
- **Issue:** [#137](https://github.com/metagrover/pluto/issues/137)
- **PR:** Pending.
- **Changed:** The action-tracker sync now promotes active `action_item` entities with live `blocked_by` links into durable `blocker` attention items, carries the blocking entity and evidence into the queue payload, and suppresses duplicate stale/overdue follow-up alerts for the same blocked action in that sync pass. Focused attention-sync coverage now proves blocker creation and lifecycle-state preservation.
- **Why:** `#61` calls for follow-ups, blockers, and risks to stay distinct. Before this slice, Pluto could model a blocked commitment in the entity graph but still only surface it as routine aging follow-up pressure, hiding why the work was stuck.
- **Replaced:** Treating blocked commitments as only overdue or stale follow-ups in the durable queue even when the graph already had explicit blocker relationships.
- **Notes:** This is intentionally non-UI groundwork. Dashboard and Meeting View surfaces can render these blocker queue items later without re-deriving blocker semantics from the graph.

### Make dashboard follow-ups honor durable lifecycle state
- **Issue:** [#135](https://github.com/metagrover/pluto/issues/135)
- **PR:** Pending.
- **Changed:** The dashboard home model now loads durable attention alerts alongside overdue, stale, and active action-item entities, then suppresses dashboard follow-up cards when every linked alert for that action has already been snoozed or dismissed. Focused dashboard model tests now cover dismissed suppression, snoozed suppression, and the mixed-state case where at least one linked alert is still active.
- **Why:** `#61` requires Pluto's homepage follow-up surface to respect the same lifecycle state users already control elsewhere. Before this slice, dismissed or snoozed follow-ups could still reappear as unresolved daily-briefing work because the dashboard read directly from action entities and ignored the durable attention queue.
- **Replaced:** Treating the dashboard briefing as an entity-only follow-up list that could bypass the user's durable dismiss/snooze decisions.
- **Notes:** This keeps the scope in the data join/filter path only. It does not redesign the dashboard cards or add new reminder/notification behavior.

### Harden Knowledge V2 merges against null structured fields
- **Issue:** [#111](https://github.com/metagrover/pluto/issues/111)
- **PR:** Pending.
- **Changed:** Knowledge V2 merge-time normalization now tolerates nullish structured LLM fields instead of throwing, and evidence dedupe now skips malformed entries that are missing either a meeting id or quote. Focused regression coverage now proves Pluto can merge malformed LLM-shaped chunk documents without crashing Knowledge refresh.
- **Why:** Pluto's working-memory and Knowledge roadmap slices depend on local resynthesis staying reliable. A single null title or quote from structured LLM output should degrade gracefully instead of crashing the merge path and aborting Knowledge refresh.
- **Replaced:** Assuming all structured LLM merge fields are valid strings and letting malformed evidence rows participate in dedupe keys even when they could only produce unusable empty identifiers.
- **Notes:** This is intentionally a narrow runtime hardening fix. It does not redesign Knowledge V2 synthesis or broaden fallback behavior beyond null/malformed merge fields.

### Let Meeting View snooze extracted follow-ups
- **Issue:** [#132](https://github.com/metagrover/pluto/issues/132)
- **PR:** Pending.
- **Changed:** Meeting View now surfaces the durable `snoozed` attention lifecycle state for linked follow-ups, lets users snooze active follow-ups or reopen snoozed ones back to active, and keeps the existing complete and dismiss controls intact. The linked follow-up mapping test coverage now includes snooze/reopen affordances alongside the prior dismiss/reopen behavior.
- **Why:** `#61` still requires the commitment lifecycle to support more than complete-or-dismiss semantics. Pluto's backend and sync path already preserved `snoozed`, but current `master` had no source-meeting UI for deferring routine follow-ups without resolving them or treating them as false positives.
- **Replaced:** Forcing users to choose only between completing a follow-up or dismissing it entirely even when the real intent was to defer it and come back later.
- **Notes:** This slice stays scoped to Meeting View follow-ups. It does not add reminder scheduling, notifications, or broader follow-up surfaces.



## 2026-05-27

### Let Knowledge Needs Attention prefer working-memory snapshots
- **Issue:** [#139](https://github.com/metagrover/pluto/issues/139)
- **PR:** Pending.
- **Changed:** The selected Knowledge doc now passes its matching working-memory snapshot into `Needs Attention`, so project docs can render snapshot-backed open loops and dependencies instead of falling straight to project-card heuristics. The global Knowledge lane still gives active durable attention-queue items highest priority, and stale or mismatched snapshots still fall back to the existing doc/project-card behavior. Focused unit coverage now proves both the snapshot-backed project path and stale-snapshot fallback.
- **Why:** `#81` already let Current Read consume durable working memory, but the `Needs Attention` lane still ignored that same persisted state for project docs. This left project re-entry surfaces showing rough heuristics even when Pluto had already synthesized a fresher scoped snapshot.
- **Replaced:** Treating project Knowledge `Needs Attention` as a purely heuristic reconstruction from doc JSON and project cards after the selected doc already had a matching durable working-memory snapshot.
- **Notes:** This slice stays read-only and scoped to the selected Knowledge doc. It does not add project-specific attention queues, new snapshot scopes, or a Knowledge UI redesign.

### Enrich Meeting follow-up drafts from linked context
- **Issue:** [#120](https://github.com/metagrover/pluto/issues/120)
- **PR:** Pending.
- **Changed:** Meeting View follow-up drafts now prefer linked meeting `action_item` entities when they exist, carrying owner and due-date metadata into the draft defaults and regenerate prompt. The draft context also includes linked participant names, while preserving the prior plain-string fallback when entity links are missing.
- **Why:** `#61` calls for follow-up generation that reflects the same durable meeting context Pluto already extracted elsewhere. Flat action-item strings made recap drafts less accountable and missed participant context even when the meeting graph already knew both.
- **Replaced:** Treating follow-up draft generation as a formatter over analysis text alone, without reusing linked entity metadata from the meeting knowledge graph.
- **Notes:** This slice stays inside Meeting View and the existing follow-up draft surface. It does not add sending integrations or redesign the draft editor.

### Keep Knowledge attention items from repeating in the risks lane
- **Issue:** [#125](https://github.com/metagrover/pluto/issues/125)
- **PR:** Pending.
- **Changed:** The Knowledge main stage now filters `Risks and Unknowns` items that are already promoted into `Needs Attention`, using citation-aware matching for both legacy structured docs and Knowledge V2 items. A focused render regression test now covers duplicate suppression and preserves distinct V2 risks that were not promoted into the primary attention lane.
- **Why:** `#58` defines Knowledge as a concise re-entry surface, but current `master` could repeat the same blocker in both the primary attention lane and the risks lane. Removing that duplication keeps the page focused without redesigning the layout or changing ranking rules.
- **Replaced:** Rendering promoted blockers twice on the same Knowledge page and forcing users to infer that both cards describe the same underlying issue.
- **Notes:** This slice intentionally keeps distinct non-promoted risks visible and does not broaden into new scoring, lifecycle controls, or section redesign.

### Let Meeting View dismiss extracted follow-ups
- **Issue:** [#121](https://github.com/metagrover/pluto/issues/121)
- **PR:** Pending.
- **Changed:** Meeting View now loads meeting-linked durable attention items alongside extracted `action_item` entities, shows a visible dismissed state for false-positive follow-ups, and lets users dismiss or reopen those linked follow-ups through the existing attention-item status IPC. The completion rail still works for active follow-ups, while dismissed items no longer present as normal active work.
- **Why:** `#61` still requires users to demote false-positive follow-ups without them reappearing unchanged. The linked action-item rail from `#114` already exposed the right meeting context, so adding dismiss/reopen there closes the next accountability gap without redesigning dashboard or draft-generation flows.
- **Replaced:** Treating Meeting View follow-ups as only complete-or-active lifecycle items even when Pluto's durable attention queue already tracked dismissed false positives separately.
- **Notes:** This slice stays scoped to dismiss/reopen for meeting-linked attention items. Snooze, broader demotion taxonomy, and follow-up draft changes remain separate work under `#61`.

### Restore the high-severity dependency audit gate
- **Issue:** [#123](https://github.com/metagrover/pluto/issues/123)
- **PR:** Pending.
- **Changed:** Added a narrow `pnpm.overrides` pin so the transitive `tmp` dependency pulled through `electron-builder` resolves to `0.2.6` instead of vulnerable `0.2.5`, and refreshed the lockfile to match.
- **Why:** Pluto's required pre-commit audit gate on current `master` was failing on `GHSA-ph9p-34f9-6g65`, which blocked otherwise-green code PRs from committing without bypassing verification.
- **Replaced:** Accepting a broken repo-level audit gate on `master` or forcing unrelated code branches to carry the security remediation themselves.
- **Notes:** This is intentionally a minimal dependency unblocker, not a broader package upgrade sweep.

## 2026-05-26

### Include participant context in meeting follow-up drafts
- **Issue:** [#122](https://github.com/metagrover/pluto/issues/122)
- **PR:** Pending.
- **Changed:** Pluto's Meeting View follow-up draft regeneration path now derives a stable participant list from transcript speakers and passes that context into the follow-up prompt. The prompt explicitly includes a deterministic participants block and tells the model to keep drafts generic instead of inventing attendees when no participant context is available. Focused tests now cover both participant extraction and prompt fallback behavior.
- **Why:** `#61` calls for follow-up drafts to use existing meeting entities, decisions, participants, and action items. Before this slice, draft generation only received the meeting title plus action/decision text, which made recaps less grounded in who was actually in the room.
- **Replaced:** Treating follow-up draft generation as generic meeting text generation with no explicit participant context even when transcript speaker data was already available locally.
- **Notes:** This slice intentionally stops at prompt/context wiring. It does not redesign the Meeting View draft panel or expand into lifecycle controls, email sending, or Slack integrations.

### Let Knowledge Needs Attention read from the durable queue
- **Issue:** [#118](https://github.com/metagrover/pluto/issues/118)
- **PR:** Pending.
- **Changed:** The global Knowledge main stage now loads active durable attention items and uses them as the source of truth for the `Needs Attention` lane when they exist. Queue-backed items preserve their severity, reason, and citations, while non-global docs and empty-queue states still fall back to the existing Knowledge-doc and project-health heuristics. Focused unit coverage now proves both the queue-backed and fallback paths.
- **Why:** `#81` promises that Knowledge can read from the durable attention queue when available. Before this slice, Pluto already persisted ranked attention items from Knowledge V2 synthesis and the action tracker, but the Knowledge surface still rebuilt a disconnected heuristic list instead of reflecting the same prioritized queue.
- **Replaced:** Treating the global Knowledge `Needs Attention` lane as a local reconstruction from doc sections and project cards even when a durable ranked attention queue already existed.
- **Notes:** This slice is intentionally read-only. It does not add lifecycle controls inside Knowledge or redesign the page layout.

### Keep weak-synthesis Knowledge Current Read useful
- **Issue:** [#116](https://github.com/metagrover/pluto/issues/116)
- **PR:** Pending.
- **Changed:** Legacy structured Knowledge briefs now keep the best reliable cited statement visible as the Current Read headline even when Pluto does not have enough evidence to mark the view as fully compiled. The compiled threshold stays strict, the generic weak-synthesis fallback still appears for empty or obviously low-quality summaries, and focused tests now cover both the legacy fallback and the existing weak V2 headline path.
- **Why:** `#58` explicitly calls out the generic "Indexed knowledge needs a stronger synthesis" fallback as bad re-entry behavior when source-backed context already exists. This slice improves the shipped Knowledge surface on current `master` without weakening trust semantics or stacking on the open working-memory scope PRs.
- **Replaced:** Hiding the best available cited legacy statement behind the generic weak-synthesis headline whenever only one narrow statement survived the compiled-surface threshold.
- **Notes:** This is intentionally a narrow fallback-quality fix. It does not redesign the Knowledge layout or relax the bar for what Pluto labels as a compiled Current Read.

### Add durable Meeting View follow-up completion controls
- **Issue:** [#114](https://github.com/metagrover/pluto/issues/114)
- **PR:** Pending.
- **Changed:** Meeting View now prefers linked `action_item` entities over plain analysis prose for its follow-up rail, shows each meeting follow-up with lifecycle state, owner, due date, and source context, and lets users mark a follow-up completed or reopen it back to active through the existing durable entity-status path. When no linked action-item entities exist, the existing analysis-text fallback still renders so the surface stays useful.
- **Why:** `#61` is still the earliest unfinished roadmap outcome under Trusted Attention, and `master` still exposed meeting commitments as passive prose with no durable lifecycle control at the source meeting. This slice closes that specific gap without waiting on the open Dashboard lifecycle PR or broadening scope into draft-generation decisions.
- **Replaced:** Treating the Meeting View action-items rail as a hover-only visual treatment over summary text instead of a durable follow-up control surface tied to the extracted action-item entities.
- **Notes:** This slice intentionally stops at complete/reopen controls. Dismiss/demote/snooze flows and broader follow-up draft placement remain follow-up work under `#61`.

### Persist project-scoped working-memory snapshots for Knowledge docs
- **Issue:** [#112](https://github.com/metagrover/pluto/issues/112)
- **PR:** Pending.
- **Changed:** Expanded the durable working-memory snapshot layer to support `project` scope in addition to `global`, persisted project-scoped snapshots during project Knowledge V2 synthesis, and taught the selected project Knowledge brief to prefer a matching fresh project snapshot while preserving the existing doc-JSON fallback when the snapshot is missing, stale, invalid, or mismatched. Focused tests now cover project snapshot persistence and project brief snapshot consumption.
- **Why:** Pluto had already started persisting and consuming global working memory, but project Knowledge docs still could not use that durable path because the snapshot model and synthesis hooks were hardcoded to `global`. Landing one non-global scope proves the next foundation step without widening into person/stream scopes or new surfaces.
- **Replaced:** Treating project Knowledge docs as permanently tied to transient structured JSON even when the working-memory consumer path already existed conceptually in the UI and brief compiler.
- **Notes:** This slice is intentionally limited to project-scoped Knowledge docs. Dashboard, Ask Pluto, and broader briefing adoption remain follow-up work under `#81` and `#82`.

### Persist dashboard follow-up completion
- **Issue:** [#109](https://github.com/metagrover/pluto/issues/109)
- **PR:** Pending.
- **Changed:** Replaced the dashboard's local-only follow-up completion toggle with a durable `action_item` status update, refreshed the homepage briefing after successful completion writes, and surfaced an inline error when the write fails instead of silently claiming success.
- **Why:** `#61` requires homepage follow-up surfaces to participate in a real lifecycle. The prior checkbox only mutated React state, so completed items came back after reload and never updated Pluto's underlying action memory.
- **Replaced:** Treating dashboard completion as a cosmetic per-session toggle detached from the stored action lifecycle.
- **Notes:** This slice only covers durable completion from the Dashboard. Dismiss/demote flows, Meeting View lifecycle controls, and attention-queue-specific UI remain follow-up work under `#61`.

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

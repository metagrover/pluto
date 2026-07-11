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

## 2026-07-08

### Surface blocker-backed spotlight quick actions on the homepage
- **Issue:** [#346](https://github.com/metagrover/pluto/issues/346)
- **PR:** Pending.
- **Changed:** The homepage quick action row now uses `Review blockers` when a blocked project spotlight is the only reason Pluto is surfacing the projects CTA, with focused model and server-rendered dashboard regression coverage for that spotlight-only path.
- **Why:** `#61` still depends on homepage follow-up surfaces making blocker-backed state explicit. Before this slice, Pluto could correctly surface a blocked project in the spotlight card while the adjacent hero quick action still fell back to generic `Open projects` copy.
- **Replaced:** Treating spotlight-driven project quick actions as generic navigation even when the spotlight already carried blocker state.
- **Notes:** This intentionally stays scoped to the spotlight-only quick action path and leaves overdue/stale action-driven project labels unchanged.
### Surface blocker state in the project spotlight badge
- **Issue:** [#344](https://github.com/metagrover/pluto/issues/344)
- **PR:** Pending.
- **Changed:** The homepage project spotlight now exposes a dedicated `badgeLabel` from the dashboard model so blocked spotlight cards render `Blocked` while non-blocked spotlight states keep the generic `Projects` pill. Focused regression coverage now proves both the model output and server-rendered dashboard markup.
- **Why:** `#61` still depends on Pluto making blocker-backed follow-ups and project state explicit on homepage surfaces. Before this slice, the spotlight could already carry blocker-specific priority and detail, but the rendered badge stayed generic and hid that trust signal at a glance.
- **Replaced:** Hardcoding the spotlight badge to `Projects` even when the selected spotlight card already represented blocked project work.
- **Notes:** This intentionally stays scoped to the spotlight badge. Adjacent spotlight subtitle and hero/briefing blocker-copy slices remain tracked in their separate PRs.
### Surface blocker state in the homepage hero badge
- **Issue:** [#342](https://github.com/metagrover/pluto/issues/342)
- **PR:** Pending.
- **Changed:** The homepage hero now carries an explicit model-backed badge label, and blocker-linked follow-ups render `Blocked` instead of the generic attention label while routine overdue, stale, active, meeting, and memory states keep their prior labels. Focused model and server-rendered dashboard regressions now prove both the blocker-specific badge and the generic fallback paths.
- **Why:** `#61` still depends on the homepage earning trust as Pluto's highest-priority follow-up surface. Before this slice, linked blocker attention could already change hero ranking and detail copy, but the badge still stayed generic, which hid the exact blocker state in the most prominent dashboard affordance.
- **Replaced:** Deriving the homepage hero badge solely from coarse hero kind labels even when linked active blocker attention already made the stronger status explicit.
- **Notes:** This stays scoped to the homepage hero label treatment and intentionally does not broaden into briefing-copy or spotlight-copy changes already tracked in separate PRs.

## 2026-07-07

### Surface blocker state in dashboard action status chips
- **Issue:** [#348](https://github.com/metagrover/pluto/issues/348)
- **PR:** Pending.
- **Changed:** Blocker-backed homepage follow-up cards now spend their primary status chip on `Blocker` instead of a routine `overdue`, `stale`, or `active` label, while the linked blocker reason and follow-up controls remain unchanged. Focused server-render regression coverage now proves the action chip itself carries the blocker state and no longer duplicates it with a routine aging badge.
- **Why:** `#61` still depends on Pluto classifying blocker-backed commitments differently from routine follow-ups across homepage surfaces. Before this slice, the dashboard already carried blocker context and reason, but the strongest visual status chip still read like ordinary calendar debt, which undercut the trust work already shipping around the same cards.
- **Replaced:** Spending the follow-up card's main status chip on routine aging labels even when linked active attention had already classified the item as a blocker.
- **Notes:** This intentionally stays scoped to the dashboard renderer and existing blocker metadata. It does not change follow-up ranking, lifecycle controls, or adjacent hero, briefing, and spotlight copy still tracked in separate PRs.
### Surface blocker state in homepage briefing action labels
- **Issue:** [#336](https://github.com/metagrover/pluto/issues/336)
- **PR:** Pending.
- **Changed:** The homepage briefing-focus panel now switches its CTA to `Review blockers` when the prioritized follow-up is blocker-backed, while overdue/stale summaries and non-blocker attention paths keep the existing `Review actions` label. Focused regression coverage now proves the blocker-specific CTA without changing the surrounding dashboard layout or action target.
- **Why:** `#61` still depends on homepage follow-up surfaces reflecting Pluto's durable blocker classification consistently. Before this slice, open work on the briefing heading and detail could say the focus was blocked while the CTA still used the same generic action copy as routine attention states, which softened the urgency of the panel.
- **Replaced:** Treating the homepage briefing CTA as generic review copy even when the selected follow-up is explicitly blocked.
- **Notes:** This stays scoped to blocker-backed briefing CTA text. The adjacent blocker-specific heading and richer blocker-detail slices remain tracked in PRs `#335` and `#333`.
### Surface blocker state in homepage briefing heading
- **Issue:** [#334](https://github.com/metagrover/pluto/issues/334)
- **PR:** Pending.
- **Changed:** The homepage briefing-focus heading now switches to `Blocked follow-up` or `Blocked follow-ups` when the selected focus is a blocker-backed active commitment, while overdue/stale summary states keep the existing generic `Needs attention` title. Focused regression coverage proves the blocked-heading path without changing adjacent briefing behavior.
- **Why:** `#61` still depends on homepage follow-up surfaces classifying blockers differently from routine attention. Before this slice, Pluto could correctly select blocked work into briefing focus but still headline it with the same generic title as ordinary attention, which hid part of the trust signal it already knew.
- **Replaced:** Treating blocker-backed briefing focus as generic attention copy even after blocker-aware selection logic had already promoted that work.
- **Notes:** This stays scoped to `buildBriefingFocus(...)` title copy. Richer blocker detail remains isolated in the separate issue tracked by PR `#333`.
### Surface blocker reason in homepage briefing focus
- **Issue:** [#332](https://github.com/metagrover/pluto/issues/332)
- **PR:** Pending.
- **Changed:** The homepage briefing-focus panel now reuses the linked active blocker reason when a blocker-backed follow-up is the highest-priority active item, while keeping the existing blocked-item count as a fallback when Pluto has no richer blocker copy. Focused regression coverage now proves both the blocker-reason path and the generic fallback path.
- **Why:** `#61` still depends on homepage follow-up surfaces showing the same trustworthy context Pluto already extracted. Before this slice, the homepage hero could already surface blocker-backed detail while the adjacent briefing panel still collapsed that same commitment to generic `1 blocked item` copy.
- **Replaced:** Treating blocker-backed homepage briefing detail as count-only summary text even when linked active attention already carried a specific blocker reason.
- **Notes:** This stays scoped to briefing-focus copy in `dashboardModel.ts`. It intentionally does not reopen routine-active briefing behavior in PR `#307` or the separate duplicate blocker-reason slices.
### Surface blocker reason in the homepage hero
- **Issue:** [#330](https://github.com/metagrover/pluto/issues/330)
- **PR:** Pending.
- **Changed:** The homepage hero now reuses the linked active blocker reason when a blocker-backed overdue or active follow-up is the top commitment, while keeping the existing generic `needs attention` copy as the fallback when Pluto has no richer blocker reason. Focused regression coverage now proves the hero preserves blocker evidence instead of dropping back to generic follow-up text.
- **Why:** `#61` still depends on homepage follow-up surfaces staying as trustworthy as Pluto's durable attention data. Before this slice, the dashboard could rank the right blocked commitment first but still headline it with thin generic copy, even when the linked attention item already contained the real blocker reason.
- **Replaced:** Treating the homepage hero detail as action-name-only copy for blocker-backed follow-ups after blocker context was already available lower in the dashboard model.
- **Notes:** This intentionally stays scoped to homepage hero detail. Dashboard cards, Meeting View, follow-up drafts, sync copy, and briefing-focus behavior remain in their own focused slices and PRs.
### Preserve richer blocker reasons in synced follow-up attention
- **Issue:** [#328](https://github.com/metagrover/pluto/issues/328)
- **PR:** Pending.
- **Changed:** Blocked action attention sync now promotes the richer blocker evidence quote into the synced attention item's primary reason when that quote is available, while keeping the existing `Blocked by <name>.` fallback when Pluto has no better blocker wording. Focused regression coverage now proves both the richer-reason path and the generic fallback path.
- **Why:** `#61` depends on Pluto carrying trustworthy blocker context through the full follow-up loop. Before this slice, the sync layer already stored the richer blocker quote in evidence but still flattened the visible reason down to a generic label, which made downstream surfaces lose context Pluto already had.
- **Replaced:** Treating blocked-action attention reasons as generic labels even when the sync payload already contained a more specific blocker explanation.
- **Notes:** This stays inside `attentionSync.ts`, keeps existing blocker scoring and dedupe behavior intact, and complements the in-flight surface-level blocker-reason PRs by improving the shared upstream attention item they consume.
### Preserve richer blocker reasons on dashboard follow-up cards
- **Issue:** [#325](https://github.com/metagrover/pluto/issues/325)
- **PR:** Pending.
- **Changed:** Dashboard follow-up cards now prefer the richest linked active blocker reason when duplicate blocker alerts point at the same action, while keeping the existing blocker label and active-status priority intact. Focused regression coverage now proves a thinner or empty blocker row can no longer hide the fuller blocker explanation Pluto already has.
- **Why:** `#61` still depends on homepage follow-up surfaces surfacing trustworthy context, not just the right ranking. Before this slice, dashboard follow-up cards already showed blocker labels and reasons, but duplicate active blocker alerts still kept the first reason they saw and could drop the more useful explanation.
- **Replaced:** Treating the first active blocker alert as authoritative for dashboard follow-up reason text even when another linked active blocker carried richer context for the same commitment.
- **Notes:** This stays inside `dashboardModel.ts` and existing dashboard follow-up tests. It intentionally avoids reopening the in-flight Meeting View and follow-up draft blocker-reason slices tracked separately.
### Preserve richer duplicate blocker reasons in Meeting View
- **Issue:** [#322](https://github.com/metagrover/pluto/issues/322)
- **PR:** Pending.
- **Changed:** Meeting View follow-up cards now keep the richest linked active blocker reason when duplicate blocker attention rows point at the same action. Focused regression coverage proves Pluto no longer keeps a thinner blocker explanation just because it appeared first.
- **Why:** `#61` depends on follow-up surfaces explaining why a commitment is blocked. Before this slice, Meeting View could already show blocker state, but duplicate active blocker rows could still hide the most useful reason Pluto had for that blockage.
- **Replaced:** Treating the first active blocker row as authoritative even when a later duplicate blocker carries better context for the same follow-up.
- **Notes:** This intentionally stays narrower than the separate in-flight active-priority slice. It only upgrades duplicate active blocker reason selection on Meeting View cards.
### Prefer richer blocker reasons in follow-up drafts
- **Issue:** [#320](https://github.com/metagrover/pluto/issues/320)
- **PR:** Pending.
- **Changed:** Follow-up draft action lines now keep the richest existing blocker reason when duplicate active blocker attention rows point at the same commitment. Focused regression coverage proves Pluto no longer settles for the first shorter blocker note when durable attention already has more specific blocker context for that same action.
- **Why:** `#61` still depends on follow-up drafts reflecting the trust and lifecycle state Pluto already knows. Before this slice, duplicate active blocker rows could leave the generated draft with thinner blocker rationale than the durable attention queue already carried, which made the draft less accountable than the underlying attention data.
- **Replaced:** Keeping the first active blocker reason encountered for a draft action even when a later linked blocker already provided richer context for the same commitment.
- **Notes:** This stays scoped to `followUpDraftContext.ts`, does not reopen the mixed-status selection work on `#312`, and does not overlap the blocker-plus-aging formatting work tracked separately on `#318`.
### Keep aging lifecycle visible in blocker-backed follow-up drafts
- **Issue:** [#318](https://github.com/metagrover/pluto/issues/318)
- **PR:** Pending.
- **Changed:** Follow-up draft action lines now preserve overdue or stale lifecycle detail even when the same action is also linked to an active blocker. Focused regression coverage proves Pluto keeps both the blocker reason and the aging state in the generated draft context instead of dropping the lifecycle label.
- **Why:** `#61` depends on Pluto distinguishing blocked, overdue, and stale commitments with trustworthy source-aware context. Before this slice, the draft surface hid overdue or stale state whenever blocker attention was also present, which made the generated follow-up copy less honest than the underlying commitment model.
- **Replaced:** Treating blocker reason text as a reason to suppress aging lifecycle labels on follow-up draft action lines.
- **Notes:** This stays scoped to `followUpDraftContext.ts` and its unit tests. It does not change draft templates, dashboard ranking, or Meeting View controls.
### Prefer blocker-backed linked attention on Meeting View follow-up cards
- **Issue:** [#316](https://github.com/metagrover/pluto/issues/316)
- **PR:** Pending.
- **Changed:** Meeting View now prefers the highest-priority linked attention item for each follow-up card, so an active `blocker` row wins over a routine active `follow_up` row for the same commitment. Focused regression coverage now proves the card keeps blocker label, blocker reason, blocker-aware ordering, and active dismiss/snooze affordances when duplicate active attention rows exist.
- **Why:** `#61` still depends on Pluto classifying blocker-backed commitments differently from routine follow-ups across every active surface. Before this slice, Meeting View could bury a blocked commitment behind routine active work and strip away blocker context just because the less important linked row happened to be iterated first.
- **Replaced:** Keeping the first linked attention row per action on Meeting View cards, even when Pluto already had a stronger active blocker state for that same commitment.
- **Notes:** This stays inside `meetingActionItems.ts`, keeps scope on linked-attention selection and ordering, and intentionally avoids new Meeting View controls or broader lifecycle redesign.
### Prefer blocker attention on duplicate dashboard follow-ups
- **Issue:** [#314](https://github.com/metagrover/pluto/issues/314)
- **PR:** Pending.
- **Changed:** Dashboard follow-up cards now resolve one preferred linked attention item per action instead of keeping the first linked active row they see. Active blocker attention outranks routine active follow-up attention for the same commitment, so homepage cards keep blocker label, blocker reason, and blocker-aware ordering when duplicate active attention rows exist.
- **Why:** `#61` still depends on Pluto classifying blocker-backed commitments differently from routine follow-ups on every active surface. Before this slice, the dashboard could flatten a blocked commitment into an ordinary follow-up simply because a weaker active linked row happened to be returned first.
- **Replaced:** Selecting dashboard linked attention from first-active-row wins, even when Pluto already persisted a stronger blocker classification for the same action.
- **Notes:** This stays scoped to dashboard linked-attention selection and existing ranking/copy behavior. It intentionally does not add new controls or reopen the separate Meeting View and draft mixed-status PRs.
### Keep active follow-ups in generated draft context
- **Issue:** [#312](https://github.com/metagrover/pluto/issues/312)
- **PR:** Pending.
- **Changed:** The shared follow-up draft context builder now resolves one preferred linked attention state per action item before it suppresses dismissed or snoozed work. When duplicate linked attention rows disagree on state, an active row now keeps the action in generated follow-up drafts and preserves any active blocker reason instead of falling back to stale summary text.
- **Why:** `#61` still depends on Pluto surfacing the highest-value follow-ups consistently across meeting surfaces. Before this slice, a stale dismissed or snoozed duplicate could hide a live commitment from follow-up drafts even while Meeting View and the durable attention queue still considered that action active.
- **Replaced:** Suppressing draft action items whenever any linked attention row for the same entity was dismissed or snoozed, regardless of whether another linked attention row was still active.
- **Notes:** This stays scoped to `followUpDraftContext.ts` and the shared draft-context tests. It intentionally avoids new draft UX, lifecycle controls, or overlap with the separate Meeting View card fix in `#310`.

### Prefer active linked attention on Meeting View follow-up cards
- **Issue:** [#310](https://github.com/metagrover/pluto/issues/310)
- **PR:** Pending.
- **Changed:** Meeting View's shared follow-up card builder now prefers the highest-priority linked attention item for each action instead of keeping the first alert it sees. Active alerts outrank snoozed and dismissed ones, blocker context still wins inside the same lifecycle tier, and focused regression coverage now proves a live blocker-backed follow-up no longer renders as dismissed just because an older handled alert appeared first.
- **Why:** `#61` still depends on Meeting View reflecting Pluto's durable follow-up lifecycle honestly. Before this slice, mixed-status linked alerts could make a live follow-up show reopen affordances or lose blocker context even while the durable attention queue still had active attention on that same action.
- **Replaced:** First-write-wins linked attention selection in `buildMeetingActionItems(...)`, which could let older dismissed or snoozed alerts override the active state.
- **Notes:** This stays inside the shared Meeting View action-card builder and does not change durable attention persistence, sync semantics, or the existing lifecycle controls.

### Surface routine active follow-ups in the homepage hero
- **Issue:** [#308](https://github.com/metagrover/pluto/issues/308)
- **PR:** Pending.
- **Changed:** The homepage hero now keeps the highest-priority routine active follow-up visible when nothing is overdue, stale, or blocker-backed, reusing the same due-date-aware active ordering already used by the dashboard action-insights list. Focused regression coverage now proves Pluto no longer falls through to unrelated meeting or knowledge copy while open routine commitments remain.
- **Why:** `#61` still depends on homepage follow-up surfaces showing the highest-value commitments consistently. Before this slice, blocker-backed active follow-ups could surface in the hero, but routine active work still disappeared behind latest-meeting or knowledge fallback copy once no item crossed the overdue, stale, or blocker thresholds.
- **Replaced:** Treating the homepage hero as if routine active follow-ups were lower priority than latest-meeting or knowledge fallback content.
- **Notes:** This intentionally stays scoped to the homepage hero. Briefing-focus behavior remains in the separate routine-active slice tracked by PR `#307`.

### Surface blocker-backed active follow-ups in homepage briefing focus
- **Issue:** [#304](https://github.com/metagrover/pluto/issues/304)
- **PR:** Pending.
- **Changed:** The homepage briefing-focus panel now surfaces blocker-backed active follow-ups when nothing is overdue or stale, reusing the same blocker-aware active ordering already shipped for the dashboard action-insights list and hero. Focused regression coverage now proves Pluto no longer pairs a blocked commitment in the hero with an unrelated meeting or knowledge headline in the adjacent briefing panel.
- **Why:** `#61` still depends on homepage follow-up surfaces showing the highest-value commitments consistently. Before this slice, the hero and list could both rank a blocked active follow-up first while briefing focus still fell through to latest-meeting or knowledge fallback copy, which made the homepage contradict itself.
- **Replaced:** Treating homepage briefing focus as overdue/stale-only attention copy even after blocker-backed active follow-ups were promoted elsewhere on the dashboard.
- **Notes:** This stays scoped to `dashboardModel.ts` and existing briefing-focus copy. It intentionally does not promote routine active work into briefing focus or redesign the dashboard surface.

### Surface routine active follow-ups in the homepage briefing
- **Issue:** [#306](https://github.com/metagrover/pluto/issues/306)
- **PR:** Pending.
- **Changed:** The homepage briefing focus now stays on follow-up attention when Pluto still has routine active commitments but nothing is overdue, stale, or blocker-backed. Focused regression coverage now proves the dashboard keeps the due-soon active follow-up visible in the briefing panel instead of falling through to latest-meeting or knowledge fallback copy.
- **Why:** `#61` still depends on homepage surfaces showing the highest-value follow-ups with trustworthy priority. Even after routine active work started surfacing in the hero, the adjacent briefing panel still dropped that same work and promoted unrelated fallback context.
- **Replaced:** Treating the homepage briefing focus as follow-up attention only for overdue or stale work, with routine active commitments falling straight to meeting or knowledge fallback.
- **Notes:** This stays scoped to briefing-focus selection on top of the shipped hero behavior. It deliberately avoids reopening the blocker-backed active path already covered by `#304` / PR `#305`, and does not redesign dashboard controls.

### Surface blocker-backed active follow-ups in the homepage hero
- **Issue:** [#302](https://github.com/metagrover/pluto/issues/302)
- **PR:** Pending.
- **Changed:** The homepage hero now surfaces the highest-priority blocker-backed active follow-up when nothing is overdue or stale, reusing the existing blocker-aware active ordering from the dashboard action-insights list. Focused regression coverage now proves Pluto no longer falls through to a latest-meeting headline while a linked blocked commitment remains the most urgent active follow-up.
- **Why:** `#61` still depends on homepage surfaces showing the highest-value follow-ups with trust status. Before this slice, dashboard action insights already knew which active commitment was blocked, but the hero ignored active follow-ups entirely and could headline an unrelated meeting or document instead.
- **Replaced:** Treating the homepage hero as overdue/stale-only follow-up copy even when the dashboard already had a blocker-backed active commitment ranked at the top of its action list.
- **Notes:** This stays scoped to `dashboardModel.ts` plus the existing dashboard hero label mapping. It does not redesign dashboard copy, broaden routine active follow-ups into the hero, or change overdue/stale fallback behavior.

## 2026-07-06

### Keep blocker-backed overdue follow-ups in the homepage hero
- **Issue:** [#300](https://github.com/metagrover/pluto/issues/300)
- **PR:** Pending.
- **Changed:** The dashboard hero now reuses the same blocker-aware overdue ordering already used by the action-insights list before choosing which overdue follow-up to headline. Focused regression coverage now proves a blocker-backed overdue commitment stays in the hero even when a routine overdue item has the earlier due date.
- **Why:** `#61` depends on Pluto surfacing the highest-value homepage follow-up with trustworthy urgency. Before this slice, the dashboard list could correctly rank a blocker first while the hero still headlined a routine overdue item from plain due-date order, making the homepage contradict itself.
- **Replaced:** Choosing the homepage overdue hero detail from due-date ordering alone after blocker priority had already been introduced lower in the same dashboard model.
- **Notes:** This stays inside `dashboardModel.ts`, keeps the existing hero copy and stale/meeting/doc fallback behavior, and intentionally avoids any dashboard redesign.

### Prioritize blocker-backed homepage follow-ups
- **Issue:** [#294](https://github.com/metagrover/pluto/issues/294)
- **PR:** Pending.
- **Changed:** Dashboard follow-up ranking now checks for active linked `blocker` attention before due date inside the overdue bucket, so blocker-backed commitments surface ahead of routine overdue work while existing intra-bucket due-date ordering, stale ordering, and dedupe behavior stay intact. Focused regression coverage now proves the homepage keeps the blocked overdue item first even when its due date is later.
- **Why:** `#61` depends on Pluto surfacing the highest-value follow-ups on the homepage, not just the oldest calendar debt. Before this slice, the dashboard already knew when a follow-up was blocker-backed, but it still sorted overdue items only by due date and could bury the blocker under routine overdue work.
- **Replaced:** Treating all overdue homepage follow-ups as equally urgent once they entered the overdue bucket, regardless of linked blocker classification.
- **Notes:** This intentionally stays inside `dashboardModel.ts` and does not redesign the dashboard cards or broaden lifecycle controls.
### Preserve source meeting context on dashboard follow-up cards
- **Issue:** [#292](https://github.com/metagrover/pluto/issues/292)
- **PR:** Pending.
- **Changed:** Dashboard follow-up cards now prefer the newest loaded meeting title from active linked attention items when Pluto already has related meeting ids for that action, and they fall back to the existing domain label only when no matching meeting title is available. Focused regression coverage now proves both the model resolution path and the rendered dashboard row copy.
- **Why:** `#61` is still Pluto's earliest unfinished roadmap outcome under `#65`, and homepage follow-up cards are less trustworthy when Pluto already knows which meeting created the commitment but still shows only a generic source label like `Work`.
- **Replaced:** Treating the dashboard follow-up metadata row as domain-only copy even when linked attention context already pointed to a concrete source meeting.
- **Notes:** This stays inside the existing dashboard follow-up model and renderer, keeps current dismiss/snooze suppression and completion behavior intact, and intentionally does not overlap the separate blocker-context slice on `#290`.
### Prioritize the most urgent dashboard hero follow-up
- **Issue:** [#298](https://github.com/metagrover/pluto/issues/298)
- **PR:** Pending.
- **Changed:** The homepage hero now reuses the same overdue due-date ordering and stale recency ordering as the dashboard action-insights list before choosing which follow-up to call out. Focused regression coverage now proves the hero surfaces the most urgent overdue or stalest action instead of whichever loader row arrived first.
- **Why:** `#61` still depends on the homepage briefing earning trust as Pluto's attention surface. Before this slice, the hero could headline a less urgent follow-up than the ordered list directly beneath it, which made the dashboard contradict itself at the exact moment it was supposed to show the highest-priority commitment.
- **Replaced:** Reading the first raw overdue or stale action from the loader result when composing the homepage hero detail.
- **Notes:** This stays inside the existing dashboard model, keeps the current hero copy and action targets, and intentionally avoids reopening the separate blocker/context dashboard PR stack.

### Prioritize blocker-backed active dashboard follow-ups
- **Issue:** [#296](https://github.com/metagrover/pluto/issues/296)
- **PR:** Pending.
- **Changed:** Dashboard action insights now lift active follow-ups with linked active `blocker` attention ahead of routine active work while preserving the existing due-date tie-breaks inside that blocker bucket. Focused regression coverage now proves the homepage sorter no longer lets a routine active card outrank a true dependency just because the blocker lacks an overdue lifecycle state.
- **Why:** `#61` still requires Pluto's homepage to classify and prioritize blocker-backed commitments differently from routine follow-ups. Before this slice, blocked commitments usually stayed in the `active` entity bucket, so the dashboard sorter treated them like ordinary open work even when the durable attention queue already classified them as blockers.
- **Replaced:** Sorting all active dashboard follow-ups strictly by due date without any blocker-aware priority.
- **Notes:** This stays inside `dashboardModel.ts`, intentionally avoids reopening the in-flight dashboard copy/context PRs, and does not change overdue or stale ordering behavior.

### Prioritize fallback-only urgent draft follow-ups
- **Issue:** [#286](https://github.com/metagrover/pluto/issues/286)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now lift fallback-only action lines marked `Blocked`, `Overdue`, or `Stale` ahead of routine linked work whenever Pluto still lacks a matching linked `action_item` entity. Focused regression coverage now proves the shared draft-context builder keeps those urgent fallback lines visible at the top of the generated next steps list without changing their existing formatting.
- **Why:** `#61` depends on follow-up drafts reflecting the same urgency Pluto already extracted from meeting analysis, even before every commitment is linked into graph state. Before this slice, the draft builder preserved fallback lifecycle labels but still appended every unmatched fallback line after routine linked work, which buried the highest-friction follow-ups.
- **Replaced:** Appending all unmatched fallback draft action lines after the linked action-item list regardless of blocked, overdue, or stale lifecycle detail.
- **Notes:** This stays inside `followUpDraftContext.ts`, intentionally avoids reopening the linked-item draft ordering slice already tracked separately, and does not change Meeting View ordering or durable attention persistence.
### Remediate the undici audit gate blocker
- **Issue:** [#287](https://github.com/metagrover/pluto/issues/287)
- **PR:** Pending.
- **Changed:** Bumped Pluto's direct `undici` dependency to the patched `6.27.x` line so fresh installs resolve past the `GHSA-vxpw-j846-p89q` fragment-count denial-of-service advisory and `pnpm audit --audit-level high` returns below the pre-commit hook threshold again.
- **Why:** Pluto's required pre-commit audit hook had become a repo-wide landing blocker again, preventing ordinary code issues from committing even after their code and tests were green.
- **Replaced:** Treating the failing high-severity `undici` audit result as unrelated dependency noise while routine Builder work stayed blocked behind it.
- **Notes:** This intentionally keeps the remediation scoped to the direct dependency and lockfile. Remaining low and moderate advisories stay below the current hook threshold.

### Surface blocker context on dashboard follow-up cards
- **Issue:** [#290](https://github.com/metagrover/pluto/issues/290)
- **PR:** Pending.
- **Changed:** Dashboard follow-up insight items now carry linked active blocker classification and reason text from the durable attention queue, and the homepage renders that context directly on the existing follow-up cards with focused model and server-rendered UI regression coverage.
- **Why:** `#61` depends on Pluto surfacing trustworthy follow-up context on homepage and meeting surfaces. Before this slice, blocker-backed dashboard work still rendered like a generic action row, so the highest-friction commitments lost their why-now context unless the user opened Meeting View first.
- **Replaced:** Treating every dashboard follow-up card as the same generic title/due/source summary even when Pluto already knew the item was blocked and had a concrete blocker reason.
- **Notes:** This stays scoped to dashboard modeling and rendering. It preserves existing dismissed/snoozed suppression and completion behavior, and it does not broaden into new lifecycle controls or notification work.

## 2026-06-16

### Prioritize blocked and aging follow-ups in generated drafts
- **Issue:** [#284](https://github.com/metagrover/pluto/issues/284)
- **PR:** Pending.
- **Changed:** The shared follow-up draft context builder now ranks blocker-backed, overdue, and stale action items ahead of routine active work before formatting the draft lines. Focused regression coverage now proves the generated follow-up action list starts with the highest-friction commitments while preserving existing owner, due-date, lifecycle, and blocker-context copy.
- **Why:** `#61` depends on Pluto surfacing the highest-value commitments consistently across follow-up surfaces, not just Meeting View. Before this slice, the draft builder already rendered blocker and aging labels correctly, but it still sorted action items only by mention count and name, which could bury urgent follow-ups beneath routine active tasks in the generated draft.
- **Replaced:** Treating follow-up draft action ordering as a pure mention-count/name ranking even when Pluto already knew some linked commitments were blocked, overdue, or stale.
- **Notes:** This stays scoped to `followUpDraftContext.ts` and does not redesign draft copy, change Meeting View ordering, or modify durable attention persistence.

### Preserve fallback blocker context on Meeting View cards
- **Issue:** [#282](https://github.com/metagrover/pluto/issues/282)
- **PR:** Pending.
- **Changed:** Meeting View's shared action-card parser now treats fallback `Status: Blocked ...` analysis text as blocker-backed active work instead of generic fallback metadata. Blocked fallback cards preserve a dedicated blocker badge and reason on the existing card model, and the shared sorter now keeps those cards ahead of routine active follow-ups even when no linked durable attention item exists yet. Focused regression coverage now proves the fallback-only blocker path.
- **Why:** `#61` depends on Pluto surfacing blocked commitments honestly even before every follow-up has a linked attention item. Before this slice, fallback-only blocker lines could read like ordinary follow-ups, which weakened the trusted-attention signal on Meeting View.
- **Replaced:** Treating fallback blocker text as opaque status copy that stayed behind routine active work unless a linked blocker attention item also existed.
- **Notes:** This stays inside `meetingActionItems.ts`, preserves the existing linked blocker behavior, and does not add new lifecycle controls or redesign Meeting View.

### Add Dashboard dismiss and snooze follow-up controls
- **Issue:** [#280](https://github.com/metagrover/pluto/issues/280)
- **PR:** Pending.
- **Changed:** Dashboard follow-up cards now carry linked durable attention metadata into the homepage model and expose direct `Dismiss` and `Snooze` controls alongside the existing completion action. The dashboard persistence helper now supports attention-item lifecycle updates and refreshes the briefing after successful writes, while focused regression coverage proves both the model mapping and the new lifecycle persistence path.
- **Why:** `#61` explicitly calls out homepage follow-up surfaces, but current `master` only let users complete follow-ups from the Dashboard. False positives or low-priority items could still demand a trip into Meeting View just to dismiss or defer them, even though the homepage already respected those durable states once set elsewhere.
- **Replaced:** Treating the Dashboard as a completion-only follow-up surface that could read durable dismiss/snooze state without letting the user perform those actions in place.
- **Notes:** This stays scoped to existing Dashboard follow-up cards and the current attention lifecycle API. It does not add reminder scheduling, notifications, or broader dashboard redesign work.

### Avoid false richer-owner merges on linked Meeting View cards
- **Issue:** [#276](https://github.com/metagrover/pluto/issues/276)
- **PR:** Pending.
- **Changed:** Matching linked Meeting View action cards now preserve richer fallback owner-role text only when the normalized linked and fallback owner names actually match. Focused regression coverage now proves both the valid richer-label path and the false-positive guard, so `Sarah Chen` can still expand to `Sarah Chen (Head of Product)` while a linked owner like `Alex` no longer gets silently rewritten to a different person such as `Alex Rivera`.
- **Why:** `#61` depends on follow-up cards preserving trustworthy accountability context. Before this slice, the shared Meeting View merge path reused a generic substring-based richer-label helper, so a longer fallback owner string could overwrite a shorter linked owner label even when Pluto had no evidence they referred to the same person.
- **Replaced:** Treating any longer fallback owner label that contained the linked owner text as automatically richer and therefore authoritative.
- **Notes:** This stays inside `meetingActionItems.ts`, keeps existing linked owner resolution behavior, and does not redesign Meeting View or change follow-up draft formatting.

### Preserve fallback-completed Meeting View affordances
- **Issue:** [#273](https://github.com/metagrover/pluto/issues/273)
- **PR:** Pending.
- **Changed:** Linked Meeting View action cards now recompute their completion toggle after merging fallback lifecycle state, so a card upgraded to `completed` by fallback analysis text renders the matching `Reopen` affordance instead of keeping the active `Mark complete` label. Focused regression coverage now proves the shared merge path keeps status and affordance in sync.
- **Why:** `#61` depends on the commitment surface staying internally consistent. Before this slice, a sparse linked action could render as completed while still advertising the active completion action, which made Pluto's lifecycle state feel contradictory.
- **Replaced:** Deriving the toggle affordance only from the pre-merge linked entity status even when fallback analysis had already promoted the card to a completed lifecycle.
- **Notes:** This stays inside `meetingActionItems.ts` and preserves the existing overdue/stale merge behavior plus current Meeting View controls.

### Prioritize overdue and stale fallback Meeting View follow-ups
- **Issue:** [#267](https://github.com/metagrover/pluto/issues/267)
- **PR:** Pending.
- **Changed:** Meeting View's shared action-card builder now reorders merged linked and fallback follow-up cards once after merge, so fallback-only cards marked `overdue`, `stale`, or `completed` participate in the same lifecycle urgency pass instead of always appending after linked work. Focused regression coverage now proves overdue and stale fallback cards surface ahead of routine active linked work while existing linked-card blocker priority and intra-bucket ordering stay intact.
- **Why:** `#61` requires Pluto to surface the highest-value follow-ups with lifecycle context even before every follow-up has a linked `action_item` entity. Before this slice, Pluto could already parse `Status: Overdue` and `Status: Stale` from fallback analysis text, but it still buried those cards beneath routine active linked work.
- **Replaced:** Appending all unmatched fallback follow-up cards after the linked-card list regardless of lifecycle urgency.
- **Notes:** This intentionally stays inside `meetingActionItems.ts` and does not redesign Meeting View or broaden lifecycle persistence behavior.

### Clear the high-severity pre-commit audit blocker
- **Issue:** [#270](https://github.com/metagrover/pluto/issues/270)
- **PR:** Pending.
- **Changed:** Bumped Pluto's direct `vite` dependency to the patched `7.3.5` line and tightened `pnpm.overrides` so the vulnerable transitive `esbuild`, `tmp`, and `form-data` packages now resolve to patched versions in the shared lockfile. `pnpm audit --audit-level high` is back below the hook threshold on fresh `master`.
- **Why:** Pluto's required pre-commit audit hook had become a repo-wide landing blocker again, which prevented ordinary code issues like `#267` from committing even after their code and tests were already green.
- **Replaced:** Treating the repo's failing high-severity audit gate as unrelated dependency noise while routine Builder work stayed blocked behind it.
- **Notes:** This is intentionally the smallest safe dependency remediation. The remaining low and moderate advisories stay below the current hook threshold and are left for later cleanup.

## 2026-06-09

### Ignore outdated snapshots in Knowledge Needs Attention
- **Issue:** [#268](https://github.com/metagrover/pluto/issues/268)
- **PR:** Pending.
- **Changed:** `compileNeedsAttention(...)` now refuses a matching working-memory snapshot when the source Knowledge doc has been synthesized more recently, aligning the Needs Attention consumer path with the existing snapshot-validity checks already used by the compiled brief path. Focused regression coverage now proves project-scope Needs Attention falls back to fresher doc JSON instead of rendering stale snapshot-backed follow-ups.
- **Why:** `#81` requires working-memory-backed Knowledge to degrade honestly when snapshot state is stale or outdated. Before this slice, Pluto could keep showing snapshot-backed blockers or follow-ups with undue confidence even after fresher Knowledge synthesis was already available.
- **Replaced:** Treating scope/doc-id matches as sufficient for Needs Attention snapshot preference even when the snapshot predates the latest doc synthesis.
- **Notes:** This stays inside the shared Knowledge consumer path and preserves the existing fallback behavior for genuinely stale snapshots and non-snapshot project-card heuristics.

## 2026-06-08

### Keep stale working-memory snapshots usable as explicit Knowledge fallback
- **Issue:** [#235](https://github.com/metagrover/pluto/issues/235)
- **PR:** Pending.
- **Changed:** Knowledge brief compilation now allows a matching working-memory snapshot with `freshness: stale` to remain usable when the live Knowledge doc surface is unavailable, instead of dropping the durable memory state entirely. Focused regression coverage now proves failed docs can still render the stale snapshot headline and trust state, while the existing stale-snapshot guard for fresh usable doc JSON remains intact.
- **Why:** `#80` requires weak or stale evidence states to stay explicit and useful. Before this slice, the shared Knowledge consumer path rejected stale snapshots unconditionally, which could leave Pluto showing no current read even when it still had durable but aging memory state.
- **Replaced:** Treating stale working-memory snapshots as unusable in every consumer case, even when the alternative was an empty or failed Knowledge surface.
- **Notes:** This stays narrowly scoped to the Knowledge brief fallback path. Fresh or newer doc JSON still wins when available, and the separate snapshot-source labeling fix remains in flight on PR `#234`.

### Align snapshot-backed Knowledge trust with rendered freshness
- **Issue:** [#249](https://github.com/metagrover/pluto/issues/249)
- **PR:** Pending.
- **Changed:** Snapshot-backed Knowledge briefs now derive their trust label from the rendered Current Read evidence freshness instead of passing through the stored snapshot trust flag unchanged. Aging snapshot evidence degrades from `Grounded` to `Inferred`, unknown snapshot freshness degrades to `Weak evidence`, and focused regression coverage now proves both cases in `compileKnowledgeBrief(...)`.
- **Why:** `#81` requires working-memory-backed Knowledge to degrade honestly when durable state becomes weaker or less fresh. Before this slice, a snapshot-backed brief could keep showing a fully grounded trust badge even when the rendered evidence was no longer fresh enough to support that claim.
- **Replaced:** Treating the persisted snapshot trust flag as authoritative for snapshot-backed Current Read trust labels even after the rendered evidence freshness had degraded.
- **Notes:** This stays inside the snapshot-backed Knowledge consumer path. It does not redesign the Knowledge UI or change the shared doc-backed trust-status utility.

### Preserve snapshot change summaries
- **Issue:** [#231](https://github.com/metagrover/pluto/issues/231)
- **PR:** Pending.
- **Changed:** Working-memory snapshots now preserve the Knowledge V2 document's structured `change_summary` metadata (added, removed, and updated counts, plus notable changes list) when converting documents to snapshots and back. Focused unit tests now cover both snapshot-payload and document-parser changes.
- **Why:** `#80` defines working-memory snapshots as Pluto's durable operational state, including recent changes. Before this slice, recent-change state existed in the source Knowledge V2 document but disappeared as soon as Pluto persisted and re-read a snapshot, leaving the durable memory layer incomplete.
- **Replaced:** Treating working-memory snapshots as if current read and evidence were enough durable state even when the source Knowledge document also tracked recent changes that downstream snapshot-backed consumers may need.
- **Notes:** This keeps the fix scoped to the snapshot schema and conversion path; it does not redesign Knowledge surfaces or add new recent-change UI in this PR.

### Prioritize overdue and stale Meeting View follow-ups
- **Issue:** [#265](https://github.com/metagrover/pluto/issues/265)
- **PR:** Pending.
- **Changed:** Meeting View's shared linked action-card sorter now ranks `overdue` and `stale` follow-ups ahead of routine `active` work while keeping completed items demoted and preserving the existing mention-count and recency tie-breakers inside each lifecycle bucket. Focused regression coverage now proves overdue and stale commitments stay ahead of routine active cards on current `master`.
- **Why:** `#61` remains the earliest unfinished roadmap outcome under `#65`, and Pluto's trusted-attention promise weakens when routine active commitments can bury follow-ups the app already considers overdue or aging.
- **Replaced:** Treating routine active linked follow-ups as higher priority than `overdue` and `stale` commitments in the shared Meeting View sorter.
- **Notes:** This is intentionally limited to lifecycle ordering in `meetingActionItems.ts`; it does not redesign Meeting View or overlap the separate blocker/classification slices already open in the PR queue.

### Surface linked attention classification on Meeting View follow-up cards
- **Issue:** [#250](https://github.com/metagrover/pluto/issues/250)
- **PR:** Pending.
- **Changed:** Meeting View follow-up cards now render a dedicated attention kind badge (e.g. `Blocker`, `Risk`, `Dependency`, `Open question`, `Stale context`, `Follow-up`) derived from the linked attention item instead of rendering a generic `Summary` or `Action Item` title badge. Focused regression coverage now proves the attention kind badge mapping survives the shared card builder.
- **Why:** `#61` remains the earliest unfinished roadmap outcome under `#65`, and follow-up cards are less actionable when Pluto hides attention classification details it already knows.
- **Replaced:** Showing a generic `Action Item` status badge on Meeting View cards even when Pluto had a more specific attention classification on the linked attention item.
- **Notes:** This stays inside the existing Meeting View action-card model and metadata badges; it does not redesign the card layout or modify the completion/snooze/dismiss affordances.

### Deprioritize dismissed and snoozed Meeting View follow-up cards
- **Issue:** [#263](https://github.com/metagrover/pluto/issues/263)
- **PR:** Pending.
- **Changed:** Meeting View's shared action-card sorter now demotes snoozed and dismissed follow-ups behind active commitments. Routine active commitments and stale follow-ups stay prioritized, snoozed follow-ups rank next (with their toggle action disabled but snooze-reopen allowed), and dismissed follow-ups rank last (with their toggle disabled and dismiss-reopen allowed). Focused regression coverage now proves the relative order of active, snoozed, and dismissed follow-ups.
- **Why:** `#61` requires Meeting View to focus attention on active commitments first. Before this slice, a dismissed or snoozed follow-up could stay sorted at the top of the meeting card list due to high mention counts or recency, burying active follow-ups that actually needed attention.
- **Replaced:** Sorting dismissed and snoozed follow-up cards using only their base entity creation time and mention counts instead of first demoting them behind active work.
- **Notes:** This stays inside the shared action-card builder and sorter. The dismiss and snooze toggle labels (`Reopen`, `Snooze`, `Dismiss`) are unchanged.

### Prioritize active blocker cards on Meeting View
- **Issue:** [#248](https://github.com/metagrover/pluto/issues/248)
- **PR:** Pending.
- **Changed:** Meeting View's shared linked action-card sorter now ranks active blocker-backed follow-ups ahead of all other active commitments, regardless of mention counts or creation recency. Focused regression coverage now proves active blockers sort first on `master`.
- **Why:** `#61` is about highlighting the most critical commitments. An active blocker follow-up should never be buried behind routine active work just because the routine work has a higher mention count or was mentioned more recently.
- **Replaced:** Letting mention counts and creation time sort routine active commitments ahead of active blockers in the shared Meeting View sorter.
- **Notes:** This stays inside the shared action-card sorter in `meetingActionItems.ts` and does not change individual card layout or lifecycle state.

### Preserve linked Meeting View action topics
- **Issue:** [#246](https://github.com/metagrover/pluto/issues/246)
- **PR:** Pending.
- **Changed:** Meeting View follow-up cards now preserve linked `action_item.topic_id` context by mapping it to a human-readable topic label using the meeting's existing topic entities. If a topic match exists, the card badge row renders it as `topicLabel` instead of dropping it, and focused regression coverage now proves the topic resolution path.
- **Why:** `#61` requires follow-up cards to preserve the structured context Pluto already knows. Before this slice, the card builder parsed and rendered fallback topic context but silently dropped linked topic context as soon as a linked action entity was matched.
- **Replaced:** Treating linked action-item topic associations as disposable metadata instead of resolving them to human-readable topic labels on Meeting View cards.
- **Notes:** This stays inside the existing Meeting View action-card model and metadata row, so it remains a focused trust/context fix rather than a surface redesign.

### Resolve linked Meeting View action owners to participant names
- **Issue:** [#241](https://github.com/metagrover/pluto/issues/241)
- **PR:** Pending.
- **Changed:** Meeting View follow-up cards now resolve linked `action_item.assigned_to` person ids through the meeting's existing person entities before rendering owner labels. If Pluto cannot resolve the id to a linked participant, the card keeps the existing raw owner string instead of hiding the value or crashing. Focused regression coverage now proves both the resolved-owner and unresolved-owner paths.
- **Why:** `#61` is still Pluto's earliest unfinished roadmap outcome under `#65`, and the Meeting View follow-up surface should preserve accountable names that Pluto already knows. Before this slice, linked action cards could show raw ids like `person-1`, making the same follow-up card less trustworthy than the adjacent draft path.
- **Replaced:** Passing linked action owners through verbatim on Meeting View cards even when the same meeting already had the participant entity needed to render a real owner name.
- **Notes:** This stays inside the shared Meeting View action-card builder and intentionally does not change lifecycle controls, alert sync semantics, or the surrounding card layout.

### Surface blocker context on Meeting View action cards
- **Issue:** [#239](https://github.com/metagrover/pluto/issues/239)
- **PR:** Pending.
- **Changed:** Meeting View action cards now preserve linked blocker attention context through the shared `buildMeetingActionItems(...)` path. Linked follow-ups render a `Blocked` marker when the linked attention item is a blocker, show the blocker reason as supporting copy on the existing card surface, and keep the current completion, dismiss, and snooze affordances unchanged. Focused regression coverage now proves the blocker context survives the shared card-builder path.
- **Why:** `#61` remains Pluto's earliest unfinished roadmap outcome under `#65`, and the commitment surface should explain what is blocked and by what instead of flattening blocker-backed follow-ups into ordinary action cards. Before this slice, Meeting View already fetched linked blocker `kind` and `reason` metadata, but the shared card builder dropped it before the renderer could use it.
- **Replaced:** Treating blocker-backed follow-ups as ordinary action cards with no blocker explanation even when Pluto already had durable blocker metadata on the linked attention item.
- **Notes:** This stays inside the existing Meeting View action-card model and renderer; it does not change lifecycle persistence, attention sync semantics, or follow-up draft behavior.

### Surface blocker classification in Knowledge
- **Issue:** [#251](https://github.com/metagrover/pluto/issues/251)
- **PR:** Pending.
- **Changed:** Knowledge Needs Attention compilation now maps linked attention item kind `blocker` to a dedicated `Blocker` category in the output items instead of placing them under the generic `Follow-up` category. Focused unit tests now verify blocker classification is preserved.
- **Why:** `#81` requires working-memory attention loops to present clear taxonomy to users so that critical blockers are highlighted.
- **Replaced:** Grouping blocker-backed attention items with generic follow-up items in compiled Needs Attention output.
- **Notes:** This change is scoped to the compiled Needs Attention adapter path and does not change database schema or main knowledge brief structure.

### Preserve fallback topic context in Meeting View action cards
- **Issue:** [#237](https://github.com/metagrover/pluto/issues/237)
- **PR:** Pending.
- **Changed:** Meeting View fallback follow-up cards now preserve `Topic: ...` metadata from analysis-backed action lines instead of dropping it during card parsing. The action-card model exposes a dedicated topic label, the existing badge row renders it alongside the current owner/status/due metadata, and focused regression coverage now proves fallback topic context survives the parser.
- **Why:** `#61` is still Pluto's earliest unfinished roadmap outcome under `#65`, and the Meeting View follow-up surface should keep the source context Pluto already knows. Before this slice, fallback cards could keep owner/due/status/context detail but still lose the topic that explained why the follow-up mattered.
- **Replaced:** Treating fallback `Topic:` metadata as disposable text instead of first-class Meeting View action-card context.
- **Notes:** This stays inside the existing fallback action-card parser and renderer; it does not redesign Meeting View or broaden lifecycle controls.

### Preserve unmatched fallback action cards in Meeting View
- **Issue:** [#229](https://github.com/metagrover/pluto/issues/229)
- **PR:** Pending.
- **Changed:** Meeting View now keeps unmatched fallback follow-up lines visible even when some linked `action_item` entities already exist. Linked cards still stay authoritative for lifecycle and attention controls, while fallback-only cards continue to surface parsed owner, due, status, and context metadata after the linked list. Focused regression coverage now proves unmatched fallback items are preserved without duplicating matched linked cards.
- **Why:** `#61` is still Pluto's earliest unfinished roadmap outcome under `#65`, and the Meeting View follow-up surface is incomplete if linked graph coverage hides remaining actionable follow-up context from the same meeting analysis. Before this slice, `buildMeetingActionItems(...)` returned only linked cards whenever any linked action existed, so unmatched fallback follow-ups silently disappeared.
- **Replaced:** Treating the presence of any linked action-item entity as a reason to discard every fallback action line instead of merging in fallback-only cards that Pluto still needs to show.
- **Notes:** This stays inside the existing Meeting View action-card builder and preserves current sorting plus linked attention affordances.

## 2026-06-06

### Preserve sparse linked action-card metadata in Meeting View
- **Issue:** [#225](https://github.com/metagrover/pluto/issues/225)
- **PR:** Pending.
- **Changed:** Meeting View action cards now merge fallback analysis metadata back into matching linked `action_item` cards when the linked entity is thinner. Linked cards preserve fallback owner, due, context, and custom status text instead of dropping those fields as soon as any matching linked action entity exists, and focused unit coverage now proves the merge behavior.
- **Why:** `#61` is still Pluto's earliest unfinished Phase 1 roadmap outcome under `#65`, and the commitment surface should keep the best accountability detail Pluto already knows. Before this slice, the card builder treated any linked action entity as authoritative enough to discard richer fallback analysis text, which made follow-up cards less actionable precisely when partial graph linking existed.
- **Replaced:** Returning raw linked action cards without reusing matching fallback metadata unless linked action entities were missing entirely.
- **Notes:** This stays inside the existing Meeting View action-card builder and keeps linked lifecycle state authoritative unless the fallback carries a richer overdue/stale/completed lifecycle.

## 2026-06-02

### Preserve fallback decision owner-role detail in follow-up drafts
- **Issue:** [#227](https://github.com/metagrover/pluto/issues/227)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now preserve richer fallback `Decided by: ... (...)` role detail when the same decision is also represented by a thinner linked V3 decision owner, while still preferring linked decision-owner data when Pluto has something more specific. Focused regression coverage now proves the shared draft merge keeps that role-aware accountability detail instead of collapsing it to a bare name.
- **Why:** `#61` is only trustworthy if the shared draft path keeps the best decision accountability context Pluto already knows. Before this slice, a linked V3 decision with just `Sarah Chen` could silently overwrite a richer fallback line like `Decided by: Sarah Chen (Head of Product)`, making the same decision read less specific once linked context was present.
- **Replaced:** Treating any linked `decided_by` value as authoritative even when the fallback decision line already carried richer role detail for the same person.
- **Notes:** This stays inside the shared follow-up draft formatter, so both default drafts and regenerated drafts inherit the same owner-role preservation behavior without a Meeting View redesign.

### Preserve fallback follow-up card metadata in Meeting View
- **Issue:** [#215](https://github.com/metagrover/pluto/issues/215)
- **PR:** Pending.
- **Changed:** Meeting View follow-up cards now parse fallback analysis detail into structured card metadata when linked `action_item` entities are missing. Fallback cards keep the base action text in the title, surface owner and due values through the existing badge row, reuse context as supporting copy, and preserve non-lifecycle fallback status text as a dedicated status label instead of burying everything inside one long summary string. Focused regression coverage now proves the fallback-card parser.
- **Why:** `#61` is still Pluto's earliest unfinished roadmap outcome under `#65`, and the Meeting View follow-up surface should stay readable even when the entity graph is incomplete. Before this slice, Pluto already had fallback follow-up detail from meeting analysis, but the card path discarded it and rendered a generic `Summary` pill with inline metadata noise.
- **Replaced:** Treating fallback follow-up items as opaque strings instead of structured Meeting View cards whenever linked action entities were unavailable.
- **Notes:** This stays inside the existing Meeting View action-card path and reuses the current UI affordances rather than redesigning the surface.

### Preserve linked action-item owner role detail in follow-up drafts
- **Issue:** [#216](https://github.com/metagrover/pluto/issues/216)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now preserve richer fallback `Owner: ... (...)` role detail when the same action item is also linked through meeting entities whose person metadata is thinner, while still preferring linked owner-role metadata when Pluto has something more specific. Focused regression coverage now proves the shared draft-context merge keeps that owner-role accountability detail instead of collapsing to a bare name.
- **Why:** `#61` is only trustworthy if the shared draft path keeps the best accountability context Pluto already knows. Before this slice, a linked person entity with just `Sarah Chen` could silently overwrite a richer fallback line like `Owner: Sarah Chen (Head of Product)`, making the same follow-up read less specific once linked context was present.
- **Replaced:** Letting linked action-entity dedupe treat any linked owner name as authoritative even when the fallback draft line already carried a richer owner role label for the same person.
- **Notes:** This remains inside the shared follow-up draft context helper, so both default drafts and regenerate prompts inherit the same owner-role preservation behavior without a Meeting View redesign.

### Preserve fallback decision detail in follow-up drafts
- **Issue:** [#221](https://github.com/metagrover/pluto/issues/221)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now preserve richer fallback decision detail when the matching V3 decision record is thinner. Existing `Topic:`, `Decided by:`, and `Why:` detail from the fallback draft path now survives the V3 decision merge instead of collapsing back to bare decision text, and focused follow-up draft tests cover that regression.
- **Why:** `#61` is still Pluto's earliest unfinished roadmap outcome under `#65`, and the shared follow-up draft path is only trustworthy if it keeps the most specific decision context Pluto already knows. Before this slice, V3 decision dedupe could silently throw away accountability and rationale detail that had already been derived earlier in the formatter.
- **Replaced:** Treating any matching V3 decision text as authoritative enough to overwrite richer fallback decision context even when the V3 record added less metadata.
- **Notes:** This stays inside the shared follow-up draft formatter, so both default drafts and regenerated drafts inherit the same richer decision lines without a Meeting View redesign.

### Let People and Team Knowledge docs consume durable snapshots
- **Issue:** [#217](https://github.com/metagrover/pluto/issues/217)
- **PR:** Pending.
- **Changed:** Knowledge now treats `person_context` and `team_tracker` docs as snapshot-backed consumers just like global and project docs. The shared snapshot eligibility and conversion path now accepts those scopes, the main Knowledge stage loads their matching durable snapshots, and focused regression coverage proves People and Team docs prefer matching snapshot-backed Current Read output over transient doc JSON.
- **Why:** `#81` is still an active Phase 2 Working Memory umbrella under `#65`, and the persistence slices for people/team snapshots were incomplete until the Knowledge consumer path could actually read them. Before this fix, Pluto could persist fresher durable memory for People and Team docs but still render older transient synthesis output because both the fetch gate and snapshot adapter rejected those scopes.
- **Replaced:** Treating working-memory snapshots as a global/project-only Knowledge feature even after Pluto started persisting equivalent durable state for person-context and team-tracker docs.
- **Notes:** Existing fallback behavior for stale, missing, invalid, or older-than-synthesis snapshots stays unchanged; this only widens the eligible Knowledge scopes to the durable snapshot types already supported by persistence.

### Let People and Team Knowledge Needs Attention prefer snapshots
- **Issue:** [#223](https://github.com/metagrover/pluto/issues/223)
- **PR:** Pending.
- **Changed:** `compileNeedsAttention(...)` now accepts matching `person_context` and `team_tracker` working-memory snapshots alongside the existing global/project scopes, so People and Team Knowledge docs can render durable snapshot-backed open loops instead of falling back to older doc JSON risk heuristics. Focused regression coverage now proves the snapshot-backed `Needs Attention` path for both scopes.
- **Why:** `#81` is about making Knowledge V2 consume durable working-memory state consistently. Before this slice, even after matching People/Team snapshots existed, Pluto still hard-blocked `Needs Attention` for those scopes to the fallback doc path and could hide fresher open-loop state.
- **Replaced:** Treating snapshot-backed `Needs Attention` as a global/project-only capability even though the same durable payload already exists for person and team scopes.
- **Notes:** This change stays inside the Knowledge consumer path and preserves the existing fallback behavior for stale, missing, invalid, or mismatched snapshots.

### Preserve rich linked decision detail in follow-up drafts
- **Issue:** [#204](https://github.com/metagrover/pluto/issues/204)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now keep the richer V3 decision detail Pluto already generated when a linked decision entity matches the same item. Topic labels, decision-owner attribution, and rationale survive the linked-entity dedupe path instead of collapsing back to a bare or rationale-only decision line, and focused follow-up draft tests now cover that merge behavior.
- **Why:** `#61` is still Pluto's earliest unfinished roadmap outcome under `#65`, and the shared draft path is only trustworthy if it preserves accountability context Pluto already knows. Before this slice, the linked-decision pass could silently drop `Topic:` and `Decided by:` detail even though the earlier formatter had already derived it.
- **Replaced:** Treating linked decision entities as a reason to overwrite richer V3 draft lines instead of using them as the canonical dedupe key while preserving the best available detail.
- **Notes:** This change stays inside the shared follow-up draft formatter, so both default drafts and regenerated drafts inherit the same richer decision output without a Meeting View redesign.

### Preserve linked action-item status and context detail in follow-up drafts
- **Issue:** [#213](https://github.com/metagrover/pluto/issues/213)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now preserve fallback `Status: ...` and `Context: ...` detail when the same action item is also linked through meeting entities whose graph metadata is thinner, while still preferring linked overdue/stale lifecycle, blocker reasons, owner formatting, due dates, and explicit meeting context when Pluto has richer linked data. Focused regression coverage now proves the shared draft-context merge keeps those fallback detail labels instead of collapsing to topic-only output.
- **Why:** `#61` requires follow-up drafts to reuse the accountability nuance Pluto already knows. Before this slice, the stacked draft-context path could still strip lifecycle and context detail that had already been derived from meeting analysis, making linked follow-ups read less actionable or less urgent than the source analysis intended.
- **Replaced:** Letting linked action-entity dedupe flatten status/context-aware fallback draft lines down to whichever thinner metadata happened to exist on the linked entity.
- **Notes:** This remains inside the shared follow-up draft context helper, so both default drafts and regenerate prompts keep the same richer action-line behavior.

### Preserve linked action-item owner and due detail in follow-up drafts
- **Issue:** [#211](https://github.com/metagrover/pluto/issues/211)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now preserve fallback `Owner: ...` and `Due: ...` detail when the same action item is also linked through meeting entities whose graph metadata is thinner, while still preferring linked lifecycle state, blocker context, role-aware owner formatting, and per-meeting context whenever Pluto has richer linked data. Focused regression coverage now proves the shared draft-context merge keeps those fallback accountability details instead of dropping them.
- **Why:** `#61` requires follow-up drafts to reuse the meeting accountability context Pluto already knows. Before this slice, linked-entity dedupe could silently strip owner and due detail that had already been derived from V3 analysis, making the same follow-up read less actionable once linked context was present.
- **Replaced:** Letting linked action-entity dedupe collapse owner/due-aware fallback draft lines down to topic-plus-context output when the linked entity lacked equivalent metadata.
- **Notes:** This stays inside the shared follow-up draft context helper, so both default drafts and regenerate prompts keep the same richer action-line behavior.

### Preserve linked action-item topic detail in follow-up drafts
- **Issue:** [#209](https://github.com/metagrover/pluto/issues/209)
- **PR:** Pending.
- **Changed:** Meeting follow-up drafts now preserve the richer `Topic: ...` detail already derived from V3 `all_action_items` even when the same action is also linked through meeting entities, while still preferring linked owner, due date, lifecycle, blocker, and context metadata for the rest of the line. Focused regression coverage now proves the shared draft-context merge keeps that topic detail instead of collapsing back to the linked entity string.
- **Why:** `#61` requires follow-up drafts to reuse the meeting context Pluto already knows. Before this slice, the shared merge path could silently discard action-item topic context that had already been added on current `master`, making the same follow-up read less specific once linked-entity metadata was present.
- **Replaced:** Letting linked action-entity dedupe flatten topic-aware fallback draft lines back into owner/due-only output.
- **Notes:** This stays inside the shared follow-up draft context helper, so both default drafts and regenerate prompts keep the same richer action-line behavior.

### Unblock pre-commit audit by remediating vulnerable Vitest
- **Issue:** [#205](https://github.com/metagrover/pluto/issues/205)
- **PR:** Pending.
- **Changed:** Pluto now resolves Vitest to the patched `4.1.x` line instead of `4.0.18`, and the lockfile refresh removes the repo's current critical `pnpm audit --audit-level high` failure on advisory `GHSA-5xrq-8626-4rwp`.
- **Why:** The pre-commit audit hook had become a delivery blocker for ordinary code issues like `#204`, because any code commit hit the existing critical Vitest advisory before it could ship.
- **Replaced:** Accepting a known critical audit failure in the shared commit path while treating it as unrelated dependency noise.
- **Notes:** This is intentionally the smallest safe dependency remediation. The existing moderate/low audit findings remain below the current hook threshold and were left untouched in this slice.

## 2026-05-31

### Add evidence drilldown for Knowledge Active Streams
- **Issue:** [#169](https://github.com/metagrover/pluto/issues/169)
- **PR:** Pending.
- **Changed:** The Knowledge main stage now gives each Active Streams card a `Why?` affordance that opens the existing evidence sheet with stream-specific reasoning, confidence, and any matching evidence-index snippets. Stream evidence lookup now matches by `stream_ids` before falling back to broader citation-level context, and focused Knowledge render coverage now proves the affordance is present.
- **Why:** Phase 2's shared working-memory surfaces are only trustworthy if important surfaced items can explain themselves. On current `master`, Active Streams looked important but exposed no item-level path back to evidence, unlike adjacent `Needs Attention` and `Risks and Unknowns` cards.
- **Replaced:** Treating Active Streams as read-only summary cards with no direct evidence drilldown even when the Knowledge evidence index already linked snippets to those streams.
- **Notes:** This slice intentionally reuses the existing right-side evidence sheet and does not redesign stream ranking, persistence, or layout.
### Add evidence drilldown for Knowledge Current Read bullets
- **Issue:** [#167](https://github.com/metagrover/pluto/issues/167)
- **PR:** Pending.
- **Changed:** Current Read supporting bullets in Knowledge now expose the same `Why?` affordance already used by Needs Attention and Risks/Unknowns. The action reuses the existing evidence sheet and prefers matching `evidence_index` snippets over bare citation fallback when Pluto has richer meeting context.
- **Why:** `#58` requires important surfaced Knowledge items to explain why Pluto believes them. Before this slice, Current Read could show the headline and supporting bullets but left those claims as the only major Knowledge items without an item-level path back to source evidence.
- **Replaced:** Treating Current Read bullets as static prose even when Pluto already had a reusable evidence sheet and linked citation data for adjacent Knowledge surfaces.
- **Notes:** This is intentionally a focused UI/evidence traceability slice. It does not redesign the Current Read layout or change ranking, synthesis, or trust-status semantics.
### Preserve Current Read evidence quality across snapshot-backed Knowledge views
- **Issue:** [#165](https://github.com/metagrover/pluto/issues/165)
- **PR:** Pending.
- **Changed:** Working-memory snapshots now persist `current_read.evidence_quality`, snapshot-backed Knowledge briefs restore that preserved evidence metadata instead of rebuilding it heuristically, and the Current Read trust panel now shows the rendered evidence mode, confidence, and freshness details. Focused regressions cover snapshot persistence, snapshot-backed brief restoration, the legacy-snapshot fallback path, and the Current Read render output.
- **Why:** `#81` already makes Knowledge Current Read prefer durable working-memory snapshots, but snapshot-backed briefs were still dropping the compiled evidence-quality details that explain how grounded the rendered read actually is. Surfacing the same evidence metadata in the trust panel keeps snapshot-backed re-entry honest and aligned with the source Knowledge doc.
- **Replaced:** Reconstructing snapshot-backed Current Read evidence quality from trust-status heuristics and showing only the generic trust label even when Pluto had already compiled more precise evidence metadata.
- **Notes:** Legacy snapshots that predate this payload field still render through the existing heuristic fallback so previously persisted state remains usable.
### Preserve snapshot-backed Current Read cited-item coverage
- **Issue:** [#163](https://github.com/metagrover/pluto/issues/163)
- **PR:** Pending.
- **Changed:** Working-memory snapshots now persist `current_read.cited_item_count`, and snapshot-backed Knowledge brief compilation restores that exact cited-item coverage instead of reconstructing it from open-loop, pattern, and risk arrays. Focused regressions now cover both snapshot persistence and the snapshot-backed Current Read coverage path.
- **Why:** `#81` promises that Knowledge can render from durable working-memory state without losing evidence semantics. Before this slice, snapshot-backed Current Read could show the wrong cited-item badge even when the compiled Knowledge doc had already established a different evidence count.
- **Replaced:** Recomputing snapshot-backed Current Read cited-item coverage from adjacent arrays instead of preserving the compiled `current_read` evidence metadata that produced the visible brief.
- **Notes:** This is intentionally a narrow metadata-preservation fix. It does not redesign the Knowledge UI or overlap the open freshness, source-count, or source-quality metadata slices.
### Preserve source-quality detail in snapshot-backed Knowledge briefs
- **Issue:** [#161](https://github.com/metagrover/pluto/issues/161)
- **PR:** Pending.
- **Changed:** Working-memory snapshots now preserve `source_quality_summary` from compiled Knowledge V2 documents, and snapshot-backed Knowledge brief compilation now surfaces that preserved included/excluded/weak-source detail back into the Current Read trust panel instead of dropping it. Focused unit coverage now proves both snapshot persistence and snapshot-backed brief rendering of the summary.
- **Why:** `#81` and `#80` require generated Knowledge surfaces to read from durable working memory without losing the trust context that made the original synthesis honest. Before this slice, Pluto could correctly prefer a persisted snapshot for Current Read while silently stripping the source-quality summary users need to judge coverage.
- **Replaced:** Treating snapshot-backed Knowledge views as a thinner trust surface than the compiled Knowledge V2 document they were derived from.
- **Notes:** This slice keeps the existing UI and snapshot selection rules intact. It only restores preserved source-quality detail when a valid snapshot already exists.
### Align Knowledge Current Read source counts with rendered backing state
- **Issue:** [#159](https://github.com/metagrover/pluto/issues/159)
- **PR:** Pending.
- **Changed:** The Knowledge main stage now carries `current_read.source_count` through the compiled brief model and uses that rendered backing count for the Current Read source badge whenever the brief comes from Knowledge V2 or a matching working-memory snapshot. Legacy and empty fallback states still use the currently loaded source list, and focused tests now cover both the rendered-count path and the fallback behavior.
- **Why:** `#81` is about making Knowledge render from durable working-memory-compatible state instead of whatever transient loader state happens to be present. Before this slice, the Current Read badge could claim `0 sources` or another mismatched number even while Pluto was visibly rendering a snapshot-backed or compiled Current Read with a different evidence count.
- **Replaced:** Treating the Current Read source badge as a direct reflection of the live renderer `sources` array instead of the evidence count for the read Pluto is actually showing.
- **Notes:** This keeps the Current Read layout and retry messaging unchanged. Freshness, supporting bullets, and other Current Read metadata slices remain separate follow-up work under `#81`.
## 2026-05-30

### Keep Knowledge Current Read freshness honest
- **Issue:** [#157](https://github.com/metagrover/pluto/issues/157)
- **PR:** Pending.
- **Changed:** Knowledge brief compilation now carries a `freshnessAt` timestamp from the rendered backing state, and the Current Read badge now prefers that timestamp over the selected doc record. Snapshot-backed briefs use the matching snapshot reinforcement time, compiled V2 briefs can use their evidence reinforcement time, and empty or legacy fallback states keep the prior doc timestamp behavior. Focused unit coverage now proves both the model timestamp source and the renderer badge behavior.
- **Why:** `#81` requires Knowledge to stay honest when it reads from durable working memory instead of isolated synthesis. Before this slice, Pluto could show snapshot-backed or evidence-backed Current Read content while labeling it with the selected doc's newer timestamp, which overstated freshness.
- **Replaced:** Treating the selected Knowledge doc record as the freshness source even when the visible Current Read was backed by different snapshot or evidence timing.
- **Notes:** This is intentionally a metadata-only renderer/model fix. It does not redesign Current Read copy, retry flows, or snapshot validation rules.
### Keep snapshot-backed Knowledge Current Read visible during synthesis failures
- **Issue:** [#155](https://github.com/metagrover/pluto/issues/155)
- **PR:** Pending.
- **Changed:** The Knowledge main stage now keeps a valid snapshot-backed Current Read headline visible when a new synthesis attempt fails or has been running unusually long. Pluto still shows the existing retry/status messaging, and the prior failure fallback copy remains in place when no valid durable snapshot-backed brief exists. Focused tests now cover both degraded-state snapshot visibility and the no-snapshot fallback path.
- **Why:** `#81` requires Knowledge to stay useful when working memory is available but live synthesis is degraded. Before this slice, Pluto could already compile a durable snapshot-backed brief, then immediately hide that best available context behind generic failure or timeout copy driven only by doc status.
- **Replaced:** Treating Current Read status copy as more important than the already-persisted durable brief, even when Pluto had a matching compiled snapshot it could show honestly.
- **Notes:** This is intentionally a renderer-side consumer fix. It does not change snapshot validation rules, retry behavior, or broaden into new working-memory scopes.
### Prefer project working-memory snapshots in Dashboard knowledge cards
- **Issue:** [#153](https://github.com/metagrover/pluto/issues/153)
- **PR:** Pending.
- **Changed:** Dashboard home now loads the available working-memory snapshots and lets project Knowledge cards prefer a matching fresh project snapshot for their Current Read headline and trust metadata, while preserving the existing Knowledge-doc fallback when the snapshot is missing, stale, invalid, or mismatched. Focused dashboard-model tests now cover both the project snapshot preference path and the stale fallback path, while the existing global snapshot behavior stays intact.
- **Why:** `#81` already proved project snapshots persist and that project Knowledge briefs can consume them, but the Dashboard still only loaded the global snapshot. That left project re-entry cards behind the rest of the working-memory stack even when a fresher durable project summary already existed.
- **Replaced:** Treating Dashboard project Knowledge cards as direct reads of transient doc JSON even after Pluto had started persisting project-scoped working-memory snapshots on `master`.
- **Notes:** This slice stays read-only and scoped to Dashboard knowledge cards. Person-context/team-tracker scopes and broader Dashboard redesign remain follow-up work.
### Keep Knowledge Current Read support aligned with V2 synthesis
- **Issue:** [#151](https://github.com/metagrover/pluto/issues/151)
- **PR:** Pending.
- **Changed:** Knowledge V2 briefs now retain `current_read.supporting_bullets` in the shared brief model, and the Knowledge main stage renders those synthesized bullets ahead of any Active Stream summary fallback. Focused regressions cover both doc-backed and snapshot-backed briefs plus the rendered Current Read support list.
- **Why:** `#58` calls for a concise, evidence-backed Current Read, but current `master` was discarding already-synthesized support and substituting stream-title summaries instead. That made the page feel more like a stream index even when Pluto had already compiled tighter re-entry context.
- **Replaced:** Treating Active Stream card summaries as the default Current Read support content for Knowledge V2, even when `current_read.supporting_bullets` were already available in the doc or working-memory snapshot.
- **Notes:** This is intentionally a narrow Current Read quality slice. It does not change stream ranking, card layout, or fallback behavior for legacy structured Knowledge docs.
### Rank Active Streams with urgency signals
- **Issue:** [#149](https://github.com/metagrover/pluto/issues/149)
- **PR:** Pending.
- **Changed:** Deterministic Knowledge V2 Active Streams now rank with urgency-aware ordering instead of relying almost entirely on source breadth. Streams with blocker/risk pressure, live follow-ups, dependencies, and decisions can rise above quieter reference streams, and the supporting bullets in Current Read automatically follow that updated order. Focused unit coverage now proves that an urgent stream can outrank a broader but lower-pressure stream.
- **Why:** `#60` says Active Streams should help users re-enter the right thread, not just the broadest one. On current `master`, a stream with explicit blockers could still be buried behind a larger reference stream because ordering mostly favored `source_count` plus recency.
- **Replaced:** Treating Active Stream ranking as a rough breadth sort that underweighted operational urgency already present in Pluto's synthesized evidence.
- **Notes:** This slice stays inside deterministic synthesis and merged Knowledge V2 ordering. It does not add new persisted stream schema or redesign the Knowledge UI.
### Ignore outdated working-memory snapshots in Knowledge consumers
- **Issue:** [#147](https://github.com/metagrover/pluto/issues/147)
- **PR:** Pending.
- **Changed:** Knowledge brief compilation and the Dashboard workspace-memory card now only consume a working-memory snapshot when it matches the selected Knowledge doc's latest synthesis timestamp. If the doc has been synthesized more recently than the persisted snapshot, Pluto falls back to the newer doc JSON instead of showing older snapshot state. Focused tests now cover both Knowledge and Dashboard outdated-snapshot fallback.
- **Why:** Pluto's Phase 2 durable-memory consumers already checked scope, doc identity, and freshness, but they did not verify that the snapshot came from the same synthesis pass as the current Knowledge doc. That allowed an older persisted snapshot to mask newer compiled state and undercut the trust contract around freshness.
- **Replaced:** Treating any non-stale matching snapshot as authoritative even when the selected Knowledge doc had already been regenerated more recently.
- **Notes:** This slice stays read-only. It does not change snapshot generation or broaden the consumer path beyond the existing global/project snapshot surfaces.
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

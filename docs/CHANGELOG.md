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

## 2026-05-10

### Apply knowledge corrections to synthesized output
- **Issue:** [#94](https://github.com/metagrover/pluto/issues/94)
- **PR:** Not opened yet.
- **Changed:** Made Knowledge V2 synthesis apply durable `knowledge_corrections` overlays before saving or progressively flushing docs, so stream renames/pins and item promote/demote/classification corrections now change the synthesized output instead of only persisting in SQLite.
- **Why:** Pluto already stored correction feedback as part of the trust spine, but most of that feedback was inert because synthesis only honored source exclusion. Trusted Attention needs user corrections to shape the shared memory layer before ranking and explanations depend on it.
- **Replaced:** Persisting stream/item correction records without feeding them back into synthesized Knowledge state.
- **Notes:** `exclude_source` still filters source meetings before synthesis, while the new overlay path handles stream/item corrections on both partial and final V2 documents.

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

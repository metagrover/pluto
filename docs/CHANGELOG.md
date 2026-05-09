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

## 2026-05-15

### Improve contributor DevEx and onboarding path
- **Issue:** [#56](https://github.com/metagrover/pluto/issues/56)
- **PR:** Not opened yet.
- **Changed:** Updated README with accurate prerequisites and clone URL; decoupled heavy Python/ML setup from standard Node installation; added `fix-sqlite-abi` script for native module recovery; brought Biome linter to green state.
- **Why:** The initial /devex-review audit found the onboarding path was fragile for new developers, with misleading documentation and unexpected "heavy" side effects during dependency installation.
- **Replaced:** Relying on `postinstall` for ML environment setup and outdated getting-started instructions.
- **Notes:** Contributors must now explicitly run `pnpm run setup-python` after `pnpm install`.

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
- **Changed:** Added a `pm:github-preflight` check that verifies environment-backed GitHub auth, API reachability, issue listing, repository write scope, and optional mutation smoke checks without logging token values.
- **Why:** Recurring PM automation needs to distinguish missing secrets, invalid auth, network failures, and mutation failures before grooming issues.
- **Replaced:** Relying on interactive `gh` keyring auth as evidence that cron automation can access GitHub.
- **Notes:** The default permission check uses GraphQL `viewerPermission`, so recurring runs can verify write access without leaving test comments behind. The local interactive shell still has keyring-backed auth only; the recurring runtime needs `GH_TOKEN` or `GITHUB_TOKEN` injected by the host environment.

### Adopt issue-driven agentic development
- **Issue:** [#55](https://github.com/metagrover/pluto/issues/55)
- **PR:** Not opened yet.
- **Changed:** Added an Issues-first workflow for active product and implementation work, with repo docs reserved for durable memory.
- **Why:** Pluto's product direction evolves as the app becomes more real. GitHub Issues provide a better live surface for divergence, discussion, scope updates, and acceptance criteria than static PRDs.
- **Replaced:** PRD-first planning as the default source of truth for active work.
- **Notes:** This first version intentionally uses templates and agent ritual rather than CI enforcement.

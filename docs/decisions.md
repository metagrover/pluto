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

### Replace the broken pnpm audit pre-commit gate
- **Issue:** [#423](https://github.com/metagrover/pluto/issues/423)
- **PR:** [#424](https://github.com/metagrover/pluto/pull/424)
- **Changed:** Pluto's `audit:high` script now reads the installed pnpm dependency tree and checks the npm bulk advisory API directly, so the pre-commit hook still enforces high-severity dependency checks without relying on retired npm audit endpoints.
- **Why:** `pnpm audit --audit-level high` began failing with HTTP 410 after npm retired the legacy audit endpoints, which blocked every ordinary code commit even when the repo had no high-severity advisories.
- **Replaced:** The broken `pnpm audit --audit-level high` pre-commit command.
- **Notes:** This keeps the existing hook behavior in place for Pluto developers; it restores the gate rather than removing it.

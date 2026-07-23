### Delegate routine Builder design reviews

- **Issue:** [#546](https://github.com/metagrover/pluto/issues/546)
- **PR:** [#547](https://github.com/metagrover/pluto/pull/547)
- **Changed:** Builder now sends routine design and committed-spec gates to fresh independent reviewers with explicit `APPROVED`, `REVISE`, and `HUMAN_REQUIRED` outcomes.
- **Why:** Routine bounded engineering decisions should keep moving autonomously without weakening the human authority boundary for product intent, privacy, risk, credentials, or destructive work.
- **Replaced:** Treating every design or written-spec review as a human-only blocker.
- **Notes:** The policy forbids self-approval, recursive review chains, approval shopping, and private content in review evidence.

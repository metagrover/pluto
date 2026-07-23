# Delegated Builder Design Review

**Issue:** [#546](https://github.com/metagrover/pluto/issues/546)

**Status:** Owner-directed; independently reviewed and approved

## Outcome

Builder sends routine design and committed written-spec gates to fresh independent review sub-agents instead of waiting for human approval. Human authority remains mandatory for unresolved product intent, risk acceptance, privileged access, destructive action, and evidence only a human can supply.

## Review Contract

For every proposed design and every later committed written spec, Builder dispatches a fresh read-only reviewer that neither authored nor implemented the artifact. The reviewer receives the live issue and roadmap context, acceptance criteria, repository instructions, the exact artifact or version under review, relevant code boundaries, and privacy and safety constraints. Summary-only review is insufficient.

The reviewer returns exactly one verdict:

- `APPROVED`: the artifact is a bounded, testable engineering realization of already-approved intent, with no unresolved normative choice and no weakened privacy, credential-free operation, recording trust, durability, or fail-closed behavior.
- `REVISE`: concrete material findings must be resolved before implementation. The revised artifact receives another independent review.
- `HUMAN_REQUIRED`: the decision crosses the human-only authority boundary. Builder records the exact decision or evidence needed and applies unchanged-blocker suppression on later runs.

Design approval and committed-spec approval are separate gates. Any material artifact revision invalidates its prior approval.

## Human-Only Authority Boundary

Builder must escalate rather than delegate approval when work requires any of the following:

- unresolved product intent, UX defaults, trust promises, or scope-changing tradeoffs;
- privacy, legal, licensing, consent, telemetry, retention, security-risk, or distribution decisions;
- credentials, private evidence, external account access, public release authorization, or spending;
- destructive or irreversible operations, data-loss migrations, force-push, or history rewrite;
- conflicts among user direction, repository instructions, roadmap intent, or issue acceptance criteria;
- real-world evidence that only a human, physical device, or privileged account can provide.

Reviewer approval is quality control. It cannot change product strategy, accept risk, disclose private data, grant access, spend money, authorize external communication beyond routine issue/PR updates, or override higher-authority instructions.

## Independence and Anti-Rubber-Stamp Safeguards

- The author or implementer cannot approve its own artifact.
- Reviewers inspect primary artifacts and relevant code, not only an author summary.
- A reviewer cannot dispatch another reviewer or implement the artifact it approves.
- Builder addresses every material `REVISE` finding and records changed intent on the issue.
- After two revision cycles that leave the same material question unresolved, or after conflicting independent verdicts, Builder escalates `HUMAN_REQUIRED` instead of shopping for approval.
- Approval notes are concise and content-free. They identify the artifact version or commit, verdict, key constraints, and reviewer independence without secrets, private recordings, transcript content, identities, credentials, or local paths.

## Automation Behavior

The Builder prompt embeds the review contract before its planning stage. Approval allows the workflow to advance only to the next gate: approved design leads to a committed written spec; approved committed spec leads to an implementation plan and TDD execution. All existing issue selection, ownership, worktree, verification, blocker-suppression, and final-reporting rules remain in force.

The automation update preserves its hourly schedule, active status, model, reasoning effort, local execution environment, and Pluto project target.

## Verification

- Inspect the live Builder configuration and confirm the full delegated-review contract is present.
- Confirm schedule, model, reasoning effort, execution environment, project target, and active status are unchanged.
- Exercise one routine design that receives `REVISE` followed by `APPROVED`.
- Exercise separate review of the later committed spec.
- Confirm a human-only decision yields `HUMAN_REQUIRED` and unchanged-blocker suppression.
- Confirm approval notes and automation memory contain no private or privileged content.

## Non-Goals

- Self-approval or approval shopping.
- Majority-vote design selection.
- Delegating product ownership or risk acceptance.
- Weakening design-first, written-spec, TDD, privacy, or verification gates.

# Builder Blocker Suppression Design

**Issue:** [#542](https://github.com/metagrover/pluto/issues/542)

**Status:** Approved direction; awaiting written-spec review

## Outcome

Scheduled Builder runs distinguish delivery work from an unchanged human-decision blocker. Repeated runs create no duplicate GitHub noise, do not imply productive implementation progress, and still notice urgent or independently actionable work.

## Current Failure

The Builder prompt requires a start comment before implementation and says to update the issue when blocked. It does not define persistent blocker identity, suppression, or an unchanged-blocker terminal state. Hourly runs therefore rediscover the same design gate, post substantially duplicate comments, and produce activity without a branch or PR.

## Chosen Approach

Use stateful blocker suppression plus a roadmap-safe fallback scan.

The rejected alternatives are:

- Pause Builder whenever any issue is blocked. This removes noise but can miss a newly filed urgent bug or newly actionable foundation issue.
- Reduce the schedule frequency. This lowers the volume without fixing duplicate behavior or misleading run outcomes.
- Skip the blocked foundation and always choose later work. This keeps Builder busy by violating roadmap ordering and product gates.

## Persistent State

Builder uses its existing automation memory file as the durable cross-run state boundary. Each blocked selection records:

- issue number and URL;
- blocker class;
- a normalized, content-free blocker fingerprint;
- first-seen and last-material-change timestamps;
- whether one GitHub notification has been posted;
- the exact human action that would unblock work.

The fingerprint is derived from stable public issue state such as issue number, blocker class, approval or evidence requirement, and relevant issue-update timestamp. It must not contain credentials, local paths, private recording evidence, transcript content, or meeting identities.

## Run Algorithm

After GitHub preflight and live ownership checks:

1. Scan urgent bugs and the roadmap in the existing priority order.
2. Classify candidates as actionable, owned, or blocked.
3. For the highest-priority blocked candidate, compute its blocker fingerprint and compare it with automation memory.
4. If the blocker is new or materially changed:
   - post at most one concise issue comment when the live issue does not already contain the same unblock request;
   - record the fingerprint and unblock action;
   - report `blocked changed` rather than delivery.
5. If the blocker is unchanged:
   - post no issue or PR comment;
   - create no branch, worktree, spec, or plan for that issue;
   - report `blocked unchanged` with the existing issue link and unblock action.
6. Continue scanning for another issue only when it is independently actionable, does not overlap active ownership, and does not bypass a required earlier foundation.
7. If a safe actionable issue exists, proceed with the normal end-to-end Builder workflow.
8. If none exists, finish without repository mutation.

A scheduled run is not described as successful delivery unless it creates or advances an implementation artifact. Preflight and blocker audits remain truthful operational outcomes, but the final report must explicitly state that no implementation or PR was produced.

## Material Change Rules

A blocker is materially changed when at least one of these occurs:

- the required approval or evidence is supplied, withdrawn, or revised;
- acceptance criteria or product direction changes;
- ownership changes through an open PR or active branch;
- a prerequisite closes or a new prerequisite appears;
- the issue is closed, superseded, reprioritized, or removed from the active roadmap;
- the previously reported unblock action is no longer accurate.

Elapsed time alone is not a material change. A new scheduled run, a new base commit, or an unchanged GitHub status timestamp does not justify another blocker comment.

## Notifications and Reporting

User-visible attention is warranted when:

- a blocker is new or materially changed;
- an issue becomes actionable;
- Builder opens or advances a PR;
- preflight or execution fails unexpectedly;
- a destructive, credential, legal, or irreversible decision is required.

An unchanged blocker should not create another GitHub notification. The automation may retain a compact local run record, but its final output must use:

- `[Run Outcome] blocked unchanged`;
- `[Issue]` with the existing link;
- `[Unblock Action]` with the one required human decision;
- `[PR] none`;
- `[GitHub Mutations] none`.

## Prompt Changes

Update the Builder automation prompt so that:

- `Builder run started` is posted only after an actionable issue is selected and immediately before implementation work begins;
- blocked candidates are checked against automation memory before any comment;
- unchanged blockers prohibit duplicate comments and speculative branches;
- the fallback scan respects roadmap sequencing and active ownership;
- final reporting distinguishes delivery, changed blocker, unchanged blocker, connectivity failure, and other execution failure;
- the historical instruction to “never skip issue updates” applies to material state changes and shipped work, not identical hourly restatements.

The hourly schedule can remain unchanged because suppression fixes the semantic problem while preserving responsiveness to urgent work.

## Verification

Because the automation prompt is external to Pluto runtime code, verification is behavioral and configuration-focused:

- inspect the updated automation through the app automation API;
- verify the schedule, model, execution environment, project target, and active status are preserved;
- run or inspect a Builder pass against an unchanged blocker and confirm no GitHub comment or repository mutation;
- change a test blocker condition or use a newly actionable issue and confirm the run reports the material transition once;
- confirm persistent state contains no secrets or private meeting data;
- confirm the final output explicitly reports `[PR] none` for blocked runs.

The design-only PR will run `pnpm run changelog:check` and `git diff --check`. No product runtime test changes are required for the automation configuration itself.

## Scope

In scope:

- Builder prompt and notification semantics;
- content-free blocker fingerprinting in existing automation memory;
- duplicate issue-comment suppression;
- truthful blocked-run reporting;
- roadmap-safe fallback selection.

Out of scope:

- bypassing product, design, evidence, legal, or security gates;
- automatically approving human decisions;
- changing Pluto runtime code;
- changing PM or Engineering Housekeeping automations;
- reprioritizing the roadmap merely to produce a PR.

## Documentation and Shipping

The implementation will update the live Builder automation through the Codex automation API after written-spec approval. The issue will record the before-and-after behavior and verification. The prompt itself remains automation configuration rather than a repository runtime artifact; this design document is the durable repository record.

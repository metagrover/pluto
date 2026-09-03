# Meeting Trust-Cost Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, privacy-safe report that exposes meeting-note model cost, duplicate recovery work, and the limits of current checkpoint evidence without changing production behavior.

**Architecture:** A pure TypeScript library validates normalized captured attempts and builds content-free per-case and aggregate reports across four non-overlapping timing boundaries. A thin CLI adapter reads two committed synthetic editor fixtures, strips raw text before evaluation, records their evidence only under `canonical_to_trusted_notes`, and prints stable JSON with unavailable capture/canonical/secondary measurements as `null`. Existing quality and privacy taxonomies remain authoritative; unsupported semantic comparisons return `insufficient_fixture_evidence` rather than inferred scores.

**Tech Stack:** TypeScript, Node.js, Vitest, existing captured synthetic JSON fixtures, existing meeting-notes latency privacy guard.

---

### Task 1: Pure trust-cost evaluator

**Files:**
- Create: `scripts/lib/meeting_notes_trust_cost.ts`
- Test: `tests/unit/meetingNotesTrustCost.test.ts`

- [ ] **Step 1: Write failing tests for recovery accounting and conclusion classification**

Create normalized cases containing initial writer, audit, and repair attempts. Assert that the evaluator totals tokens/model time, identifies identical repair output by digest, reports unavailable checkpoint evidence as `null`, classifies rejected writers as `writer_unusable`, and otherwise returns `insufficient_fixture_evidence` when no executable reviewed rubric exists.

```ts
expect(report.cases[0]).toMatchObject({
  conclusion: 'writer_unusable',
  recovery: {
    malformedContractRepairCount: 1,
    duplicateRecoveryCount: 1,
    duplicateRecoveryModelMs: 40,
  },
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run tests/unit/meetingNotesTrustCost.test.ts`

Expected: FAIL because `meeting_notes_trust_cost.ts` does not exist.

- [ ] **Step 3: Implement strict normalized inputs and deterministic reporting**

Implement `buildMeetingNotesTrustCostReport(cases)` with exact output types. Include only fixture/case identifiers, model/prompt identifiers, stage/task, recovery kind, outcome, counts, durations, token counts, duplicate digest equality, blocking status, and nullable quality checkpoints. Every case and aggregate must expose `stop_to_sealed_capture`, `sealed_to_canonical_transcript`, `canonical_to_trusted_notes`, and `post_publication_compute` separately. The canonical boundary may contain only the approved content-free stage names, with queue/active time and attempt/resume state distinct; absent evidence is `null`. Do not include raw response, transcript, prompt, evidence, names, paths, timestamps, or free-form review text.

```ts
export type TrustCostConclusion =
  | 'audit_added_unique_value'
  | 'deterministic_checks_sufficient_for_fixture'
  | 'writer_unusable'
  | 'insufficient_fixture_evidence';
```

Reuse `assertContentFreeMeetingNotesLatencyReport` as the final recursive privacy check. Reject unknown/invalid normalized values rather than coercing them.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm vitest run tests/unit/meetingNotesTrustCost.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the evaluator**

```bash
git add scripts/lib/meeting_notes_trust_cost.ts tests/unit/meetingNotesTrustCost.test.ts
git commit -m "test: measure meeting notes recovery cost"
```

### Task 2: Captured-fixture adapter and stable CLI

**Files:**
- Create: `scripts/report_meeting_notes_trust_cost.ts`
- Create: `tests/unit/meetingNotesTrustCostReport.test.ts`

- [ ] **Step 1: Write a failing adapter/CLI test**

Load `meetingNotesCompactEditorBaseline.json` and `meetingNotesCompactEditorCandidate.json` through an exported adapter. Assert six cases, deterministic repeated serialization, no raw/text-bearing fields, measured `canonical_to_trusted_notes`, nullable `stop_to_sealed_capture`, nullable `sealed_to_canonical_transcript`, nullable `post_publication_compute`, and the known duplicate repairs from captured response digests.

```ts
expect(report.totals).toMatchObject({
  caseCount: 6,
  post_publication_compute: null,
});
expect(JSON.stringify(report)).not.toContain('review');
```

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `pnpm vitest run tests/unit/meetingNotesTrustCostReport.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the fixture adapter and CLI**

Strictly validate only metadata used from the captured fixtures: top-level model/scope/commit, case id/gate/error, request task/repair/digest, and numeric metrics. Map free-form errors to stable categories. Never pass `raw`, `review`, or `finalDocument` into the evaluator. Export `buildCommittedMeetingNotesTrustCostReport(root)` and print `JSON.stringify(report, null, 2)` only when executed as the CLI entry point.

- [ ] **Step 4: Run focused tests and the CLI twice**

Run:

```bash
pnpm vitest run tests/unit/meetingNotesTrustCost.test.ts tests/unit/meetingNotesTrustCostReport.test.ts
tsx scripts/report_meeting_notes_trust_cost.ts > /tmp/pluto-trust-cost-a.json
tsx scripts/report_meeting_notes_trust_cost.ts > /tmp/pluto-trust-cost-b.json
cmp /tmp/pluto-trust-cost-a.json /tmp/pluto-trust-cost-b.json
```

Expected: tests PASS and `cmp` exits 0.

- [ ] **Step 5: Commit the adapter**

```bash
git add scripts/report_meeting_notes_trust_cost.ts tests/unit/meetingNotesTrustCostReport.test.ts
git commit -m "feat: report meeting trust cost"
```

### Task 3: Repository integration and verification

**Files:**
- Modify: `package.json`
- Create: `docs/changelog/entries/2026-09-03-739-meeting-trust-cost-ledger.md`

- [ ] **Step 1: Add the repository command**

Add `"report:meeting-notes-trust-cost": "tsx scripts/report_meeting_notes_trust_cost.ts"` beside the existing meeting-notes reports.

- [ ] **Step 2: Add a changelog fragment**

Document issue #739, the diagnostic-only report, the duplicate recovery accounting, the absence of production changes, and the privacy boundary. Do not claim an audit or recovery policy has shipped.

- [ ] **Step 3: Verify the full change**

Run:

```bash
pnpm run report:meeting-notes-trust-cost
pnpm vitest run tests/unit/meetingNotesTrustCost.test.ts tests/unit/meetingNotesTrustCostReport.test.ts
pnpm exec tsc --noEmit
pnpm biome check scripts/lib/meeting_notes_trust_cost.ts scripts/report_meeting_notes_trust_cost.ts tests/unit/meetingNotesTrustCost.test.ts tests/unit/meetingNotesTrustCostReport.test.ts
pnpm run changelog:check
pnpm run test
```

Expected: deterministic JSON report; all focused and full tests pass; TypeScript, Biome, and changelog validation exit 0.

- [ ] **Step 4: Commit repository integration**

```bash
git add package.json docs/changelog/entries/2026-09-03-739-meeting-trust-cost-ledger.md
git commit -m "docs: record meeting trust cost ledger"
```

- [ ] **Step 5: Summarize evidence on issue #739**

Post only content-free aggregate findings, explicitly distinguishing measured facts from next-step hypotheses. Include report command and verification evidence. Do not propose a production policy until the report result is reviewed.

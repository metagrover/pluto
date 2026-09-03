# Deterministic Notes Recovery Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replay duplicate writer failures through a narrow benchmark-only schema normalizer and measure which model repairs could be avoided without weakening production parsing.

**Architecture:** A pure normalizer accepts decoded JSON and returns either an exact bounded adaptation or a stable refusal code. The existing report adapter joins committed synthetic sources to captured initial writer responses, uses the existing wire decoder, strict writer parser, and source guardrails, then emits only aggregate recovery facts.

**Tech Stack:** TypeScript, Vitest, existing meeting-notes wire/parser/guardrail modules, committed synthetic fixtures.

---

### Task 1: Lossless mechanical normalizer

**Files:**
- Create: `scripts/lib/meeting_notes_recovery_replay.ts`
- Create: `tests/unit/meetingNotesRecoveryReplay.test.ts`

- [x] Write failing tests proving exact nested-text flattening, `discussion` to `point` mapping, field/order preservation, and refusal for competing sources, extra nested fields, non-null discussion metadata, audit payloads, and invalid JSON.

```ts
expect(normalizeCapturedNotesDraft(nestedWriter)).toMatchObject({
  status: 'normalized',
  transformations: { flattenedTextFields: 1, discussionKindsMapped: 1 },
});
expect(normalizeCapturedNotesDraft(competingSources)).toEqual({
  status: 'not_normalizable',
  reason: 'competing_sources',
});
```

- [x] Run `pnpm vitest run tests/unit/meetingNotesRecoveryReplay.test.ts` and verify the missing-module failure.
- [x] Implement the minimal pure normalizer with exact-key and invariant checks. Return transformation counts and normalized JSON only to the replay caller.

```ts
export type NotesRecoveryNormalization =
  | {
      status: 'normalized';
      normalizedJson: string;
      transformations: {
        flattenedTextFields: number;
        discussionKindsMapped: number;
      };
    }
  | {
      status: 'not_normalizable';
      reason: 'invalid_json' | 'not_writer_draft' | 'competing_sources' |
        'unsupported_nested_text' | 'discussion_metadata' | 'no_supported_change';
    };
```

- [x] Run the focused test and verify it passes.
- [x] Commit as `test: define deterministic notes recovery`.

### Task 2: Captured replay integration

**Files:**
- Modify: `scripts/report_meeting_notes_trust_cost.ts`
- Modify: `tests/unit/meetingNotesTrustCostReport.test.ts`

- [x] Add failing expectations for five duplicate repairs: four writer candidates evaluated, one audit repair refused, strict parse results, guardrail results, and captured avoidable model milliseconds.

```ts
expect(report.deterministic_recovery_replay).toMatchObject({
  duplicateRepairCount: 5,
  writerCandidateCount: 4,
  auditRepairRefusalCount: 1,
  strictParseRecoveredCount: 4,
});
```

- [x] Run the report test and verify it fails.
- [x] Join case IDs to committed synthetic segments, decode source labels with `createNotesWireRequest`, normalize only initial writer responses, parse with `parseNotesDraft`, and evaluate with `findNotesGuardrailIssues`. Add a privacy-safe `deterministic_recovery_replay` section to the report.
- [x] Run focused tests and byte-compare two report executions.
- [x] Commit as `feat: replay deterministic notes recovery`.

### Task 3: Documentation and full verification

**Files:**
- Modify: `docs/changelog/entries/2026-09-03-739-meeting-trust-cost-ledger.md`
- Modify: `docs/superpowers/plans/2026-09-03-deterministic-notes-recovery-replay.md`

- [x] Record measured replay findings without claiming production safety or semantic correctness.

```markdown
- **Notes:** Deterministic replay is benchmark-only. Structural recovery and guardrail passage do not establish semantic correctness or authorize production parser changes.
```
- [x] Run focused tests, full tests, TypeScript, Biome, changelog validation, deterministic report comparison, and the privacy assertion.
- [x] Mark every plan step complete and commit.
- [x] Push PR #740 and add the content-free replay result to issue #739.

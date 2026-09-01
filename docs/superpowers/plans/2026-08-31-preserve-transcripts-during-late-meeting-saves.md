# Preserve Transcripts During Late Meeting Saves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generic partial meeting saves preserve omitted transcript-owned state and keep long live-ASR tokens inside the transcript pane.

**Architecture:** Add one pure merge boundary for the seven transcript-owned fields and apply it inside the existing synchronous SQLite save transaction before trust validation, upsert, and FTS refresh. Keep explicit values, including `null`, authoritative. Add the two necessary CSS containment declarations without changing transcript layout or scrolling.

**Tech Stack:** TypeScript, Electron, better-sqlite3, React CSS/Tailwind, Vitest, PostCSS, Biome.

---

## File map

- Create `electron/meetingTranscriptOwnedFields.ts`: own the protected-field list and omitted-property merge semantics.
- Modify `electron/db.ts`: resolve the effective meeting row inside the generic save transaction and use it for validation, SQL, and FTS.
- Create `tests/unit/dbPartialMeetingSave.test.ts`: exercise real SQLite upserts for omission, explicit replacement, explicit clearing, and FTS consistency.
- Modify `src/index.css`: contain recognized and interim transcript tokens.
- Create `tests/unit/liveTranscriptContainmentStyles.test.ts`: parse the stylesheet and assert the containment contract.
- Create `docs/changelog/entries/2026-08-31-665-preserve-late-save-transcripts.md`: record the shipped regression repair and why it matters.

### Task 1: Preserve omitted transcript-owned fields

**Files:**
- Create: `electron/meetingTranscriptOwnedFields.ts`
- Modify: `electron/db.ts`
- Test: `tests/unit/dbPartialMeetingSave.test.ts`

- [ ] **Step 1: Write the failing SQLite regression tests**

Create an isolated Electron database test that saves a fully populated meeting, performs `{ id, title }` as a generic late save, and expects `audio_path`, `system_audio_path`, `mixed_audio_path`, `transcript_json`, `transcript_status`, `transcript_integrity_json`, and `transcript_validated_at` to remain unchanged. Add cases proving explicit replacement values win and explicit `null` clears the nullable transcript/audio fields. Query FTS after the partial save and expect the original transcript token to remain searchable.

```ts
saveMeeting({
  id,
  title: 'Original',
  audio_path: '/audio/mic.wav',
  system_audio_path: '/audio/system.wav',
  mixed_audio_path: '/audio/mixed.wav',
  transcript_json: JSON.stringify({
    segments: [{ text: 'durable-transcript-token' }],
  }),
  transcript_status: 'validated',
  transcript_integrity_json: JSON.stringify({ schemaVersion: 1 }),
  transcript_validated_at: '2026-08-31T12:00:00.000Z',
});
saveMeeting({ id, title: 'Late title' });
expect(getMeeting(id)).toMatchObject({
  title: 'Late title',
  audio_path: '/audio/mic.wav',
  system_audio_path: '/audio/system.wav',
  mixed_audio_path: '/audio/mixed.wav',
  transcript_status: 'validated',
  transcript_validated_at: '2026-08-31T12:00:00.000Z',
});
expect(searchMeetingsFts('"durable-transcript-token"')).toHaveLength(1);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/dbPartialMeetingSave.test.ts`

Expected: the omission case fails because the generic upsert replaces protected values with null/default bindings.

- [ ] **Step 3: Add the pure protected-field merge**

Create `meetingTranscriptOwnedFields.ts` with the exact protected fields and own-property semantics:

```ts
import type { PersistedMeeting } from './db';

export const MEETING_TRANSCRIPT_OWNED_FIELDS = [
  'audio_path',
  'system_audio_path',
  'mixed_audio_path',
  'transcript_json',
  'transcript_status',
  'transcript_integrity_json',
  'transcript_validated_at',
] as const satisfies readonly (keyof PersistedMeeting)[];

export const preserveOmittedTranscriptOwnedFields = (
  current: PersistedMeeting | undefined,
  incoming: PersistedMeeting,
): PersistedMeeting => {
  if (!current) return incoming;
  const effective = { ...incoming };
  for (const field of MEETING_TRANSCRIPT_OWNED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(incoming, field)) {
      effective[field] = current[field] as never;
    }
  }
  return effective;
};
```

In `saveMeetingTransaction`, read the existing row by normalized ID, replace the local `meeting` parameter with the effective merged record, and then run the existing lifecycle validation, positional upsert, and `refreshMeetingFts` unchanged against that record.

- [ ] **Step 4: Run focused persistence tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/dbPartialMeetingSave.test.ts tests/unit/meetingInsertSql.test.ts tests/unit/dbMeetingSearchIndex.test.ts tests/unit/dbCheckpointTranscriptFinalization.test.ts`

Expected: all tests pass, including omitted-field preservation, explicit replacement/clearing, FTS consistency, SQL placeholder integrity, and guarded finalization.

- [ ] **Step 5: Commit the persistence fix**

```bash
git add electron/meetingTranscriptOwnedFields.ts electron/db.ts tests/unit/dbPartialMeetingSave.test.ts
git commit -m "fix: preserve transcripts during partial meeting saves (#665)"
```

### Task 2: Contain long live-transcript tokens

**Files:**
- Modify: `src/index.css`
- Test: `tests/unit/liveTranscriptContainmentStyles.test.ts`

- [ ] **Step 1: Write the failing style-contract test**

Parse `src/index.css` with PostCSS, find `.transcript-turn p` and `.transcript-interim`, and assert both contain the declaration below:

```ts
expect(declarationsFor('.transcript-turn p')).toMatchObject({
  'overflow-wrap': 'anywhere',
});
expect(declarationsFor('.transcript-interim')).toMatchObject({
  'overflow-wrap': 'anywhere',
});
```

- [ ] **Step 2: Run the style test and verify RED**

Run: `pnpm exec vitest run tests/unit/liveTranscriptContainmentStyles.test.ts`

Expected: both assertions fail because neither rule declares `overflow-wrap`.

- [ ] **Step 3: Add minimal containment CSS**

Add `overflow-wrap: anywhere;` to `.transcript-turn p` and `.transcript-interim`. Do not add horizontal scrolling, truncate text, change widths, or change live-edge behavior.

- [ ] **Step 4: Run focused live transcript tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/liveTranscriptContainmentStyles.test.ts tests/unit/LiveTranscript.dom.test.tsx tests/unit/RecordingWorkspaceComponents.test.tsx`

Expected: all tests pass.

- [ ] **Step 5: Commit the containment fix**

```bash
git add src/index.css tests/unit/liveTranscriptContainmentStyles.test.ts
git commit -m "fix: contain long live transcript tokens (#665)"
```

### Task 3: Record and verify the shipped behavior

**Files:**
- Create: `docs/changelog/entries/2026-08-31-665-preserve-late-save-transcripts.md`

- [ ] **Step 1: Add the issue-scoped changelog fragment**

```md
### Preserve transcripts during late meeting saves

- **Issue:** #665
- **Changed:** Generic partial meeting saves now retain omitted transcript and audio state, while explicit transcript replacements remain authoritative. Live recognized and interim transcript text wraps long unbroken ASR tokens inside the recording workspace.
- **Why:** Late title or analysis saves could previously bind omitted transcript fields as null/default values and erase a completed transcript.
```

- [ ] **Step 2: Run static and changelog checks**

Run: `pnpm exec biome check electron/meetingTranscriptOwnedFields.ts electron/db.ts src/index.css tests/unit/dbPartialMeetingSave.test.ts tests/unit/liveTranscriptContainmentStyles.test.ts docs/changelog/entries/2026-08-31-665-preserve-late-save-transcripts.md`

Run: `pnpm run changelog:check`

Run: `pnpm exec tsc --noEmit`

Expected: all commands exit zero.

- [ ] **Step 3: Run focused and full regression suites**

Run the focused persistence/live-transcript command from Tasks 1 and 2, then run `pnpm run test` with localhost binding available for the Ollama transport tests.

Expected: all tests pass; the baseline is 289 files and 3,302 tests before adding #665 coverage.

- [ ] **Step 4: Commit the changelog and any formatter-only corrections**

```bash
git add docs/changelog/entries/2026-08-31-665-preserve-late-save-transcripts.md
git commit -m "docs: record transcript preservation fix (#665)"
```

- [ ] **Step 5: Review the branch and open the pull request**

Inspect `git diff master...HEAD`, confirm only #665 files changed, push `codex/665-preserve-transcripts`, and open a PR that links and closes #665. The PR must describe omitted-versus-explicit semantics, FTS consistency, live-token containment, tests, durable decision status (none), and the changelog fragment.

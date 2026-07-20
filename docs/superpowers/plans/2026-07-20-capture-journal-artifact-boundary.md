# Capture Journal Artifact Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject unsafe capture-journal identities and non-canonical manifest paths before journal filesystem mutation or recovery artifact reads.

**Architecture:** Keep capture-journal path policy in `electron/captureJournal.ts`. Strengthen the existing meeting-ID normalizer, validate parsed version-1 manifests against paths derived from the requested directory identity, and leave recovery dependent on the trusted manifest reader so it cannot consume unvalidated entry paths.

**Tech Stack:** TypeScript, Node `fs/promises` and `path`, Vitest.

---

### Task 1: Reject unsafe meeting identities before filesystem mutation

**Files:**
- Modify: `tests/unit/captureJournal.test.ts`
- Modify: `electron/captureJournal.ts`

- [ ] **Step 1: Write the failing identity-boundary test**

Add `readdir` to the test imports and exercise the public create boundary:

```ts
it.each(['..', '.', '../escaped', 'nested/meeting', 'nested\\meeting', 'bad\0id'])(
  'rejects unsafe meeting ID %j before filesystem mutation',
  async (meetingId) => {
    const root = await makeRoot();

    await expect(
      createCaptureJournal(root, { meetingId, startedAtMs: 1_000 }),
    ).rejects.toThrow(/invalid capture journal meeting id/i);

    expect(await readdir(root)).toEqual([]);
  },
);
```

- [ ] **Step 2: Run the identity test to verify RED**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts -t "rejects unsafe meeting ID"`

Expected: FAIL because the current normalizer accepts at least dot segments, path separators, and NUL-containing values; the root may be mutated or Node may surface an unrelated path error.

- [ ] **Step 3: Implement the safe-segment contract**

Update `normalizeMeetingId` after its empty check:

```ts
if (
  normalized === '.' ||
  normalized === '..' ||
  normalized.includes('/') ||
  normalized.includes('\\') ||
  normalized.includes('\0')
) {
  throw new Error(`Invalid capture journal meeting ID: ${JSON.stringify(normalized)}`);
}
```

Do not add a restrictive character allowlist; spaces, punctuation, and Unicode remain compatible.

- [ ] **Step 4: Run the focused identity test to verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts -t "rejects unsafe meeting ID"`

Expected: PASS with all parameterized cases and an empty root after every rejection.

### Task 2: Reject non-canonical manifest identity and paths

**Files:**
- Modify: `tests/unit/captureJournal.test.ts`
- Modify: `electron/captureJournal.ts`

- [ ] **Step 1: Add a helper for mutating the persisted manifest**

Add a local helper that creates a canonical manifest, changes one field, and writes it back:

```ts
const mutateManifest = async (
  root: string,
  mutate: (manifest: Record<string, unknown>) => void,
) => {
  const manifest = await createCaptureJournal(root, {
    meetingId: 'meeting-123',
    startedAtMs: 1_000,
  });
  const manifestPath = join(root, manifest.manifestRelativePath);
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >;
  mutate(parsed);
  await writeFile(manifestPath, JSON.stringify(parsed));
};
```

- [ ] **Step 2: Write failing manifest-identity and root-path tests**

Add table-driven checks:

```ts
it.each([
  ['meeting identity', (manifest) => (manifest.meetingId = 'meeting-other')],
  ['artifact root', (manifest) => (manifest.artifactRootRelativePath = '../outside')],
  ['manifest path', (manifest) => (manifest.manifestRelativePath = '../manifest.json')],
])('rejects a non-canonical manifest %s', async (_label, mutate) => {
  const root = await makeRoot();
  await mutateManifest(root, mutate);

  await expect(
    readCaptureJournalManifest(root, 'meeting-123'),
  ).rejects.toThrow(/invalid capture journal manifest/i);
});
```

- [ ] **Step 3: Run the manifest tests to verify RED**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts -t "non-canonical manifest"`

Expected: FAIL because the current reader returns parsed version-1 data without canonical identity or path checks.

- [ ] **Step 4: Implement canonical manifest validation**

Parse JSON as `unknown`, narrow it to a record, keep the existing unsupported-version error, and validate the requested identity plus derived root and manifest paths. Use a shared failure helper:

```ts
const invalidManifest = (field: string) => {
  throw new Error(`Invalid capture journal manifest ${field}`);
};

const validateCaptureJournalManifest = (
  value: unknown,
  requestedMeetingId: string,
): CaptureJournalManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidManifest('shape');
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `Unsupported capture journal schema version: ${String(manifest.schemaVersion)}`,
    );
  }
  const artifactRootRelativePath =
    getArtifactRootRelativePath(requestedMeetingId);
  if (manifest.meetingId !== requestedMeetingId) {
    return invalidManifest('meeting ID');
  }
  if (manifest.artifactRootRelativePath !== artifactRootRelativePath) {
    return invalidManifest('artifact root path');
  }
  if (
    manifest.manifestRelativePath !==
    `${artifactRootRelativePath}/${MANIFEST_FILE}`
  ) {
    return invalidManifest('manifest path');
  }
  if (!Array.isArray(manifest.entries)) {
    return invalidManifest('entries');
  }
  // Entry validation is completed in the next red-green cycle.
  return value as CaptureJournalManifest;
};
```

Call this validator from `readCaptureJournalManifest` and return only its validated result.

- [ ] **Step 5: Run the manifest tests to verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts -t "non-canonical manifest"`

Expected: PASS for identity, artifact-root, and manifest-path mismatches.

### Task 3: Reject non-canonical chunk entry paths before recovery reads

**Files:**
- Modify: `tests/unit/captureJournal.test.ts`
- Modify: `tests/unit/captureJournalRecovery.test.ts`
- Modify: `electron/captureJournal.ts`

- [ ] **Step 1: Write the failing entry-validation test**

Create one canonical chunk, then rewrite its entry path and verify direct reads reject:

```ts
it('rejects a chunk entry whose path is not canonical for its metadata', async () => {
  const root = await makeRoot();
  const manifest = await appendCaptureJournalChunk(root, {
    meetingId: 'meeting-123',
    source: 'mic',
    sequence: 2,
    chunkStartSec: 0,
    chunkEndSec: 1,
    format: 'audio/wav',
    data: Buffer.from('mic'),
  });
  const manifestPath = join(root, manifest.manifestRelativePath);
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  parsed.entries[0].relativePath = '../sentinel.wav';
  await writeFile(manifestPath, JSON.stringify(parsed));

  await expect(
    readCaptureJournalManifest(root, 'meeting-123'),
  ).rejects.toThrow(/invalid capture journal manifest entry path/i);
});
```

- [ ] **Step 2: Run the entry test to verify RED**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts -t "chunk entry whose path"`

Expected: FAIL because entry paths are not validated.

- [ ] **Step 3: Implement entry metadata and canonical-path validation**

Inside the centralized validator, iterate `manifest.entries` and require a record, source `mic` or `system`, a non-negative integer sequence, a string format, and an exact canonical path:

```ts
for (const entryValue of manifest.entries) {
  if (!entryValue || typeof entryValue !== 'object' || Array.isArray(entryValue)) {
    return invalidManifest('entry shape');
  }
  const entry = entryValue as Record<string, unknown>;
  if (entry.source !== 'mic' && entry.source !== 'system') {
    return invalidManifest('entry source');
  }
  if (!Number.isInteger(entry.sequence) || Number(entry.sequence) < 0) {
    return invalidManifest('entry sequence');
  }
  if (typeof entry.format !== 'string') {
    return invalidManifest('entry format');
  }
  const expectedPath = `${artifactRootRelativePath}/chunks/${entry.source}-${padSequence(Number(entry.sequence))}.${formatToExtension(entry.format)}`;
  if (entry.relativePath !== expectedPath) {
    return invalidManifest('entry path');
  }
}
```

- [ ] **Step 4: Run the entry test to verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts -t "chunk entry whose path"`

Expected: PASS.

- [ ] **Step 5: Write the failing recovery-boundary test**

Add `mkdir` and `readFile` imports as needed. Create malformed `meeting-a` and healthy `meeting-b` journals, set `meeting-a`'s entry to `sentinel.wav`, and place the sentinel at the root. Assert recovery counts one invalid manifest, recovers `meeting-b`, and never sends the sentinel path to `stitchWavSegments`:

```ts
expect(result).toMatchObject({
  recoveredCount: 1,
  skippedInvalidManifestCount: 1,
});
expect(stitchWavSegments).toHaveBeenCalledTimes(1);
expect(stitchWavSegments.mock.calls.flatMap(([segments]) => segments))
  .not.toContainEqual(expect.objectContaining({ path: sentinelPath }));
expect(savedMeetingIds).toEqual(['meeting-b']);
```

- [ ] **Step 6: Run the recovery test to verify RED against pre-validation behavior**

Temporarily revert only the entry-path validation hunk, run:

`pnpm exec vitest run tests/unit/captureJournalRecovery.test.ts -t "escaped chunk path"`

Expected: FAIL because recovery attempts to consume the redirected sentinel. Restore the entry-validation hunk immediately afterward.

- [ ] **Step 7: Run both journal suites to verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts tests/unit/captureJournalRecovery.test.ts`

Expected: both files pass, including valid create, append, duplicate, seal, and recovery behavior.

### Task 4: Verify the implementation and open its review

**Files:**
- Verify: all changed files

- [ ] **Step 1: Run focused and repository verification**

Run, in order:

```bash
pnpm exec vitest run tests/unit/captureJournal.test.ts tests/unit/captureJournalRecovery.test.ts
pnpm run lint
pnpm run test -- --run
git diff --check
```

Expected: every command exits 0 and Vitest reports no failed files or tests.

- [ ] **Step 2: Review the diff against the approved spec**

Confirm the diff contains only the centralized boundary validator, focused tests, and the approved spec and plan. Confirm there is no schema change, silent manifest repair, unrelated refactor, or root-checkout modification.

- [ ] **Step 3: Commit, push, and open the PR**

Commit implementation with an issue-scoped message, push `codex/505-capture-journal-boundary`, and open a non-draft PR targeting `master` with `Closes #505`, the approved design, TDD evidence, verification results, and explicit non-goals.

### Task 5: Add traceability and complete verification

**Files:**
- Create: `docs/changelog/entries/2026-07-20-505-capture-journal-boundary.md`

- [ ] **Step 1: Add the issue-scoped changelog fragment with the real PR number**

After the PR exists, add:

```md
### Reject capture journals outside their artifact boundary

- **Issue:** `#505`
- **PR:** `<the numeric PR identifier returned by gh pr create>`
- **Changed:** Capture-journal operations now reject unsafe meeting identities and non-canonical manifest or chunk paths before filesystem mutation or recovery reads.
- **Why:** Recovery manifests are durable evidence; corrupt identity or path fields must not redirect trusted recording reads outside the meeting artifact directory.
- **Replaced:** Version-1 manifest reads that validated only the schema version before trusting manifest-controlled paths.
- **Notes:** Valid journal schema and create, append, duplicate, seal, and recovery behavior are unchanged; retention, recovery UI, and transcript policy remain out of scope.
```

The angle-bracket instruction is plan notation only; write the concrete PR number in the repository file.

- [ ] **Step 2: Commit and push the changelog fragment**

Run `pnpm run changelog:check`, commit the fragment with an issue-scoped message, and push it to the existing PR branch.

- [ ] **Step 3: Run final verification on the exact pushed head**

Run:

```bash
pnpm exec vitest run tests/unit/captureJournal.test.ts tests/unit/captureJournalRecovery.test.ts
pnpm run changelog:check
pnpm run lint
pnpm run test -- --run
git diff --check
git status --short --branch
```

Expected: every validation command exits 0, the branch is clean, and its head is pushed.

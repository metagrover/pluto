# Drizzle Database Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Pluto's import-time ad hoc SQLite initialization with one Drizzle-managed baseline, one shared `better-sqlite3` connection, verified database replacement, and explicit Electron startup/shutdown ownership.

**Architecture:** Drizzle owns schema declarations and ordered migrations while current query functions keep using the same raw `better-sqlite3` client. A thin runtime validates migration history, configures the connection, stages legacy or corrupt artifacts, applies and verifies a fresh baseline, and deletes staged data only after success. Electron bootstrap initializes this runtime before importing the main process and closes it after database consumers stop.

**Tech Stack:** TypeScript, Electron 40, SQLite, `better-sqlite3`, Drizzle ORM/Kit, Vitest, Biome, pnpm

**Issue:** [#722](https://github.com/metagrover/pluto/issues/722)

**Design:** `docs/superpowers/specs/2026-09-01-database-lifecycle-drizzle-design.md`

---

## File map

- `drizzle.config.ts`, `electron/database/schema.ts`, and `drizzle/` own schema declarations and migrations.
- `electron/database/errors.ts`, `migrationHistory.ts`, `artifacts.ts`, and `runtime.ts` isolate lifecycle mechanics.
- `electron/database/applicationDatabase.ts` owns Electron path/resource resolution and the application singleton.
- `electron/database/startupRecovery.ts` owns non-schema startup repair.
- `electron/db.ts`, calendar store, and identity store retain query APIs but lose schema side effects.
- Bootstrap, main, and builder configuration own startup, shutdown, and packaged migration assets.
- Focused `tests/unit/database*.test.ts` files prove each boundary before integration.

---

### Task 1: Add Drizzle and establish the complete baseline

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `drizzle.config.ts`
- Create: `electron/database/schema.ts`
- Create: `drizzle/0000_pluto_baseline.sql`
- Create: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0000_snapshot.json`
- Create: `tests/unit/databaseBaseline.test.ts`

- [ ] **Step 1: Install and configure Drizzle**

```bash
pnpm add drizzle-orm
pnpm add -D drizzle-kit
```

Add `db:generate` as `drizzle-kit generate --name` and `db:check` as `drizzle-kit check`. Create:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './electron/database/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
```

- [ ] **Step 2: Write the failing baseline inventory test**

Create a temporary file database, call `migrate(drizzle(sqlite), { migrationsFolder })`, and assert the exact application table list, twelve identity revision triggers, empty `foreign_key_check`, and `quick_check = ok`:

```ts
const expectedTables = [
  'attention_items', 'auto_end_log', 'calendar_events',
  'calendar_integration', 'commitment_aliases', 'entities', 'entities_fts',
  'entity_links', 'identity_bindings', 'identity_captures',
  'identity_input_revision', 'identity_jobs', 'identity_person_aliases',
  'identity_profiles', 'identity_resolution_history',
  'identity_resolutions', 'identity_workspace', 'knowledge_backlinks',
  'knowledge_corrections', 'knowledge_doc_notes', 'knowledge_doc_sources',
  'knowledge_doc_user_edits', 'knowledge_doc_versions', 'knowledge_docs',
  'meeting_analysis_run_history', 'meeting_analysis_runs',
  'meeting_calendar_context', 'meeting_context_events',
  'meeting_context_snapshots', 'meeting_entities', 'meeting_notes_fts',
  'meetings', 'meetings_fts', 'person_aliases', 'person_name_aliases',
  'project_aliases', 'settings', 'working_memory_snapshots',
];
expect(readApplicationTableNames(sqlite)).toEqual(expectedTables);
expect(readIdentityTriggerCount(sqlite)).toBe(12);
expect(sqlite.pragma('foreign_key_check')).toEqual([]);
expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok');
```

- [ ] **Step 3: Run the test and observe the missing baseline failure**

```bash
pnpm test -- --run tests/unit/databaseBaseline.test.ts
```

Expected: FAIL because the schema and migration folder do not exist.

- [ ] **Step 4: Translate the final schema**

Use Drizzle SQLite declarations to translate the final, not historical, definitions from `electron/db.ts:315-709`, `electron/calendar/store.ts:37-75`, and `electron/identityStore.ts:23-63`. Preserve every SQL column name, default, check, foreign key, and index. Use this pattern:

```ts
export const meetings = sqliteTable('meetings', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  transcriptJson: text('transcript_json'),
  analysisJson: text('analysis_json'),
  transcriptStatus: text('transcript_status').default('provisional'),
  finalizationStatus: text('finalization_status').notNull().default('finalized'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});
```

The implementation must export declarations for every ordinary table in the inventory. FTS5 tables and triggers remain explicit migration SQL because Drizzle cannot model them faithfully.

- [ ] **Step 5: Generate, review, and complete the baseline**

```bash
pnpm exec drizzle-kit generate --name pluto_baseline
```

Review every generated object against the cited final DDL. Append the exact current FTS5 definitions and identity revision insert/triggers from `electron/db.ts:1460-1475`. Include no `DROP TABLE`, `ALTER TABLE`, reset key, or data backfill.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test -- --run tests/unit/databaseBaseline.test.ts
pnpm exec drizzle-kit check
git add package.json pnpm-lock.yaml drizzle.config.ts electron/database/schema.ts drizzle tests/unit/databaseBaseline.test.ts
git commit -m "feat(db): establish Drizzle baseline (#722)"
```

Expected: baseline and Drizzle checks pass.

---

### Task 2: Add typed errors and migration-history validation

**Files:**
- Create: `electron/database/errors.ts`
- Create: `electron/database/migrationHistory.ts`
- Create: `tests/unit/databaseMigrationHistory.test.ts`

- [ ] **Step 1: Write failing blank, prefix, divergent, and future-history tests**

```ts
const packaged = [
  { tag: '0000_pluto_baseline', when: 100, hash: 'hash-0' },
  { tag: '0001_example', when: 200, hash: 'hash-1' },
];
expect(() => assertSupportedMigrationHistory([], packaged)).not.toThrow();
expect(() => assertSupportedMigrationHistory(
  [{ createdAt: 100, hash: 'hash-0' }], packaged,
)).not.toThrow();
expect(getPendingMigrationId([], packaged)).toBe('0000_pluto_baseline');
expect(() => assertSupportedMigrationHistory(
  [{ createdAt: 100, hash: 'different' }], packaged,
)).toThrowError(expect.objectContaining({ code: 'database_version_unsupported' }));
expect(describeDatabaseStartupError(
  new DatabaseLifecycleError('database_migration_failed', 'failed', {
    migrationId: '0001_example', sqliteCode: 'SQLITE_ERROR',
  }),
)).toBe('Database migration 0001_example failed (SQLITE_ERROR).');
```

- [ ] **Step 2: Run and observe missing-module failure**

```bash
pnpm test -- --run tests/unit/databaseMigrationHistory.test.ts
```

- [ ] **Step 3: Implement exact contracts**

```ts
export type DatabaseErrorCode =
  | 'database_path_invalid' | 'database_directory_unavailable'
  | 'database_open_failed' | 'database_configuration_failed'
  | 'database_version_unsupported' | 'database_migration_failed'
  | 'database_integrity_failed' | 'database_replacement_failed'
  | 'database_cleanup_failed' | 'database_closed';

export class DatabaseLifecycleError extends Error {
  constructor(
    readonly code: DatabaseErrorCode,
    message: string,
    readonly details: { migrationId?: string; sqliteCode?: string } = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DatabaseLifecycleError';
  }
}
```

Require applied entries to equal a prefix of packaged entries by timestamp and hash. Return the next packaged tag or `null`. Error text may contain only stable codes and migration identifiers, never SQL or stored content.

`readPackagedMigrationHistory(migrationsFolder)` must combine Drizzle's journal tags/timestamps with hashes returned by `readMigrationFiles()`. `readAppliedMigrationHistory(sqlite)` returns ordered rows from `__drizzle_migrations`, or an empty list when the table does not exist. `describeDatabaseStartupError()` maps only typed code/details to concise user-facing text.

- [ ] **Step 4: Verify and commit**

```bash
pnpm test -- --run tests/unit/databaseMigrationHistory.test.ts
git add electron/database/errors.ts electron/database/migrationHistory.ts tests/unit/databaseMigrationHistory.test.ts
git commit -m "feat(db): validate migration history (#722)"
```

---

### Task 3: Stage and delete exact SQLite artifacts

**Files:**
- Create: `electron/database/artifacts.ts`
- Create: `tests/unit/databaseArtifacts.test.ts`

- [ ] **Step 1: Write failing artifact tests**

Create `pluto.db` plus `-wal`, `-shm`, and `-journal`, alongside unrelated `pluto.db.keep`. Assert only the exact artifact set moves, partial rename failure rolls moved files back, and cleanup removes only the returned directory:

```ts
const staged = stageDatabaseArtifacts(databasePath, 'legacy', {
  now: () => new Date('2026-09-01T10:00:00.000Z'),
  processId: 42,
});
expect(staged.moved.map(path.basename).sort()).toEqual([
  'pluto.db', 'pluto.db-journal', 'pluto.db-shm', 'pluto.db-wal',
]);
expect(fs.existsSync(path.join(root, 'pluto.db.keep'))).toBe(true);
cleanupStagedDatabase(staged);
expect(fs.existsSync(staged.directory)).toBe(false);
```

- [ ] **Step 2: Run and observe missing-module failure**

```bash
pnpm test -- --run tests/unit/databaseArtifacts.test.ts
```

- [ ] **Step 3: Implement validated staging**

```ts
export type ReplacementReason = 'legacy' | 'integrity-failed';
export interface StagedDatabase {
  directory: string;
  databasePath: string;
  moved: string[];
}
const SQLITE_SUFFIXES = ['', '-journal', '-shm', '-wal'] as const;
```

Require an absolute non-root `.db` path. Create a process-unique sibling `.pluto-db-replacement-<reason>-<safe-time>-<pid>` directory. Move only exact suffix paths; roll back on partial failure. Cleanup accepts only a validated returned directory and otherwise throws `database_cleanup_failed`.

- [ ] **Step 4: Verify and commit**

```bash
pnpm test -- --run tests/unit/databaseArtifacts.test.ts
git add electron/database/artifacts.ts tests/unit/databaseArtifacts.test.ts
git commit -m "feat(db): stage replacement artifacts (#722)"
```

---

### Task 4: Build the one-connection runtime and replacement flow

**Files:**
- Create: `electron/database/runtime.ts`
- Create: `tests/unit/databaseRuntime.test.ts`
- Create: `tests/unit/databaseReplacement.test.ts`

- [ ] **Step 1: Write failing lifecycle/configuration tests**

```ts
const runtime = createDatabaseRuntime({ databasePath, migrationsFolder });
const first = runtime.initialize();
expect(runtime.initialize()).toBe(first);
expect(first.pragma('foreign_keys', { simple: true })).toBe(1);
expect(first.pragma('journal_mode', { simple: true })).toBe('wal');
expect(first.pragma('synchronous', { simple: true })).toBe(2);
expect(first.pragma('busy_timeout', { simple: true })).toBe(5000);
runtime.close();
runtime.close();
expect(() => runtime.getConnection()).toThrowError(
  expect.objectContaining({ code: 'database_closed' }),
);
```

Add `:memory:` journal-mode coverage and an invalid parent-as-file path expecting `database_directory_unavailable`.

- [ ] **Step 2: Write failing migration/replacement tests**

Use test-owned migration folders to prove ordered once-only application, reopening idempotence, unsupported-history rejection, and rollback of:

```sql
CREATE TABLE deliberate_failure_marker (id INTEGER PRIMARY KEY);
INSERT INTO missing_table (id) VALUES (1);
```

Create a representative legacy meeting row and invalid SQLite file. Prove successful replacement deletes staging only after health checks; migration, health, and cleanup failures retain the staged database; and an established Drizzle migration failure is never reset.

- [ ] **Step 3: Run and observe missing runtime failure**

```bash
pnpm test -- --run tests/unit/databaseRuntime.test.ts tests/unit/databaseReplacement.test.ts
```

- [ ] **Step 4: Implement the narrow runtime**

```ts
export interface DatabaseRuntime {
  initialize(): Database.Database;
  getConnection(): Database.Database;
  close(): void;
  readonly state: 'new' | 'open' | 'closed';
}
export interface DatabaseRuntimeOptions {
  databasePath: string;
  migrationsFolder: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}
export function createDatabaseRuntime(
  options: DatabaseRuntimeOptions,
): DatabaseRuntime;
```

Initialize in this order: validate/create path; open one client; set/read back PRAGMAs; precheck; classify blank/legacy/current/corrupt; validate packaged/applied history; stage legacy/corrupt artifacts; open fresh when staged; disable foreign keys outside Drizzle's transaction only while migrations are pending; migrate; restore foreign keys in `finally`; postcheck; delete staging only after success; expose raw client. Close fresh clients and preserve staging on failure. Never convert an established migration failure into a reset.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test -- --run tests/unit/databaseBaseline.test.ts tests/unit/databaseMigrationHistory.test.ts tests/unit/databaseArtifacts.test.ts tests/unit/databaseRuntime.test.ts tests/unit/databaseReplacement.test.ts
git add electron/database/runtime.ts tests/unit/databaseRuntime.test.ts tests/unit/databaseReplacement.test.ts
git commit -m "feat(db): manage verified SQLite lifecycle (#722)"
```

---

### Task 5: Centralize schema ownership while preserving query APIs

**Files:**
- Create: `electron/database/startupRecovery.ts`
- Create: `electron/database/applicationDatabase.ts`
- Modify: `electron/calendar/store.ts`
- Modify: `electron/identityStore.ts`
- Modify: `electron/db.ts`
- Create: `tests/unit/applicationDatabase.test.ts`
- Modify: `tests/unit/calendarStore.test.ts`
- Modify: `tests/unit/identityStore.test.ts`
- Create: `tests/unit/databaseSchemaBoundary.test.ts`

- [ ] **Step 1: Write failing source and store-boundary tests**

```ts
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  expect(source).not.toMatch(/\bCREATE\s+(?:VIRTUAL\s+)?TABLE\b/i);
  expect(source).not.toMatch(/\bALTER\s+TABLE\b/i);
  expect(source).not.toMatch(/\bDROP\s+TABLE\b/i);
  expect(source).not.toMatch(/\bCREATE\s+TRIGGER\b/i);
}
```

Prove store constructors fail against missing schema rather than creating it. Prove interrupted identity recovery changes only `running` jobs to `pending`. Prove the application singleton reuses one connection, closes idempotently, and rejects acquisition after close.

- [ ] **Step 2: Run and observe current DDL failures**

```bash
pnpm test -- --run tests/unit/databaseSchemaBoundary.test.ts tests/unit/calendarStore.test.ts tests/unit/identityStore.test.ts
```

- [ ] **Step 3: Remove schema side effects**

Remove `ensureCalendarSchema()` and identity constructor DDL/legacy cleanup. Export:

```ts
export const recoverInterruptedIdentityJobs = (
  sql: Database.Database,
): number => sql.prepare(
  "UPDATE identity_jobs SET state = 'pending' WHERE state = 'running'",
).run().changes;
```

Put that hook and orphan meeting-context cleanup in `startupRecovery.ts`. Keep derived FTS repair as named post-migration maintenance. Create `applicationDatabase.ts` with `initializeApplicationDatabase()`, `getApplicationDatabase()`, and `closeApplicationDatabase()` over one `DatabaseRuntime`; accept injected paths/runtime creation in tests.

- [ ] **Step 4: Replace `electron/db.ts` initialization**

Remove path/open code, `initDb()` DDL/probes/backfills, calendar setup, identity trigger DDL, and import-time legacy person-role repair invocation. Retain the exported repair function. Obtain the raw client through `getApplicationDatabase()`, construct stores from it, and run only operational recovery after migrations.

- [ ] **Step 5: Move store fixtures to the baseline**

Use `createDatabaseRuntime({ databasePath: ':memory:', migrationsFolder })` in calendar/identity tests, pass its connection, and close runtime in teardown. Delete hand-written store schema setup.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test -- --run tests/unit/applicationDatabase.test.ts tests/unit/databaseSchemaBoundary.test.ts tests/unit/calendarStore.test.ts tests/unit/identityStore.test.ts tests/unit/dbActionCommitment.test.ts tests/unit/dbMeetingAnalysisRuns.test.ts tests/unit/dbMeetingSearchIndex.test.ts tests/unit/dbPersonBriefing.test.ts tests/unit/dbPersonRoleRepair.test.ts
git add electron/database/applicationDatabase.ts electron/database/startupRecovery.ts electron/calendar/store.ts electron/identityStore.ts electron/db.ts tests/unit/applicationDatabase.test.ts tests/unit/databaseSchemaBoundary.test.ts tests/unit/calendarStore.test.ts tests/unit/identityStore.test.ts
git commit -m "refactor(db): centralize schema ownership (#722)"
```

---

### Task 6: Bind the singleton to Electron and package migrations

**Files:**
- Modify: `electron/database/applicationDatabase.ts`
- Modify: `electron/bootstrap.ts`
- Modify: `electron/main.ts`
- Modify: `electron-builder.json5`
- Modify: `tests/unit/applicationDatabase.test.ts`
- Modify: `tests/unit/appBootstrapBoundary.test.ts`
- Create: `tests/unit/databasePackaging.test.ts`

- [ ] **Step 1: Write failing resolver/singleton/ordering/packaging tests**

```ts
expect(resolveApplicationDatabasePath({ userDataPath: '/profile' }))
  .toBe('/profile/pluto.db');
expect(resolveMigrationsFolder({
  isPackaged: false, appRoot: '/checkout', resourcesPath: '/resources',
})).toBe('/checkout/drizzle');
expect(resolveMigrationsFolder({
  isPackaged: true, appRoot: '/checkout', resourcesPath: '/Resources',
})).toBe('/Resources/drizzle');
```

Also assert singleton reuse/close/no-reopen, bootstrap initialization after locking and before `import('./main')`, main-process close after consumer cleanup, and builder `extraResources` from/to `drizzle` with `**/*`.

- [ ] **Step 2: Run and observe failures**

```bash
pnpm test -- --run tests/unit/applicationDatabase.test.ts tests/unit/appBootstrapBoundary.test.ts tests/unit/databasePackaging.test.ts
```

- [ ] **Step 3: Complete Electron-specific application ownership**

```ts
export function initializeApplicationDatabase(): Database.Database;
export function getApplicationDatabase(): Database.Database;
export function closeApplicationDatabase(): void;
export function resolveApplicationDatabasePath(input: { userDataPath: string }): string;
export function resolveMigrationsFolder(input: {
  isPackaged: boolean;
  appRoot: string;
  resourcesPath: string;
}): string;
```

Resolve Electron values only after profile selection. Permit lazy initialization only from `new` for direct compatibility imports. At bootstrap, initialize before importing main; map lifecycle errors to a content-safe `dialog.showErrorBox` and quit. In `before-quit`, close after database consumers stop.

- [ ] **Step 4: Package migrations without changing ABI preparation**

Append:

```json5
{
  "from": "drizzle",
  "to": "drizzle",
  "filter": ["**/*"]
}
```

Do not modify `scripts/ensure_sqlite_abi.mjs` unless direct Electron verification proves a minimal integration need.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test -- --run tests/unit/applicationDatabase.test.ts tests/unit/appBootstrapBoundary.test.ts tests/unit/databasePackaging.test.ts tests/unit/sqliteAbiPreflight.test.mjs tests/unit/dbPartialMeetingSave.test.ts tests/unit/dbCheckpointTranscriptFinalization.test.ts
pnpm run ensure:sqlite-abi
git add electron/database/applicationDatabase.ts electron/bootstrap.ts electron/main.ts electron-builder.json5 tests/unit/applicationDatabase.test.ts tests/unit/appBootstrapBoundary.test.ts tests/unit/databasePackaging.test.ts
git commit -m "feat(db): bind lifecycle to Electron startup (#722)"
```

---

### Task 7: Record durable decisions

**Files:**
- Create: `docs/adr/2026-09-01-drizzle-database-lifecycle.md`
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-09-01-722-drizzle-database-lifecycle.md`

- [ ] **Step 1: Write the ADR**

Record the import-time/split-schema problem; Drizzle-over-one-raw-client decision; Umzug, Knex, and custom-runner alternatives; explicit FTS/trigger SQL; packaged assets; and generated rebuild review.

- [ ] **Step 2: Record the reset decision**

Add a dated decision that #722 permits development-phase replacement, exact artifacts are staged and deleted only after fresh verification, and preservation must be redesigned before local data becomes durable.

- [ ] **Step 3: Add, validate, and commit the changelog fragment**

Explain what changed and why one lifecycle is safer than partial ad hoc startup mutations.

```bash
pnpm run changelog:check
git add docs/adr/2026-09-01-drizzle-database-lifecycle.md docs/decisions.md docs/changelog/entries/2026-09-01-722-drizzle-database-lifecycle.md
git commit -m "docs: record managed database lifecycle (#722)"
```

---

### Task 8: Verify without production data

**Files:**
- Modify only defects found in files already listed above.

- [ ] **Step 1: Run focused database tests**

```bash
pnpm test -- --run tests/unit/databaseBaseline.test.ts tests/unit/databaseMigrationHistory.test.ts tests/unit/databaseArtifacts.test.ts tests/unit/databaseRuntime.test.ts tests/unit/databaseReplacement.test.ts tests/unit/databaseSchemaBoundary.test.ts tests/unit/applicationDatabase.test.ts tests/unit/databasePackaging.test.ts tests/unit/calendarStore.test.ts tests/unit/identityStore.test.ts tests/unit/dbActionCommitment.test.ts tests/unit/dbMeetingAnalysisRuns.test.ts tests/unit/dbMeetingSearchIndex.test.ts tests/unit/dbPartialMeetingSave.test.ts tests/unit/dbCheckpointTranscriptFinalization.test.ts
```

- [ ] **Step 2: Run full checks**

```bash
pnpm run lint
pnpm test -- --run
pnpm run ensure:sqlite-abi
pnpm run changelog:check
```

- [ ] **Step 3: Run Electron-context in-memory initialization**

Under Electron, import `createDatabaseRuntime`, pass `databasePath: ':memory:'` and the checkout's absolute `drizzle` folder, require `quick_check = ok`, then close. Do not call `app.getPath('userData')`; print only content-free status.

- [ ] **Step 4: Confirm isolation and status**

```bash
git diff --check
git status --short
```

Confirm no command used `pnpm start`, no path resolved to `~/Library/Application Support/pluto`, and every file database used a test-owned temporary directory.

- [ ] **Step 5: Commit only verification fixes and update issue #722**

Do not create an empty commit. Comment on #722 with lifecycle/reset behavior, exact verification results, production-isolation confirmation, durable-document paths, and deferred query/repository conversion.

---

## Completion criteria

- Drizzle is the only schema/migration authority.
- One raw `better-sqlite3` connection backs migrations and existing queries.
- Legacy and integrity-failed artifacts are deleted only after a verified baseline.
- Established migration failures roll back and stop startup without reset.
- Stores and `electron/db.ts` contain no schema DDL.
- Electron initializes before main services and closes after consumers stop.
- Migration assets resolve in development and packaged builds.
- Focused tests, lint, full suite, ABI preflight, Electron probe, and changelog validation pass.
- No production database or profile is opened.

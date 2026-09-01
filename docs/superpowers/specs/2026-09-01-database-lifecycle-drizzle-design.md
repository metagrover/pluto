# Drizzle-managed database lifecycle design

**Issue:** [#722](https://github.com/metagrover/pluto/issues/722)

**Status:** Approved in conversation on 2026-09-01

**Scope:** Electron runtime database lifecycle, schema ownership, and migrations

## Summary

Pluto will keep `better-sqlite3` as its runtime driver and adopt Drizzle as the schema and migration authority. One raw SQLite connection will be opened for the application, wrapped by Drizzle only for migration management, and then reused by the existing `electron/db.ts` functions and stores. This avoids a broad query rewrite while removing module-scoped path resolution, connection creation, and ad hoc schema mutation from `electron/db.ts`.

Pluto is still in a development phase where existing database contents do not need to survive this transition. A pre-Drizzle database will therefore be replaced by the consolidated baseline rather than passed through a reconstructed history of legacy migrations. Replacement remains two-phase: stage the old database and its sidecars, build and verify the new database, then delete the staged artifacts. A failed replacement keeps the staged database available instead of deleting the only recoverable copy.

## Goals

- Give one module explicit ownership of the application database path, connection, configuration, migration, health, and close lifecycle.
- Use Drizzle's maintained SQLite migration machinery rather than a Pluto-authored migration runner.
- Consolidate the current schema into one fresh baseline migration.
- Stop stores and query modules from modifying schema as a construction side effect.
- Preserve all existing database function exports and raw-query behavior during this change.
- Support injected in-memory and temporary-file databases in tests.
- Produce content-safe, actionable startup failures.
- Make the one-time deletion of pre-Drizzle data explicit, verified, and tested.

## Non-goals

- Preserve data from a pre-Drizzle Pluto database.
- Reconstruct every historical schema state as an ordered compatibility chain.
- Rewrite existing queries or repositories with Drizzle's query API.
- Replace `better-sqlite3` or introduce another SQLite connection.
- Add downgrade migrations or automatic rollback to an older application release.
- Change `scripts/ensure_sqlite_abi.mjs`, Parakeet, or any other native-runtime setup.
- Define Pluto's eventual long-term user backup and retention product policy.

## Current-state findings

`electron/db.ts` currently resolves `<userData>/pluto.db`, creates its directory, opens `better-sqlite3`, and initializes the database during module evaluation. Its `initDb()` function combines fresh-schema DDL, column probes, additive alterations, table rebuilds, data backfills, derived-index repair, and destructive legacy fallbacks. Several migration failures are caught and logged while startup continues, which can expose consumers to a partially initialized schema.

Schema ownership also exists outside `initDb()`:

- `electron/calendar/store.ts` creates calendar tables when its store is constructed.
- `electron/identityStore.ts` creates and alters identity tables, deletes obsolete derived cache rows, and resets interrupted jobs when its store is constructed.
- `electron/db.ts` creates identity revision tables and triggers after `initDb()`.
- The application shutdown sequence stops several services but never closes SQLite.

The existing test pattern mocks Electron's `userData` path and imports `electron/db.ts`, relying on import-time database creation. The new runtime must offer direct path injection while keeping those compatibility imports viable during the transition.

## Chosen architecture

### Drizzle schema and migrations

`electron/database/schema.ts` defines ordinary SQLite tables, columns, foreign keys, indexes, and constraints with Drizzle. `drizzle.config.ts` points Drizzle Kit at that schema and emits migrations under `drizzle/`.

The first migration is a single consolidated baseline for a blank database. It contains the complete current schema, not a replay of Pluto's former probes and alterations. Drizzle-generated SQL is reviewed before commit.

SQLite objects that Drizzle cannot represent faithfully—particularly FTS5 virtual tables and the identity revision triggers—remain explicit SQL in the migration. The migration is the durable source of truth for those special objects, and the design documents this exception so that `schema.ts` is not falsely presented as exhaustive.

Future changes update `schema.ts` and generate a new migration. A generated SQLite table rebuild is never accepted solely because it was generated: it requires inspection and a focused preservation test before merge.

### Runtime adapter

`electron/database/runtime.ts` is a thin Electron/application adapter around the existing driver and Drizzle. It is not a second migration framework. Its responsibilities are:

- resolve an injected path or the Electron profile path;
- validate the target and create its parent directory;
- recognize blank, legacy, current, and unsupported databases;
- perform the approved two-phase legacy replacement;
- open exactly one `better-sqlite3` connection;
- apply and verify the connection policy;
- construct the Drizzle wrapper over that same connection;
- apply packaged migrations;
- run health checks and startup recovery hooks;
- return the raw connection to compatibility consumers;
- close the connection exactly once.

The runtime exposes a factory for isolated tests and one application singleton. Tests can inject `:memory:` or an explicit temporary file path without importing Electron.

### Compatibility facade and stores

`electron/db.ts` retains its public API. Its internal raw `db` reference comes from the initialized application runtime. No exported query function is converted to Drizzle in this work.

Calendar and identity stores continue to receive the raw connection. Their constructors become schema-free. Operational startup behavior that is not schema migration remains explicit after migrations; for example, interrupted identity jobs can be returned from `running` to `pending` by a named recovery hook. Obsolete legacy-only repairs disappear with the legacy database reset.

### Electron startup and shutdown

`electron/bootstrap.ts` already selects the profile and acquires the packaged-app single-instance lock before dynamically importing `electron/main.ts`. It will initialize the application database between those steps. Only a successfully initialized database permits `main.ts` to load.

The compatibility facade may retain a guarded lazy acquisition path for direct unit-test imports, but production startup calls initialization explicitly and handles errors at the bootstrap boundary.

During `before-quit`, database-using background services stop first. The application runtime then closes the SQLite connection synchronously. Close is idempotent. Acquiring or using the managed connection after close throws `database_closed` rather than silently reopening it.

## Complete baseline inventory

The consolidated baseline owns the objects currently spread across `initDb()`, post-init setup, and store constructors.

### Core and intelligence tables

- `meetings`
- `meeting_analysis_runs`
- `meeting_analysis_run_history`
- `settings`
- `entities`
- `entity_links`
- `meeting_entities`
- `commitment_aliases`
- `project_aliases`
- `person_aliases`
- `person_name_aliases`
- `attention_items`
- `working_memory_snapshots`
- `meeting_context_events`
- `meeting_context_snapshots`
- `auto_end_log`
- `identity_input_revision`

### Knowledge tables

- `knowledge_docs`
- `knowledge_doc_sources`
- `knowledge_doc_versions`
- `knowledge_doc_user_edits`
- `knowledge_doc_notes`
- `knowledge_corrections`
- `knowledge_backlinks`

### Search objects

- `meetings_fts`
- `meeting_notes_fts`
- `entities_fts`
- all current supporting indexes

### Calendar tables

- `calendar_integration`
- `calendar_events`
- `meeting_calendar_context`

### Identity tables

- `identity_workspace`
- `identity_profiles`
- `identity_person_aliases`
- `identity_captures`
- `identity_bindings`
- `identity_resolutions`
- `identity_resolution_history`
- `identity_jobs`

### Triggers

The baseline includes the current identity-input revision triggers for inserts, updates, and deletes on `entities`, `entity_links`, and `meeting_entities`, plus the meeting insert, selected-field update, and delete triggers.

### Legacy mutations retired by the baseline

The following behaviors are not carried forward as startup probes:

- dropping legacy `meetings`, FTS, or `settings` tables based on column shape;
- additive `ALTER TABLE` checks for meeting, entity, attention, knowledge, alias, and identity columns;
- rebuilding old meetings FTS, knowledge documents, knowledge corrections, or entity links;
- resetting generated Knowledge V2 artifacts for old databases;
- backfilling knowledge notes from old edit storage;
- deleting old identity cache rows that lack meeting scope;
- repairing extraction-authored person roles created by versions predating the current extraction fix.

Derived FTS consistency repair and interrupted-job recovery remain runtime maintenance where still useful; they are not schema migrations.

## Connection policy

Every application connection explicitly sets and verifies:

- `foreign_keys = ON` so referential actions do not depend on a compile-time default;
- `journal_mode = WAL` to allow safe read/write interleaving and predictable recovery files;
- `synchronous = FULL` to avoid accepting WAL's common reduced power-loss durability setting;
- `busy_timeout = 5000` to tolerate short-lived locks from diagnostics or external access instead of failing immediately.

The runtime reads each effective value back and fails initialization if SQLite does not accept the required policy. `:memory:` tests account for SQLite's inability to switch an in-memory database to WAL and assert the documented in-memory equivalent instead of weakening the file-database production policy.

Normal application access always runs with foreign-key enforcement enabled. Immediately before Drizzle starts a pending migration set, the runtime disables foreign-key enforcement outside Drizzle's transaction, because SQLite ignores `foreign_keys` changes made inside a transaction and generated table-rebuild SQL may otherwise trigger unintended cascading deletes. A `finally` block restores enforcement. Successful migration is not exposed until `foreign_key_check` returns no rows. This is migration orchestration around Drizzle, not a replacement migration runner.

## Startup state machine

### Blank database

Open the connection, configure it, create the Drizzle migration history, apply the baseline, run health checks, run operational recovery hooks, and expose the connection.

### Pre-Drizzle database

1. Open only far enough to identify the existing schema and settle any normal SQLite recovery.
2. Close the connection.
3. Create a process-unique recovery directory beside the database.
4. Move the exact `pluto.db`, `pluto.db-wal`, `pluto.db-shm`, and `pluto.db-journal` artifacts that exist into that directory.
5. Open a new canonical `pluto.db` and apply the baseline.
6. Verify migration history, `foreign_key_check`, and `quick_check`.
7. Delete the recovery directory only after every verification succeeds.

If fresh initialization fails, close the new connection and retain the recovery directory. Startup reports the reset failure rather than deleting the staged source.

### Current Drizzle database

Run pre-migration `quick_check` and `foreign_key_check`, compare migration history, apply pending migrations with the migration-only foreign-key policy, restore enforcement, run post-migration foreign-key and quick checks, run operational recovery hooks, and expose the connection. Reopening with no pending migrations is a no-op apart from health and recovery checks.

### Unsupported future or divergent history

Compare the database's Drizzle history with the packaged migration journal before applying anything. A migration timestamp/hash not represented by the packaged history, or history newer than the application understands, produces `database_version_unsupported`. The database remains unchanged.

### Integrity failure

For the current development phase, an integrity-failed database follows the same staged replacement flow as a legacy database. The suspect artifacts are deleted only after the fresh baseline passes all checks. This is an explicit data-reset policy, not silent repair.

### Migration failure

Drizzle's SQLite migration application is transactional. A thrown migration rolls back, the runtime restores foreign-key enforcement, closes the connection, and stops startup. The diagnostic includes the pending migration identifier and stable SQLite error code when available. An established Drizzle database is not reset after a migration failure because doing so could hide a broken shipped migration.

## Error model and diagnostics

Database startup throws typed application errors with stable codes:

- `database_path_invalid`
- `database_directory_unavailable`
- `database_open_failed`
- `database_configuration_failed`
- `database_version_unsupported`
- `database_migration_failed`
- `database_integrity_failed`
- `database_replacement_failed`
- `database_cleanup_failed`
- `database_closed`

Errors may include a migration identifier, SQLite error code, and a sanitized location suitable for troubleshooting. They never include SQL parameters, row values, transcripts, notes, identities, or other database content.

`electron/bootstrap.ts` catches initialization errors before loading normal application services. It shows a concise Electron error dialog and exits. A staged source database remains present when replacement fails. Failure to delete a successfully replaced database is surfaced as `database_cleanup_failed`; it is not reported as successful cleanup.

## Packaging

Runtime migrations must be available in both development and packaged Electron builds. The build configuration includes the Drizzle migration directory as an application resource, and the runtime resolves its location explicitly for development and packaged modes. Packaging tests verify that the baseline SQL and Drizzle journal are present; the runtime never generates or mutates migration files.

Drizzle Kit is a development dependency used to generate migrations. `drizzle-orm` is the runtime dependency used to wrap the existing client and apply packaged migrations.

## Test strategy

All non-UI behavior is developed test-first.

### Runtime and migration tests

- A fresh temporary database receives the complete baseline schema.
- `:memory:` initialization works with the documented journal-mode exception.
- Repeated acquisition returns the same raw connection.
- Fixture migrations apply in order exactly once.
- Reopening an up-to-date database is idempotent.
- A deliberately failing migration rolls back its schema and data changes and reports its identifier.
- Unsupported and divergent migration histories are rejected without mutation.
- File databases expose the required foreign-key, WAL, synchronous, and timeout settings.
- Invalid and unwritable targets produce actionable typed errors.
- `quick_check` and `foreign_key_check` failures exercise the reset policy.
- Close is idempotent and later acquisition throws `database_closed`.

### Replacement tests

- A representative legacy database is staged and replaced with the baseline.
- Existing database, WAL, SHM, and rollback-journal artifacts are handled as one exact set.
- Staged artifacts are deleted only after successful migration and health checks.
- A failed fresh initialization retains staged artifacts.
- Cleanup failure is reported rather than silently ignored.

### Integration and boundary tests

- Existing database and store tests pass through the unchanged compatibility exports.
- Calendar and identity store construction emits no schema DDL.
- `electron/db.ts` contains no schema creation, alteration, or migration fallback.
- Bootstrap initializes the database before importing `main.ts`.
- Shutdown stops consumers before closing SQLite.
- Packaged migration assets are present.
- Existing SQLite ABI preflight tests pass unchanged.
- An Electron-context probe opens and migrates an in-memory database.

All automated and manual verification uses test-owned temporary paths or isolated development profiles. No test or probe reads or modifies Pluto's production profile.

## Verification

Run, in order:

1. Focused database runtime, migration, replacement, store, and bootstrap tests.
2. Existing database/store test suites.
3. `pnpm run lint`.
4. `pnpm test -- --run`.
5. `pnpm run ensure:sqlite-abi`.
6. Electron-context in-memory initialization and migration probe.
7. `pnpm run changelog:check` after adding the changelog fragment.

The final evidence must state the exact temporary profile or in-memory target used and confirm that no production profile was opened.

## Durable records

Implementation adds:

- an ADR recording Drizzle as the schema/migration authority while raw `better-sqlite3` remains the compatibility query interface;
- a `docs/decisions.md` entry recording the approved development-phase replacement and verified deletion of pre-Drizzle data;
- a uniquely named changelog fragment linked to issue #722.

## Deliberately deferred work

- Converting queries and repositories to Drizzle.
- Removing the `electron/db.ts` compatibility facade.
- Downgrade migrations.
- User-facing backup browsing or restore workflows.
- Long-term retention guarantees for durable user data.
- Unrelated database/query cleanup.

Before Pluto treats local databases as durable user data, a separate approved design must replace the development-phase reset policy with preservation, backup retention, and recovery guarantees.

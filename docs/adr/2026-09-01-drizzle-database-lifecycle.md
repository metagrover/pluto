# ADR: Manage Pluto's SQLite lifecycle with Drizzle

- **Status:** Accepted
- **Date:** 2026-09-01
- **Source:** [Issue #722](https://github.com/metagrover/pluto/issues/722)
- **Design:** [Database lifecycle design](../superpowers/specs/2026-09-01-database-lifecycle-drizzle-design.md)

## Context

Pluto opened SQLite while importing `electron/db.ts` and then mutated schema from that module, the calendar store, and the identity store. Startup mixed current schema creation with historical probes, table rebuilds, data backfills, derived-data repair, and caught migration errors. This split ownership made the final schema hard to audit, allowed partial startup mutation, and provided no explicit close boundary.

The product is still in a development phase where existing local database contents may be discarded. The owner approved consolidating history into one baseline and replacing a pre-manager database, provided the old artifact set is retained until the replacement is fully verified.

## Decision

Use Drizzle ORM and Drizzle Kit as the schema and migration authority over one `better-sqlite3` connection. Existing query functions continue using that raw synchronous connection; adopting Drizzle does not require a repository/query rewrite.

The checked-in baseline declares every ordinary table in TypeScript. FTS5 virtual tables and identity revision triggers remain explicit SQL in the migration because Drizzle cannot model them faithfully. Migration SQL, its journal, and snapshot are versioned and packaged with Electron.

A narrow runtime owns path validation, connection policy, migration-history validation, migration application, health checks, replacement, and close. It requires foreign keys, WAL for file databases, FULL synchronization, and a five-second busy timeout. Applied migrations must be an exact timestamp-and-hash prefix of the packaged journal.

For a legacy or integrity-failed database, the runtime closes SQLite and moves only the exact database, WAL, SHM, and rollback-journal artifacts into a sibling recovery directory. It creates and migrates a fresh database, verifies migration history, foreign keys, and SQLite quick integrity, and only then deletes the recovery directory. Any migration, verification, or cleanup failure stops startup and retains the staged source. An established managed database is never reset when a later migration fails.

Electron initializes the database after profile selection and single-instance locking but before importing normal main-process services. Shutdown stops database consumers before closing the connection.

## Alternatives considered

- **Keep a custom migration manager:** rejected because transaction/history mechanics would remain Pluto-owned despite mature tooling being available.
- **Umzug:** capable orchestration, but SQLite history storage and migration integration would still require custom plumbing without adding schema declarations.
- **Knex:** capable migrations and queries, but its connection/query model would encourage a much larger asynchronous refactor for little lifecycle benefit.
- **Full Drizzle query conversion:** deferred. It would increase scope and risk without being required to establish safe ownership.

## Consequences

Schema changes must be made in the Drizzle schema and shipped as reviewed migrations. Generated SQLite rebuild SQL requires explicit foreign-key review, and FTS/trigger changes require explicit SQL. Migration resources are a packaging requirement. Tests and diagnostics use temporary or in-memory databases only.

The approved replacement policy intentionally discards pre-Drizzle data after verification. Before Pluto treats local data as durable, this policy must be replaced with a preservation/import design and recorded as a new decision.

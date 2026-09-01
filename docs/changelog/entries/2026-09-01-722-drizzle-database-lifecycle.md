### Manage SQLite schema and startup with Drizzle

- **Issue:** [#722](https://github.com/metagrover/pluto/issues/722)
- **PR:** Pending.
- **Changed:** Pluto now uses one checked-in Drizzle baseline, migration journal, and shared `better-sqlite3` connection. Electron migrates and verifies the database before loading normal services, packages migration assets, and closes SQLite after consumers stop.
- **Why:** The previous import-time initializer mixed historical probes, schema changes, store-owned DDL, repairs, and error suppression. One lifecycle makes startup transactional, auditable, and testable without rewriting the existing query layer.
- **Replaced:** Ad hoc `CREATE`, `ALTER`, table-rebuild, backfill, calendar-schema, identity-schema, and trigger setup spread across startup modules.
- **Notes:** Existing raw query APIs remain in place; repository/query conversion is intentionally deferred.
- **Safety:** Pre-Drizzle or integrity-failed data is moved with its exact WAL, SHM, and journal sidecars to a recovery directory. Pluto deletes that directory only after the fresh database passes migration-history, foreign-key, and quick-integrity verification. Failed migration, verification, or cleanup retains recovery data and stops startup; an established managed database is never reset for a failed new migration.

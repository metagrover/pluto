### Adopt and preserve legacy SQLite database into Drizzle database lifecycle

- **Issue:** [#763](https://github.com/metagrover/pluto/issues/763)
- **PR:** Pending.
- **Changed:** Pluto now preserves existing pre-Drizzle databases in-place rather than deleting them upon startup. The runtime creates a pre-adoption safety backup, applies the baseline schema idempotently, adds missing cross-meeting speaker candidate/voice profile tables, and stamps `__drizzle_migrations` with the baseline migration. Subsequent runs recognize the adopted database as managed.
- **Why:** PR #741 introduced Drizzle database lifecycle management with a `replaceExisting('legacy')` policy that staged and deleted existing databases, resetting users to an empty workspace. Pre-Drizzle databases already match the baseline table schemas and can be safely adopted in-place with zero data loss.
- **Replaced:** Deletion of pre-Drizzle databases via `replaceExisting('legacy')`.
- **Notes:** Added `scripts/migrate_legacy_db.ts` for manual and scripted database adoption.
- **Safety:** Every legacy database is backed up to `.pluto-db-pre-drizzle-adoption-<timestamp>-<pid>` before any modifications are made. Baseline SQL is executed with foreign key checks temporarily disabled and re-enabled with strict integrity and foreign key checks before completing initialization.

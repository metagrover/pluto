### Crash-safe database encryption migration and key recovery

- **Issue:** `#790`
- **PR:** `Pending.`
- **Changed:** Adopted `better-sqlite3-multiple-ciphers` with SQLCipher profile, implemented atomic crash-safe database encryption migration state machine with durable fsyncing, deep structural verification, downgrade and corruption guards, and non-destructive recovery overlay.
- **Why:** PR #790 lacked crash resilience at transition points, performed shallow verification limited to table names, and risked overwriting encrypted databases on unkeyed startup. PR B establishes complete database safety and recovery before enabling recording encryption.
- **Replaced:** Shallow table-name-only migration checks, unsynced transition journals, and unsafe corruption fallbacks that could destroy encrypted databases.
- **Notes:** Encrypted databases are strictly guarded; missing or rejected encryption keys fail closed with typed lifecycle errors and never trigger database replacement.

# Ignore Local SQLite Artifacts

Issue: [#361](https://github.com/metagrover/pluto/issues/361)

## Goal

Prevent local SQLite databases containing meeting or user data from being committed to the repository.

## Design

- Remove the tracked, zero-byte `pluto.db` from the repository.
- Ignore SQLite database files with the extensions `.db`, `.sqlite`, and `.sqlite3` anywhere in the working tree.
- Ignore the common `-wal`, `-shm`, and `-journal` sidecars for those database formats.
- Leave Pluto's runtime database under Electron's user-data directory untouched.
- Require an explicit negated `.gitignore` rule if the project later adds an intentionally sanitized SQLite fixture.

## Verification

- Confirm `pluto.db` is no longer tracked.
- Confirm representative database and sidecar paths are ignored.
- Confirm the historical `pluto.db` blob is empty.
- Run the repository's focused validation for ignore behavior and ensure unrelated files are unchanged.

## Non-goals

- Rewriting Git history, because the tracked database has always been empty.
- Changing runtime database paths or persistence behavior.
- Adding commit hooks or content scanners.

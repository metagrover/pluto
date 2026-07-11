# Ignore Local SQLite Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent local SQLite databases and their sidecars from being committed to Pluto.

**Architecture:** Add repository-wide ignore patterns for the three common SQLite filename extensions and their sidecars. Remove the tracked empty root database without changing runtime persistence or paths.

**Tech Stack:** Git ignore rules, Git repository metadata

---

### Task 1: Ignore SQLite artifacts

**Files:**
- Modify: `.gitignore`
- Delete: `pluto.db`

- [ ] **Step 1: Demonstrate the current unsafe behavior**

Run `git check-ignore sample.db sample.sqlite sample.sqlite3 sample.db-wal sample.sqlite-shm sample.sqlite3-journal`.

Expected: exit status 1 and no output because none of the representative artifacts are ignored.

- [ ] **Step 2: Add the ignore policy**

Append this section to `.gitignore`:

```gitignore
# Local SQLite databases and sidecars
*.db
*.db-wal
*.db-shm
*.db-journal
*.sqlite
*.sqlite-wal
*.sqlite-shm
*.sqlite-journal
*.sqlite3
*.sqlite3-wal
*.sqlite3-shm
*.sqlite3-journal
```

- [ ] **Step 3: Remove the empty tracked database**

Run `git rm pluto.db`.

Expected: Git stages deletion of the zero-byte root database.

- [ ] **Step 4: Verify ignore behavior**

Run `git check-ignore sample.db sample.sqlite sample.sqlite3 sample.db-wal sample.sqlite-shm sample.sqlite3-journal`.

Expected: all six paths are printed and the command exits successfully.

- [ ] **Step 5: Verify safety and scope**

Run:

```bash
test "$(git cat-file -s e69de29bb2d1d6434b8b29ae775ad8c2e48c5391)" -eq 0
test -z "$(git ls-files -- pluto.db)"
git diff --check
git status --short
```

Expected: checks succeed; status contains only `.gitignore` and the deletion of `pluto.db`.

- [ ] **Step 6: Commit the cleanup**

Run `git add .gitignore pluto.db && git commit -m "chore: ignore local SQLite artifacts"`.

Expected: commit succeeds with `.gitignore` modified and `pluto.db` deleted.

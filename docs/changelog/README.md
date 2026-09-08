# Pluto Changelog Fragments

Use fragments when an issue-backed change benefits from a durable journal entry. They are optional; a focused change can be documented in its commit or PR without creating an issue or fragment. When adding an entry, use a unique file here instead of editing the historical `docs/CHANGELOG.md`.

## Filename

Use:

```text
docs/changelog/entries/YYYY-MM-DD-<issue-number>-<short-slug>.md
```

Example:

```text
docs/changelog/entries/2026-07-13-390-changelog-fragments.md
```

The date must be a real calendar date, the issue number must match the fragment's Issue field, and the lowercase slug may contain letters, numbers, and hyphens.

## Entry format

Every fragment contains exactly one entry with these fields in this order:

```markdown
### Short change title
- **Issue:** [#390](https://github.com/metagrover/pluto/issues/390)
- **PR:** Pending.
- **Changed:** What shipped or changed.
- **Why:** The product or technical reason.
- **Replaced:** The prior assumption, workflow, behavior, or plan this supersedes.
- **Notes:** Follow-up context future agents should know.
```

`Pending.` is valid for the PR field when the pull request does not exist yet. Update it with the PR link when practical.

## Commands

Validate every fragment:

```bash
pnpm run changelog:check
```

Assemble the post-migration journal on standard output:

```bash
pnpm run changelog:build
```

Write assembled output to an explicit file:

```bash
pnpm run changelog:build -- --output /tmp/pluto-changelog.md
```

Do not commit assembled output from an ordinary feature branch. Fragments are canonical; keeping generated aggregates out of feature diffs is what eliminates the merge-conflict hotspot.

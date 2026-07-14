# Changelog Fragments Design

**Issue:** [#390](https://github.com/metagrover/pluto/issues/390)

## Problem

Pluto's development journal is valuable because it records not only what changed, but why the change mattered, what it replaced, and what future agents should know. Its current storage model undermines the development workflow: every meaningful PR inserts text into the newest date section of `docs/CHANGELOG.md`. Concurrent branches therefore edit the same lines, and otherwise independent PRs repeatedly become unmergeable.

The goal is to preserve the journal's context while removing the shared write hotspot from ordinary pull requests.

## Decision

Use one changelog fragment per meaningful issue or PR as the canonical source for new journal entries. Feature branches add uniquely named files under `docs/changelog/entries/` and do not edit a shared aggregate journal.

The canonical filename is:

```text
YYYY-MM-DD-<issue-number>-<short-slug>.md
```

For example:

```text
2026-07-13-390-changelog-fragments.md
```

Each fragment contains one complete entry using the existing journal schema:

```markdown
### Short change title
- **Issue:** [#390](https://github.com/metagrover/pluto/issues/390)
- **PR:** Pending.
- **Changed:** What shipped or changed.
- **Why:** The product or technical reason.
- **Replaced:** The prior assumption, workflow, behavior, or plan this supersedes.
- **Notes:** Follow-up context future agents should know.
```

The date lives in the filename rather than inside the fragment. This makes fragments independently writable and gives the assembler an unambiguous sort key.

## Repository Structure

```text
docs/
  CHANGELOG.md                 Existing historical journal and workflow pointer
  changelog/
    README.md                  Authoring rules and examples
    entries/                   Canonical entries created after this migration
scripts/
  changelog.mjs                Validation and deterministic assembly commands
tests/
  unit/
    changelog.test.ts          Validator and assembler regression coverage
```

Existing history remains in `docs/CHANGELOG.md`; it will not be mechanically split into hundreds of files. The file becomes an immutable legacy archive followed by a clear pointer to the fragment directory for entries after the migration date. New history is canonical in fragments.

This hybrid migration avoids a large, noisy rewrite while ensuring no future feature PR needs to touch the archive.

## Validation

The changelog script exposes two commands:

- `pnpm changelog:check` validates all fragments.
- `pnpm changelog:build` writes the complete assembled post-migration journal to standard output by default, with an explicit output-file option for publishing workflows.

Validation fails with actionable messages when:

- a filename does not match the required date, issue number, and slug shape;
- the filename date is not a real calendar date;
- any required field is missing, duplicated, empty, or out of order;
- the Issue field does not match the filename's issue number;
- more than one fragment uses the same issue number;
- a fragment contains unresolved merge markers;
- a fragment contains more than one journal entry.

CI runs `pnpm changelog:check` for every pull request. Existing lint and test workflows remain otherwise unchanged.

## Assembly

Assembly is deterministic:

1. Read all valid fragments.
2. Sort by date descending.
3. Break same-date ties by numeric issue number descending, then filename ascending.
4. Group entries beneath `## YYYY-MM-DD` headings.
5. Emit a generated-file warning and the standard journal introduction.

Ordinary PRs never commit assembled output. This is the key invariant that removes the conflict hotspot. Humans and agents can read fragments directly, while a future documentation or release workflow can publish the assembled view without changing feature branches.

The initial implementation provides the deterministic command but does not add a bot that commits generated output to `master`. A committing bot would create unnecessary branch churn and protected-branch complexity.

## Workflow Changes

`AGENTS.md` and `.agent/skills/issue-driven-development/SKILL.md` will instruct contributors to add a fragment when work ships or materially changes Pluto's product or development direction. Planning templates that explicitly name `docs/CHANGELOG.md` will be updated to name a unique fragment instead.

The pull request remains responsible for filling in its own fragment. `Pending.` is accepted for the PR field because the PR number may not exist when the branch is first committed. Updating that field after PR creation is encouraged but not required for validation; the linked issue remains the stable identifier.

Changes that do not meet the existing changelog threshold do not need a fragment. CI validates fragments that exist but does not attempt to infer from a code diff whether an entry is required. That policy remains a review responsibility because a mechanical heuristic would produce false positives for tests, formatting, and internal refactors.

## Error Handling

The command exits nonzero and prints every discovered validation error in one run, prefixed by the offending relative path. Missing directories and an empty entry set are valid so fresh checkouts and transitional branches do not fail unexpectedly.

Assembly refuses to run when validation fails. It never emits a partially valid journal.

## Testing

Unit coverage will prove:

- valid fragments pass;
- malformed filenames and impossible dates fail;
- missing, duplicate, empty, and reordered fields fail;
- filename and Issue field mismatches fail;
- duplicate issue numbers fail across files;
- merge markers and multiple entries fail;
- assembly order and date grouping are deterministic;
- assembly refuses invalid input.

An integration-level package-script invocation will verify the repository's real fragments. Implementation of the parser and assembler will follow TDD.

## Alternatives Rejected

### Continue editing one file at a different location

Appending at the bottom or creating one section per month only moves or reduces the hotspot. Concurrent branches can still touch the same insertion point.

### Configure a custom Git merge driver

Merge drivers are local configuration, are not consistently applied by GitHub, and can silently combine entries in the wrong order or preserve malformed content.

### Generate entries solely from issues or pull requests

GitHub metadata does not reliably preserve Pluto's `Why`, `Replaced`, and `Notes` context. It would also make durable project history dependent on an external service.

### Regenerate and commit the aggregate in every PR

This recreates the original conflict because every branch still modifies the same generated file. Aggregate output must remain outside ordinary feature diffs.

## Success Criteria

- Two concurrent meaningful PRs can add changelog entries without touching the same path.
- Invalid fragments fail locally and in CI with clear repair instructions.
- Pluto's contextual journal format and existing history remain intact.
- Contributors have one documented command to validate and one to assemble the journal.
- No routine feature plan or workflow instructs agents to edit `docs/CHANGELOG.md` directly.

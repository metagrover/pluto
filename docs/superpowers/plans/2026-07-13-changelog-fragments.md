# Changelog Fragments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Pluto's shared per-PR changelog edit with validated, uniquely named fragments that can be assembled deterministically without creating merge conflicts.

**Architecture:** A dependency-free ES module owns fragment parsing, validation, and assembly, while a thin CLI reads repository files and exposes `check` and `build`. Vitest exercises the module with in-memory inputs; package scripts and CI connect it to the repository workflow. Existing `docs/CHANGELOG.md` remains the immutable pre-migration archive and points contributors to canonical new fragments.

**Tech Stack:** Node.js 24 ES modules, Vitest 4, pnpm scripts, GitHub Actions, Markdown.

---

### Task 1: Define fragment parsing and validation

**Files:**
- Create: `tests/unit/changelog.test.ts`
- Create: `scripts/lib/changelog.mjs`

- [ ] **Step 1: Write failing tests for a valid fragment and filename validation**

Create fixtures in `tests/unit/changelog.test.ts` with a complete six-field entry and assertions that `validateFragments()` accepts it, rejects malformed filenames and impossible dates, and reports paths in errors.

```ts
import { describe, expect, it } from 'vitest';
import { validateFragments } from '../../scripts/lib/changelog.mjs';

const validBody = `### Eliminate changelog conflicts
- **Issue:** [#390](https://github.com/metagrover/pluto/issues/390)
- **PR:** Pending.
- **Changed:** Feature branches now add unique changelog fragments.
- **Why:** Parallel work should not edit one shared journal insertion point.
- **Replaced:** Direct edits to the aggregate changelog from every PR.
- **Notes:** Existing history remains in docs/CHANGELOG.md.
`;

describe('validateFragments', () => {
  it('accepts a complete fragment whose issue matches its filename', () => {
    expect(validateFragments([{ path: '2026-07-13-390-changelog-fragments.md', body: validBody }])).toEqual([]);
  });

  it.each(['changelog.md', '2026-02-30-390-invalid-date.md'])('rejects invalid filename %s', (path) => {
    expect(validateFragments([{ path, body: validBody }])[0]).toContain(path);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/changelog.test.ts`

Expected: FAIL because `scripts/lib/changelog.mjs` does not exist.

- [ ] **Step 3: Implement minimal filename and body validation**

Create `scripts/lib/changelog.mjs` exporting `validateFragments(fragments)`. Match filenames with `^(\d{4}-\d{2}-\d{2})-(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$`, validate the date by reconstructing its UTC ISO date, and parse the title plus the ordered field list `Issue`, `PR`, `Changed`, `Why`, `Replaced`, `Notes`. Return all errors as strings prefixed with the fragment path.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/changelog.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing validation-edge tests**

Extend the same test file with separate cases for missing, duplicate, empty, and reordered fields; mismatched Issue number; duplicate issue numbers across files; merge markers; and multiple `###` entry headings.

- [ ] **Step 6: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/changelog.test.ts`

Expected: FAIL on the first unsupported validation edge.

- [ ] **Step 7: Complete validation with aggregated actionable errors**

Update `validateFragments()` to collect every error in one run, require exactly one title, require each field exactly once and in schema order, extract the linked or plain issue number, compare it with the filename, reject conflict markers, and track duplicate issue numbers across fragments.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/changelog.test.ts`

Expected: all validation tests PASS with no warnings.

- [ ] **Step 9: Commit the validator**

```bash
git add tests/unit/changelog.test.ts scripts/lib/changelog.mjs
git commit -m "feat: validate changelog fragments (#390)"
```

### Task 2: Add deterministic assembly

**Files:**
- Modify: `tests/unit/changelog.test.ts`
- Modify: `scripts/lib/changelog.mjs`

- [ ] **Step 1: Write failing assembly-order tests**

Import `assembleChangelog` and add fragments across two dates plus two issues on one date. Assert reverse date order, descending numeric issue order for same-date entries, one heading per date, the standard introduction, and a generated-output warning.

```ts
expect(assembleChangelog(fragments)).toBe(`# Pluto Product/Development Journal

<!-- Generated from docs/changelog/entries. Do not edit this output directly. -->

This is Pluto's human-readable development journal. It is not a formal release-notes file.

## 2026-07-13

${issue390Body.trim()}

${issue389Body.trim()}

## 2026-07-12

${issue388Body.trim()}
`);
```

Also assert that invalid input throws an error containing every validation failure rather than emitting partial output.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/changelog.test.ts`

Expected: FAIL because `assembleChangelog` is not exported.

- [ ] **Step 3: Implement minimal deterministic assembly**

Export `assembleChangelog(fragments)`. Call `validateFragments()` first and throw `Error(errors.join('\n'))` on failure. Parse metadata once, sort by date descending, issue descending, then path ascending, group bodies below date headings, and return a newline-terminated Markdown string.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/changelog.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the assembler**

```bash
git add tests/unit/changelog.test.ts scripts/lib/changelog.mjs
git commit -m "feat: assemble changelog fragments (#390)"
```

### Task 3: Add the repository CLI and package commands

**Files:**
- Create: `scripts/changelog.mjs`
- Modify: `package.json`
- Modify: `tests/unit/changelog.test.ts`

- [ ] **Step 1: Write failing CLI integration tests**

Use `mkdtemp`, `mkdir`, and `writeFile` from `node:fs/promises` to create an isolated fragment directory, then invoke `node scripts/changelog.mjs check --entries <dir>` and `node scripts/changelog.mjs build --entries <dir>` with `spawnSync`. Assert check exits zero for a valid fragment, exits nonzero with the path for invalid content, and build writes assembled Markdown to stdout. Add an output-file case asserting `--output <path>` writes the same content and keeps stdout concise.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/changelog.test.ts`

Expected: FAIL because `scripts/changelog.mjs` does not exist.

- [ ] **Step 3: Implement the thin CLI**

Create `scripts/changelog.mjs` to parse `check|build`, `--entries`, and optional `--output`; default entries to `docs/changelog/entries`; treat a missing directory as an empty fragment set; sort directory names before reading; print all check failures to stderr and exit 1; print `Validated N changelog fragment(s).` for successful checks; write build output only after validation succeeds; and print usage with exit 1 for invalid arguments.

- [ ] **Step 4: Add package commands**

Add these scripts to `package.json`:

```json
"changelog:check": "node scripts/changelog.mjs check",
"changelog:build": "node scripts/changelog.mjs build"
```

- [ ] **Step 5: Run the focused tests and repository commands**

Run:

```bash
pnpm exec vitest run tests/unit/changelog.test.ts
pnpm run changelog:check
pnpm run changelog:build > /tmp/pluto-changelog-generated.md
```

Expected: tests PASS, repository check reports the current fragment count, and generated Markdown is written without changing tracked files.

- [ ] **Step 6: Commit the CLI**

```bash
git add tests/unit/changelog.test.ts scripts/changelog.mjs package.json
git commit -m "feat: add changelog fragment commands (#390)"
```

### Task 4: Migrate documentation and add Pluto's first fragment

**Files:**
- Create: `docs/changelog/README.md`
- Create: `docs/changelog/entries/2026-07-13-390-changelog-fragments.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/decisions.md`
- Modify: `AGENTS.md`
- Modify: `.agent/skills/issue-driven-development/SKILL.md`
- Modify: `docs/superpowers/plans/2026-07-10-recording-command-center.md`
- Modify: `docs/superpowers/plans/2026-07-10-compact-daily-briefing.md`

- [ ] **Step 1: Write the authoring guide and first real fragment**

Document the filename schema, six required ordered fields, `Pending.` PR allowance, validation/build commands, and the rule that ordinary PRs never edit an aggregate. Add issue #390's fragment describing the shipped workflow and why it replaces shared journal edits.

- [ ] **Step 2: Convert the legacy journal into an archive pointer**

At the top of `docs/CHANGELOG.md`, preserve the current title and history but replace the authoring instructions and entry template with a migration notice: entries through 2026-07-13 are archived below, and new canonical entries live in `docs/changelog/entries/`. Link the README and show `pnpm run changelog:build` for an assembled post-migration view.

- [ ] **Step 3: Update workflow guidance**

Change `AGENTS.md` and issue-driven-development guidance from direct `docs/CHANGELOG.md` edits to uniquely named fragments. Update the two active plans that hard-code `docs/CHANGELOG.md` so future execution uses issue-specific fragment paths.

- [ ] **Step 4: Record the durable decision**

Add an Accepted 2026-07-13 decision for issue #390 explaining that canonical post-migration journal entries are independently writable fragments and aggregate output is never committed from ordinary PRs.

- [ ] **Step 5: Validate the real repository content**

Run:

```bash
pnpm run changelog:check
pnpm run changelog:build > /tmp/pluto-changelog-generated.md
git diff --check
```

Expected: one fragment validates, generated output includes issue #390, and no whitespace errors appear.

- [ ] **Step 6: Commit the migration**

```bash
git add AGENTS.md .agent/skills/issue-driven-development/SKILL.md docs/CHANGELOG.md docs/changelog docs/decisions.md docs/superpowers/plans/2026-07-10-recording-command-center.md docs/superpowers/plans/2026-07-10-compact-daily-briefing.md
git commit -m "docs: adopt changelog fragments (#390)"
```

### Task 5: Enforce fragment validation in CI

**Files:**
- Modify: `.github/workflows/lint.yml`

- [ ] **Step 1: Add changelog validation to the existing lint job**

After dependency installation and before Biome lint, add:

```yaml
- name: Validate changelog fragments
  run: pnpm run changelog:check
```

- [ ] **Step 2: Run equivalent local verification**

Run:

```bash
pnpm run changelog:check
pnpm run lint
pnpm exec vitest run tests/unit/changelog.test.ts
```

Expected: all commands exit zero.

- [ ] **Step 3: Commit CI enforcement**

```bash
git add .github/workflows/lint.yml
git commit -m "ci: validate changelog fragments (#390)"
```

### Task 6: Complete repository verification and traceability

**Files:**
- Modify: `docs/changelog/entries/2026-07-13-390-changelog-fragments.md` if the PR number is available

- [ ] **Step 1: Run the focused and full quality gates**

Run:

```bash
pnpm run changelog:check
pnpm exec vitest run tests/unit/changelog.test.ts
pnpm run lint
pnpm run test -- --run
pnpm audit --audit-level high
git diff --check origin/master...HEAD
```

Expected: changelog validation, focused tests, lint, full tests, and high-severity audit all pass; the branch diff has no whitespace errors.

- [ ] **Step 2: Inspect the final diff for scope and generated-file safety**

Run: `git diff --stat origin/master...HEAD && git diff --name-only origin/master...HEAD`

Expected: only issue #390's implementation, tests, CI, workflow docs, decision, design, plan, and unique fragment appear; no generated aggregate file is introduced.

- [ ] **Step 3: Update issue #390 with verification evidence**

Comment the exact passing commands, summarize the migration invariant, and link the branch or PR. If a PR number now exists, update the fragment's PR field, re-run `pnpm run changelog:check`, and commit that single metadata change.

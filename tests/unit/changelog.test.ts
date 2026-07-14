import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assembleChangelog,
  validateFragments,
} from '../../scripts/lib/changelog.mjs';

const validBody = `### Eliminate changelog conflicts
- **Issue:** [#390](https://github.com/metagrover/pluto/issues/390)
- **PR:** Pending.
- **Changed:** Feature branches now add unique changelog fragments.
- **Why:** Parallel work should not edit one shared journal insertion point.
- **Replaced:** Direct edits to the aggregate changelog from every PR.
- **Notes:** Existing history remains in docs/CHANGELOG.md.
`;

const fragment = (path: string, body = validBody) => ({ path, body });

describe('validateFragments', () => {
  it('accepts a complete fragment whose issue matches its filename', () => {
    expect(
      validateFragments([fragment('2026-07-13-390-changelog-fragments.md')]),
    ).toEqual([]);
  });

  it.each(['changelog.md', '2026-02-30-390-invalid-date.md'])(
    'rejects invalid filename %s',
    (path) => {
      expect(validateFragments([fragment(path)])[0]).toContain(path);
    },
  );

  it('reports missing, empty, duplicate, and reordered fields', () => {
    const missing = validBody.replace(
      '- **Notes:** Existing history remains in docs/CHANGELOG.md.\n',
      '',
    );
    const empty = validBody.replace(
      '- **Changed:** Feature branches now add unique changelog fragments.',
      '- **Changed:**',
    );
    const duplicate = `${validBody}- **Notes:** Duplicate.\n`;
    const reordered = validBody.replace(
      '- **Changed:** Feature branches now add unique changelog fragments.\n- **Why:** Parallel work should not edit one shared journal insertion point.',
      '- **Why:** Parallel work should not edit one shared journal insertion point.\n- **Changed:** Feature branches now add unique changelog fragments.',
    );

    const errors = validateFragments([
      fragment('2026-07-13-390-missing.md', missing),
      fragment('2026-07-13-391-empty.md', empty.replaceAll('390', '391')),
      fragment(
        '2026-07-13-392-duplicate.md',
        duplicate.replaceAll('390', '392'),
      ),
      fragment(
        '2026-07-13-393-reordered.md',
        reordered.replaceAll('390', '393'),
      ),
    ]);

    expect(
      errors.some(
        (error) => error.includes('missing.md') && error.includes('Notes'),
      ),
    ).toBe(true);
    expect(
      errors.some(
        (error) => error.includes('empty.md') && error.includes('Changed'),
      ),
    ).toBe(true);
    expect(
      errors.some(
        (error) => error.includes('duplicate.md') && error.includes('Notes'),
      ),
    ).toBe(true);
    expect(
      errors.some(
        (error) => error.includes('reordered.md') && error.includes('order'),
      ),
    ).toBe(true);
  });

  it('rejects an issue number that does not match the filename', () => {
    expect(
      validateFragments([fragment('2026-07-13-391-mismatch.md')])[0],
    ).toContain('does not match filename issue #391');
  });

  it('rejects duplicate issue numbers across fragments', () => {
    const errors = validateFragments([
      fragment('2026-07-13-390-first.md'),
      fragment('2026-07-12-390-second.md'),
    ]);

    expect(errors.some((error) => error.includes('duplicate issue #390'))).toBe(
      true,
    );
  });

  it('rejects conflict markers and multiple entry headings', () => {
    const errors = validateFragments([
      fragment('2026-07-13-390-conflict.md', `${validBody}<<<<<<< HEAD\n`),
      fragment(
        '2026-07-13-391-multiple.md',
        `${validBody.replaceAll('390', '391')}\n### Another entry\n`,
      ),
    ]);

    expect(
      errors.some(
        (error) =>
          error.includes('conflict.md') && error.includes('merge marker'),
      ),
    ).toBe(true);
    expect(
      errors.some(
        (error) => error.includes('multiple.md') && error.includes('one entry'),
      ),
    ).toBe(true);
  });
});

describe('assembleChangelog', () => {
  it('groups valid fragments in deterministic reverse chronological order', () => {
    const issue388 = validBody
      .replaceAll('390', '388')
      .replace('Eliminate', 'Older');
    const issue389 = validBody
      .replaceAll('390', '389')
      .replace('Eliminate', 'Earlier issue');
    const fragments = [
      fragment('2026-07-12-388-older.md', issue388),
      fragment('2026-07-13-389-earlier-issue.md', issue389),
      fragment('2026-07-13-390-changelog-fragments.md'),
    ];

    const assembled = assembleChangelog(fragments);

    expect(assembled).toContain(
      '<!-- Generated from docs/changelog/entries. Do not edit this output directly. -->',
    );
    expect(assembled.match(/## 2026-07-13/g)).toHaveLength(1);
    expect(assembled.indexOf('Eliminate changelog conflicts')).toBeLessThan(
      assembled.indexOf('Earlier issue changelog conflicts'),
    );
    expect(assembled.indexOf('Earlier issue changelog conflicts')).toBeLessThan(
      assembled.indexOf('## 2026-07-12'),
    );
    expect(assembled.endsWith('\n')).toBe(true);
  });

  it('refuses to assemble invalid fragments', () => {
    expect(() => assembleChangelog([fragment('invalid.md')])).toThrow(
      'invalid.md',
    );
  });
});

describe('changelog CLI', () => {
  const temporaryDirectories: string[] = [];
  const cliPath = resolve('scripts/changelog.mjs');

  const createEntries = async (body = validBody) => {
    const root = await mkdtemp(join(tmpdir(), 'pluto-changelog-'));
    const entries = join(root, 'entries');
    temporaryDirectories.push(root);
    await mkdir(entries);
    await writeFile(
      join(entries, '2026-07-13-390-changelog-fragments.md'),
      body,
    );
    return { root, entries };
  };

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true })),
    );
  });

  it('checks valid fragments and reports their count', async () => {
    const { entries } = await createEntries();

    const output = execFileSync(
      process.execPath,
      [cliPath, 'check', '--entries', entries],
      { encoding: 'utf8' },
    );

    expect(output).toContain('Validated 1 changelog fragment(s).');
  });

  it('returns validation errors on stderr', async () => {
    const { entries } = await createEntries();
    await writeFile(join(entries, 'invalid.md'), validBody);

    const result = spawnSync(
      process.execPath,
      [cliPath, 'check', '--entries', entries],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('invalid.md');
  });

  it('builds to stdout or an explicit output file', async () => {
    const { root, entries } = await createEntries();
    const stdout = execFileSync(
      process.execPath,
      [cliPath, 'build', '--entries', entries],
      { encoding: 'utf8' },
    );
    const outputPath = join(root, 'generated.md');

    const fileCommandOutput = execFileSync(
      process.execPath,
      [cliPath, 'build', '--entries', entries, '--output', outputPath],
      { encoding: 'utf8' },
    );

    expect(stdout).toContain('## 2026-07-13');
    expect(await readFile(outputPath, 'utf8')).toBe(stdout);
    expect(fileCommandOutput).toContain('Wrote 1 changelog fragment(s)');
  });
});

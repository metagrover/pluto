import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveNotesEvaluationActivation } from '../../electron/notesEvaluationActivation';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
const fixture = () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-phi-application-')),
  );
  roots.push(root);
  fs.chmodSync(root, 0o700);
  const token = randomUUID();
  const markerPath = path.join(root, '.notes-evaluation.json');
  fs.writeFileSync(
    markerPath,
    JSON.stringify({
      version: 1,
      source: 'synthetic_only',
      token,
      userDataPath: root,
    }),
    { mode: 0o600 },
  );
  return {
    root,
    markerPath,
    input: {
      isPackaged: false,
      userDataPath: root,
      argv: [`--user-data-dir=${root}`, `--phi-notes-evaluation=${token}`],
    },
  };
};

describe('disposable Electron notes activation', () => {
  it('leaves all ordinary launches unchanged without reading the filesystem', () => {
    expect(
      resolveNotesEvaluationActivation({
        isPackaged: true,
        userDataPath: '/does-not-exist',
        argv: [],
      }),
    ).toBeUndefined();
  });
  it('admits the owner-only synthetic temporary profile', () => {
    expect(resolveNotesEvaluationActivation(fixture().input)).toMatchObject({
      configId: 'phi-notes-source-first',
      environment: 'disposable_integration',
    });
  });
  it.each([
    'packaged',
    'wrong_token',
    'wrong_profile',
    'public_marker',
    'public_root',
    'symlink_marker',
    'wrong_source',
  ])('rejects %s', (fault) => {
    const { root, input, markerPath } = fixture();
    if (fault === 'packaged') input.isPackaged = true;
    if (fault === 'wrong_token')
      input.argv[1] = `--phi-notes-evaluation=${randomUUID()}`;
    if (fault === 'wrong_profile')
      input.argv[0] = '--user-data-dir=/production';
    if (fault === 'public_marker') fs.chmodSync(markerPath, 0o644);
    if (fault === 'public_root') fs.chmodSync(root, 0o755);
    if (fault === 'symlink_marker') {
      fs.renameSync(markerPath, `${markerPath}.original`);
      fs.symlinkSync(`${markerPath}.original`, markerPath);
    }
    if (fault === 'wrong_source') {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      fs.writeFileSync(
        markerPath,
        JSON.stringify({ ...marker, source: 'production' }),
      );
    }
    expect(() => resolveNotesEvaluationActivation(input)).toThrow(
      'notes_evaluation_profile_rejected',
    );
  });
});

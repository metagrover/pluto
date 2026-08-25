import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type PrivateParakeetEouManifest,
  validatePrivateParakeetEouManifest,
} from '../../scripts/validate_private_parakeet_eou_manifest.ts';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const fixture = () => {
  const sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), 'pluto-eou-')));
  const privateRoot = path.join(sandbox, 'private-audio');
  mkdirSync(privateRoot);
  const micPath = path.join(privateRoot, 'mic.wav');
  const systemPath = path.join(privateRoot, 'system.wav');
  writeFileSync(micPath, 'mic-bytes');
  writeFileSync(systemPath, 'system-bytes');
  const manifest: PrivateParakeetEouManifest = {
    schemaVersion: 1,
    approvedPrivateRoot: privateRoot,
    expectedDurationSeconds: 60,
    sources: {
      mic: { path: micPath, sha256: sha256('mic-bytes') },
      system: { path: systemPath, sha256: sha256('system-bytes') },
    },
  };
  const adapters = {
    lstat: lstatSync,
    realpath: realpathSync,
    sha256File: (filePath: string) =>
      sha256(filePath === micPath ? 'mic-bytes' : 'system-bytes'),
    probeAudio: () => ({ durationSeconds: 60, monoConvertible: true }),
  };
  return { sandbox, privateRoot, micPath, systemPath, manifest, adapters };
};

describe('private Parakeet EOU manifest', () => {
  it('accepts unchanged regular dual-source audio under one approved root', () => {
    const value = fixture();
    const validated = validatePrivateParakeetEouManifest(
      value.manifest,
      value.adapters,
      { homeRoot: '/Users/test', workspaceRoot: '/workspace/pluto' },
    );
    expect(validated.sources.mic.path).toBe(value.micPath);
    expect(validated.sources.system.path).toBe(value.systemPath);
    expect(validated.expectedDurationSeconds).toBe(60);
  });

  it('rejects transcript content and missing sources', () => {
    const value = fixture();
    expect(() =>
      validatePrivateParakeetEouManifest(
        { ...value.manifest, transcript: 'private words' },
        value.adapters,
      ),
    ).toThrowError('private_content_not_allowed');
    expect(() =>
      validatePrivateParakeetEouManifest(
        { ...value.manifest, sources: { mic: value.manifest.sources.mic } },
        value.adapters,
      ),
    ).toThrowError('manifest_invalid');
  });

  it('rejects changed files and invalid digests', () => {
    const value = fixture();
    expect(() =>
      validatePrivateParakeetEouManifest(
        {
          ...value.manifest,
          sources: {
            ...value.manifest.sources,
            mic: { ...value.manifest.sources.mic, sha256: '0'.repeat(64) },
          },
        },
        value.adapters,
      ),
    ).toThrowError('source_digest_mismatch');
    expect(() =>
      validatePrivateParakeetEouManifest(
        {
          ...value.manifest,
          sources: {
            ...value.manifest.sources,
            mic: { ...value.manifest.sources.mic, sha256: 'bad' },
          },
        },
        value.adapters,
      ),
    ).toThrowError('manifest_invalid');
  });

  it('rejects symlinks and source aliases', () => {
    const value = fixture();
    const linked = path.join(value.privateRoot, 'linked.wav');
    symlinkSync(value.micPath, linked);
    expect(() =>
      validatePrivateParakeetEouManifest(
        {
          ...value.manifest,
          sources: {
            ...value.manifest.sources,
            system: { path: linked, sha256: sha256('mic-bytes') },
          },
        },
        value.adapters,
      ),
    ).toThrowError('source_unavailable');
    expect(() =>
      validatePrivateParakeetEouManifest(
        {
          ...value.manifest,
          sources: {
            mic: value.manifest.sources.mic,
            system: value.manifest.sources.mic,
          },
        },
        value.adapters,
      ),
    ).toThrowError('source_not_independent');
  });

  it.each(['/', '/Users/test', '/workspace/pluto'])(
    'rejects unsafe approved root %s',
    (approvedPrivateRoot) => {
      const value = fixture();
      expect(() =>
        validatePrivateParakeetEouManifest(
          { ...value.manifest, approvedPrivateRoot },
          value.adapters,
          { homeRoot: '/Users/test', workspaceRoot: '/workspace/pluto' },
        ),
      ).toThrowError('private_root_unsafe');
    },
  );

  it('rejects workspace fixtures, non-convertible audio, and duration drift', () => {
    const value = fixture();
    expect(() =>
      validatePrivateParakeetEouManifest(value.manifest, value.adapters, {
        homeRoot: '/Users/test',
        workspaceRoot: value.sandbox,
      }),
    ).toThrowError('private_root_unsafe');
    expect(() =>
      validatePrivateParakeetEouManifest(value.manifest, {
        ...value.adapters,
        probeAudio: () => ({ durationSeconds: 60, monoConvertible: false }),
      }),
    ).toThrowError('source_not_convertible');
    expect(() =>
      validatePrivateParakeetEouManifest(value.manifest, {
        ...value.adapters,
        probeAudio: () => ({ durationSeconds: 57, monoConvertible: true }),
      }),
    ).toThrowError('source_duration_mismatch');
  });
});

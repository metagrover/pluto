import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  LIVE_TRANSCRIPTION_ROLLOUT_ZERO_DIGEST,
  LiveTranscriptionRolloutStore,
  type LiveTranscriptionRolloutStoreOptions,
} from '../../electron/transcription/liveTranscriptionRolloutStore';

const digest = 'a'.repeat(64);
const ownerToken = 'owner-token';
const directories: string[] = [];

const createStore = (
  overrides: Partial<LiveTranscriptionRolloutStoreOptions> = {},
) => {
  const directory = mkdtempSync(join(tmpdir(), 'pluto-live-rollout-'));
  directories.push(directory);
  return new LiveTranscriptionRolloutStore({
    filePath: join(directory, 'rollout.json'),
    ownerToken,
    approvedStageEvidenceDigests: { internal_primary: [digest] },
    ...overrides,
  });
};

const pathOf = (store: LiveTranscriptionRolloutStore) =>
  (store as unknown as { filePath: string }).filePath;

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('live transcription rollout store', () => {
  it('defaults missing and corrupt state to mlx', () => {
    const store = createStore();
    expect(store.read()).toMatchObject({
      mode: 'mlx',
      stage: 'none',
      evidenceDigest: LIVE_TRANSCRIPTION_ROLLOUT_ZERO_DIGEST,
    });
    writeFileSync(pathOf(store), '{corrupt');
    expect(store.read().mode).toBe('mlx');
  });

  it('promotes only with an approved stage digest and owner', () => {
    const store = createStore();
    expect(
      store.promote({
        stage: 'internal_primary',
        evidenceDigest: digest,
        engineEpoch: 1,
        ownerToken: 'wrong',
      }),
    ).toEqual({ accepted: false, reason: 'not_owner' });
    expect(
      store.promote({
        stage: 'internal_primary',
        evidenceDigest: 'b'.repeat(64),
        engineEpoch: 1,
        ownerToken,
      }),
    ).toEqual({ accepted: false, reason: 'invalid_evidence' });
    expect(
      store.promote({
        stage: 'internal_primary',
        evidenceDigest: digest,
        engineEpoch: 1,
        ownerToken,
      }),
    ).toMatchObject({
      accepted: true,
      state: {
        mode: 'parakeet',
        stage: 'internal_primary',
        evidenceDigest: digest,
        engineEpoch: 1,
      },
    });
  });

  it('persists only finite content-free rollout fields and survives restart', () => {
    const store = createStore();
    store.promote({
      stage: 'internal_primary',
      evidenceDigest: digest,
      engineEpoch: 1,
      ownerToken,
    });
    const persisted = JSON.parse(readFileSync(pathOf(store), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(persisted).sort()).toEqual([
      'engineEpoch',
      'evidenceDigest',
      'mode',
      'rollbackCount',
      'schemaVersion',
      'stage',
    ]);
    expect(
      new LiveTranscriptionRolloutStore({
        filePath: pathOf(store),
        ownerToken,
        approvedStageEvidenceDigests: { internal_primary: [digest] },
      }).read().mode,
    ).toBe('parakeet');
  });

  it('fails closed for invalid stored mode, config, and digest', () => {
    const store = createStore();
    for (const invalid of [
      {
        schemaVersion: 1,
        mode: 'ollama',
        stage: 'none',
        evidenceDigest: LIVE_TRANSCRIPTION_ROLLOUT_ZERO_DIGEST,
        engineEpoch: 0,
        rollbackCount: 0,
      },
      {
        schemaVersion: 1,
        mode: 'parakeet',
        stage: 'internal_primary',
        evidenceDigest: 'not-a-digest',
        engineEpoch: 1,
        rollbackCount: 0,
      },
      {
        schemaVersion: 1,
        mode: 'parakeet',
        stage: 'none',
        evidenceDigest: LIVE_TRANSCRIPTION_ROLLOUT_ZERO_DIGEST,
        engineEpoch: 1,
        rollbackCount: 0,
      },
      {
        schemaVersion: 1,
        mode: 'parakeet',
        stage: 'internal_primary',
        evidenceDigest: digest,
        engineEpoch: Number.MAX_SAFE_INTEGER + 1,
        rollbackCount: 0,
      },
    ]) {
      writeFileSync(pathOf(store), JSON.stringify(invalid));
      expect(store.read().mode).toBe('mlx');
    }
  });

  it('durably rolls watchdog state back before stale Parakeet success can win', () => {
    const store = createStore();
    store.promote({
      stage: 'internal_primary',
      evidenceDigest: digest,
      engineEpoch: 1,
      ownerToken,
    });
    expect(
      store.rollback({ reason: 'watchdog', engineEpoch: 2, ownerToken }),
    ).toMatchObject({
      accepted: true,
      state: {
        mode: 'mlx',
        rollbackCount: 1,
        engineEpoch: 2,
        lastRollbackReason: 'watchdog',
      },
    });
    expect(
      store.promote({
        stage: 'internal_primary',
        evidenceDigest: digest,
        engineEpoch: 1,
        ownerToken,
      }),
    ).toEqual({ accepted: false, reason: 'stale_epoch' });
    expect(
      new LiveTranscriptionRolloutStore({
        filePath: pathOf(store),
        ownerToken,
        approvedStageEvidenceDigests: { internal_primary: [digest] },
      }).read().mode,
    ).toBe('mlx');
  });

  it('fails closed and durably rolls back when restart approvals no longer contain the stored digest', () => {
    const store = createStore();
    store.promote({
      stage: 'internal_primary',
      evidenceDigest: digest,
      engineEpoch: 1,
      ownerToken,
    });
    const restarted = new LiveTranscriptionRolloutStore({
      filePath: pathOf(store),
      ownerToken,
      approvedStageEvidenceDigests: { internal_primary: ['b'.repeat(64)] },
    });

    expect(restarted.read()).toMatchObject({
      mode: 'mlx',
      stage: 'none',
      engineEpoch: 1,
      rollbackCount: 1,
      lastRollbackReason: 'startup_invalid',
    });
    expect(JSON.parse(readFileSync(pathOf(store), 'utf8')).mode).toBe('mlx');
  });

  it('keeps rollback monotonic and rejects stale epochs', () => {
    const store = createStore();
    expect(
      store.rollback({ reason: 'backend_failure', engineEpoch: 3, ownerToken }),
    ).toMatchObject({ accepted: true, state: { rollbackCount: 1 } });
    expect(
      store.rollback({ reason: 'manual', engineEpoch: 2, ownerToken }),
    ).toEqual({ accepted: false, reason: 'stale_epoch' });
    expect(
      store.rollback({ reason: 'manual', engineEpoch: 3, ownerToken }),
    ).toMatchObject({
      accepted: true,
      state: { rollbackCount: 2, engineEpoch: 3 },
    });
  });
});

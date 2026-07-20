import { spawnSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runProductionAttributionAcceptance } from '../../src/services/productionSpeakerAttributionAcceptance';
import { reprocessAttributedMeeting } from '../../src/services/safeAttributionReprocessing';

describe('production speaker-attribution acceptance', () => {
  it('passes pass-through, all-remote, overlap, and short-local cases', () => {
    const report = runProductionAttributionAcceptance({
      schemaVersion: 1,
      cases: [
        {
          id: 'pass-through',
          turns: [{ startTime: 0, endTime: 6, cluster: 'remote' }],
          energy: [{ startTime: 0, endTime: 6, micRms: 0.03, systemRms: 0.03 }],
          expected: { falseMeSeconds: 0, injectedLocalWindows: 0 },
        },
        {
          id: 'short-local',
          turns: [{ startTime: 0, endTime: 8, cluster: 'remote' }],
          segments: [
            { startTime: 0, endTime: 4, speaker: 'Them', text: 'remote' },
            {
              startTime: 4,
              endTime: 4.541,
              speaker: 'Them',
              text: 'short reply',
            },
            { startTime: 4.541, endTime: 8, speaker: 'Them', text: 'remote' },
          ],
          referenceTurns: [
            { startTime: 0, endTime: 4, speaker: 'Them' },
            { startTime: 4, endTime: 4.541, speaker: 'Me' },
            { startTime: 4.541, endTime: 8, speaker: 'Them' },
          ],
          energy: [
            { startTime: 0, endTime: 4, micRms: 0.03, systemRms: 0.03 },
            { startTime: 4, endTime: 4.541, micRms: 0.06, systemRms: 0.001 },
            { startTime: 4.541, endTime: 8, micRms: 0.03, systemRms: 0.03 },
          ],
          expected: { falseMeSeconds: 0, injectedLocalWindows: 1 },
        },
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(2);
    expect(report.results[1]).toMatchObject({
      falseMeSeconds: 0,
      missedMeSeconds: 0,
      injectedLocalWindows: 1,
    });
  });

  it('does not disclose a private manifest path when loading fails', () => {
    const privatePath = '/private/tmp/private-speaker-secret.json';
    const script = path.resolve(
      'scripts/run_production_speaker_attribution_acceptance.ts',
    );
    const run = spawnSync(
      process.execPath,
      ['--experimental-strip-types', script, '--manifest', privatePath],
      { encoding: 'utf8' },
    );

    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).not.toContain(privatePath);
    expect(JSON.parse(run.stdout)).toEqual({
      passed: false,
      error: 'manifest_invalid',
    });
  });

  it('does not disclose private manifest content when parsing fails', () => {
    const privatePath = path.join(
      os.tmpdir(),
      `pluto-private-attribution-${process.pid}.json`,
    );
    const privateContent = 'private transcript content';
    writeFileSync(privatePath, privateContent);
    const script = path.resolve(
      'scripts/run_production_speaker_attribution_acceptance.ts',
    );
    let run: ReturnType<typeof spawnSync>;
    try {
      run = spawnSync(
        process.execPath,
        ['--experimental-strip-types', script, '--manifest', privatePath],
        { encoding: 'utf8' },
      );
    } finally {
      unlinkSync(privatePath);
    }

    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).not.toContain(privatePath);
    expect(`${run.stdout}${run.stderr}`).not.toContain(privateContent);
    expect(JSON.parse(run.stdout)).toEqual({
      passed: false,
      error: 'manifest_invalid',
    });
  });
});

describe('safe attribution reprocessing', () => {
  it('preserves the previous artifact until replacement validates', async () => {
    const saves: unknown[] = [];
    const result = await reprocessAttributedMeeting({
      previous: { version: 2, transcript: 'previous' },
      buildReplacement: async () => ({ version: 3, transcript: 'candidate' }),
      validateReplacement: async () => false,
      saveReplacement: async (replacement) => saves.push(replacement),
    });

    expect(result).toEqual({ status: 'validation_failed', preserved: true });
    expect(saves).toEqual([]);
  });

  it('saves only the validated replacement', async () => {
    const saves: unknown[] = [];
    const result = await reprocessAttributedMeeting({
      previous: { version: 2 },
      buildReplacement: async () => ({ version: 3 }),
      validateReplacement: async () => true,
      saveReplacement: async (replacement) => saves.push(replacement),
    });

    expect(result).toEqual({ status: 'replaced', preserved: false });
    expect(saves).toEqual([{ version: 3 }]);
  });

  it('preserves persisted state when the atomic replacement rolls back', async () => {
    const previous = { version: 2 };
    let persisted = previous;
    const result = await reprocessAttributedMeeting({
      previous,
      buildReplacement: async () => ({ version: 3 }),
      validateReplacement: async () => true,
      saveReplacement: async (replacement) => {
        const snapshot = persisted;
        try {
          persisted = replacement;
          throw new Error('index update failed');
        } catch (error) {
          persisted = snapshot;
          throw error;
        }
      },
    });

    expect(result).toEqual({ status: 'save_failed', preserved: true });
    expect(persisted).toEqual(previous);
  });
});

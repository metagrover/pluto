import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  serializeDualShadowTrialReport,
  writeDualShadowTrialReport,
} from '../../electron/transcription/dualShadowTrialReport';

const directories: string[] = [];

const report = () => ({
  verdict: 'passed' as const,
  windowsSubmitted: { mic: 2, system: 2 },
  windowsCompleted: { mic: 2, system: 2 },
  unresolved: { mic: 0, system: 0 },
  flush: { mic: 'completed' as const, system: 'completed' as const },
  resource: {
    peakCombinedRssBucket: '512mb_to_1gb' as const,
    worstThermal: 'nominal' as const,
  },
  failureCodes: [],
});

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('dual shadow trial report', () => {
  it('serializes only allowlisted aggregate fields', () => {
    const parsed = JSON.parse(serializeDualShadowTrialReport(report()));

    expect(Object.keys(parsed).sort()).toEqual([
      'failureCodes',
      'flush',
      'resource',
      'schemaVersion',
      'unresolved',
      'verdict',
      'windowsCompleted',
      'windowsSubmitted',
    ]);
    expect(parsed).toEqual({ schemaVersion: 1, ...report() });
  });

  it.each([
    { text: 'private transcript' },
    { audioPath: '/private/audio.wav' },
    { meetingId: 'meeting-1' },
    { generation: 'generation-1' },
    { timestamp: '2026-08-20T00:00:00.000Z' },
    { errorMessage: 'private runtime failure' },
    { unexpected: true },
  ])('rejects privacy-sensitive or unknown fields: %o', (privateField) => {
    expect(() =>
      serializeDualShadowTrialReport({ ...report(), ...privateField }),
    ).toThrowError('dual_shadow_report_invalid');
  });

  it('rejects unknown nested values and arbitrary failure strings', () => {
    expect(() =>
      serializeDualShadowTrialReport({
        ...report(),
        resource: { ...report().resource, detail: 'not allowed' },
      }),
    ).toThrowError('dual_shadow_report_invalid');
    expect(() =>
      serializeDualShadowTrialReport({
        ...report(),
        failureCodes: ['details'],
      }),
    ).toThrowError('dual_shadow_report_invalid');
  });

  it('atomically replaces the one private user-data report', () => {
    const userDataPath = mkdtempSync(
      join(tmpdir(), 'pluto-dual-shadow-report-'),
    );
    directories.push(userDataPath);
    const reportPath = join(
      userDataPath,
      'parakeet-dual-shadow-trial-report.json',
    );
    writeFileSync(reportPath, '{"old":true}\n', { mode: 0o644 });

    writeDualShadowTrialReport({ userDataPath, report: report() });

    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      ...report(),
    });
    expect(statSync(reportPath).mode & 0o777).toBe(0o600);
    expect(
      existsSync(
        join(userDataPath, '.parakeet-dual-shadow-trial-report.json.0.tmp'),
      ),
    ).toBe(false);
  });

  it('never reuses a permissive pre-existing temporary file', () => {
    const userDataPath = mkdtempSync(
      join(tmpdir(), 'pluto-dual-shadow-report-'),
    );
    directories.push(userDataPath);
    const staleTemporaryPath = join(
      userDataPath,
      '.parakeet-dual-shadow-trial-report.json.0.tmp',
    );
    writeFileSync(staleTemporaryPath, 'stale', { mode: 0o644 });

    writeDualShadowTrialReport({ userDataPath, report: report() });

    expect(readFileSync(staleTemporaryPath, 'utf8')).toBe('stale');
    expect(statSync(staleTemporaryPath).mode & 0o777).toBe(0o644);
  });
});

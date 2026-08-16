import { spawnSync } from 'node:child_process';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertReportTargetSafe,
  buildEngineRunOrder,
  buildGapInjections,
  buildQuarterSecondFrames,
  nextMlxProductionQueueIndex,
  parsePrivateLiveReplayOptions,
  proveTargetedRepair,
  timedAgreement,
} from '../../scripts/run_private_parakeet_live_replay.ts';
import {
  PRIVATE_LIVE_REPLAY_MODEL_VERSION,
  type PrivateLiveReplayManifest,
  requirePreparedPrivateLiveReplayModel,
  summarizePrivateLiveReplayManifest,
  validatePrivateLiveReplayManifest,
} from '../../scripts/validate_private_parakeet_live_manifest.ts';

const createFixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pluto-live-replay-'));
  const runtimePath = path.join(root, 'parakeet-runtime');
  const modelRoot = path.join(root, 'models');
  writeFileSync(runtimePath, 'runtime');
  mkdirSync(modelRoot);
  writeFileSync(
    path.join(modelRoot, 'active.json'),
    JSON.stringify({ version: PRIVATE_LIVE_REPLAY_MODEL_VERSION }),
  );
  const versionRoot = path.join(
    modelRoot,
    'versions',
    PRIVATE_LIVE_REPLAY_MODEL_VERSION,
  );
  mkdirSync(versionRoot, { recursive: true });
  writeFileSync(path.join(versionRoot, 'verified-model'), 'model');
  const durations = [1_800, 1_800, 1_800];
  const durationByPath = new Map<string, number>();
  const meetings = durations.map((durationSeconds, index) => {
    const micPath = path.join(root, `mic-${index}.wav`);
    const systemPath = path.join(root, `system-${index}.wav`);
    writeFileSync(micPath, `mic-${index}`);
    writeFileSync(systemPath, `system-${index}`);
    const proxyTranscriptPath = path.join(root, `proxy-${index}.json`);
    writeFileSync(proxyTranscriptPath, '[]');
    durationByPath.set(realpathSync(micPath), durationSeconds);
    durationByPath.set(realpathSync(systemPath), durationSeconds);
    return {
      id: `meeting-${index}`,
      sealedDurationSeconds: durationSeconds,
      sealedGeneration: index + 1,
      integrity: 'sealed' as const,
      unresolvedCaptureGap: false,
      micSource: 'independent' as const,
      proxyTranscriptPath,
      sources: { micPath, systemPath },
    };
  });
  const manifest: PrivateLiveReplayManifest = {
    schemaVersion: 1,
    runtime: { executablePath: runtimePath, modelRoot },
    meetings,
  };
  return {
    manifest,
    adapters: {
      lstat: lstatSync,
      realpath: realpathSync,
      durationSeconds: (filePath: string) => durationByPath.get(filePath) ?? 0,
    },
  };
};

describe('private Parakeet live replay manifest', () => {
  it('accepts three independent sealed dual-source meetings totaling 90 minutes', () => {
    const fixture = createFixture();
    const validated = validatePrivateLiveReplayManifest(
      fixture.manifest,
      fixture.adapters,
    );

    expect(summarizePrivateLiveReplayManifest(validated)).toEqual({
      schemaVersion: 1,
      meetingCount: 3,
      sourceCount: 6,
      audioMinutesRoundedTo5: 90,
    });
  });

  it('requires an already activated pinned model and never prepares one', () => {
    const fixture = createFixture();
    expect(() =>
      requirePreparedPrivateLiveReplayModel(fixture.manifest.runtime.modelRoot),
    ).not.toThrow();
    const emptyRoot = mkdtempSync(path.join(tmpdir(), 'pluto-empty-model-'));
    expect(() => requirePreparedPrivateLiveReplayModel(emptyRoot)).toThrowError(
      'model_unavailable',
    );
    expect(readdirSync(emptyRoot)).toEqual([]);
  });

  it('returns only insufficient_corpus when corpus minima are not met', () => {
    const fixture = createFixture();
    expect(() =>
      validatePrivateLiveReplayManifest(
        {
          ...fixture.manifest,
          meetings: fixture.manifest.meetings.slice(0, 2),
        },
        fixture.adapters,
      ),
    ).toThrowError('insufficient_corpus');

    fixture.manifest.meetings[0].sealedDurationSeconds = 1_799;
    fixture.adapters.durationSeconds = () => 1_799;
    expect(() =>
      validatePrivateLiveReplayManifest(fixture.manifest, fixture.adapters),
    ).toThrowError('insufficient_corpus');
  });

  it('rejects mixed mic evidence and aliased source files', () => {
    const fixture = createFixture();
    expect(() =>
      validatePrivateLiveReplayManifest(
        {
          ...fixture.manifest,
          meetings: fixture.manifest.meetings.map((meeting, index) =>
            index === 0 ? { ...meeting, micSource: 'mixed' as never } : meeting,
          ),
        },
        fixture.adapters,
      ),
    ).toThrowError('mixed_mic_source');

    const aliased = structuredClone(fixture.manifest);
    aliased.meetings[0].sources.systemPath =
      aliased.meetings[0].sources.micPath;
    expect(() =>
      validatePrivateLiveReplayManifest(aliased, fixture.adapters),
    ).toThrowError('source_not_independent');

    const hardLinked = createFixture();
    const micPath = hardLinked.manifest.meetings[0].sources.micPath;
    const systemPath = hardLinked.manifest.meetings[0].sources.systemPath;
    const hardLinkPath = path.join(
      path.dirname(systemPath),
      'system-hard-link.wav',
    );
    linkSync(micPath, hardLinkPath);
    hardLinked.manifest.meetings[0].sources.systemPath = hardLinkPath;
    expect(() =>
      validatePrivateLiveReplayManifest(
        hardLinked.manifest,
        hardLinked.adapters,
      ),
    ).toThrowError('source_not_independent');
  });

  it('requires sealed generations, integrity, and gap-free capture', () => {
    const fixture = createFixture();
    for (const patch of [
      { sealedGeneration: 0 },
      { integrity: 'recording' },
      { unresolvedCaptureGap: true },
    ]) {
      const manifest = structuredClone(fixture.manifest) as unknown as Record<
        string,
        unknown
      >;
      const meetings = manifest.meetings as Array<Record<string, unknown>>;
      Object.assign(meetings[0], patch);
      expect(() =>
        validatePrivateLiveReplayManifest(manifest, fixture.adapters),
      ).toThrow();
    }
  });

  it('rejects source duration drift over five seconds', () => {
    const fixture = createFixture();
    const driftingPath = realpathSync(
      fixture.manifest.meetings[0].sources.systemPath,
    );
    const baseProbe = fixture.adapters.durationSeconds;
    fixture.adapters.durationSeconds = (filePath) =>
      filePath === driftingPath ? 1_806 : baseProbe(filePath);
    expect(() =>
      validatePrivateLiveReplayManifest(fixture.manifest, fixture.adapters),
    ).toThrowError('source_duration_mismatch');
  });

  it.each([
    { transcript: 'private' },
    { nested: { text: 'private' } },
    { nested: [{ audio: 'base64' }] },
    { payload: { pcmData: 'AAAA' } },
    { payload: 'data:audio/wav;base64,AAAA' },
  ])('recursively rejects inline private content: $unsafe', (unsafe) => {
    const fixture = createFixture();
    expect(() =>
      validatePrivateLiveReplayManifest(
        { ...fixture.manifest, ...unsafe },
        fixture.adapters,
      ),
    ).toThrowError('private_content_not_allowed');
  });

  it('rejects unknown fields, relative paths, non-files, and symlinks with finite codes', () => {
    const fixture = createFixture();
    const unknown = structuredClone(fixture.manifest) as unknown as Record<
      string,
      unknown
    >;
    (unknown.runtime as Record<string, unknown>).secret = true;
    expect(() =>
      validatePrivateLiveReplayManifest(unknown, fixture.adapters),
    ).toThrowError('manifest_invalid');

    const relative = structuredClone(fixture.manifest);
    relative.meetings[0].sources.micPath = 'relative.wav';
    expect(() =>
      validatePrivateLiveReplayManifest(relative, fixture.adapters),
    ).toThrowError('source_unavailable');

    const symlinked = createFixture();
    const micPath = symlinked.manifest.meetings[0].sources.micPath;
    const linkPath = path.join(path.dirname(micPath), 'mic-link.wav');
    symlinkSync(micPath, linkPath);
    symlinked.manifest.meetings[0].sources.micPath = linkPath;
    expect(() =>
      validatePrivateLiveReplayManifest(symlinked.manifest, symlinked.adapters),
    ).toThrowError('source_unavailable');
  });

  it('redacts a missing manifest path from the CLI failure', () => {
    const missing = '/definitely/private/missing-live-manifest.json';
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--experimental-strip-types',
        path.resolve('scripts/validate_private_parakeet_live_manifest.ts'),
        '--manifest',
        missing,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('manifest_unavailable\n');
    expect(`${result.stdout}${result.stderr}`).not.toContain(missing);
  });

  it('redacts runner failures before any model process starts', () => {
    const missing = '/definitely/private/missing-live-manifest.json';
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        path.resolve('scripts/run_private_parakeet_live_replay.ts'),
        '--manifest',
        missing,
        '--mode',
        'causal',
        '--repetitions',
        '3',
        '--out',
        '/definitely/private/report.json',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('manifest_unavailable\n');
    expect(`${result.stdout}${result.stderr}`).not.toContain(missing);
  });
});

describe('private Parakeet live replay orchestration', () => {
  it('alternates engine order across three warm repetitions and tests both configs', () => {
    expect(buildEngineRunOrder(3)).toEqual([
      ['mlxProduction', 'parakeetPinnedDefault', 'parakeetLowLatency'],
      ['parakeetLowLatency', 'parakeetPinnedDefault', 'mlxProduction'],
      ['mlxProduction', 'parakeetPinnedDefault', 'parakeetLowLatency'],
    ]);
  });

  it('releases only 250 ms causal frames without future audio', () => {
    expect(buildQuarterSecondFrames(0.6)).toEqual([
      { sequence: 0, availableAtSeconds: 0.25, audioEndSeconds: 0.25 },
      { sequence: 1, availableAtSeconds: 0.5, audioEndSeconds: 0.5 },
      { sequence: 2, availableAtSeconds: 0.6, audioEndSeconds: 0.6 },
    ]);
  });

  it('applies production latest-wins admission when MLX exceeds five seconds', () => {
    expect(nextMlxProductionQueueIndex(0, 16, 8, 40)).toEqual({
      nextIndex: 2,
      admittedThroughIndex: 2,
    });
    expect(nextMlxProductionQueueIndex(2, 16.5, 8, 40)).toEqual({
      nextIndex: 3,
      admittedThroughIndex: 2,
    });
  });

  it('scores token identity only within the causal time tolerance', () => {
    expect(
      timedAgreement(
        [
          { token: 'alpha', atSeconds: 5 },
          { token: 'beta', atSeconds: 20 },
        ],
        [
          { token: 'alpha', atSeconds: 6.5 },
          { token: 'beta', atSeconds: 30 },
        ],
        2,
      ),
    ).toEqual({ precision: 0.5, recall: 0.5 });
  });

  it('splices targeted repair evidence without changing tokens outside context', () => {
    expect(
      proveTargetedRepair(
        [
          { token: 'before', atSeconds: 1 },
          { token: 'repair', atSeconds: 5 },
          { token: 'after', atSeconds: 9 },
        ],
        'repair',
        3,
        7,
      ),
    ).toEqual({ repairedTokenF1: 1, outsideContextTokenChanges: 0 });
  });

  it('places exact two-second gap injections in early, middle, and late regions', () => {
    expect(buildGapInjections(1_800)).toEqual([
      { label: 'early', startSeconds: 180, endSeconds: 182 },
      { label: 'middle', startSeconds: 899, endSeconds: 901 },
      { label: 'late', startSeconds: 1_618, endSeconds: 1_620 },
    ]);
  });

  it('accepts only finite modes, exactly three causal repetitions, and absolute outputs', () => {
    expect(
      parsePrivateLiveReplayOptions([
        '--',
        '--manifest',
        '/private/manifest.json',
        '--mode',
        'realtime-soak',
        '--out',
        '/private/report.json',
      ]),
    ).toMatchObject({ mode: 'realtime-soak', repetitions: 1 });
    expect(() =>
      parsePrivateLiveReplayOptions([
        '--manifest',
        '/private/manifest.json',
        '--mode',
        'causal',
        '--repetitions',
        '2',
        '--out',
        '/private/report.json',
      ]),
    ).toThrowError('options_invalid');
    expect(() =>
      parsePrivateLiveReplayOptions([
        '--manifest',
        '/private/manifest.json',
        '--mode',
        'realtime',
        '--out',
        '/private/report.json',
      ]),
    ).toThrowError('options_invalid');
  });

  it('refuses to overwrite any protected private input with the report', () => {
    const fixture = createFixture();
    expect(() =>
      assertReportTargetSafe(
        fixture.manifest.meetings[0].sources.micPath,
        fixture.manifest.meetings[0].proxyTranscriptPath,
        fixture.manifest,
      ),
    ).toThrowError('report_unavailable');
  });
});

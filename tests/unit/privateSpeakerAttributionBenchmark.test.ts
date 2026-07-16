import { describe, expect, it } from 'vitest';

import {
  buildPrivateSpeakerAttributionManifestSummary,
  loadPrivateSpeakerAttributionManifest,
} from '../../src/services/privateSpeakerAttributionBenchmark';

describe('loadPrivateSpeakerAttributionManifest', () => {
  it('loads a valid private speaker-attribution manifest', () => {
    const manifest = loadPrivateSpeakerAttributionManifest({
      schemaVersion: 1,
      cases: [
        {
          id: 'case-alpha',
          title: 'Customer call pass-through bleed',
          audio: {
            mixedAudioPath: '/private/tmp/mixed.wav',
            micAudioPath: '/private/tmp/mic.wav',
            systemAudioPath: '/private/tmp/system.wav',
          },
          transcript: {
            groundTruthTranscriptPath: '/private/tmp/ground-truth.json',
            speakers: ['Me', 'Them'],
          },
        },
      ],
    });

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.cases).toHaveLength(1);
    expect(manifest.cases[0]).toMatchObject({
      id: 'case-alpha',
      title: 'Customer call pass-through bleed',
      audio: {
        mixedAudioPath: '/private/tmp/mixed.wav',
        micAudioPath: '/private/tmp/mic.wav',
        systemAudioPath: '/private/tmp/system.wav',
      },
      transcript: {
        groundTruthTranscriptPath: '/private/tmp/ground-truth.json',
        speakers: ['Me', 'Them'],
      },
    });
  });

  it('rejects duplicate ids and relative paths', () => {
    expect(() =>
      loadPrivateSpeakerAttributionManifest({
        schemaVersion: 1,
        cases: [
          {
            id: 'duplicate',
            title: 'First',
            audio: {
              mixedAudioPath: './mixed.wav',
              micAudioPath: '/private/tmp/mic.wav',
              systemAudioPath: '/private/tmp/system.wav',
            },
            transcript: {
              groundTruthTranscriptPath: '/private/tmp/ground-truth.json',
              speakers: ['Me', 'Them'],
            },
          },
          {
            id: 'duplicate',
            title: 'Second',
            audio: {
              mixedAudioPath: '/private/tmp/mixed-2.wav',
              micAudioPath: '/private/tmp/mic-2.wav',
              systemAudioPath: '/private/tmp/system-2.wav',
            },
            transcript: {
              groundTruthTranscriptPath: '/private/tmp/ground-truth-2.json',
              speakers: ['Me', 'Them'],
            },
          },
        ],
      }),
    ).toThrow(/absolute local path|duplicate private benchmark case id/i);
  });

  it('rejects unsupported speaker labels', () => {
    expect(() =>
      loadPrivateSpeakerAttributionManifest({
        schemaVersion: 1,
        cases: [
          {
            id: 'bad-speakers',
            title: 'Unsupported labels',
            audio: {
              mixedAudioPath: '/private/tmp/mixed.wav',
              micAudioPath: '/private/tmp/mic.wav',
              systemAudioPath: '/private/tmp/system.wav',
            },
            transcript: {
              groundTruthTranscriptPath: '/private/tmp/ground-truth.json',
              speakers: ['Me', 'Guest'],
            },
          },
        ],
      }),
    ).toThrow(/speaker labels/i);
  });
});

describe('buildPrivateSpeakerAttributionManifestSummary', () => {
  it('redacts raw ids, paths, and transcript hints from the summary', () => {
    const manifest = loadPrivateSpeakerAttributionManifest({
      schemaVersion: 1,
      cases: [
        {
          id: 'founder-sync',
          title: 'Founder sync on pricing',
          audio: {
            mixedAudioPath: '/Users/example/meetings/founder-sync/mixed.wav',
            micAudioPath: '/Users/example/meetings/founder-sync/mic.wav',
            systemAudioPath: '/Users/example/meetings/founder-sync/system.wav',
          },
          transcript: {
            groundTruthTranscriptPath:
              '/Users/example/meetings/founder-sync/ground-truth.json',
            speakers: ['Me', 'Them'],
          },
        },
      ],
    });

    const summary = buildPrivateSpeakerAttributionManifestSummary(manifest);

    expect(summary).toMatchObject({
      schemaVersion: 1,
      totalCases: 1,
      speakerSet: ['Me', 'Them'],
      cases: [
        {
          caseId: expect.stringMatching(/^private-case-[a-f0-9]{12}$/),
          speakerSet: ['Me', 'Them'],
          hasMixedAudio: true,
          hasMicAudio: true,
          hasSystemAudio: true,
        },
      ],
    });

    const rendered = JSON.stringify(summary);
    expect(rendered).not.toContain('founder-sync');
    expect(rendered).not.toContain('/Users/example/meetings');
    expect(rendered).not.toContain('pricing');
    expect(rendered).not.toContain('ground-truth.json');
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadPrivateTranscriptionBenchmarkManifest,
  summarizePrivateTranscriptionManifest,
} from '../../src/services/privateTranscriptionBenchmark.ts';

describe('private transcription benchmark manifest', () => {
  it('accepts file-only cases and reports content-free counts', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pluto-private-asr-'));
    const audioPath = path.join(root, 'audio.wav');
    const referencePath = path.join(root, 'reference.json');
    writeFileSync(audioPath, 'synthetic-audio');
    writeFileSync(referencePath, '[]');
    const manifest = loadPrivateTranscriptionBenchmarkManifest({
      schemaVersion: 1,
      cases: [
        {
          id: 'recent-01',
          language: 'en',
          audio: { micAudioPath: audioPath },
          referenceTranscriptPath: referencePath,
        },
      ],
    });

    expect(summarizePrivateTranscriptionManifest(manifest)).toEqual({
      schemaVersion: 1,
      caseCount: 1,
      audioSourceCount: 1,
      referenceCount: 1,
    });
  });

  it('rejects inline transcript content', () => {
    expect(() =>
      loadPrivateTranscriptionBenchmarkManifest({
        schemaVersion: 1,
        cases: [{ id: 'unsafe', text: 'private content' }],
      }),
    ).toThrow(/file references only/);
  });
});

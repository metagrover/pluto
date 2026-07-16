import { describe, expect, it } from 'vitest';
import {
  loadLocalAttributionCandidateOutput,
  loadLocalAttributionManifest,
  loadSpeakerReference,
} from '../../src/services/localSpeakerAttributionBenchmark';

const privateRoot = '/private/pluto-speaker-corpus';

describe('loadLocalAttributionManifest', () => {
  it('loads synthetic and consented-private cases plus versioned candidates', () => {
    const manifest = loadLocalAttributionManifest(
      {
        schemaVersion: 1,
        cases: [
          {
            id: 'synthetic-one-local-turn',
            recordingId: 'synthetic-recording-001',
            provenance: { tier: 'synthetic', source: 'generated-fixture' },
            audio: {
              mixedPath: 'tests/fixtures/speaker-attribution/mixed.wav',
              systemReferencePath:
                'tests/fixtures/speaker-attribution/system.wav',
            },
            referencePath: 'tests/fixtures/speaker-attribution/reference.json',
          },
          {
            id: 'private-restart-case',
            recordingId: 'private-recording-001',
            provenance: {
              tier: 'consented-private',
              source: 'local-consented-corpus',
            },
            audio: { mixedPath: `${privateRoot}/audio/mixed.wav` },
            referencePath: `${privateRoot}/references/case.json`,
          },
        ],
        candidates: [
          {
            id: 'pyannote-community-1',
            kind: 'diarizer',
            version: '1.0.0',
            command: [
              '/opt/local-python/bin/python',
              'python/speaker_attribution_benchmark_adapter.py',
            ],
            model: {
              id: 'pyannote/speaker-diarization-community-1',
              version: '2026.07',
            },
            config: { exclusive: true },
          },
        ],
      },
      { privateCorpusRoot: privateRoot },
    );

    expect(manifest.cases[1].provenance.tier).toBe('consented-private');
    expect(manifest.candidates[0].model.version).toBe('2026.07');
  });

  it('rejects duplicate stable ids and malformed required fields', () => {
    expect(() =>
      loadLocalAttributionManifest({
        schemaVersion: 1,
        cases: [
          {
            id: 'duplicate',
            recordingId: 'recording-one',
            provenance: { tier: 'synthetic', source: 'fixture' },
            audio: { mixedPath: 'fixtures/one.wav' },
            referencePath: 'fixtures/one.json',
          },
          {
            id: 'duplicate',
            recordingId: 'recording-two',
            provenance: { tier: 'synthetic', source: 'fixture' },
            audio: { mixedPath: 'fixtures/two.wav' },
            referencePath: 'fixtures/two.json',
          },
        ],
        candidates: [],
      }),
    ).toThrow(/duplicate case id/i);

    expect(() =>
      loadLocalAttributionManifest({
        schemaVersion: 2,
        cases: [],
        candidates: [],
      }),
    ).toThrow(/schemaVersion/i);
  });

  it('rejects traversal and private paths outside the supplied corpus root without echoing paths', () => {
    const traversal = '../secret/mixed.wav';
    expect(() =>
      loadLocalAttributionManifest({
        schemaVersion: 1,
        cases: [
          {
            id: 'bad-public',
            recordingId: 'recording-bad',
            provenance: { tier: 'synthetic', source: 'fixture' },
            audio: { mixedPath: traversal },
            referencePath: 'fixtures/reference.json',
          },
        ],
        candidates: [],
      }),
    ).toThrow(/mixedPath.*traversal/i);

    const outside = '/private/other-corpus/audio.wav';
    let message = '';
    try {
      loadLocalAttributionManifest(
        {
          schemaVersion: 1,
          cases: [
            {
              id: 'bad-private',
              recordingId: 'recording-private',
              provenance: { tier: 'consented-private', source: 'consented' },
              audio: { mixedPath: outside },
              referencePath: `${privateRoot}/reference.json`,
            },
          ],
          candidates: [],
        },
        { privateCorpusRoot: privateRoot },
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/mixedPath.*private corpus root/i);
    expect(message).not.toContain(outside);
  });
});

describe('loadSpeakerReference', () => {
  it('accepts ordered Me/Them reference turns and timestamped transcript words', () => {
    const reference = loadSpeakerReference({
      schemaVersion: 1,
      transcript: {
        words: [
          { startTime: 0, endTime: 0.4, text: 'Synthetic', confidence: 0.9 },
          { startTime: 0.5, endTime: 1, text: 'statement' },
        ],
      },
      turns: [
        {
          startTime: 0,
          endTime: 1,
          speaker: 'Them',
          text: 'Synthetic statement',
        },
        {
          startTime: 1.2,
          endTime: 2,
          speaker: 'Me',
          text: 'Synthetic response',
        },
      ],
    });
    expect(reference.turns.map((turn) => turn.speaker)).toEqual(['Them', 'Me']);
  });

  it('rejects unsupported speakers and unordered or non-positive intervals', () => {
    expect(() =>
      loadSpeakerReference({
        schemaVersion: 1,
        transcript: { words: [] },
        turns: [
          { startTime: 0, endTime: 1, speaker: 'Alex', text: 'Synthetic' },
        ],
      }),
    ).toThrow(/turns\[0\]\.speaker/i);
    expect(() =>
      loadSpeakerReference({
        schemaVersion: 1,
        transcript: { words: [] },
        turns: [
          { startTime: 2, endTime: 3, speaker: 'Them', text: 'Later' },
          { startTime: 1, endTime: 1, speaker: 'Me', text: 'Invalid' },
        ],
      }),
    ).toThrow(/turns\[1\].*duration|ordered/i);
  });
});

describe('loadLocalAttributionCandidateOutput', () => {
  it('normalizes timestamped transcript and diarization output with runtime provenance', () => {
    const output = loadLocalAttributionCandidateOutput({
      schemaVersion: 1,
      caseId: 'synthetic-case',
      candidateId: 'local-pipeline',
      transcript: {
        words: [
          { startTime: 0, endTime: 0.5, text: 'Synthetic', confidence: 0.98 },
        ],
        segments: [{ startTime: 0, endTime: 0.5, text: 'Synthetic' }],
      },
      diarization: {
        turns: [
          {
            startTime: 0,
            endTime: 0.5,
            cluster: 'speaker-0',
            overlap: false,
            confidence: 0.8,
          },
        ],
      },
      runtime: {
        pipelineVersion: '1',
        models: [{ id: 'local-model', version: '2026.07' }],
        elapsedMs: 1200,
        hardware: 'local-test',
      },
    });
    expect(output.runtime.models[0]).toEqual({
      id: 'local-model',
      version: '2026.07',
    });
  });

  it('rejects missing model provenance and invalid confidence', () => {
    expect(() =>
      loadLocalAttributionCandidateOutput({
        schemaVersion: 1,
        caseId: 'case',
        candidateId: 'candidate',
        transcript: {
          words: [
            { startTime: 0, endTime: 1, text: 'Synthetic', confidence: 2 },
          ],
          segments: [],
        },
        diarization: { turns: [] },
        runtime: { pipelineVersion: '1', models: [], elapsedMs: 1 },
      }),
    ).toThrow(/confidence|models/i);
  });
});

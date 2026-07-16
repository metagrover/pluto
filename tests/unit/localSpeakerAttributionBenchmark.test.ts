import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeLocalAttributionMetrics,
  loadLocalAttributionCandidateOutput,
  loadLocalAttributionManifest,
  loadSpeakerReference,
  runLocalAttributionCandidate,
  sanitizeCandidateResult,
} from '../../src/services/localSpeakerAttributionBenchmark';

describe('computeLocalAttributionMetrics', () => {
  it('audits transcript, speaker-attributed word, and duration classification errors', () => {
    const metrics = computeLocalAttributionMetrics({
      reference: [
        { startTime: 0, endTime: 8, speaker: 'Them', text: 'alpha beta' },
        { startTime: 8, endTime: 10, speaker: 'Me', text: 'gamma delta' },
      ],
      generated: [
        { startTime: 0, endTime: 3, speaker: 'Me', text: 'alpha' },
        { startTime: 3, endTime: 9, speaker: 'Them', text: 'beta' },
        { startTime: 9, endTime: 10, speaker: 'Me', text: 'gamma delta' },
      ],
      audioDurationSeconds: 10,
      elapsedMs: 5000,
    });

    expect(metrics).toMatchObject({
      transcript: { referenceWords: 4, errors: 0, wordErrorRate: 0 },
      speakerAttributedWords: {
        referenceWords: 4,
        substitutions: 0,
        deletions: 1,
        insertions: 1,
        errors: 2,
        wordErrorRate: 0.5,
      },
      diarization: {
        referenceSpeakerSeconds: 10,
        missedSpeechSeconds: 0,
        falseAlarmSeconds: 0,
        speakerConfusionSeconds: 4,
        errorRate: 0.4,
      },
      me: {
        truePositiveSeconds: 1,
        predictedSeconds: 4,
        referenceSeconds: 2,
        precision: 0.25,
        recall: 0.5,
        f1: 1 / 3,
      },
      them: {
        truePositiveSeconds: 5,
        predictedSeconds: 6,
        referenceSeconds: 8,
        precision: 5 / 6,
        recall: 0.625,
        f1: 5 / 7,
      },
      generatedSpeakerCount: 2,
      speakerCountCorrect: true,
      speakerCount: 2,
      falseMeSeconds: 3,
      missedMeSeconds: 1,
      wordErrorRate: 0,
      diarizationErrorRate: 0.4,
      runtimeFactor: 0.5,
    });
  });

  it('does not treat a fixed-label swap as correct just because the counts match', () => {
    const metrics = computeLocalAttributionMetrics({
      reference: [{ startTime: 0, endTime: 1, speaker: 'Me', text: 'local' }],
      generated: [{ startTime: 0, endTime: 1, speaker: 'Them', text: 'local' }],
    });

    expect(metrics.generatedSpeakerCount).toBe(1);
    expect(metrics.speakerCount).toBe(1);
    expect(metrics.speakerCountCorrect).toBe(false);
    expect(metrics.falseMeSeconds).toBe(0);
    expect(metrics.missedMeSeconds).toBe(1);
  });

  it('uses active-speaker sets on overlap and exposes missed, false-alarm, and confusion components', () => {
    const metrics = computeLocalAttributionMetrics({
      reference: [
        { startTime: 0, endTime: 2, speaker: 'Them', text: 'remote' },
        { startTime: 1, endTime: 3, speaker: 'Me', text: 'local' },
      ],
      generated: [
        { startTime: 0, endTime: 1, speaker: 'Me', text: 'remote' },
        { startTime: 1, endTime: 2, speaker: 'Me', text: 'local' },
        { startTime: 2, endTime: 4, speaker: 'Them', text: 'extra' },
      ],
    });

    expect(metrics.diarization).toEqual({
      referenceSpeakerSeconds: 4,
      missedSpeechSeconds: 1,
      falseAlarmSeconds: 1,
      speakerConfusionSeconds: 2,
      errorRate: 1,
    });
  });

  it('returns finite deterministic scores for empty inputs and validates runtime timing', () => {
    const empty = computeLocalAttributionMetrics({
      reference: [],
      generated: [],
    });
    expect(empty.transcript).toEqual({
      referenceWords: 0,
      hypothesisWords: 0,
      substitutions: 0,
      deletions: 0,
      insertions: 0,
      errors: 0,
      wordErrorRate: 0,
    });
    expect(empty.diarization.errorRate).toBe(0);
    expect(empty.me).toMatchObject({ precision: 1, recall: 1, f1: 1 });
    expect(empty.speakerCountCorrect).toBe(true);
    expect(empty.runtimeFactor).toBeUndefined();
    expect(JSON.stringify(empty)).not.toMatch(/NaN|Infinity/);

    expect(() =>
      computeLocalAttributionMetrics({
        reference: [],
        generated: [],
        elapsedMs: 10,
      }),
    ).toThrow(/audioDurationSeconds/i);
    expect(() =>
      computeLocalAttributionMetrics({
        reference: [],
        generated: [],
        audioDurationSeconds: 0,
        elapsedMs: 10,
      }),
    ).toThrow(/positive/i);
    expect(() =>
      computeLocalAttributionMetrics({
        reference: [],
        generated: [],
        audioDurationSeconds: 1,
        elapsedMs: -1,
      }),
    ).toThrow(/non-negative/i);
    expect(() =>
      computeLocalAttributionMetrics({
        reference: [
          { startTime: 0, endTime: 2, speaker: 'Them', text: 'remote' },
        ],
        generated: [],
        audioDurationSeconds: 1,
      }),
    ).toThrow(/cannot end before/i);
  });

  it('reports overlap, speaker boundary, and local-turn recall deterministically', () => {
    const input = {
      reference: [
        { startTime: 0, endTime: 4, speaker: 'Them' as const, text: 'remote' },
        { startTime: 3, endTime: 5, speaker: 'Me' as const, text: 'local' },
      ],
      generated: [
        { startTime: 0, endTime: 4, speaker: 'Them' as const, text: 'remote' },
        { startTime: 4, endTime: 5, speaker: 'Me' as const, text: 'local' },
      ],
    };

    const first = computeLocalAttributionMetrics(input);
    const second = computeLocalAttributionMetrics(input);
    expect(second).toEqual(first);
    expect(first.boundaryErrorSeconds).toBe(1.25);
    expect(first.overlapAccuracy).toBe(0);
    expect(first.shortLocalTurnRecall).toBe(0);
  });

  it('uses union duration for local-turn recall when generated Me intervals overlap', () => {
    const metrics = computeLocalAttributionMetrics({
      reference: [{ startTime: 0, endTime: 10, speaker: 'Me', text: 'local' }],
      generated: [
        { startTime: 0, endTime: 4, speaker: 'Me', text: 'duplicate one' },
        { startTime: 2, endTime: 6, speaker: 'Me', text: 'duplicate two' },
      ],
    });

    expect(metrics.shortLocalTurnRecall).toBe(0);
    expect(metrics.me.predictedSeconds).toBe(6);
    expect(metrics.missedMeSeconds).toBe(4);
  });

  it('scores active-set boundaries for silence gaps, overlap ends, and separated same-speaker turns', () => {
    const separated = [
      { startTime: 0, endTime: 1, speaker: 'Me' as const, text: 'one' },
      { startTime: 2, endTime: 3, speaker: 'Me' as const, text: 'two' },
    ];
    expect(
      computeLocalAttributionMetrics({
        reference: separated,
        generated: separated,
      }).boundaryErrorSeconds,
    ).toBe(0);
    expect(
      computeLocalAttributionMetrics({
        reference: separated,
        generated: [
          { startTime: 0, endTime: 3, speaker: 'Me', text: 'continuous' },
        ],
      }).boundaryErrorSeconds,
    ).toBe(1.5);

    const overlap = [
      { startTime: 0, endTime: 3, speaker: 'Them' as const, text: 'remote' },
      { startTime: 1, endTime: 2, speaker: 'Me' as const, text: 'local' },
    ];
    expect(
      computeLocalAttributionMetrics({ reference: overlap, generated: overlap })
        .boundaryErrorSeconds,
    ).toBe(0);
  });

  it('penalizes missing and extra boundaries and matches nearby boundaries one-to-one', () => {
    const oneTurn = [
      { startTime: 0, endTime: 2, speaker: 'Me' as const, text: 'local' },
    ];
    expect(
      computeLocalAttributionMetrics({ reference: oneTurn, generated: [] })
        .boundaryErrorSeconds,
    ).toBe(2);
    expect(
      computeLocalAttributionMetrics({ reference: [], generated: oneTurn })
        .boundaryErrorSeconds,
    ).toBe(2);

    const metrics = computeLocalAttributionMetrics({
      reference: [
        { startTime: 0, endTime: 1, speaker: 'Me', text: 'one' },
        { startTime: 1, endTime: 2, speaker: 'Them', text: 'two' },
        { startTime: 2, endTime: 3, speaker: 'Me', text: 'three' },
      ],
      generated: [
        { startTime: 0, endTime: 1.1, speaker: 'Me', text: 'one' },
        { startTime: 1.1, endTime: 3, speaker: 'Them', text: 'rest' },
      ],
    });
    expect(metrics.boundaryErrorSeconds).toBeCloseTo(0.775, 10);
  });
});

const temporaryDirectories: string[] = [];

const makePrivateCorpus = () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'pluto-attribution-test-'));
  temporaryDirectories.push(parent);
  const root = path.join(parent, 'corpus');
  mkdirSync(path.join(root, 'audio'), { recursive: true });
  mkdirSync(path.join(root, 'references'), { recursive: true });
  writeFileSync(path.join(root, 'audio', 'mixed.wav'), 'synthetic audio');
  writeFileSync(path.join(root, 'references', 'case.json'), '{}');
  return { parent, root };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('loadLocalAttributionManifest', () => {
  it('loads synthetic and consented-private cases plus versioned candidates', () => {
    const { root } = makePrivateCorpus();
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
            audio: { mixedPath: path.join(root, 'audio', 'mixed.wav') },
            referencePath: path.join(root, 'references', 'case.json'),
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
      { privateCorpusRoot: root },
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

    const { parent, root } = makePrivateCorpus();
    const outside = path.join(parent, 'outside.wav');
    writeFileSync(outside, 'synthetic outside audio');
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
              referencePath: path.join(root, 'references', 'case.json'),
            },
          ],
          candidates: [],
        },
        { privateCorpusRoot: root },
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/mixedPath.*private corpus root/i);
    expect(message).not.toContain(outside);
  });

  it('rejects an in-root symlink whose canonical target escapes the private corpus', () => {
    const { parent, root } = makePrivateCorpus();
    const outside = path.join(parent, 'outside.wav');
    const linkedInput = path.join(root, 'audio', 'linked.wav');
    writeFileSync(outside, 'synthetic outside audio');
    symlinkSync(outside, linkedInput);

    let message = '';
    try {
      loadLocalAttributionManifest(
        {
          schemaVersion: 1,
          cases: [
            {
              id: 'symlink-escape',
              recordingId: 'synthetic-private-recording',
              provenance: { tier: 'consented-private', source: 'consented' },
              audio: { mixedPath: linkedInput },
              referencePath: path.join(root, 'references', 'case.json'),
            },
          ],
          candidates: [],
        },
        { privateCorpusRoot: root },
      );
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/mixedPath.*private corpus root/i);
    expect(message).not.toContain(outside);
    expect(message).not.toContain(linkedInput);
  });

  it('rejects nonexistent private roots and inputs without echoing their paths', () => {
    const { parent, root } = makePrivateCorpus();
    const missingRoot = path.join(parent, 'missing-root');
    const missingInput = path.join(root, 'audio', 'missing.wav');
    const manifestWith = (mixedPath: string) => ({
      schemaVersion: 1,
      cases: [
        {
          id: 'missing-private-input',
          recordingId: 'synthetic-private-recording',
          provenance: { tier: 'consented-private', source: 'consented' },
          audio: { mixedPath },
          referencePath: path.join(root, 'references', 'case.json'),
        },
      ],
      candidates: [],
    });

    expect(() =>
      loadLocalAttributionManifest(manifestWith(missingInput), {
        privateCorpusRoot: missingRoot,
      }),
    ).toThrow(/private corpus root.*exist/i);
    try {
      loadLocalAttributionManifest(manifestWith(missingInput), {
        privateCorpusRoot: root,
      });
      throw new Error('expected missing private input to be rejected');
    } catch (error) {
      expect((error as Error).message).toMatch(/mixedPath.*exist/i);
      expect((error as Error).message).not.toContain(missingInput);
    }
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

describe('runLocalAttributionCandidate', () => {
  const benchmarkCase = (id: string, mixedPath = `fixtures/${id}.wav`) => ({
    id,
    recordingId: `recording-${id}`,
    provenance: { tier: 'synthetic' as const, source: 'fixture' },
    audio: { mixedPath },
    referencePath: `fixtures/${id}.json`,
  });
  const candidate = (source: string) => ({
    id: 'fixture-candidate',
    kind: 'pipeline' as const,
    version: '1',
    command: [process.execPath, '-e', source],
    model: { id: 'fixture-model', version: '1' },
    config: {},
  });
  const validOutput = (caseId: string) => ({
    schemaVersion: 1,
    caseId,
    candidateId: 'fixture-candidate',
    transcript: { words: [], segments: [] },
    diarization: { turns: [] },
    runtime: {
      pipelineVersion: '1',
      models: [{ id: 'fixture-model', version: '1' }],
      elapsedMs: 1,
    },
  });
  const lineReader =
    "const r=require('readline').createInterface({input:process.stdin});";

  it('exchanges one request and successful response per case over JSONL', async () => {
    const script = `${lineReader}r.on('line',line=>{const q=JSON.parse(line);const output=${JSON.stringify(validOutput('placeholder'))};output.caseId=q.case.id;process.stdout.write(JSON.stringify({schemaVersion:1,id:q.id,output})+'\\n')})`;
    const result = await runLocalAttributionCandidate(
      candidate(script),
      [benchmarkCase('one'), benchmarkCase('two')],
      { timeoutMs: 2_000 },
    );

    expect(result.results.map((entry) => entry.status)).toEqual([
      'success',
      'success',
    ]);
    expect(result.results.map((entry) => entry.caseId)).toEqual(['one', 'two']);
  });

  it('kills a hung candidate within the configured timeout', async () => {
    const started = Date.now();
    const result = await runLocalAttributionCandidate(
      candidate('process.stdin.resume();setInterval(()=>{},1000)'),
      [benchmarkCase('hung')],
      { timeoutMs: 80 },
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.results[0]).toMatchObject({
      caseId: 'hung',
      status: 'failure',
      error: { code: 'candidate_timeout' },
    });
  });

  it('escalates from SIGTERM when a timed-out candidate refuses to exit', async () => {
    const started = Date.now();
    const result = await runLocalAttributionCandidate(
      candidate(
        "process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000)",
      ),
      [benchmarkCase('ignores-term')],
      { timeoutMs: 50 },
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.results[0]).toMatchObject({
      error: { code: 'candidate_timeout' },
    });
  });

  it('keeps timeout authoritative when a SIGTERM handler emits a valid response', async () => {
    const output = JSON.stringify(validOutput('late'));
    const script = `${lineReader}let q;r.on('line',line=>{q=JSON.parse(line)});process.on('SIGTERM',()=>{process.stdout.write(JSON.stringify({schemaVersion:1,id:q.id,output:${output}})+'\\n');process.exit(0)});setInterval(()=>{},1000)`;
    const result = await runLocalAttributionCandidate(
      candidate(script),
      [benchmarkCase('late')],
      { timeoutMs: 60 },
    );
    expect(result.results[0]).toMatchObject({
      status: 'failure',
      error: { code: 'candidate_timeout' },
    });
  });

  it.each([
    [
      'malformed output',
      "process.stdout.write('not-json\\n')",
      'candidate_invalid_json',
    ],
    [
      'mismatched response id',
      `${lineReader}r.on('line',()=>process.stdout.write(JSON.stringify({schemaVersion:1,id:'wrong',error:{code:'candidate_model_missing',message:'no'}})+'\\n'))`,
      'candidate_contract_mismatch',
    ],
  ])('contains %s as structured failures', async (_name, script, code) => {
    const result = await runLocalAttributionCandidate(
      candidate(script),
      [benchmarkCase('case-one')],
      { timeoutMs: 500 },
    );
    expect(result.results[0]).toMatchObject({
      status: 'failure',
      error: { code },
    });
  });

  it('rejects duplicate and missing responses', async () => {
    const duplicateScript = `${lineReader}r.on('line',line=>{const q=JSON.parse(line);const output=${JSON.stringify(validOutput('duplicate'))};const response=JSON.stringify({schemaVersion:1,id:q.id,output})+'\\n';process.stdout.write(response+response)})`;
    const duplicate = await runLocalAttributionCandidate(
      candidate(duplicateScript),
      [benchmarkCase('duplicate')],
      { timeoutMs: 500 },
    );
    expect(duplicate.results[0]).toMatchObject({
      status: 'failure',
      error: { code: 'candidate_contract_mismatch' },
    });

    const missing = await runLocalAttributionCandidate(
      candidate('process.stdin.resume()'),
      [benchmarkCase('missing')],
      { timeoutMs: 500 },
    );
    expect(missing.results[0]).toMatchObject({
      status: 'failure',
      error: { code: 'candidate_contract_mismatch' },
    });
  });

  it('redacts private paths, stderr, and candidate payloads from surfaced errors', async () => {
    const secretRoot = path.join(tmpdir(), 'private-corpus-secret');
    const secretTranscript = 'confidential transcript sentence';
    const script = `${lineReader}r.on('line',line=>{const q=JSON.parse(line);process.stderr.write(q.case.audio.mixedPath+' ${secretTranscript}');process.stdout.write(JSON.stringify({schemaVersion:1,id:q.id,error:{code:'candidate_model_missing',message:q.case.audio.mixedPath+' ${secretTranscript}'}})+'\\n')})`;
    const result = await runLocalAttributionCandidate(
      candidate(script),
      [benchmarkCase('private', path.join(secretRoot, 'meeting.wav'))],
      { timeoutMs: 500 },
    );
    const surfaced = JSON.stringify(result);
    expect(surfaced).not.toContain(secretRoot);
    expect(surfaced).not.toContain('meeting.wav');
    expect(surfaced).not.toContain(secretTranscript);
    expect(surfaced).toContain('[redacted]');
  });

  it('continues after a candidate reports a per-case error', async () => {
    const script = `${lineReader}r.on('line',line=>{const q=JSON.parse(line);if(q.case.id==='bad'){process.stdout.write(JSON.stringify({schemaVersion:1,id:q.id,error:{code:'candidate_unsupported_hardware',message:'safe failure'}})+'\\n');return}const output=${JSON.stringify(validOutput('good'))};process.stdout.write(JSON.stringify({schemaVersion:1,id:q.id,output})+'\\n')})`;
    const result = await runLocalAttributionCandidate(
      candidate(script),
      [benchmarkCase('bad'), benchmarkCase('good')],
      { timeoutMs: 1_000 },
    );
    expect(result.results).toMatchObject([
      {
        caseId: 'bad',
        status: 'failure',
        error: { code: 'candidate_unsupported_hardware' },
      },
      { caseId: 'good', status: 'success' },
    ]);
  });

  it('normalizes unknown candidate failure codes to a contract mismatch', async () => {
    const script = `${lineReader}r.on('line',line=>{const q=JSON.parse(line);process.stdout.write(JSON.stringify({schemaVersion:1,id:q.id,error:{code:'leaky-private-code',message:'secret'}})+'\\n')})`;
    const result = await runLocalAttributionCandidate(
      candidate(script),
      [benchmarkCase('unknown-code')],
      { timeoutMs: 500 },
    );
    expect(result.results[0]).toMatchObject({
      error: { code: 'candidate_contract_mismatch' },
    });
  });

  it('caps cumulative stdout even when every individual JSONL line is below the limit', async () => {
    const script =
      "for(let i=0;i<12;i+=1)process.stdout.write(' '.repeat(900*1024)+'\\n')";
    const result = await runLocalAttributionCandidate(
      candidate(script),
      [benchmarkCase('cumulative-output')],
      { timeoutMs: 2_000 },
    );
    expect(result.results[0]).toMatchObject({
      error: { code: 'candidate_output_too_large' },
    });
  });

  it('rejects a bad envelope version and nonzero exit even after valid output', async () => {
    const badVersion = `${lineReader}r.on('line',line=>{const q=JSON.parse(line);process.stdout.write(JSON.stringify({schemaVersion:2,id:q.id,output:{}})+'\\n')})`;
    const versionResult = await runLocalAttributionCandidate(
      candidate(badVersion),
      [benchmarkCase('version')],
      { timeoutMs: 500 },
    );
    expect(versionResult.results[0]).toMatchObject({
      error: { code: 'candidate_contract_mismatch' },
    });

    const exitsNonzero = `${lineReader}r.on('line',line=>{const q=JSON.parse(line);const output=${JSON.stringify(validOutput('exit'))};process.stdout.write(JSON.stringify({schemaVersion:1,id:q.id,output})+'\\n');process.exitCode=7})`;
    const exitResult = await runLocalAttributionCandidate(
      candidate(exitsNonzero),
      [benchmarkCase('exit')],
      { timeoutMs: 500 },
    );
    expect(exitResult.results[0]).toMatchObject({
      error: { code: 'candidate_exit_nonzero' },
    });
  });

  it('rejects a valid response followed by unterminated garbage', async () => {
    const script = `${lineReader}r.on('line',line=>{const q=JSON.parse(line);const output=${JSON.stringify(validOutput('garbage'))};process.stdout.write(JSON.stringify({schemaVersion:1,id:q.id,output})+'\\n');process.stdout.write('private trailing garbage')})`;
    const result = await runLocalAttributionCandidate(
      candidate(script),
      [benchmarkCase('garbage')],
      { timeoutMs: 500 },
    );
    expect(result.results[0]).toMatchObject({
      status: 'failure',
      error: { code: 'candidate_invalid_json' },
    });
  });

  it('kills a candidate process group whose grandchild inherits stdout', async () => {
    if (process.platform === 'win32') return;
    const script = `require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});process.stdin.resume();setInterval(()=>{},1000)`;
    const started = Date.now();
    const result = await runLocalAttributionCandidate(
      candidate(script),
      [benchmarkCase('process-tree')],
      { timeoutMs: 60 },
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.results[0]).toMatchObject({
      error: { code: 'candidate_timeout' },
    });
  });

  it('streams a high-volume multi-case request set with backpressure', async () => {
    const script = `${lineReader}r.on('line',line=>{const q=JSON.parse(line);const output=${JSON.stringify(validOutput('placeholder'))};output.caseId=q.case.id;process.stdout.write(JSON.stringify({schemaVersion:1,id:q.id,output})+'\\n')})`;
    const cases = Array.from({ length: 1_500 }, (_, index) =>
      benchmarkCase(`bulk-${index}`),
    );
    const result = await runLocalAttributionCandidate(
      candidate(script),
      cases,
      {
        timeoutMs: 5_000,
      },
    );
    expect(result.results).toHaveLength(cases.length);
    expect(result.results.every((entry) => entry.status === 'success')).toBe(
      true,
    );
  });
});

describe('sanitizeCandidateResult', () => {
  it.each(['ok', 'failed'] as const)(
    'constructs an allowlisted %s public result',
    (status) => {
      const serialized = JSON.stringify(
        sanitizeCandidateResult({
          caseHash: 'abc123',
          candidateId: 'candidate',
          status,
          failureCode:
            status === 'failed' ? 'candidate_exit_nonzero' : undefined,
          elapsedMs: 10,
          peakMemoryMb: 20,
          privatePath: '/private/meeting.wav',
          stderr: 'private transcript words',
          transcript: { words: ['secret'] },
          arbitrary: { secret: true },
          metrics: { wordErrorRate: 0.1, privatePath: '/private/metric' },
          provenance: {
            pipelineVersion: 'pipeline-1',
            models: [{ id: 'model', version: '1', privatePath: '/private' }],
            stderr: 'secret',
          },
        }),
      );
      expect(serialized).toContain('abc123');
      expect(serialized).toContain('wordErrorRate');
      expect(serialized).toContain('pipeline-1');
      expect(serialized).not.toMatch(
        /private|transcript|stderr|arbitrary|secret/,
      );
    },
  );
});

import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLocalAttributionCandidate } from '../../src/services/localSpeakerAttributionBenchmark';

const adapter = path.resolve(
  process.cwd(),
  'python/speaker_attribution_benchmark_adapter.py',
);

const runAdapter = async (requests: unknown[]) => {
  const child = spawn('python3', [adapter], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  for (const request of requests)
    child.stdin.write(`${JSON.stringify(request)}\n`);
  child.stdin.end();
  const exitCode = await new Promise<number | null>((resolve) =>
    child.on('close', resolve),
  );
  return {
    exitCode,
    stderr,
    stdout,
    responses: stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
};

const request = (
  id: string,
  action: string,
  candidateId: string,
  config: Record<string, unknown> = {},
) => ({
  id,
  requestId: id,
  schemaVersion: 1,
  action,
  candidate: {
    id: candidateId,
    kind: action === 'diarize' ? 'diarizer' : 'pipeline',
    version: '1',
    model: { id: candidateId, version: 'test' },
    config,
  },
  case: {
    id: `case-${id}`,
    audio: { mixedPath: 'tests/fixtures/synthetic.wav' },
  },
});

describe('speaker attribution benchmark adapter', () => {
  it('returns normalized deterministic output in dependency-free synthetic mode', async () => {
    const result = await runAdapter([
      request('one', 'diarize', 'synthetic', {
        turns: [
          { startTime: 0, endTime: 1.5, cluster: 'speaker-0' },
          { startTime: 1.5, endTime: 2, cluster: 'speaker-1', overlap: true },
        ],
      }),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0]).toMatchObject({
      id: 'one',
      requestId: 'one',
      schemaVersion: 1,
      output: {
        schemaVersion: 1,
        caseId: 'case-one',
        candidateId: 'synthetic',
        transcript: { words: [], segments: [] },
        diarization: {
          turns: [
            { startTime: 0, endTime: 1.5, cluster: 'speaker-0' },
            {
              startTime: 1.5,
              endTime: 2,
              cluster: 'speaker-1',
              overlap: true,
            },
          ],
        },
        runtime: {
          pipelineVersion: 'speaker-attribution-adapter-v1',
          models: [{ id: 'synthetic', version: '1' }],
        },
      },
    });
    expect(result.responses[0].output.runtime.elapsedMs).toBeGreaterThanOrEqual(
      0,
    );
    expect(result.responses[0].output.runtime.hardware).toEqual(
      expect.any(String),
    );
  });

  it('keeps stdout pure JSONL and continues after request-level errors', async () => {
    const result = await runAdapter([
      { ...request('bad', 'probe', 'synthetic'), schemaVersion: 99 },
      request('unknown', 'probe', 'not-a-candidate'),
      request('good', 'probe', 'synthetic'),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split('\n')).toHaveLength(3);
    expect(result.responses[0]).toMatchObject({
      id: 'bad',
      error: { code: 'candidate_contract_mismatch' },
    });
    expect(result.responses[1]).toMatchObject({
      id: 'unknown',
      error: { code: 'candidate_unknown' },
    });
    expect(result.responses[2]).toMatchObject({ id: 'good', output: {} });
    expect(result.stdout).not.toMatch(/Traceback|INFO|WARNING/);
  });

  it('preserves candidate_unknown through the TypeScript runner', async () => {
    const result = await runLocalAttributionCandidate(
      {
        id: 'unknown-local-engine',
        kind: 'asr',
        version: '1',
        command: ['python3', adapter],
        model: { id: 'unknown-local-engine', version: '1' },
        config: {},
      },
      [
        {
          id: 'unknown-case',
          recordingId: 'synthetic-recording',
          provenance: { tier: 'synthetic', source: 'generated-fixture' },
          audio: { mixedPath: 'unused.wav' },
          referencePath: 'unused.json',
        },
      ],
      { timeoutMs: 2_000 },
    );

    expect(result.results[0]).toMatchObject({
      status: 'failure',
      error: { code: 'candidate_unknown', message: '[redacted]' },
    });
  });

  it('runs the synthetic adapter end to end through the TypeScript candidate runner', async () => {
    const result = await runLocalAttributionCandidate(
      {
        id: 'synthetic',
        kind: 'asr',
        version: '1',
        command: ['python3', adapter],
        model: { id: 'synthetic', version: '1' },
        config: {
          turns: [{ startTime: 0, endTime: 1, cluster: 'speaker-0' }],
        },
      },
      [
        {
          id: 'runner-case',
          recordingId: 'synthetic-recording',
          provenance: { tier: 'synthetic', source: 'generated-fixture' },
          audio: { mixedPath: 'not-read-by-synthetic-mode.wav' },
          referencePath: 'not-read-by-synthetic-mode.json',
        },
      ],
      { timeoutMs: 2_000 },
    );

    expect(result.results[0]).toMatchObject({
      caseId: 'runner-case',
      status: 'success',
      output: {
        candidateId: 'synthetic',
        diarization: {
          turns: [{ startTime: 0, endTime: 1, cluster: 'speaker-0' }],
        },
      },
    });
  });

  it.each(['pyannote-community-1', 'nemo-local'])(
    'preserves an adapter model failure through the runner for %s',
    async (candidateId) => {
      const result = await runLocalAttributionCandidate(
        {
          id: candidateId,
          kind: 'diarizer',
          version: '1',
          command: ['python3', adapter],
          model: { id: candidateId, version: 'test' },
          config: {},
        },
        [
          {
            id: `${candidateId}-case`,
            recordingId: 'synthetic-recording',
            provenance: { tier: 'synthetic', source: 'generated-fixture' },
            audio: { mixedPath: 'unavailable-local-audio.wav' },
            referencePath: 'not-read-on-model-failure.json',
          },
        ],
        { timeoutMs: 2_000 },
      );

      expect(result.results[0]).toMatchObject({
        status: 'failure',
        error: { code: 'candidate_model_missing', message: '[redacted]' },
      });
    },
  );

  it('probes the current WhisperX installation deterministically', async () => {
    const result = await runAdapter([
      request('whisperx-one', 'probe', 'current-whisperx'),
      request('whisperx-two', 'probe', 'current-whisperx'),
    ]);

    expect(result.responses).toHaveLength(2);
    if (result.responses[0].error) {
      expect(result.responses.map((response) => response.error.code)).toEqual([
        'candidate_model_missing',
        'candidate_model_missing',
      ]);
    } else {
      expect(result.responses[1].output.runtime.models).toEqual(
        result.responses[0].output.runtime.models,
      );
      expect(result.responses[0].output.runtime.models[0]).toMatchObject({
        id: 'whisperx',
        version: expect.any(String),
      });
    }
  });

  it('reports unavailable optional models without leaking paths or tracebacks', async () => {
    const missingPath = '/private/secret/model/does-not-exist';
    const result = await runAdapter([
      request('pyannote', 'probe', 'pyannote-community-1', {
        modelPath: missingPath,
      }),
      request('nemo', 'probe', 'nemo-local', { modelPath: missingPath }),
    ]);

    expect(result.responses).toHaveLength(2);
    for (const response of result.responses) {
      expect(response.error.code).toBe('candidate_model_missing');
      expect(JSON.stringify(response)).not.toContain(missingPath);
      expect(JSON.stringify(response)).not.toContain('Traceback');
    }
    expect(result.stdout).not.toContain(missingPath);
  });
});

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLocalAttributionCandidate } from '../../src/services/localSpeakerAttributionBenchmark';

const adapter = path.resolve(
  process.cwd(),
  'python/speaker_attribution_benchmark_adapter.py',
);

const runAdapter = async (
  requests: unknown[],
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const child = spawn('python3', [adapter], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: environment,
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

  it('fails sherpa-onnx closed until both model licenses are reviewed', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pluto-sherpa-license-'));
    try {
      const segmentation = path.join(root, 'segmentation.onnx');
      const embedding = path.join(root, 'embedding.onnx');
      writeFileSync(segmentation, 'segmentation');
      writeFileSync(embedding, 'embedding');
      const checksum = (filePath: string) =>
        createHash('sha256').update(readFileSync(filePath)).digest('hex');
      const result = await runAdapter([
        request('sherpa-license', 'probe', 'sherpa-onnx', {
          segmentationModelPath: segmentation,
          segmentationSha256: checksum(segmentation),
          embeddingModelPath: embedding,
          embeddingSha256: checksum(embedding),
          distribution: {
            userCredentialsRequired: false,
            redistributionReviewed: false,
            licenseIds: ['MIT'],
          },
        }),
      ]);

      expect(result.responses[0]).toMatchObject({
        error: { code: 'candidate_distribution_ineligible' },
      });
      expect(result.stdout).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('probes and diarizes checksum-pinned sherpa-onnx artifacts', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pluto-fake-sherpa-'));
    try {
      const segmentation = path.join(root, 'segmentation.onnx');
      const embedding = path.join(root, 'embedding.onnx');
      const audio = path.join(root, 'requested.wav');
      writeFileSync(segmentation, 'segmentation');
      writeFileSync(embedding, 'embedding');
      writeFileSync(audio, 'synthetic');
      writeFileSync(
        path.join(root, 'sherpa_onnx.py'),
        'class C:\n def __init__(self,**kwargs): self.__dict__.update(kwargs)\nOfflineSpeakerSegmentationPyannoteModelConfig=C\nOfflineSpeakerSegmentationModelConfig=C\nSpeakerEmbeddingExtractorConfig=C\nFastClusteringConfig=C\nclass OfflineSpeakerDiarizationConfig(C):\n def validate(self): return True\nclass S:\n start=0.25;end=1.5;speaker=3\nclass R:\n def sort_by_start_time(self): return [S()]\nclass OfflineSpeakerDiarization:\n def __init__(self,config): self.config=config\n def process(self,samples): return R()\n',
      );
      const metadata = path.join(root, 'sherpa_onnx-9.9.dist-info');
      mkdirSync(metadata);
      writeFileSync(
        path.join(metadata, 'METADATA'),
        'Metadata-Version: 2.1\nName: sherpa-onnx\nVersion: 9.9\n',
      );
      writeFileSync(
        path.join(root, 'wave.py'),
        "class W:\n def __enter__(self): return self\n def __exit__(self,*args): pass\n def getnchannels(self): return 1\n def getsampwidth(self): return 2\n def getframerate(self): return 16000\n def getnframes(self): return 2\n def readframes(self,n): return b'\\x00\\x00\\x00\\x00'\ndef open(*args,**kwargs): return W()\n",
      );
      const checksum = (filePath: string) =>
        createHash('sha256').update(readFileSync(filePath)).digest('hex');
      const config = {
        segmentationModelPath: segmentation,
        segmentationSha256: checksum(segmentation),
        embeddingModelPath: embedding,
        embeddingSha256: checksum(embedding),
        distribution: {
          userCredentialsRequired: false,
          redistributionReviewed: true,
          licenseIds: ['MIT', 'Apache-2.0'],
        },
      };
      const probe = request('sherpa-probe', 'probe', 'sherpa-onnx', config);
      const diarize = request('sherpa-run', 'diarize', 'sherpa-onnx', config);
      diarize.case.audio.mixedPath = audio;

      const result = await runAdapter([probe, diarize], {
        ...process.env,
        PYTHONPATH: root,
      });

      expect(result.responses[0].output.runtime.models).toEqual([
        { id: 'sherpa-onnx', version: '9.9' },
        { id: 'pyannote-segmentation-onnx', version: checksum(segmentation) },
        { id: 'speaker-embedding-onnx', version: checksum(embedding) },
      ]);
      expect(result.responses[1].output.diarization.turns).toEqual([
        { startTime: 0.25, endTime: 1.5, cluster: 'speaker_3' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([true, false])(
    'binds NeMo to request audio and %s fresh output instead of caller RTTM',
    async (writeFreshOutput) => {
      const root = mkdtempSync(path.join(tmpdir(), 'pluto-fake-nemo-'));
      try {
        const packageDir = path.join(root, 'nemo/collections/asr');
        mkdirSync(packageDir, { recursive: true });
        for (const init of [
          'nemo/__init__.py',
          'nemo/collections/__init__.py',
          'nemo/collections/asr/__init__.py',
        ])
          writeFileSync(path.join(root, init), '');
        writeFileSync(
          path.join(packageDir, 'models.py'),
          "import json,os\nclass ClusteringDiarizer:\n def __init__(self,cfg): self.cfg=cfg\n def diarize(self):\n  manifest=json.loads(open(self.cfg['diarizer']['manifest_filepath']).readline())\n  if not manifest['audio_filepath'].endswith('requested.wav'): raise RuntimeError('wrong private audio')\n  if self.cfg.get('write_output'):\n   out=os.path.join(self.cfg['diarizer']['out_dir'],'pred_rttms');os.makedirs(out)\n   open(os.path.join(out,'fresh.rttm'),'w').write('SPEAKER file 1 0.0 1.0 <NA> <NA> speaker_0 <NA> <NA>\\n')\n",
        );
        const metadata = path.join(root, 'nemo_toolkit-9.9.dist-info');
        mkdirSync(metadata);
        writeFileSync(
          path.join(metadata, 'METADATA'),
          'Metadata-Version: 2.1\nName: nemo_toolkit\nVersion: 9.9\n',
        );
        const audio = path.join(root, 'requested.wav');
        const model = path.join(root, 'model.json');
        const stale = path.join(root, 'stale.rttm');
        writeFileSync(audio, 'synthetic');
        writeFileSync(
          model,
          JSON.stringify({ diarizer: {}, write_output: writeFreshOutput }),
        );
        writeFileSync(
          stale,
          'SPEAKER stale 1 0.0 9.0 <NA> <NA> stale <NA> <NA>\n',
        );
        const nemo = request('nemo-run', 'diarize', 'nemo-local', {
          modelPath: model,
          rttmPath: stale,
        });
        nemo.case.audio.mixedPath = audio;

        const result = await runAdapter([nemo], {
          ...process.env,
          PYTHONPATH: root,
        });

        if (writeFreshOutput) {
          expect(result.responses[0].output.diarization.turns).toEqual([
            { startTime: 0, endTime: 1, cluster: 'speaker_0' },
          ]);
        } else {
          expect(result.responses[0]).toMatchObject({
            error: { code: 'candidate_contract_mismatch' },
          });
          expect(JSON.stringify(result.responses[0])).not.toContain('stale');
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

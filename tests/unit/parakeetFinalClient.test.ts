import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { NativeChildProcess } from '../../electron/transcription/nativeJsonLineProcess';
import {
  ParakeetFinalClient,
  type ParakeetRuntimePaths,
  parseSpeakerEvidenceResult,
} from '../../electron/transcription/parakeetFinalClient';
import { makeRuntimeHost } from '../../electron/transcription/parakeetRuntimeHost';

class FakeChild extends EventEmitter implements NativeChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly writes: Array<Record<string, unknown>> = [];
  readonly stdin = {
    write: vi.fn((value: string) => {
      this.writes.push(JSON.parse(value.trim()));
      return true;
    }),
    end: vi.fn(),
  };
  readonly kill = vi.fn(() => true);

  respond(response: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

const paths: ParakeetRuntimePaths = {
  executablePath: '/app/bin/parakeet-runtime',
  modelRoot: '/user/models/parakeet',
  audioRoot: '/user/recordings',
};

const success = (id: string, text = 'hello') => ({
  schemaVersion: 1,
  id,
  ok: true,
  result: {
    transcription: {
      text,
      confidence: 0.95,
      durationSeconds: 1,
      words: [{ text, startSeconds: 0, endSeconds: 1 }],
      noSpeech: false,
    },
    vocabularyCount: 0,
  },
});

const prepared = (id: string) => ({
  schemaVersion: 1,
  id,
  ok: true,
  result: { modelVersion: 'test-model-v1' },
});

const speakerEvidenceSuccess = (id: string) => ({
  schemaVersion: 1,
  id,
  ok: true,
  result: {
    speakerEvidence: {
      turns: [{ startTime: 0, endTime: 1, cluster: 'S1' }],
      energyWindows: [
        { startTime: 0, endTime: 0.1, micRms: 0.2, systemRms: 0.01 },
      ],
      provenance: {
        modelIdentifier: 'speaker-diarization-offline-v1',
        modelRevision: 'a'.repeat(40),
        artifactDigest: 'b'.repeat(64),
        runtimeVersion: 'fluidaudio-test',
      },
      timings: { diarizationMs: 10, energyAnalysisMs: 2, totalMs: 12 },
      windowSeconds: 0.1,
    },
  },
});

describe('ParakeetFinalClient', () => {
  it('bounds speaker cancellation and grants a fresh live worker after a stuck inference', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const nextChild = new FakeChild();
    const spawn = vi.fn().mockReturnValueOnce(child).mockReturnValue(nextChild);
    const runtimeHost = makeRuntimeHost({ paths, spawn });
    const client = new ParakeetFinalClient({ paths, runtimeHost });
    const evidence = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    const failed = expect(evidence).rejects.toThrow(
      'parakeet_process_terminated',
    );
    await vi.advanceTimersByTimeAsync(0);
    const live = runtimeHost.startRecordingLive();
    await vi.advanceTimersByTimeAsync(1_000);
    await failed;
    const lease = await live;
    expect(child.kill).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(runtimeHost.diagnostics().state).toBe('live');
    await lease.release();
    runtimeHost.shutdown();
    vi.useRealTimers();
  });
  it('forwards only progress correlated to its active prepare request', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });
    const progress = vi.fn();
    const ready = client.prepare(progress);
    const requestId = String(child.writes[0].id);

    child.respond({
      schemaVersion: 1,
      kind: 'event',
      event: 'prepare_progress',
      requestId: 'prepare-stale',
      phase: 'downloading',
      downloadedBytes: 1,
      totalBytes: 10,
    });
    child.respond({
      schemaVersion: 1,
      kind: 'event',
      event: 'prepare_progress',
      requestId,
      phase: 'downloading',
      downloadedBytes: 4,
      totalBytes: 10,
    });
    child.respond(prepared(requestId));

    await ready;
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({
      phase: 'downloading',
      downloadedBytes: 4,
      totalBytes: 10,
    });
  });

  it('starts one shared child and correlates preparation', async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const client = new ParakeetFinalClient({ paths, spawn });
    expect(client.getPreparedCapability()).toBeNull();

    const first = client.prepare();
    const second = client.prepare();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(child.writes).toHaveLength(1);
    expect(child.writes[0]).toMatchObject({
      method: 'prepare',
      modelRoot: paths.modelRoot,
    });
    child.respond(prepared(String(child.writes[0].id)));

    await expect(first).resolves.toMatchObject({
      ready: true,
      engine: 'parakeet_coreml',
      liveEngine: 'parakeet_eou_320ms',
      modelVersion: 'test-model-v1',
      modelBundleVersion: 'test-model-v1',
    });
    await expect(second).resolves.toEqual(await first);
    expect(client.getPreparedCapability()).toMatchObject({
      ready: true,
      liveEngine: 'parakeet_eou_320ms',
      modelVersion: 'test-model-v1',
    });
  });

  it('prepares the native worker while a live lease is held', async () => {
    const child = new FakeChild();
    const host = makeRuntimeHost({ paths, spawn: () => child });
    const client = new ParakeetFinalClient({ paths, runtimeHost: host });
    const lease = await host.startRecordingLive();

    const ready = client.prepareForLive(lease);
    expect(child.writes).toHaveLength(1);
    expect(child.writes[0]).toMatchObject({
      method: 'prepare',
      modelRoot: paths.modelRoot,
    });
    child.respond(prepared(String(child.writes[0].id)));

    await expect(ready).resolves.toMatchObject({ ready: true });
    expect(host.diagnostics().state).toBe('live');
    await lease.release();
    host.shutdown();
  });

  it('reprepares a new runtime after idle unload before final transcription', async () => {
    vi.useFakeTimers();
    const firstChild = new FakeChild();
    const restartedChild = new FakeChild();
    const host = makeRuntimeHost({
      paths,
      spawn: vi
        .fn()
        .mockReturnValueOnce(firstChild)
        .mockReturnValueOnce(restartedChild),
      idleTimeoutMs: 1,
    });
    const client = new ParakeetFinalClient({ paths, runtimeHost: host });

    const ready = client.prepare();
    firstChild.respond(prepared(String(firstChild.writes[0].id)));
    await ready;
    await vi.advanceTimersByTimeAsync(1);
    expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(client.getPreparedCapability()).toBeNull();

    const transcription = client.transcribe({
      meetingId: 'after-idle-unload',
      role: 'final_validation',
      source: 'system',
      audioPath: '/user/recordings/after-idle-unload.wav',
      language: 'en',
    });
    await vi.waitFor(() => expect(restartedChild.writes).toHaveLength(1));
    expect(restartedChild.writes[0]).toMatchObject({ method: 'prepare' });
    restartedChild.respond(prepared(String(restartedChild.writes[0].id)));

    await vi.waitFor(() => expect(restartedChild.writes).toHaveLength(2));
    expect(restartedChild.writes[1]).toMatchObject({ method: 'transcribe' });
    restartedChild.respond(success(String(restartedChild.writes[1].id)));
    await expect(transcription).resolves.toMatchObject({
      segments: [{ text: 'hello' }],
    });
    vi.useRealTimers();
  });

  it('submits final transcription requests sequentially', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });
    const ready = client.prepare();
    child.respond(prepared(String(child.writes[0].id)));
    await ready;

    const first = client.transcribe({
      meetingId: 'one',
      role: 'final_validation',
      source: 'mic',
      audioPath: '/user/recordings/one.wav',
      language: 'en',
    });
    const second = client.transcribe({
      meetingId: 'two',
      role: 'final_validation',
      source: 'system',
      audioPath: '/user/recordings/two.wav',
      language: 'en',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(2));
    const firstID = String(child.writes[1].id);
    expect(child.writes[1]).toMatchObject({
      method: 'transcribe',
      audioPath: '/user/recordings/one.wav',
    });
    child.respond(success(firstID, 'first'));
    await expect(first).resolves.toMatchObject({
      segments: [{ text: 'first' }],
    });

    await vi.waitFor(() => expect(child.writes).toHaveLength(3));
    expect(child.writes[2]).toMatchObject({
      audioPath: '/user/recordings/two.wav',
    });
    child.respond(success(String(child.writes[2].id), 'second'));
    await expect(second).resolves.toMatchObject({
      segments: [{ text: 'second' }],
    });
  });

  it('rejects paths outside the approved audio root before writing', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });

    await expect(
      client.transcribe({
        meetingId: 'private',
        role: 'final_validation',
        source: 'mic',
        audioPath: '/private/meeting.wav',
        language: 'en',
      }),
    ).rejects.toThrow('parakeet_path_not_allowed');
    expect(child.writes).toHaveLength(0);
  });

  it('requests and strictly validates sealed speaker evidence under the final lease', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });

    const request = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    expect(child.writes[0]).toMatchObject({
      method: 'speaker_evidence',
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    child.respond(speakerEvidenceSuccess(String(child.writes[0].id)));

    await expect(request).resolves.toMatchObject({
      turns: [{ cluster: 'S1' }],
      energyWindows: [{ micRms: 0.2, systemRms: 0.01 }],
      provenance: { modelIdentifier: 'speaker-diarization-offline-v1' },
    });
  });

  it('accepts empty system diarization so finalization can fall back safely', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });
    const request = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    const response = speakerEvidenceSuccess(String(child.writes[0].id));
    response.result.speakerEvidence.turns = [];
    child.respond(response);

    await expect(request).resolves.toMatchObject({ turns: [] });
  });

  it('accepts speaker evidence without microphone diarization', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });
    const request = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    const response = speakerEvidenceSuccess(String(child.writes[0].id));
    child.respond(response);

    await expect(request).resolves.toMatchObject({
      turns: [{ cluster: 'S1' }],
    });
  });

  it('accepts full meeting speaker evidence with > 1024 energy windows and > 256 turns', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });
    const request = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    const response = speakerEvidenceSuccess(String(child.writes[0].id));
    response.result.speakerEvidence.turns = Array.from(
      { length: 300 },
      (_, i) => ({
        startTime: i,
        endTime: i + 0.8,
        cluster: `S${(i % 3) + 1}`,
      }),
    );
    response.result.speakerEvidence.energyWindows = Array.from(
      { length: 3_000 },
      (_, i) => ({
        startTime: i * 0.1,
        endTime: (i + 1) * 0.1,
        micRms: 0.1,
        systemRms: 0.05,
      }),
    );
    child.respond(response);

    const result = await request;
    expect(result.turns).toHaveLength(300);
    expect(result.energyWindows).toHaveLength(3_000);
  });

  it('validates speaker evidence of any meeting length without arbitrary caps', () => {
    const valid = {
      turns: Array.from({ length: 500 }, (_, i) => ({
        startTime: i,
        endTime: i + 0.8,
        cluster: `S${(i % 5) + 1}`,
      })),
      energyWindows: Array.from({ length: 20_000 }, (_, i) => ({
        startTime: i * 0.1,
        endTime: (i + 1) * 0.1,
        micRms: 0.1,
        systemRms: 0.1,
      })),
      provenance: {
        modelIdentifier: 'speaker-diarization-offline-v1',
        modelRevision: 'a'.repeat(40),
        artifactDigest: 'b'.repeat(64),
        runtimeVersion: 'test',
      },
      timings: { diarizationMs: 100, energyAnalysisMs: 50, totalMs: 150 },
      windowSeconds: 0.1,
    };
    const parsed = parseSpeakerEvidenceResult(valid);
    expect(parsed.turns).toHaveLength(500);
    expect(parsed.energyWindows).toHaveLength(20_000);
  });

  it('deserializes clusterEvidence and profileAlgorithmVersion when present', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });
    const request = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    const response = speakerEvidenceSuccess(String(child.writes[0].id));
    (response.result.speakerEvidence as any).clusterEvidence = [
      {
        cluster: 'S1',
        embedding: new Array(256).fill(0.1),
        cleanChunkCount: 3,
        cleanSegmentCount: 2,
        cleanDurationSeconds: 4.5,
        minimumChunkSimilarity: 0.82,
        meanChunkSimilarity: 0.88,
      },
    ];
    (
      response.result.speakerEvidence.provenance as any
    ).profileAlgorithmVersion = 'v1';
    child.respond(response);

    const result = await request;
    expect(result.clusterEvidence).toHaveLength(1);
    expect(result.clusterEvidence?.[0].cluster).toBe('S1');
    expect(result.clusterEvidence?.[0].embedding).toHaveLength(256);
    expect(result.clusterEvidence?.[0].cleanChunkCount).toBe(3);
    expect(result.clusterEvidence?.[0].cleanSegmentCount).toBe(2);
    expect(result.clusterEvidence?.[0].cleanDurationSeconds).toBeCloseTo(4.5);
    expect(result.clusterEvidence?.[0].minimumChunkSimilarity).toBeCloseTo(
      0.82,
    );
    expect(result.clusterEvidence?.[0].meanChunkSimilarity).toBeCloseTo(0.88);
    expect(result.provenance.profileAlgorithmVersion).toBe('v1');
  });

  it('rejects speaker evidence with invalid clusterEvidence bounds or malformed vectors', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });

    // Test 1: > 64 clusters
    const req1 = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    const resp1 = speakerEvidenceSuccess(String(child.writes[0].id));
    (resp1.result.speakerEvidence as any).clusterEvidence = Array.from(
      { length: 65 },
      (_, i) => ({
        cluster: `S${i + 1}`,
        embedding: new Array(256).fill(0.1),
        cleanChunkCount: 1,
        cleanSegmentCount: 1,
        cleanDurationSeconds: 1.0,
        minimumChunkSimilarity: 1.0,
        meanChunkSimilarity: 1.0,
      }),
    );
    child.respond(resp1);
    await expect(req1).rejects.toThrow('parakeet_protocol_invalid');

    // Test 2: wrong embedding dimension
    const req2 = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(2));
    const resp2 = speakerEvidenceSuccess(String(child.writes[1].id));
    (resp2.result.speakerEvidence as any).clusterEvidence = [
      {
        cluster: 'S1',
        embedding: new Array(128).fill(0.1),
        cleanChunkCount: 1,
        cleanSegmentCount: 1,
        cleanDurationSeconds: 1.0,
        minimumChunkSimilarity: 1.0,
        meanChunkSimilarity: 1.0,
      },
    ];
    child.respond(resp2);
    await expect(req2).rejects.toThrow('parakeet_protocol_invalid');

    // Test 3: non-finite embedding values
    const req3 = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(3));
    const resp3 = speakerEvidenceSuccess(String(child.writes[2].id));
    const badEmbedding = new Array(256).fill(0.1);
    badEmbedding[5] = Number.NaN;
    (resp3.result.speakerEvidence as any).clusterEvidence = [
      {
        cluster: 'S1',
        embedding: badEmbedding,
        cleanChunkCount: 1,
        cleanSegmentCount: 1,
        cleanDurationSeconds: 1.0,
        minimumChunkSimilarity: 1.0,
        meanChunkSimilarity: 1.0,
      },
    ];
    child.respond(resp3);
    await expect(req3).rejects.toThrow('parakeet_protocol_invalid');
  });

  it('rejects malformed speaker evidence and out-of-root evidence paths', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });

    await expect(
      client.speakerEvidence({
        mixedAudioPath: '/private/mixed.wav',
        micAudioPath: '/user/recordings/mic.wav',
        systemAudioPath: '/user/recordings/system.wav',
      }),
    ).rejects.toThrow('parakeet_path_not_allowed');
    expect(child.writes).toHaveLength(0);

    const request = client.speakerEvidence({
      mixedAudioPath: '/user/recordings/mixed.wav',
      micAudioPath: '/user/recordings/mic.wav',
      systemAudioPath: '/user/recordings/system.wav',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    child.respond({
      ...speakerEvidenceSuccess(String(child.writes[0].id)),
      result: { speakerEvidence: { turns: [], energyWindows: [] } },
    });
    await expect(request).rejects.toThrow('parakeet_protocol_invalid');
  });

  it('rejects pending requests on malformed stdout without exposing the line', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });
    const request = client.prepare();

    child.stdout.write('/private/meeting.wav malformed\n');

    await expect(request).rejects.toThrow('parakeet_protocol_invalid');
    expect(child.kill).toHaveBeenCalled();
  });

  it('rejects pending requests with a stable error when the child exits', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });
    const request = client.prepare();

    child.emit('exit', 9, null);

    await expect(request).rejects.toThrow('parakeet_process_exited');
  });

  it('times out and terminates a wedged child', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const client = new ParakeetFinalClient({
      paths,
      spawn: () => child,
      requestTimeoutMs: 50,
    });
    const request = client.prepare();
    const expectation = expect(request).rejects.toThrow(
      'parakeet_request_timeout',
    );

    await vi.advanceTimersByTimeAsync(51);

    await expectation;
    expect(child.kill).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('sends cancellation for an aborted active transcription', async () => {
    const child = new FakeChild();
    const client = new ParakeetFinalClient({ paths, spawn: () => child });
    const ready = client.prepare();
    child.respond(prepared(String(child.writes[0].id)));
    await ready;
    const controller = new AbortController();
    const request = client.transcribe({
      meetingId: 'one',
      role: 'final_validation',
      source: 'mic',
      audioPath: '/user/recordings/one.wav',
      language: 'en',
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(2));
    const targetID = child.writes[1].id;

    controller.abort();

    expect(child.writes[2]).toMatchObject({
      method: 'cancel',
      targetId: targetID,
    });
    let settled = false;
    void request.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    child.respond({
      schemaVersion: 1,
      id: targetID,
      ok: false,
      error: { code: 'parakeet_cancelled' },
    });
    await expect(request).rejects.toThrow('parakeet_cancelled');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('does not hand the runtime to live work until the cancelled transcription settles', async () => {
    const child = new FakeChild();
    const host = makeRuntimeHost({ paths, spawn: () => child });
    const client = new ParakeetFinalClient({ paths, runtimeHost: host });
    const ready = client.prepare();
    child.respond(prepared(String(child.writes[0].id)));
    await ready;

    const transcription = client.transcribe({
      meetingId: 'one',
      role: 'final_validation',
      source: 'mic',
      audioPath: '/user/recordings/one.wav',
      language: 'en',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(2));
    const transcribeID = String(child.writes[1].id);

    let liveResolved = false;
    const live = host.startRecordingLive().then((lease) => {
      liveResolved = true;
      return lease;
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(3));
    child.respond({
      schemaVersion: 1,
      id: child.writes[2].id,
      ok: false,
      error: { code: 'parakeet_cancelled' },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(liveResolved).toBe(false);

    child.respond({
      schemaVersion: 1,
      id: transcribeID,
      ok: false,
      error: { code: 'parakeet_cancelled' },
    });
    await expect(transcription).rejects.toThrow('parakeet_cancelled');
    await expect(live).resolves.toMatchObject({ kind: 'live' });
  });

  it('preempts a final request held in the client queue before live ownership', async () => {
    const child = new FakeChild();
    const persistInterruptedFinalization = vi.fn(async () => undefined);
    const host = makeRuntimeHost({
      paths,
      spawn: () => child,
      persistInterruptedFinalization,
    });
    const client = new ParakeetFinalClient({ paths, runtimeHost: host });
    const first = client.transcribe({
      meetingId: 'one',
      role: 'final_validation',
      source: 'mic',
      audioPath: '/user/recordings/one.wav',
      language: 'en',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    child.respond(prepared(String(child.writes[0].id)));
    await vi.waitFor(() => expect(child.writes).toHaveLength(2));
    const firstID = String(child.writes[1].id);

    const second = client.transcribe({
      meetingId: 'two',
      role: 'final_validation',
      source: 'system',
      audioPath: '/user/recordings/two.wav',
      language: 'en',
    });
    const live = host.startRecordingLive();

    await expect(second).rejects.toThrow('parakeet_cancelled');
    await vi.waitFor(() => expect(child.writes).toHaveLength(3));
    child.respond({
      schemaVersion: 1,
      id: child.writes[2].id,
      ok: false,
      error: { code: 'parakeet_cancelled' },
    });
    child.respond({
      schemaVersion: 1,
      id: firstID,
      ok: false,
      error: { code: 'parakeet_cancelled' },
    });

    await expect(first).rejects.toThrow('parakeet_cancelled');
    const liveLease = await live;
    expect(persistInterruptedFinalization).toHaveBeenCalledTimes(2);
    expect(child.writes).toHaveLength(3);
    await liveLease.release();
  });

  it('cancels and settles preparation before handing the runtime to live work', async () => {
    const child = new FakeChild();
    const persistInterruptedFinalization = vi.fn(async () => undefined);
    const host = makeRuntimeHost({
      paths,
      spawn: () => child,
      persistInterruptedFinalization,
    });
    const client = new ParakeetFinalClient({ paths, runtimeHost: host });
    const transcription = client.transcribe({
      meetingId: 'one',
      role: 'final_validation',
      source: 'mic',
      audioPath: '/user/recordings/one.wav',
      language: 'en',
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    const prepareID = String(child.writes[0].id);

    let liveResolved = false;
    const live = host.startRecordingLive().then((lease) => {
      liveResolved = true;
      return lease;
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(2));
    child.respond({
      schemaVersion: 1,
      id: child.writes[1].id,
      ok: false,
      error: { code: 'parakeet_cancelled' },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(liveResolved).toBe(false);

    child.respond({
      schemaVersion: 1,
      id: prepareID,
      ok: false,
      error: { code: 'parakeet_cancelled' },
    });
    await expect(transcription).rejects.toThrow('parakeet_cancelled');
    await expect(live).resolves.toMatchObject({ kind: 'live' });
    expect(persistInterruptedFinalization).toHaveBeenCalledTimes(1);
    expect(child.writes).toHaveLength(2);
  });

  it('preempts a direct prepare before granting live ownership', async () => {
    const child = new FakeChild();
    const persisted = vi.fn(async () => undefined);
    const host = makeRuntimeHost({
      paths,
      spawn: () => child,
      persistInterruptedFinalization: persisted,
    });
    const client = new ParakeetFinalClient({ paths, runtimeHost: host });
    const preparing = client.prepare();
    await vi.waitFor(() => expect(child.writes).toHaveLength(1));
    const prepareID = String(child.writes[0].id);
    let liveResolved = false;
    const live = host.startRecordingLive().then((lease) => {
      liveResolved = true;
      return lease;
    });
    await vi.waitFor(() => expect(child.writes).toHaveLength(2));
    child.respond({
      schemaVersion: 1,
      id: child.writes[1].id,
      ok: false,
      error: { code: 'parakeet_cancelled' },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(liveResolved).toBe(false);
    child.respond({
      schemaVersion: 1,
      id: prepareID,
      ok: false,
      error: { code: 'parakeet_cancelled' },
    });
    await expect(preparing).rejects.toThrow('parakeet_cancelled');
    await expect(live).resolves.toMatchObject({ kind: 'live' });
    expect(persisted).toHaveBeenCalledTimes(1);
  });

  it('drops native stderr content', async () => {
    const child = new FakeChild();
    const diagnostic = vi.fn();
    const client = new ParakeetFinalClient({
      paths,
      spawn: () => child,
      diagnostic,
    });
    const ready = client.prepare();
    child.stderr.write('/private/meeting.wav secret transcript');
    child.respond(prepared(String(child.writes[0].id)));
    await ready;

    expect(diagnostic).toHaveBeenCalledWith('parakeet_stderr_activity');
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
      'secret transcript',
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('meeting.wav');
  });

  it('unloads the native model process after the idle deadline', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const client = new ParakeetFinalClient({
      paths,
      spawn: () => child,
      idleTimeoutMs: 100,
    });
    const ready = client.prepare();
    child.respond(prepared(String(child.writes[0].id)));
    await ready;
    const request = client.transcribe({
      meetingId: 'one',
      role: 'final_validation',
      source: 'mic',
      audioPath: '/user/recordings/one.wav',
      language: 'en',
    });
    await vi.advanceTimersByTimeAsync(0);
    child.respond(success(String(child.writes[1].id)));
    await request;

    await vi.advanceTimersByTimeAsync(99);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });
});

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { NativeChildProcess } from '../../electron/transcription/nativeJsonLineProcess';
import {
  ParakeetFinalClient,
  type ParakeetRuntimePaths,
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

describe('ParakeetFinalClient', () => {
  it('starts one shared child and correlates preparation', async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const client = new ParakeetFinalClient({ paths, spawn });

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
      modelBundleVersion: 'test-model-v1',
    });
    await expect(second).resolves.toEqual(await first);
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
      ok: true,
      result: {},
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

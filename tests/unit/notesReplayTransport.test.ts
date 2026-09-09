import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotesReplayTransport } from '../../scripts/lib/notesReplayTransport';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
function setup(
  response: () => Promise<Response>,
  isolated = false,
  loadMode?: 'mmap' | 'none',
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-wire-test-'));
  roots.push(root);
  const events: Array<Record<string, unknown>> = [];
  const request = vi.fn<typeof fetch>(response);
  return {
    root,
    events,
    request,
    wire: createNotesReplayTransport({
      isolated,
      loadMode,
      root,
      model: 'gemma4:12b',
      contextTokens: 16384,
      fetch: request as typeof fetch,
      record: (event) => events.push(event),
      currentCase: () => 3,
    }),
  };
}
const init = {
  method: 'POST',
  body: JSON.stringify({
    model: 'gemma4:12b',
    messages: [],
    stream: true,
    options: { num_ctx: 16384 },
  }),
};
describe('private notes replay transport', () => {
  it('captures an explicit non-mapped diagnostic profile without altering the shared runtime', async () => {
    for (const isolated of [true, false]) {
      const state = setup(
        async () => new Response('{"model":"gemma4:12b","done":true}\n'),
        isolated,
        'none',
      );
      await (
        await state.wire.fetch('http://127.0.0.1:11434/api/chat', init)
      ).text();
      const captured = JSON.parse(
        fs.readFileSync(
          path.join(state.root, 'case-3-attempt-1-request.json'),
          'utf8',
        ),
      );
      expect(captured.options.use_mmap).toBe(isolated ? false : undefined);
    }
  });
  it('refuses a second generation until the first stream has terminated', async () => {
    const state = setup(
      async () => new Response('{"model":"gemma4:12b","done":true}\n'),
    );
    const first = await state.wire.fetch(
      'http://127.0.0.1:11434/api/chat',
      init,
    );
    await expect(
      state.wire.fetch('http://127.0.0.1:11434/api/chat', init),
    ).rejects.toThrow('replay_concurrent_generation_forbidden');
    expect(state.request).toHaveBeenCalledTimes(1);
    await first.text();
    await (
      await state.wire.fetch('http://127.0.0.1:11434/api/chat', init)
    ).text();
    expect(state.request).toHaveBeenCalledTimes(2);
  });
  it('routes control and generation only to the fixed diagnostic loopback daemon', async () => {
    const state = setup(
      async () => new Response('{"model":"gemma4:12b","done":true}\n'),
      true,
    );
    await state.wire.fetch('http://127.0.0.1:11434/api/ps');
    const response = await state.wire.fetch(
      'http://127.0.0.1:11434/api/chat',
      init,
    );
    await response.text();
    expect(state.request.mock.calls.map((call) => call[0])).toEqual([
      'http://127.0.0.1:11435/api/ps',
      'http://127.0.0.1:11435/api/chat',
    ]);
    await expect(
      state.wire.fetch('https://example.com/api/chat', init),
    ).rejects.toThrow('replay_local_only');
    expect(state.request).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(state.root, 'case-3-attempt-1-request.json'),
          'utf8',
        ),
      ).options.use_mmap,
    ).toBe(true);
  });
  it('preserves partial output and a failure terminal when the owned signal aborts', async () => {
    const abort = new AbortController();
    const state = setup(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('{"message":{"content":"partial"}}\n'),
              );
              abort.signal.addEventListener(
                'abort',
                () => controller.error(new Error('aborted')),
                { once: true },
              );
            },
          }),
        ),
    );
    const response = await state.wire.fetch('http://127.0.0.1:11434/api/chat', {
      ...init,
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();
    await expect(reader.read()).rejects.toThrow('aborted');
    expect(state.events.at(-1)).toMatchObject({
      outcome: 'stream_failed',
      wireDone: false,
    });
    expect(
      fs.readFileSync(
        path.join(state.root, 'case-3-attempt-1-response.ndjson'),
        'utf8',
      ),
    ).toContain('partial');
  });
  it('retains exact split streaming bytes and records terminal completion separately from headers', async () => {
    const raw =
      '{"model":"gemma4:12b","message":{"content":"héllo"}}\n{"model":"gemma4:12b","done":true,"done_reason":"stop"}\n';
    const bytes = new TextEncoder().encode(raw);
    const state = setup(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(bytes.slice(0, 55));
              c.enqueue(bytes.slice(55));
              c.close();
            },
          }),
        ),
    );
    const response = await state.wire.fetch(
      'http://127.0.0.1:11434/api/chat',
      init,
    );
    expect(await response.text()).toBe(raw);
    expect(state.events.at(-1)).toMatchObject({
      event: 'physical_terminal',
      outcome: 'complete',
      wireDone: true,
      firstAnswerMs: expect.any(Number),
      firstReasoningMs: null,
    });
    const file = path.join(state.root, 'case-3-attempt-1-response.ndjson');
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(state.wire.active()).toEqual([]);
  });
  it.each([
    ['{"message":{"content":"partial"}}\n', 'incomplete_or_invalid'],
    ['{"model":"other","done":true}\n', 'stream_failed'],
    ['not-json\n', 'stream_failed'],
    ['{"done":true}\n{"message":{"content":"late"}}\n', 'stream_failed'],
  ])(
    'retains rejected responses and fails closed: %s',
    async (raw, outcome) => {
      const state = setup(async () => new Response(raw));
      const response = await state.wire.fetch(
        'http://127.0.0.1:11434/api/chat',
        init,
      );
      await expect(response.text()).rejects.toThrow();
      expect(state.events.at(-1)).toMatchObject({ outcome });
      expect(
        fs.readFileSync(
          path.join(state.root, 'case-3-attempt-1-response.ndjson'),
          'utf8',
        ),
      ).toBe(raw);
    },
  );
  it('records failures before headers without losing the attempt', async () => {
    const state = setup(async () => {
      throw new Error('connection failed');
    });
    await expect(
      state.wire.fetch('http://127.0.0.1:11434/api/chat', init),
    ).rejects.toThrow();
    expect(state.wire.count()).toBe(1);
    expect(state.events.at(-1)).toMatchObject({ outcome: 'transport_failed' });
  });
  it('rejects remote hosts and wrong wire models before making requests', async () => {
    const state = setup(async () => new Response());
    await expect(
      state.wire.fetch('https://example.com/api/chat', init),
    ).rejects.toThrow();
    await expect(
      state.wire.fetch('http://127.0.0.1:11434/api/chat', {
        ...init,
        body: init.body.replace('gemma4:12b', 'other'),
      }),
    ).rejects.toThrow();
    expect(state.request).not.toHaveBeenCalled();
  });
  it('records consumer cancellation exactly once and preserves bytes', async () => {
    const state = setup(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(
                new TextEncoder().encode('{"message":{"content":"partial"}}\n'),
              );
            },
          }),
        ),
    );
    const response = await state.wire.fetch(
      'http://127.0.0.1:11434/api/chat',
      init,
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(
      state.events.filter((event) => event.event === 'physical_terminal'),
    ).toHaveLength(1);
    expect(state.events.at(-1)).toMatchObject({
      outcome: 'consumer_cancelled',
      wireDone: false,
    });
  });
});

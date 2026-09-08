import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Private, streaming transport evidence. HTTP headers never mean completion. */
export function createNotesReplayTransport(input: {
  root: string;
  model: string;
  contextTokens: number;
  fetch: typeof fetch;
  record: (event: Record<string, unknown>) => void;
  currentCase: () => number;
}) {
  let count = 0;
  const active = new Set<number>();
  const capturedFetch: typeof fetch = async (urlInput, init) => {
    const url = new URL(String(urlInput));
    assert.equal(url.origin, 'http://127.0.0.1:11434', 'replay_local_only');
    assert.ok(!url.username && !url.password, 'replay_credentials_forbidden');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const generation = Boolean(body?.messages || body?.prompt);
    if (!generation) {
      assert.ok(
        ['/api/tags', '/api/ps', '/api/show', '/api/generate'].includes(
          url.pathname,
        ),
        'replay_endpoint_forbidden',
      );
      input.record({
        event: 'control_request',
        endpoint: url.pathname,
        model: body?.model ?? null,
      });
      return input.fetch(urlInput, { ...init, redirect: 'error' });
    }
    assert.ok(
      ['/api/chat', '/api/generate'].includes(url.pathname),
      'replay_endpoint_forbidden',
    );
    assert.equal(body.model, input.model, 'replay_wire_model_mismatch');
    assert.equal(
      body.options?.num_ctx,
      input.contextTokens,
      'replay_wire_context_mismatch',
    );
    assert.equal(body.stream, true, 'replay_stream_required');
    const attempt = ++count;
    const caseIndex = input.currentCase();
    const prefix = `case-${caseIndex}-attempt-${attempt}`;
    const requestFd = fs.openSync(
      path.join(input.root, `${prefix}-request.json`),
      'wx',
      0o600,
    );
    try {
      fs.writeSync(requestFd, JSON.stringify(body));
      fs.fsyncSync(requestFd);
    } finally {
      fs.closeSync(requestFd);
    }
    const fd = fs.openSync(
      path.join(input.root, `${prefix}-response.ndjson`),
      'wx',
      0o600,
    );
    active.add(attempt);
    const started = Date.now();
    input.record({
      event: 'physical_started',
      attempt,
      caseIndex,
      prefix,
      endpoint: url.pathname,
    });
    let closed = false;
    let pending = '';
    let bytes = 0;
    let done = false;
    let doneReason: unknown = null;
    let responseModel: unknown = null;
    let invalid = false;
    const decoder = new TextDecoder();
    const parseLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const packet = JSON.parse(line);
        if (packet.model) responseModel = packet.model;
        if (packet.model && packet.model !== input.model) invalid = true;
        if (packet.error) invalid = true;
        if (packet.done === true) {
          done = true;
          doneReason = packet.done_reason ?? null;
        }
      } catch {
        invalid = true;
      }
    };
    const finish = (outcome: string) => {
      if (closed) return;
      closed = true;
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      active.delete(attempt);
      input.record({
        event: 'physical_terminal',
        attempt,
        caseIndex,
        outcome,
        bytes,
        wireDone: done,
        doneReason,
        responseModel,
        invalid,
        elapsedMs: Date.now() - started,
      });
    };
    try {
      const response = await input.fetch(urlInput, {
        ...init,
        redirect: 'error',
      });
      input.record({
        event: 'physical_headers',
        attempt,
        caseIndex,
        status: response.status,
      });
      if (!response.body) {
        finish('body_missing');
        throw new Error('replay_response_body_missing');
      }
      const reader = response.body.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              pending += decoder.decode();
              parseLine(pending);
              finish(
                response.ok && done && !invalid
                  ? 'complete'
                  : 'incomplete_or_invalid',
              );
              if (!response.ok || !done || invalid)
                controller.error(
                  new Error('replay_response_incomplete_or_invalid'),
                );
              else controller.close();
              return;
            }
            bytes += next.value.byteLength;
            if (bytes > 16 * 1024 * 1024)
              throw new Error('replay_response_size_exceeded');
            fs.writeSync(fd, next.value);
            fs.fsyncSync(fd);
            pending += decoder.decode(next.value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            lines.forEach(parseLine);
            if (invalid)
              throw new Error('replay_response_identity_or_payload_invalid');
            controller.enqueue(next.value);
          } catch (error) {
            finish('stream_failed');
            void reader.cancel().catch(() => {});
            controller.error(error);
          }
        },
        async cancel() {
          finish('consumer_cancelled');
          await reader.cancel();
        },
      });
      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      finish('transport_failed');
      throw error;
    }
  };
  return {
    fetch: capturedFetch,
    count: () => count,
    active: () => [...active],
  };
}

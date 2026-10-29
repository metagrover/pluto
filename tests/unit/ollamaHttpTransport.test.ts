import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ollamaHttpFetch,
  ollamaHttpStream,
} from '../../electron/llm/ollamaHttpTransport';

describe('ollamaHttpFetch', () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  it('keeps localhost generation off Electron network services', async () => {
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ response: JSON.parse(body).prompt }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');

    const response = await ollamaHttpFetch(
      `http://127.0.0.1:${address.port}/api/generate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'durable' }),
      },
    );

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ response: 'durable' });
  });

  it.each([
    { transport: 'fetch', bodyType: 'string' },
    { transport: 'stream', bodyType: 'string' },
    { transport: 'fetch', bodyType: 'bytes' },
    { transport: 'stream', bodyType: 'bytes' },
  ])(
    'frames a large Unicode $bodyType body for $transport cancellation before response headers',
    async ({ transport, bodyType }) => {
      const controller = new AbortController();
      const bodyText = JSON.stringify({
        prompt: 'Meeting notes ✓ café 🌙 '.repeat(1024),
      });
      const body =
        bodyType === 'bytes' ? Buffer.from(bodyText, 'utf8') : bodyText;
      let headers: Record<string, string | string[] | undefined> = {};
      let receivedBody = '';
      let upstreamClosed = false;
      let resolveReceived!: () => void;
      const received = new Promise<void>((resolve) => {
        resolveReceived = resolve;
      });
      const server = createServer((request, response) => {
        headers = request.headers;
        response.on('close', () => {
          upstreamClosed = true;
        });
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
          receivedBody += chunk;
        });
        request.on('end', resolveReceived);
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('no address');
      const url = `http://127.0.0.1:${address.port}/api/chat`;
      const init = { method: 'POST', body, signal: controller.signal };
      const generation =
        transport === 'fetch'
          ? ollamaHttpFetch(url, init)
          : ollamaHttpStream(url, init, () => undefined);
      const rejected = expect(generation).rejects.toMatchObject({
        name: 'AbortError',
      });
      try {
        await received;
      } finally {
        controller.abort();
      }
      await rejected;
      await vi.waitFor(() => expect(upstreamClosed).toBe(true));
      expect(receivedBody).toBe(bodyText);
      expect(headers['content-length']).toBe(
        String(Buffer.byteLength(bodyText, 'utf8')),
      );
      expect(headers['transfer-encoding']).toBeUndefined();
    },
  );

  it('rejects when the response stream terminates before completion', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"response":');
      response.destroy();
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');

    const outcome = await Promise.race([
      ollamaHttpFetch(`http://127.0.0.1:${address.port}/api/generate`).then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 100)),
    ]);

    expect(outcome).toBe('rejected');
  });

  it('rejects promptly when the caller aborts generation', async () => {
    const controller = new AbortController();
    const server = createServer(() => controller.abort());
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');

    await expect(
      ollamaHttpFetch(`http://127.0.0.1:${address.port}/api/generate`, {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it('rejects responses that exceed the configured byte limit', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('x'.repeat(17));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');

    await expect(
      ollamaHttpFetch(`http://127.0.0.1:${address.port}/api/generate`, {}, 16),
    ).rejects.toThrow('response exceeded');
  });

  it('delivers streaming UTF-8 chunks before the response completes', async () => {
    const packet = Buffer.from('{"response":"Pluto ✓"}\n', 'utf8');
    const splitAt = packet.indexOf(Buffer.from('✓')) + 1;
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.write(packet.subarray(0, splitAt));
      setImmediate(() => response.end(packet.subarray(splitAt)));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const chunks: string[] = [];

    const response = await ollamaHttpStream(
      `http://127.0.0.1:${address.port}/api/generate`,
      { method: 'POST', body: '{}' },
      (chunk) => chunks.push(chunk),
    );

    expect(response.ok).toBe(true);
    expect(chunks.join('')).toBe(packet.toString('utf8'));
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('finishes immediately when the consumer observes logical completion', async () => {
    let upstreamClosed = false;
    const server = createServer((request, response) => {
      request.on('close', () => {
        upstreamClosed = true;
      });
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.write('{"response":"Done.","done":true}\n');
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');

    const result = await Promise.race([
      ollamaHttpStream(
        `http://127.0.0.1:${address.port}/api/generate`,
        { method: 'POST', body: '{}' },
        (chunk) => !chunk.includes('"done":true'),
      ).then(() => 'completed'),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 100)),
    ]);

    expect(result).toBe('completed');
    await vi.waitFor(() => expect(upstreamClosed).toBe(true));
  });

  it('closes the active upstream response when streaming is aborted', async () => {
    const controller = new AbortController();
    let upstreamClosed = false;
    const server = createServer((request, response) => {
      request.on('close', () => {
        upstreamClosed = true;
      });
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.write('{"response":"started"}\n');
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');

    const generation = ollamaHttpStream(
      `http://127.0.0.1:${address.port}/api/generate`,
      { method: 'POST', body: '{}', signal: controller.signal },
      () => controller.abort(new DOMException('preempted', 'AbortError')),
    );

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(upstreamClosed).toBe(true));
  });

  it('retains bounded HTTP error bodies without delivering them as generated chunks', async () => {
    const body = JSON.stringify({ error: 'PRIVATE_MARKER input too long' });
    const server = createServer((_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(body);
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const onChunk = vi.fn();
    const url = `http://127.0.0.1:${address.port}/api/chat`;
    await expect(ollamaHttpStream(url, {}, onChunk)).resolves.toMatchObject({
      ok: false,
      status: 400,
      errorBody: body,
    });
    expect(onChunk).not.toHaveBeenCalled();
    await expect(ollamaHttpStream(url, {}, onChunk, 16)).rejects.toThrow(
      'response exceeded',
    );
  });
});

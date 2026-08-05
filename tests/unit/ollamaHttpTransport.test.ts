import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ollamaHttpFetch } from '../../electron/llm/ollamaHttpTransport';

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
});

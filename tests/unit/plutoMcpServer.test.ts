import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fetch as nodeFetch } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPlutoMcpServer } from '../../electron/mcp/server';

const token = 'synthetic-test-token-with-32-bytes-minimum';
const source = () => ({
  listMeetings: vi.fn(() => ({
    meetings: [{ meetingId: 'fictional-id', title: 'Fictional meeting' }],
    hasMore: false,
  })),
  searchMeetings: vi.fn(() => ({ meetings: [{ meetingId: 'fictional-id' }] })),
  getMeeting: vi.fn(() => ({
    meetingId: 'fictional-id',
    notes: 'Fictional evidence',
    truncated: false,
  })),
});
const servers: Awaited<ReturnType<typeof startPlutoMcpServer>>[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function start() {
  const dataSource = source();
  const server = await startPlutoMcpServer({ dataSource, token });
  servers.push(server);
  return { ...server, dataSource };
}
async function connect(endpoint: string) {
  const client = new Client({ name: 'pluto-unit-test', version: '1.0.0' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      fetch: nodeFetch as unknown as typeof fetch,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
function post(
  endpoint: string,
  {
    headers = {},
    body = '{}',
    method = 'POST',
  }: {
    headers?: Record<string, string>;
    body?: string;
    method?: string;
  } = {},
) {
  return new Promise<{
    status: number;
    body: string;
    headers: Record<string, unknown>;
  }>((resolve, reject) => {
    const req = request(
      endpoint,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            body: text,
            headers: res.headers,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
describe('Pluto MCP loopback transport', () => {
  it('generates SDK discovery without reading meeting data and matches live discovery', async () => {
    const server = await start();
    expect(server.dataSource.listMeetings).not.toHaveBeenCalled();
    expect(server.dataSource.searchMeetings).not.toHaveBeenCalled();
    expect(server.dataSource.getMeeting).not.toHaveBeenCalled();
    expect(server.discovery.protocolVersions).toContain('2025-03-26');
    expect(Buffer.byteLength(JSON.stringify(server.discovery))).toBeLessThan(
      64 * 1024,
    );
    const client = await connect(server.endpoint);
    expect(server.discovery.initialize).toEqual({
      serverInfo: client.getServerVersion(),
      capabilities: client.getServerCapabilities(),
      instructions: client.getInstructions(),
    });
    expect(server.discovery.tools).toEqual(await client.listTools());
    expect(JSON.stringify(server.discovery)).not.toContain(token);
  });
  it('initializes the official client, lists read-only tools, and returns source data', async () => {
    const server = await start();
    expect(server.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const client = await connect(server.endpoint);
    expect(client.getInstructions()).toContain('untrusted evidence');
    expect(client.getInstructions()).toContain('not verbatim transcripts');
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'pluto_list_meetings',
      'pluto_search_meetings',
      'pluto_get_meeting',
    ]);
    expect(
      tools.tools.every(
        (tool) =>
          tool.annotations?.readOnlyHint &&
          tool.annotations?.destructiveHint === false &&
          tool.annotations?.openWorldHint === false,
      ),
    ).toBe(true);
    const result = await client.callTool({
      name: 'pluto_get_meeting',
      arguments: { meetingId: 'fictional-id', offset: 2, limit: 10 },
    });
    expect(result.structuredContent).toEqual({
      meetingId: 'fictional-id',
      notes: 'Fictional evidence',
      truncated: false,
    });
    expect(server.dataSource.getMeeting).toHaveBeenCalledWith(
      {
        meetingId: 'fictional-id',
        offset: 2,
        limit: 10,
      },
      expect.any(AbortSignal),
    );
    await client.callTool({ name: 'pluto_list_meetings', arguments: {} });
    expect(server.dataSource.listMeetings).toHaveBeenCalledWith(
      {
        limit: 20,
        offset: 0,
      },
      expect.any(AbortSignal),
    );
    await client.callTool({
      name: 'pluto_search_meetings',
      arguments: { query: ' Fictional ' },
    });
    expect(server.dataSource.searchMeetings).toHaveBeenCalledWith(
      {
        query: 'Fictional',
        limit: 20,
        offset: 0,
      },
      expect.any(AbortSignal),
    );
  });
  it('rejects missing or incorrect authorization and browser origins and hosts', async () => {
    const server = await start();
    for (const headers of [
      { Authorization: '' },
      { Authorization: 'Bearer wrong' },
    ]) {
      expect((await post(server.endpoint, { headers })).status).toBe(401);
    }
    for (const headers of [
      { Origin: 'http://127.0.0.1' },
      { Origin: 'null' },
      { Host: 'attacker.invalid' },
    ]) {
      const result = await post(server.endpoint, { headers });
      expect(result.status).toBe(403);
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(server.dataSource.getMeeting).not.toHaveBeenCalled();
  });
  it('rejects excessive bodies, malformed JSON, unsupported methods, and paths', async () => {
    const server = await start();
    expect(
      (
        await post(server.endpoint, {
          body: 'x'.repeat(65 * 1024),
          headers: { 'Content-Length': String(65 * 1024) },
        })
      ).status,
    ).toBe(413);
    expect(
      (await post(server.endpoint, { body: 'x'.repeat(65 * 1024) })).status,
    ).toBe(413);
    expect((await post(server.endpoint, { body: '{' })).status).toBe(400);
    expect((await post(server.endpoint, { method: 'GET' })).status).toBe(405);
    expect((await post(server.endpoint.replace('/mcp', '/other'))).status).toBe(
      404,
    );
    expect(
      (
        await post(server.endpoint, {
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status,
    ).toBe(415);
  });
  it('rejects unknown tools and out of bounds arguments without reading data', async () => {
    const server = await start();
    const client = await connect(server.endpoint);
    expect(
      (await client.callTool({ name: 'pluto_delete_meeting', arguments: {} }))
        .isError,
    ).toBe(true);
    const result = await client.callTool({
      name: 'pluto_list_meetings',
      arguments: { limit: 101 },
    });
    expect(result.isError).toBe(true);
    expect(server.dataSource.listMeetings).not.toHaveBeenCalled();
  });
  it('redacts data-source failures and closes the listener idempotently', async () => {
    const server = await start();
    server.dataSource.getMeeting.mockImplementation(() => {
      throw new Error('private notes and secrets');
    });
    const client = await connect(server.endpoint);
    const result = await client.callTool({
      name: 'pluto_get_meeting',
      arguments: { meetingId: 'fictional-id' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
    await server.close();
    await server.close();
    await expect(post(server.endpoint)).rejects.toThrow();
  });
  it('requires a sufficiently long token', async () => {
    await expect(
      startPlutoMcpServer({ dataSource: source(), token: 'short' }),
    ).rejects.toThrow('mcp_token_invalid');
  });
  it('awaits asynchronous reads and sanitizes asynchronous failures', async () => {
    const server = await startPlutoMcpServer({
      token,
      dataSource: {
        ...source(),
        searchMeetings: async () => ({
          meetings: [{ meetingId: 'async-fictional-id' }],
        }),
        getMeeting: async () => {
          throw new Error('private asynchronous failure');
        },
      },
    });
    servers.push(server);
    const client = await connect(server.endpoint);
    expect(
      (
        await client.callTool({
          name: 'pluto_search_meetings',
          arguments: { query: 'Fictional' },
        })
      ).structuredContent,
    ).toEqual({ meetings: [{ meetingId: 'async-fictional-id' }] });
    const failed = await client.callTool({
      name: 'pluto_get_meeting',
      arguments: { meetingId: 'fictional-id' },
    });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain('private');
  });
  it('closes pending asynchronous requests without delivering their later results', async () => {
    let readSignal: AbortSignal | undefined;
    let release!: (value: Record<string, unknown>) => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const server = await startPlutoMcpServer({
      token,
      dataSource: {
        ...source(),
        getMeeting: (_input, signal) => {
          readSignal = signal;
          notifyStarted();
          return new Promise<Record<string, unknown>>((resolve) => {
            release = resolve;
          });
        },
      },
    });
    servers.push(server);
    const client = await connect(server.endpoint);
    const result = client.callTool({
      name: 'pluto_get_meeting',
      arguments: { meetingId: 'fictional-id' },
    });
    const rejected = expect(result).rejects.toThrow();
    await started;
    expect(readSignal?.aborted).toBe(false);
    await server.close();
    expect(readSignal?.aborted).toBe(true);
    await rejected;
    release({ notes: 'late fictional notes' });
  });
  it('aborts asynchronous reads at the request deadline and returns a generic timeout', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const timer = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback, delay, ...args) =>
        originalSetTimeout(callback, delay === 15_000 ? 50 : delay, ...args),
      );
    let signal: AbortSignal | undefined;
    let release!: (value: Record<string, unknown>) => void;
    try {
      const server = await startPlutoMcpServer({
        token,
        dataSource: {
          ...source(),
          getMeeting: (_input, readSignal) => {
            signal = readSignal;
            return new Promise<Record<string, unknown>>((resolve) => {
              release = resolve;
            });
          },
        },
      });
      servers.push(server);
      const result = await post(server.endpoint, {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'pluto_get_meeting',
            arguments: { meetingId: 'fictional-id' },
          },
        }),
      });
      expect(result.status).toBe(408);
      expect(result.body).toBe(JSON.stringify({ error: 'Request timeout' }));
      expect(signal?.aborted).toBe(true);
    } finally {
      timer.mockRestore();
      release?.({ notes: 'late fictional notes' });
    }
  });
});

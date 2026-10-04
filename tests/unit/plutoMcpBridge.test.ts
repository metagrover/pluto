import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import { startPlutoMcpServer } from '../../electron/mcp/server';

const bridgePath = path.resolve('resources/mcp/pluto-mcp-bridge.mjs');
const electronExecutable = createRequire(import.meta.url)('electron') as string;
const token = 'a'.repeat(43);
const directories: string[] = [];
const servers: Awaited<ReturnType<typeof startPlutoMcpServer>>[] = [];
const clients: Client[] = [];
const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  directories
    .splice(0)
    .forEach((directory) =>
      rmSync(directory, { recursive: true, force: true }),
    );
});

function configFile(endpoint: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pluto-mcp-bridge-test-'));
  directories.push(directory);
  const file = path.join(directory, 'connection.json');
  writeFileSync(
    file,
    JSON.stringify({
      endpoint,
      token,
      discovery: servers.find((server) => server.endpoint === endpoint)
        ?.discovery,
    }),
    { mode: 0o600 },
  );
  return file;
}

async function service() {
  const server = await startPlutoMcpServer({
    token,
    dataSource: {
      listMeetings: () => ({
        meetings: [
          { meetingId: 'fictional-bridge-id', title: 'Fictional planning' },
        ],
      }),
      searchMeetings: () => ({ meetings: [] }),
      getMeeting: () => ({
        meetingId: 'fictional-bridge-id',
        notes: 'Fictional bridge evidence.',
        truncated: false,
      }),
    },
  });
  servers.push(server);
  return server;
}

function runBridge(file: string, input = initialize) {
  return new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath, '--connection', file], {
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error('Bridge test timed out'));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(deadline);
      resolve({ stdout, stderr, exitCode });
    });
    child.stdin.end(`${input}\n`);
  });
}

function expectUnavailable(result: { stdout: string; stderr: string }) {
  expect(JSON.parse(result.stdout)).toEqual({
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: -32000,
      message:
        'Pluto is unavailable. Open Pluto and enable the ChatGPT connection in Settings.',
    },
  });
  expect(result.stdout + result.stderr).not.toContain(token);
  expect(result.stderr).toBe('');
}

describe('Pluto MCP stdio bridge', () => {
  it('uses bundled Electron to initialize, read notes, and reload a restarted connection', async () => {
    const server = await service();
    const file = configFile(server.endpoint);
    const transport = new StdioClientTransport({
      command: electronExecutable,
      args: [bridgePath, '--connection', file],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    const client = new Client({ name: 'pluto-bridge-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(transport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'pluto_list_meetings',
      'pluto_search_meetings',
      'pluto_get_meeting',
    ]);
    expect(
      (
        await client.callTool({
          name: 'pluto_get_meeting',
          arguments: { meetingId: 'fictional-bridge-id' },
        })
      ).structuredContent,
    ).toEqual({
      meetingId: 'fictional-bridge-id',
      notes: 'Fictional bridge evidence.',
      truncated: false,
    });
    // Pluto restart changes the endpoint and token; the same bridge reloads both.
    await server.close();
    const restartedToken = 'b'.repeat(43);
    const restarted = await startPlutoMcpServer({
      token: restartedToken,
      dataSource: {
        listMeetings: () => ({ meetings: [] }),
        searchMeetings: () => ({ meetings: [] }),
        getMeeting: () => ({
          meetingId: 'fictional-bridge-id',
          notes: 'Fictional restarted evidence.',
        }),
      },
    });
    servers.push(restarted);
    writeFileSync(
      file,
      JSON.stringify({
        endpoint: restarted.endpoint,
        token: restartedToken,
        discovery: restarted.discovery,
      }),
      { mode: 0o600 },
    );
    expect(
      (
        await client.callTool({
          name: 'pluto_get_meeting',
          arguments: { meetingId: 'fictional-bridge-id' },
        })
      ).structuredContent,
    ).toEqual({
      meetingId: 'fictional-bridge-id',
      notes: 'Fictional restarted evidence.',
    });
    // Disabling removes the config; an already-running bridge must stop access.
    rmSync(file);
    await expect(client.listTools()).rejects.toThrow('Pluto is unavailable');
    expect(stderr).toBe('');
  });

  it('discovers tools immediately when HTTP stalls and a note read is outstanding', async () => {
    const source = await service();
    const stalled = createServer(() => {});
    await new Promise<void>((resolve) =>
      stalled.listen(0, '127.0.0.1', resolve),
    );
    const address = stalled.address() as { port: number };
    const endpoint = `http://127.0.0.1:${address.port}/mcp`;
    const file = configFile(endpoint);
    writeFileSync(
      file,
      JSON.stringify({ endpoint, token, discovery: source.discovery }),
      { mode: 0o600 },
    );
    const client = new Client({ name: 'stalled-pluto-test', version: '1' });
    const transport = new StdioClientTransport({
      command: electronExecutable,
      args: [bridgePath, '--connection', file],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    try {
      await client.connect(transport, { timeout: 2000 });
      const reading = client
        .callTool({ name: 'pluto_list_meetings', arguments: {} }, undefined, {
          timeout: 1000,
        })
        .catch(() => undefined);
      const tools = await client.listTools({}, { timeout: 500 });
      expect(tools.tools).toHaveLength(3);
      await client.ping({ timeout: 500 });
      await reading;
    } finally {
      await client.close();
      stalled.closeAllConnections();
      await new Promise<void>((resolve) => stalled.close(() => resolve()));
    }
  });

  it('returns a generic error when the file is absent or the local service is disabled', async () => {
    const server = await service();
    const file = configFile(server.endpoint);
    await server.close();
    const discovery = await runBridge(file);
    expect(JSON.parse(discovery.stdout).result.serverInfo.name).toBe('Pluto');
    expectUnavailable(
      await runBridge(
        file,
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'pluto_list_meetings', arguments: {} },
        }),
      ),
    );
    rmSync(file);
    const missing = await runBridge(file);
    expectUnavailable(missing);
    expect(missing.stdout).not.toContain(file);
  });

  it('refuses a connection file readable by other users', async () => {
    const server = await service();
    const file = configFile(server.endpoint);
    chmodSync(file, 0o644);
    expectUnavailable(await runBridge(file));
  });

  it('refuses non-loopback, authenticated, or unexpected endpoints', async () => {
    const server = await service();
    for (const endpoint of [
      'http://example.invalid:1234/mcp',
      server.endpoint.replace('http:', 'https:'),
      server.endpoint.replace('127.0.0.1', 'user:password@127.0.0.1'),
      `${server.endpoint}?token=private-placeholder`,
      server.endpoint.replace('/mcp', '/other'),
    ]) {
      const result = await runBridge(configFile(endpoint));
      expectUnavailable(result);
      expect(result.stdout + result.stderr).not.toContain(endpoint);
      expect(result.stdout + result.stderr).not.toContain(
        'private-placeholder',
      );
    }
  });

  it('rejects oversized stdio lines before forwarding and does not echo their content', async () => {
    const server = await service();
    const result = await runBridge(
      configFile(server.endpoint),
      's'.repeat(65 * 1024),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('MCP request exceeds the size limit.\n');
    expect(result.stderr).not.toContain(token);
  });
});

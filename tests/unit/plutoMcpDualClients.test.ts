import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, expect, it } from 'vitest';
import { installInClaudeDesktop } from '../../electron/mcp/claudeDesktop';
import { createPlutoMcpConnection } from '../../electron/mcp/connection';
import { installPlutoLocalPlugin } from '../../electron/mcp/localPlugin';
import { createPlutoMcpDataSource } from '../../electron/mcp/meetingTools';

const connections: ReturnType<typeof createPlutoMcpConnection>[] = [];
const clients: Client[] = [];
const directories: string[] = [];
const databases: DatabaseSync[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    connections.splice(0).map((connection) => connection.close()),
  );
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

it('serves both desktop clients with independent consent, revocation, and credential rotation', async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pluto-dual-mcp-'),
  );
  directories.push(homeDirectory);
  const executablePath = createRequire(import.meta.url)('electron') as string;
  const bridgePath = path.resolve('resources/mcp/pluto-mcp-bridge.mjs');
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(`CREATE TABLE meetings (
    id TEXT PRIMARY KEY, title TEXT, started_at TEXT, created_at TEXT,
    user_notes TEXT, enhanced_notes TEXT, analysis_json TEXT,
    user_edits_json TEXT, analysis_format_pass INTEGER, transcript_json TEXT
  )`);
  const insert = database.prepare(`INSERT INTO meetings
    (id, title, created_at, enhanced_notes, transcript_json)
    VALUES (?, ?, ?, ?, ?)`);
  insert.run(
    'first',
    'Prototype planning',
    '2026-01-01',
    'The prototype needs approval.',
    'Transcript sentinel',
  );
  insert.run(
    'second',
    'Prototype review',
    '2026-01-02',
    'Decision: ship the prototype.',
    'Transcript sentinel',
  );
  const dataSource = createPlutoMcpDataSource(database);
  const make = (client: 'chatgpt' | 'claude') => {
    let enabled = false;
    const connection = createPlutoMcpConnection({
      directory: path.join(homeDirectory, client),
      dataSource,
      readEnabled: () => enabled,
      writeEnabled: (next) => {
        enabled = next;
      },
      installPlugin: (connectionFile) =>
        client === 'claude'
          ? installInClaudeDesktop({
              homeDirectory,
              executablePath,
              bridgePath,
              connectionFile,
            })
          : installPlutoLocalPlugin({
              homeDirectory,
              executablePath,
              bridgePath,
              connectionFile,
              logoPath: path.resolve('public/dock-icon.png'),
            }),
    });
    connections.push(connection);
    return connection;
  };
  const chatgpt = make('chatgpt');
  const claude = make('claude');
  await Promise.all([chatgpt.initialize(), claude.initialize()]);
  await chatgpt.setEnabled(true);
  expect(claude.getStatus()).toMatchObject({ enabled: false, running: false });
  expect(
    fs.existsSync(
      path.join(homeDirectory, 'Library', 'Application Support', 'Claude'),
    ),
  ).toBe(false);
  await claude.setEnabled(true);
  const configFile = (client: string) =>
    path.join(homeDirectory, client, 'connection.json');
  const credentials = (client: string) =>
    JSON.parse(fs.readFileSync(configFile(client), 'utf8'));
  expect(credentials('claude').token).not.toBe(credentials('chatgpt').token);
  const claudeConfig = JSON.parse(
    fs.readFileSync(
      path.join(
        homeDirectory,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      ),
      'utf8',
    ),
  ).mcpServers['pluto-notes'];
  const connect = async (
    name: string,
    config: { command: string; args: string[]; env: Record<string, string> },
  ) => {
    const client = new Client({ name, version: '1' });
    clients.push(client);
    await client.connect(new StdioClientTransport(config));
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'pluto_list_meetings',
      'pluto_search_meetings',
      'pluto_get_meeting',
    ]);
    return client;
  };
  const chatgptConfig = JSON.parse(
    fs.readFileSync(
      path.join(homeDirectory, '.codex', 'plugins', 'pluto-notes', '.mcp.json'),
      'utf8',
    ),
  ).mcpServers['pluto-notes'];
  const chatgptClient = await connect('chatgpt-fixture', chatgptConfig);
  const claudeClient = await connect('claude-fixture', claudeConfig);
  const read = (client: Client) =>
    client.callTool({
      name: 'pluto_get_meeting',
      arguments: { meetingId: 'second' },
    });
  for (const client of [chatgptClient, claudeClient]) {
    const results = await client.callTool({
      name: 'pluto_search_meetings',
      arguments: { query: 'prototype' },
    });
    const search = JSON.stringify(results);
    expect(search).toContain('Prototype planning');
    expect(search).toContain('Prototype review');
    expect(JSON.stringify(await read(client))).toContain('ship the prototype');
    expect(JSON.stringify(await read(client))).not.toContain(
      'Transcript sentinel',
    );
  }
  expect(JSON.stringify(await read(claudeClient))).toContain(
    'ship the prototype',
  );
  const first = credentials('claude');
  await claude.setEnabled(false);
  await expect(read(claudeClient)).rejects.toThrow('Pluto is unavailable');
  expect(JSON.stringify(await read(chatgptClient))).toContain(
    'ship the prototype',
  );
  await claude.setEnabled(true);
  expect(credentials('claude').token).not.toBe(first.token);
  expect(JSON.stringify(await read(claudeClient))).toContain(
    'ship the prototype',
  );
  await chatgpt.setEnabled(false);
  await expect(read(chatgptClient)).rejects.toThrow('Pluto is unavailable');
  expect(JSON.stringify(await read(claudeClient))).toContain(
    'ship the prototype',
  );
  await claude.close();
  expect(fs.existsSync(configFile('claude'))).toBe(false);
  await expect(read(claudeClient)).rejects.toThrow('Pluto is unavailable');
}, 20_000);

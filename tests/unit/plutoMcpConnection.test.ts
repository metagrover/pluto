import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlutoMcpConnection } from '../../electron/mcp/connection';
import type { PlutoMcpDataSource } from '../../electron/mcp/types';

const directories: string[] = [];
const dataSource: PlutoMcpDataSource = {
  listMeetings: () => ({}),
  searchMeetings: () => ({}),
  getMeeting: () => ({}),
};
function fixture(initiallyEnabled = false) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pluto-mcp-lifecycle-'),
  );
  directories.push(directory);
  let preference = initiallyEnabled;
  const close = vi.fn(async () => undefined);
  const startServer = vi.fn(async () => ({
    endpoint: 'http://127.0.0.1:12345/mcp',
    discovery: {
      initialize: {
        serverInfo: { name: 'Pluto', version: '1.0.0' },
        capabilities: { tools: {} },
        instructions: 'Synthetic discovery',
      },
      tools: { tools: [] },
      protocolVersions: ['2025-03-26'],
    },
    close,
  }));
  const writeEnabled = vi.fn((next: boolean) => {
    preference = next;
  });
  const installPlugin = vi.fn(() => ({
    pluginName: 'pluto-notes',
    marketplaceName: 'personal',
  }));
  const connection = createPlutoMcpConnection({
    directory,
    installPlugin,
    dataSource,
    readEnabled: () => preference,
    writeEnabled,
    startServer,
  });
  return {
    directory,
    connection,
    close,
    startServer,
    writeEnabled,
    installPlugin,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('Pluto MCP connection lifecycle', () => {
  it('defaults off and removes stale credentials without starting a server', async () => {
    const { connection, directory, startServer } = fixture();
    fs.writeFileSync(path.join(directory, 'connection.json'), 'stale');
    expect(await connection.initialize()).toMatchObject({
      enabled: false,
      running: false,
      pluginReady: false,
    });
    expect(startServer).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(directory, 'connection.json'))).toBe(false);
  });

  it('creates private credentials, keeps them out of status, rotates after disable and restores opt-in on startup', async () => {
    const { connection, directory, startServer, close } = fixture(true);
    const status = await connection.initialize();
    const filename = path.join(directory, 'connection.json');
    const first = JSON.parse(fs.readFileSync(filename, 'utf8'));
    expect(first.token).toMatch(/^[\w-]{43}$/);
    expect(first.discovery).toEqual(
      (await startServer.mock.results[0].value).discovery,
    );
    expect(JSON.stringify(status)).not.toContain('Synthetic discovery');
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(status).toMatchObject({ enabled: true, running: true });
    expect(JSON.stringify(status)).not.toContain(first.token);
    expect(status.pluginReady).toBe(true);
    expect(status.pluginName).toBe('pluto-notes');
    await connection.setEnabled(true);
    expect(startServer).toHaveBeenCalledTimes(1);
    await connection.setEnabled(false);
    expect(close).toHaveBeenCalledOnce();
    expect(fs.existsSync(filename)).toBe(false);
    await connection.setEnabled(true);
    expect(JSON.parse(fs.readFileSync(filename, 'utf8')).token).not.toBe(
      first.token,
    );
    await connection.close();
  });

  it('sanitizes start failures and allows a later retry', async () => {
    const { connection, startServer } = fixture();
    startServer.mockRejectedValueOnce(new Error('private-key-or-path'));
    const failure = await connection.setEnabled(true);
    expect(failure).toMatchObject({ enabled: true, running: false });
    expect(failure.error).toBeTruthy();
    expect(JSON.stringify(failure)).not.toContain('private-key-or-path');
    expect(await connection.setEnabled(true)).toMatchObject({
      running: true,
      error: null,
    });
    await connection.close();
  });

  it('closes a listener if its private configuration cannot be written', async () => {
    const { connection, directory, close } = fixture();
    fs.rmSync(directory, { recursive: true });
    fs.writeFileSync(directory, 'not a directory');
    expect(await connection.setEnabled(true)).toMatchObject({ running: false });
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed if the local plugin cannot be prepared, then allows retry', async () => {
    const { connection, directory, installPlugin, close } = fixture();
    installPlugin.mockImplementationOnce(() => {
      throw new Error('catalog_conflict_private_path');
    });
    const failed = await connection.setEnabled(true);
    expect(failed).toMatchObject({ running: false, pluginReady: false });
    expect(close).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(directory, 'connection.json'))).toBe(false);
    expect(JSON.stringify(failed)).not.toContain(
      'catalog_conflict_private_path',
    );
    expect(await connection.setEnabled(true)).toMatchObject({
      running: true,
      pluginReady: true,
    });
    await connection.close();
  });

  it('stops access even when saving the disabled preference fails', async () => {
    const { connection, directory, writeEnabled, close } = fixture(true);
    await connection.initialize();
    writeEnabled.mockImplementationOnce(() => {
      throw new Error('write failed');
    });
    expect(await connection.setEnabled(false)).toMatchObject({
      running: false,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(directory, 'connection.json'))).toBe(false);
    expect(connection.getStatus().error).toContain(
      'preference could not be saved',
    );
    await connection.setEnabled(false);
    expect(connection.getStatus()).toMatchObject({
      enabled: false,
      error: null,
    });
  });

  it('serializes rapid changes and shutdown preserves the opt-in preference while revoking credentials', async () => {
    const { connection, directory, writeEnabled, close } = fixture();
    await Promise.all([
      connection.setEnabled(true),
      connection.setEnabled(false),
      connection.setEnabled(true),
    ]);
    expect(connection.getStatus()).toMatchObject({
      enabled: true,
      running: true,
    });
    await connection.close();
    expect(close).toHaveBeenCalledTimes(2);
    expect(writeEnabled).toHaveBeenLastCalledWith(true);
    expect(fs.existsSync(path.join(directory, 'connection.json'))).toBe(false);
    await expect(connection.setEnabled(true)).rejects.toThrow(
      'connection_shutting_down',
    );
  });
});

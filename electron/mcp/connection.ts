import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startPlutoMcpServer } from './server';
import type { PlutoMcpDataSource, PlutoMcpSnapshot } from './types';

export const PLUTO_MCP_ENABLED_SETTING = 'chatgpt_notes_connection_enabled';
export const PLUTO_MCP_SETUP_URL =
  'https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually';

export function createPlutoMcpConnection({
  dataSource,
  directory,
  installPlugin,
  readEnabled,
  writeEnabled,
  startServer = startPlutoMcpServer,
}: {
  dataSource: PlutoMcpDataSource;
  directory: string;
  installPlugin: (connectionFile: string) =>
    | {
        pluginName: string;
        marketplaceName: string;
      }
    | Promise<{ pluginName: string; marketplaceName: string }>;
  readEnabled: () => boolean;
  writeEnabled: (enabled: boolean) => void;
  startServer?: typeof startPlutoMcpServer;
}) {
  const connectionFile = path.join(directory, 'connection.json');
  let server: Awaited<ReturnType<typeof startPlutoMcpServer>> | null = null;
  let enabled = false;
  let error: string | null = null;
  let stopped = false;
  let plugin: { pluginName: string; marketplaceName: string } | null = null;
  let queue = Promise.resolve();

  const getStatus = (): PlutoMcpSnapshot => ({
    enabled,
    running: server !== null,
    pluginReady: plugin !== null,
    pluginName: plugin?.pluginName ?? null,
    marketplaceName: plugin?.marketplaceName ?? null,
    error,
  });

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const stop = async () => {
    const previous = server;
    server = null;
    // Stop accepting authenticated work before the database is closed.
    try {
      await previous?.close();
    } finally {
      fs.rmSync(connectionFile, { force: true });
    }
  };

  const start = async () => {
    if (server || stopped) return;
    const token = randomBytes(32).toString('base64url');
    const pending = await startServer({ dataSource, token });
    const temporaryPath = path.join(
      directory,
      `.connection-${randomBytes(8).toString('hex')}.tmp`,
    );
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.chmodSync(directory, 0o700);
      fs.writeFileSync(
        temporaryPath,
        JSON.stringify({
          endpoint: pending.endpoint,
          token,
          discovery: pending.discovery,
        }),
        {
          mode: 0o600,
          flag: 'wx',
        },
      );
      fs.renameSync(temporaryPath, connectionFile);
      plugin = await installPlugin(connectionFile);
      server = pending;
    } catch (failure) {
      await pending.close();
      fs.rmSync(temporaryPath, { force: true });
      fs.rmSync(connectionFile, { force: true });
      throw failure;
    }
  };

  return {
    getStatus,
    initialize: () =>
      serialize(async () => {
        if (stopped) return getStatus();
        try {
          fs.rmSync(connectionFile, { force: true });
          enabled = readEnabled();
          if (enabled) await start();
        } catch {
          error =
            'Could not start the local connection. Disable it and try again.';
        }
        return getStatus();
      }),
    setEnabled: (next: boolean) =>
      serialize(async () => {
        if (typeof next !== 'boolean')
          throw new Error('invalid_connection_setting');
        if (stopped) throw new Error('connection_shutting_down');
        error = null;
        // Disable access even if saving the preference fails.
        if (!next) await stop();
        try {
          writeEnabled(next);
          enabled = next;
          if (enabled) await start();
        } catch {
          error = next
            ? 'Could not enable the local connection. Try again.'
            : 'Access stopped, but the preference could not be saved. Try disabling again.';
        }
        return getStatus();
      }),
    close: () => {
      stopped = true;
      return serialize(stop);
    },
  };
}

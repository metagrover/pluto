import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { lockSync } from 'proper-lockfile';

export const CLAUDE_NOTES_ENABLED_SETTING = 'claude_notes_connection_enabled';
export const CLAUDE_SETUP_URL =
  'https://modelcontextprotocol.io/docs/develop/connect-local-servers';

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

function readRegular(filename: string): string | undefined {
  try {
    const fd = fs.openSync(
      filename,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
        throw new Error('invalid_claude_config');
      return fs.readFileSync(fd, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Merge only Pluto's entry; credentials stay in Pluto's private connection file. */
export function installInClaudeDesktop({
  homeDirectory,
  executablePath,
  bridgePath,
  connectionFile,
  development = false,
}: {
  homeDirectory: string;
  executablePath: string;
  bridgePath: string;
  connectionFile: string;
  development?: boolean;
}): { pluginName: string; marketplaceName: string } {
  for (const filename of [
    homeDirectory,
    executablePath,
    bridgePath,
    connectionFile,
  ]) {
    if (!path.isAbsolute(filename) || filename.includes('\0'))
      throw new Error('claude_setup_requires_absolute_paths');
  }
  const directory = path.join(
    homeDirectory,
    'Library',
    'Application Support',
    'Claude',
  );
  // Check every existing parent before creating or writing config files.
  let current = homeDirectory;
  for (const segment of ['', 'Library', 'Application Support', 'Claude']) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('claude_setup_requires_regular_directories');
  }
  const configFile = path.join(directory, 'claude_desktop_config.json');
  const releaseLock = lockSync(configFile, {
    realpath: false,
    lockfilePath: path.join(directory, '.pluto-setup.lock'),
  });
  const temporary = path.join(directory, `.pluto-${randomUUID()}.tmp`);
  try {
    const original = readRegular(configFile);
    const config: unknown = original === undefined ? {} : JSON.parse(original);
    if (
      !object(config) ||
      (config.mcpServers !== undefined && !object(config.mcpServers))
    )
      throw new Error('invalid_claude_config');
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    const pluginName = development ? 'pluto-notes-development' : 'pluto-notes';
    const previous = servers[pluginName];
    if (
      previous !== undefined &&
      !(
        object(previous) &&
        object(previous.env) &&
        previous.env.PLUTO_MCP_CLIENT === 'claude-desktop' &&
        Array.isArray(previous.args) &&
        previous.args.length === 3 &&
        previous.args[1] === '--connection' &&
        previous.args[2] === connectionFile
      )
    )
      throw new Error('claude_pluto_entry_conflict');
    config.mcpServers = {
      ...servers,
      [pluginName]: {
        command: executablePath,
        args: [bridgePath, '--connection', connectionFile],
        env: { ELECTRON_RUN_AS_NODE: '1', PLUTO_MCP_CLIENT: 'claude-desktop' },
      },
    };
    const content = `${JSON.stringify(config, null, 2)}\n`;
    if (content !== original) {
      fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
      if (readRegular(configFile) !== original)
        throw new Error('claude_config_changed_during_setup');
      if (original !== undefined)
        fs.writeFileSync(
          path.join(directory, `.pluto-backup-${randomUUID()}.json`),
          original,
          {
            flag: 'wx',
            mode: 0o600,
          },
        );
      fs.renameSync(temporary, configFile);
    }
    return { pluginName, marketplaceName: 'claude-desktop' };
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } finally {
      releaseLock();
    }
  }
}

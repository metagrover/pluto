import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installInClaudeDesktop } from '../../electron/mcp/claudeDesktop';

const directories: string[] = [];
function fixture() {
  const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-claude-'));
  directories.push(homeDirectory);
  const directory = path.join(
    homeDirectory,
    'Library',
    'Application Support',
    'Claude',
  );
  fs.mkdirSync(directory, { recursive: true });
  const configFile = path.join(directory, 'claude_desktop_config.json');
  const options = {
    homeDirectory,
    executablePath: '/Applications/Pluto.app/Contents/MacOS/Pluto',
    bridgePath:
      '/Applications/Pluto.app/Contents/Resources/mcp/pluto-mcp-bridge.mjs',
    connectionFile: path.join(
      homeDirectory,
      'pluto',
      'claude-connection',
      'connection.json',
    ),
  };
  const read = () => JSON.parse(fs.readFileSync(configFile, 'utf8'));
  return { directory, configFile, options, read };
}
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('Claude Desktop note connection setup', () => {
  it('creates a private stdio configuration without copying credentials', () => {
    const f = fixture();
    expect(installInClaudeDesktop(f.options)).toEqual({
      pluginName: 'pluto-notes',
      marketplaceName: 'claude-desktop',
    });
    expect(f.read()).toEqual({
      mcpServers: {
        'pluto-notes': {
          command: f.options.executablePath,
          args: [
            f.options.bridgePath,
            '--connection',
            f.options.connectionFile,
          ],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            PLUTO_MCP_CLIENT: 'claude-desktop',
          },
        },
      },
    });
    expect(fs.statSync(f.configFile).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(f.configFile, 'utf8')).not.toMatch(
      /token|Bearer|endpoint/,
    );
  });

  it('preserves other connectors and preferences, backs up existing content, and reconnects idempotently', () => {
    const f = fixture();
    const original = JSON.stringify({
      preferences: { theme: 'dark' },
      mcpServers: { other: { command: '/other' } },
    });
    fs.writeFileSync(f.configFile, original);
    installInClaudeDesktop(f.options);
    expect(f.read().preferences).toEqual({ theme: 'dark' });
    expect(f.read().mcpServers.other).toEqual({ command: '/other' });
    const backups = fs
      .readdirSync(f.directory)
      .filter((name) => name.startsWith('.pluto-backup-'));
    expect(backups).toHaveLength(1);
    const backup = path.join(f.directory, backups[0]);
    expect(fs.readFileSync(backup, 'utf8')).toBe(original);
    expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
    const stat = fs.statSync(f.configFile);
    installInClaudeDesktop(f.options);
    expect(fs.statSync(f.configFile).ino).toBe(stat.ino);
    expect(
      fs
        .readdirSync(f.directory)
        .filter((name) => name.startsWith('.pluto-backup-')),
    ).toHaveLength(1);
  });

  it('keeps development and packaged connections distinct and updates owned runtime paths', () => {
    const f = fixture();
    installInClaudeDesktop(f.options);
    const development = {
      ...f.options,
      development: true,
      connectionFile: path.join(
        f.options.homeDirectory,
        'development',
        'connection.json',
      ),
    };
    installInClaudeDesktop(development);
    installInClaudeDesktop({
      ...f.options,
      executablePath: '/new/Pluto',
      bridgePath: '/new/bridge.mjs',
    });
    expect(Object.keys(f.read().mcpServers)).toEqual([
      'pluto-notes',
      'pluto-notes-development',
    ]);
    expect(f.read().mcpServers['pluto-notes'].command).toBe('/new/Pluto');
    expect(f.read().mcpServers['pluto-notes-development'].args[2]).toBe(
      development.connectionFile,
    );
  });

  it.each([
    'not json',
    'null',
    '[]',
    '{"mcpServers":[]}',
    '{"mcpServers":null}',
    '{"mcpServers":{"pluto-notes":{"command":"/foreign"}}}',
  ])('preserves malformed or conflicting configuration: %s', (original) => {
    const f = fixture();
    fs.writeFileSync(f.configFile, original);
    expect(() => installInClaudeDesktop(f.options)).toThrow();
    expect(fs.readFileSync(f.configFile, 'utf8')).toBe(original);
    expect(fs.readdirSync(f.directory)).toEqual(['claude_desktop_config.json']);
  });

  it('refuses to replace another profile’s Pluto connector', () => {
    const f = fixture();
    installInClaudeDesktop(f.options);
    const original = fs.readFileSync(f.configFile, 'utf8');
    expect(() =>
      installInClaudeDesktop({
        ...f.options,
        connectionFile: '/other/profile/connection.json',
      }),
    ).toThrow('conflict');
    expect(fs.readFileSync(f.configFile, 'utf8')).toBe(original);
  });

  it('refuses symlinked configuration and directories without touching their targets', () => {
    const f = fixture();
    const target = path.join(f.options.homeDirectory, 'target.json');
    fs.writeFileSync(target, '{}');
    fs.symlinkSync(target, f.configFile);
    expect(() => installInClaudeDesktop(f.options)).toThrow();
    expect(fs.readFileSync(target, 'utf8')).toBe('{}');
    fs.unlinkSync(f.configFile);
    fs.rmdirSync(f.directory);
    const elsewhere = path.join(f.options.homeDirectory, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, f.directory);
    expect(() => installInClaudeDesktop(f.options)).toThrow(
      'regular_directories',
    );
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('does not overwrite a concurrent setup lock', () => {
    const f = fixture();
    const lock = path.join(f.directory, '.pluto-setup.lock');
    fs.writeFileSync(lock, 'other setup');
    expect(() => installInClaudeDesktop(f.options)).toThrow();
    expect(fs.readFileSync(lock, 'utf8')).toBe('other setup');
    expect(fs.existsSync(f.configFile)).toBe(false);
  });
});

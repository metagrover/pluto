import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPlutoLocalPlugin } from '../../electron/mcp/localPlugin';

const homes: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const home of homes.splice(0))
    fs.rmSync(home, { recursive: true, force: true });
});

function fixture() {
  const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-plugin-'));
  homes.push(homeDirectory);
  const options = {
    homeDirectory,
    logoPath: path.resolve('public/dock-icon.png'),
    executablePath: '/Applications/Pluto Example.app/Contents/MacOS/Pluto',
    bridgePath: '/Applications/Pluto Example.app/Contents/Resources/bridge.mjs',
    connectionFile: path.join(
      homeDirectory,
      'Pluto Support',
      'connection.json',
    ),
  };
  const catalogDirectory = path.join(homeDirectory, '.agents', 'plugins');
  const catalogPath = path.join(catalogDirectory, 'marketplace.json');
  const pluginDirectory = path.join(
    homeDirectory,
    '.codex',
    'plugins',
    'pluto-notes',
  );
  const readJson = (filename: string) =>
    JSON.parse(fs.readFileSync(filename, 'utf8'));
  const setCatalog = (value: unknown) => {
    fs.mkdirSync(catalogDirectory, { recursive: true });
    fs.writeFileSync(catalogPath, JSON.stringify(value));
  };
  return {
    options,
    catalogDirectory,
    catalogPath,
    pluginDirectory,
    readJson,
    setCatalog,
  };
}

describe('local Pluto plugin registration', () => {
  it('registers a personal stdio plugin using bundled Electron with private atomic files', () => {
    const { options, catalogPath, pluginDirectory, readJson } = fixture();
    const result = installPlutoLocalPlugin(options);
    expect(result).toEqual({
      pluginName: 'pluto-notes',
      marketplaceName: 'pluto-local',
    });
    const catalog = readJson(catalogPath);
    expect(catalog.plugins).toEqual([
      {
        name: 'pluto-notes',
        source: { source: 'local', path: './.codex/plugins/pluto-notes' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
      },
    ]);
    const manifestPath = path.join(
      pluginDirectory,
      '.codex-plugin',
      'plugin.json',
    );
    expect(readJson(manifestPath)).toMatchObject({
      name: 'pluto-notes',
      mcpServers: './.mcp.json',
      interface: {
        displayName: 'Pluto',
        capabilities: ['Read'],
        logo: './assets/logo.png',
        composerIcon: './assets/logo.png',
      },
    });
    expect(
      fs.readFileSync(path.join(pluginDirectory, 'assets', 'logo.png')),
    ).toEqual(fs.readFileSync(options.logoPath));
    const mcpPath = path.join(pluginDirectory, '.mcp.json');
    expect(readJson(mcpPath)).toEqual({
      mcpServers: {
        'pluto-notes': {
          type: 'stdio',
          command: options.executablePath,
          args: [options.bridgePath, '--connection', options.connectionFile],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      },
    });
    for (const filename of [
      catalogPath,
      manifestPath,
      mcpPath,
      path.join(pluginDirectory, '.pluto-owned.json'),
    ]) {
      expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    }
    expect(fs.statSync(pluginDirectory).mode & 0o777).toBe(0o700);
    expect(
      fs.existsSync(path.join(options.homeDirectory, '.codex', 'config.toml')),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(options.homeDirectory, '.codex', 'plugins', 'cache'),
      ),
    ).toBe(false);
    expect(fs.existsSync(options.connectionFile)).toBe(false);
  });

  it('preserves unrelated catalog entries, top-level fields and user configuration when refreshed', () => {
    const { options, catalogPath, pluginDirectory, readJson, setCatalog } =
      fixture();
    const other = {
      name: 'other',
      source: './other',
      policy: { installation: 'NOT_AVAILABLE' },
      extra: 'preserve',
    };
    setCatalog({
      name: 'my-marketplace',
      interface: { displayName: 'My Tools' },
      custom: { value: 4 },
      plugins: [other],
    });
    expect(installPlutoLocalPlugin(options).marketplaceName).toBe(
      'my-marketplace',
    );
    const before = readJson(catalogPath);
    const configPath = path.join(
      options.homeDirectory,
      '.codex',
      'config.toml',
    );
    fs.writeFileSync(configPath, '# user settings\n');
    installPlutoLocalPlugin({
      ...options,
      bridgePath: '/updated/local bridge.mjs',
    });
    expect(readJson(catalogPath)).toEqual(before);
    expect(
      readJson(path.join(pluginDirectory, '.mcp.json')).mcpServers[
        'pluto-notes'
      ].args[0],
    ).toBe('/updated/local bridge.mjs');
    expect(fs.readFileSync(configPath, 'utf8')).toBe('# user settings\n');
  });

  it('keeps development and production entries separate', () => {
    const { options, catalogPath, readJson } = fixture();
    installPlutoLocalPlugin(options);
    installPlutoLocalPlugin({
      ...options,
      pluginName: 'pluto-notes-development',
    });
    expect(
      readJson(catalogPath).plugins.map(
        (entry: { name: string }) => entry.name,
      ),
    ).toEqual(['pluto-notes', 'pluto-notes-development']);
    expect(
      readJson(
        path.join(
          options.homeDirectory,
          '.codex',
          'plugins',
          'pluto-notes-development',
          '.codex-plugin',
          'plugin.json',
        ),
      ).interface.displayName,
    ).toBe('Pluto');
  });

  it.each(['broken-json', 'bad-shape'])(
    'preserves a malformed existing catalog: %s',
    (kind) => {
      const { options, catalogPath, catalogDirectory, pluginDirectory } =
        fixture();
      fs.mkdirSync(catalogDirectory, { recursive: true });
      const text =
        kind === 'broken-json'
          ? '{ broken'
          : JSON.stringify({ name: 'mine', plugins: {} });
      fs.writeFileSync(catalogPath, text);
      expect(() => installPlutoLocalPlugin(options)).toThrow('malformed');
      expect(fs.readFileSync(catalogPath, 'utf8')).toBe(text);
      expect(fs.existsSync(pluginDirectory)).toBe(false);
      expect(fs.readdirSync(catalogDirectory)).toEqual(['marketplace.json']);
    },
  );

  it('refuses existing foreign plugin directories without changing their contents', () => {
    const { options, pluginDirectory, catalogPath } = fixture();
    fs.mkdirSync(pluginDirectory, { recursive: true });
    const foreignFile = path.join(pluginDirectory, 'keep.txt');
    fs.writeFileSync(foreignFile, 'owned by another app');
    expect(() => installPlutoLocalPlugin(options)).toThrow('not owned');
    expect(fs.readdirSync(pluginDirectory)).toEqual(['keep.txt']);
    expect(fs.readFileSync(foreignFile, 'utf8')).toBe('owned by another app');
    expect(fs.existsSync(catalogPath)).toBe(false);
  });

  it('refuses foreign catalog name collisions before generating plugin files', () => {
    const { options, catalogPath, pluginDirectory, setCatalog } = fixture();
    setCatalog({
      name: 'mine',
      plugins: [{ name: 'pluto-notes', source: './another-plugin' }],
    });
    const original = fs.readFileSync(catalogPath, 'utf8');
    expect(() => installPlutoLocalPlugin(options)).toThrow('not owned');
    expect(fs.readFileSync(catalogPath, 'utf8')).toBe(original);
    expect(fs.existsSync(pluginDirectory)).toBe(false);
  });

  it('refuses a changed source even when the local directory has a valid ownership marker', () => {
    const { options, catalogPath, pluginDirectory, readJson, setCatalog } =
      fixture();
    installPlutoLocalPlugin(options);
    const catalog = readJson(catalogPath);
    catalog.plugins[0].source.path = './another-plugin';
    setCatalog(catalog);
    const beforeCatalog = fs.readFileSync(catalogPath, 'utf8');
    const mcpPath = path.join(pluginDirectory, '.mcp.json');
    const beforeMcp = fs.readFileSync(mcpPath, 'utf8');
    expect(() =>
      installPlutoLocalPlugin({ ...options, bridgePath: '/different.mjs' }),
    ).toThrow('not owned');
    expect(fs.readFileSync(catalogPath, 'utf8')).toBe(beforeCatalog);
    expect(fs.readFileSync(mcpPath, 'utf8')).toBe(beforeMcp);
  });

  it('does not follow symlinked directories or catalog files', () => {
    const { options, catalogPath, catalogDirectory } = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-outside-'));
    homes.push(outside);
    const codexPath = path.join(options.homeDirectory, '.codex');
    fs.symlinkSync(outside, codexPath, 'dir');
    expect(() => installPlutoLocalPlugin(options)).toThrow('symbolic links');
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.unlinkSync(codexPath);
    fs.mkdirSync(catalogDirectory, { recursive: true });
    const foreignCatalog = path.join(outside, 'catalog.json');
    fs.writeFileSync(foreignCatalog, '{"name":"foreign","plugins":[]}');
    fs.symlinkSync(foreignCatalog, catalogPath);
    expect(() => installPlutoLocalPlugin(options)).toThrow('symbolic links');
    expect(fs.readFileSync(foreignCatalog, 'utf8')).toBe(
      '{"name":"foreign","plugins":[]}',
    );
  });

  it('refuses symlinked generated files rather than overwriting their targets', () => {
    const { options, pluginDirectory } = fixture();
    installPlutoLocalPlugin(options);
    const filename = path.join(pluginDirectory, '.mcp.json');
    fs.unlinkSync(filename);
    const target = path.join(options.homeDirectory, 'foreign.txt');
    fs.writeFileSync(target, 'keep');
    fs.symlinkSync(target, filename);
    expect(() => installPlutoLocalPlugin(options)).toThrow('symbolic links');
    expect(fs.readFileSync(target, 'utf8')).toBe('keep');
    expect(fs.lstatSync(filename).isSymbolicLink()).toBe(true);
  });

  it('detects a catalog update during setup and preserves the concurrent writer', () => {
    const { options, catalogPath, setCatalog } = fixture();
    setCatalog({ name: 'mine', plugins: [] });
    const originalRename = fs.renameSync.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (!changed && String(to).endsWith('.mcp.json')) {
        changed = true;
        setCatalog({
          name: 'mine',
          plugins: [{ name: 'concurrent', source: './concurrent' }],
        });
      }
      originalRename(from, to);
    });
    expect(() => installPlutoLocalPlugin(options)).toThrow(
      'changed during setup',
    );
    expect(
      JSON.parse(fs.readFileSync(catalogPath, 'utf8')).plugins[0].name,
    ).toBe('concurrent');
    expect(fs.readdirSync(path.dirname(catalogPath))).toEqual([
      'marketplace.json',
    ]);
  });

  it('refuses an active lock and invalid paths or plugin names', () => {
    const { options, catalogDirectory } = fixture();
    fs.mkdirSync(catalogDirectory, { recursive: true });
    const lockPath = path.join(catalogDirectory, '.pluto-install.lock');
    fs.writeFileSync(lockPath, 'other installer');
    expect(() => installPlutoLocalPlugin(options)).toThrow('in progress');
    expect(fs.readFileSync(lockPath, 'utf8')).toBe('other installer');
    expect(() =>
      installPlutoLocalPlugin({ ...options, executablePath: 'node' }),
    ).toThrow('absolute');
    expect(() =>
      installPlutoLocalPlugin({ ...options, pluginName: '../escape' }),
    ).toThrow('names');
  });
});

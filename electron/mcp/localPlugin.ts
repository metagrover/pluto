import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type InstallOptions = {
  homeDirectory: string;
  executablePath: string;
  bridgePath: string;
  connectionFile: string;
  logoPath: string;
  pluginName?: string;
};

const OWNER = 'pluto-local-notes-plugin';
const MARKER = '.pluto-owned.json';
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function existsStat(filename: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertDirectory(directory: string) {
  const stat = existsStat(directory);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      'Plugin setup requires regular directories, not symbolic links.',
    );
  }
}

function ensureDirectory(directory: string) {
  if (!existsStat(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  assertDirectory(directory);
}

function readRegular(filename: string): string | undefined {
  const stat = existsStat(filename);
  if (!stat) return undefined;
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      'Plugin setup refuses symbolic links or non-regular configuration files.',
    );
  }
  return fs.readFileSync(filename, 'utf8');
}

function atomicWrite(
  filename: string,
  content: string | Buffer,
  beforeRename: () => void,
) {
  const temporary = path.join(
    path.dirname(filename),
    `.pluto-${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    beforeRename();
    // Refuse an unexpected symlink even though rename itself would replace it.
    readRegular(filename);
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Adds an available personal plugin; the ChatGPT host owns installation/approval. */
export function installPlutoLocalPlugin({
  homeDirectory,
  executablePath,
  bridgePath,
  connectionFile,
  logoPath,
  pluginName = 'pluto-notes',
}: InstallOptions): { pluginName: string; marketplaceName: string } {
  for (const filename of [
    homeDirectory,
    executablePath,
    bridgePath,
    connectionFile,
    logoPath,
  ]) {
    if (!path.isAbsolute(filename) || filename.includes('\0')) {
      throw new Error('Plugin setup requires absolute local paths.');
    }
  }
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(pluginName) ||
    pluginName.length > 64
  ) {
    throw new Error(
      'Plugin names must use lowercase letters, numbers, and hyphens.',
    );
  }
  assertDirectory(homeDirectory);
  const agentsDirectory = path.join(homeDirectory, '.agents');
  const catalogDirectory = path.join(agentsDirectory, 'plugins');
  const codexDirectory = path.join(homeDirectory, '.codex');
  const pluginsDirectory = path.join(codexDirectory, 'plugins');
  for (const directory of [
    agentsDirectory,
    catalogDirectory,
    codexDirectory,
    pluginsDirectory,
  ]) {
    ensureDirectory(directory);
  }
  const directories = [
    homeDirectory,
    agentsDirectory,
    catalogDirectory,
    codexDirectory,
    pluginsDirectory,
  ];
  const checkDirectories = () => directories.forEach(assertDirectory);
  const catalogPath = path.join(catalogDirectory, 'marketplace.json');
  const lockPath = path.join(catalogDirectory, '.pluto-install.lock');
  let lock: number;
  try {
    lock = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Another Pluto plugin setup is in progress. Try again.');
    }
    throw error;
  }
  const lockStat = fs.fstatSync(lock);
  try {
    const originalCatalog = readRegular(catalogPath);
    const originalStat = existsStat(catalogPath);
    let catalog: Record<string, unknown>;
    try {
      catalog =
        originalCatalog === undefined
          ? {
              name: 'pluto-local',
              interface: { displayName: 'Pluto' },
              plugins: [],
            }
          : JSON.parse(originalCatalog);
      if (
        !object(catalog) ||
        typeof catalog.name !== 'string' ||
        !catalog.name.trim() ||
        !Array.isArray(catalog.plugins)
      ) {
        throw new Error('invalid_catalog');
      }
    } catch {
      throw new Error(
        'The personal plugin marketplace is malformed. Its contents were preserved.',
      );
    }

    const pluginDirectory = path.join(pluginsDirectory, pluginName);
    const markerPath = path.join(pluginDirectory, MARKER);
    const alreadyExists = existsStat(pluginDirectory);
    if (alreadyExists) {
      assertDirectory(pluginDirectory);
      let marker: unknown;
      try {
        marker = JSON.parse(readRegular(markerPath) || 'null');
      } catch {
        marker = null;
      }
      if (
        !object(marker) ||
        marker.owner !== OWNER ||
        marker.pluginName !== pluginName
      ) {
        throw new Error(
          'A plugin with this name already exists and is not owned by Pluto.',
        );
      }
    }
    const sourcePath = `./.codex/plugins/${pluginName}`;
    const entries = catalog.plugins as unknown[];
    const matching = entries.filter(
      (entry) => object(entry) && entry.name === pluginName,
    );
    if (
      matching.length > 1 ||
      matching.some((entry) => {
        const source = (entry as Record<string, unknown>).source;
        return (
          !alreadyExists ||
          !(
            source === sourcePath ||
            (object(source) &&
              source.source === 'local' &&
              source.path === sourcePath)
          )
        );
      })
    ) {
      throw new Error(
        'A marketplace plugin with this name is not owned by Pluto.',
      );
    }

    ensureDirectory(pluginDirectory);
    directories.push(pluginDirectory);
    const manifestDirectory = path.join(pluginDirectory, '.codex-plugin');
    ensureDirectory(manifestDirectory);
    directories.push(manifestDirectory);
    const write = (filename: string, value: unknown) =>
      atomicWrite(filename, json(value), checkDirectories);
    write(markerPath, { owner: OWNER, pluginName });
    const assetsDirectory = path.join(pluginDirectory, 'assets');
    ensureDirectory(assetsDirectory);
    directories.push(assetsDirectory);
    atomicWrite(
      path.join(assetsDirectory, 'logo.png'),
      fs.readFileSync(logoPath),
      checkDirectories,
    );
    const description =
      'Read current Pluto meeting notes for grounded conversations, feedback, comparisons, and analytics.';
    const presentation = {
      displayName:
        pluginName === 'pluto-notes-development'
          ? 'Pluto (Development)'
          : 'Pluto',
      composerIcon: './assets/logo.png',
      logo: './assets/logo.png',
      shortDescription: 'Conversations grounded in your meeting notes',
      longDescription: description,
      developerName: 'Pluto',
      category: 'Productivity',
      capabilities: ['Read'],
    };
    const mcp = {
      mcpServers: {
        [pluginName]: {
          type: 'stdio',
          command: executablePath,
          args: [bridgePath, '--connection', connectionFile],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      },
    };
    write(path.join(manifestDirectory, 'plugin.json'), {
      name: pluginName,
      version: '1.0.1',
      description,
      mcpServers: './.mcp.json',
      interface: presentation,
    });
    write(path.join(pluginDirectory, '.mcp.json'), mcp);
    const entry = {
      name: pluginName,
      source: { source: 'local', path: sourcePath },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity',
    };
    catalog.plugins = matching.length
      ? entries.map((existing) =>
          object(existing) && existing.name === pluginName ? entry : existing,
        )
      : [...entries, entry];
    atomicWrite(catalogPath, json(catalog), () => {
      checkDirectories();
      const currentStat = existsStat(catalogPath);
      if (
        readRegular(catalogPath) !== originalCatalog ||
        currentStat?.ino !== originalStat?.ino ||
        currentStat?.mtimeMs !== originalStat?.mtimeMs ||
        currentStat?.ctimeMs !== originalStat?.ctimeMs
      ) {
        throw new Error(
          'The personal plugin marketplace changed during setup. Its contents were preserved; try again.',
        );
      }
    });
    return { pluginName, marketplaceName: catalog.name as string };
  } finally {
    fs.closeSync(lock);
    const currentLock = existsStat(lockPath);
    if (currentLock?.ino === lockStat.ino && currentLock.dev === lockStat.dev)
      fs.unlinkSync(lockPath);
  }
}

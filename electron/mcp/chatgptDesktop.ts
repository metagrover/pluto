import { execFile } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
type CommandOptions = { encoding: 'utf8'; timeout: number; maxBuffer: number };
type RunCommand = (
  command: string,
  args: string[],
  options: CommandOptions,
) => Promise<{ stdout: string; stderr: string }>;
const commandOptions: CommandOptions = {
  encoding: 'utf8',
  timeout: 20_000,
  maxBuffer: 1024 * 1024,
};

export async function installInChatGptDesktop({
  homeDirectory,
  pluginName,
  marketplaceName,
  runCommand = executeFile,
  accessFile = fs.access,
}: {
  homeDirectory: string;
  pluginName: string;
  marketplaceName: string;
  runCommand?: RunCommand;
  accessFile?: (filename: string, mode: number) => Promise<void>;
}): Promise<void> {
  if (
    !path.isAbsolute(homeDirectory) ||
    !/^[a-zA-Z0-9_-]+$/.test(pluginName) ||
    !/^[a-zA-Z0-9_-]+$/.test(marketplaceName)
  ) {
    throw new Error(
      'Could not prepare the local ChatGPT connection. Try connecting again.',
    );
  }
  let appPath: string;
  try {
    const located = await runCommand(
      '/usr/bin/osascript',
      ['-e', 'POSIX path of (path to application id "com.openai.codex")'],
      commandOptions,
    );
    appPath = located.stdout.trim();
    if (
      !path.isAbsolute(appPath) ||
      !appPath.replace(/\/$/, '').endsWith('.app')
    )
      throw new Error('invalid_app_path');
  } catch {
    throw new Error('Install ChatGPT Desktop, then try connecting again.');
  }
  const cliPath = path.join(
    appPath,
    'Contents',
    'Resources',
    'codex-cli',
    'CodexCLI.app',
    'Contents',
    'MacOS',
    'codex',
  );
  try {
    await accessFile(cliPath, constants.X_OK);
  } catch {
    throw new Error('Update ChatGPT Desktop, then try connecting again.');
  }
  try {
    await runCommand(
      cliPath,
      [
        '-c',
        `marketplaces.${JSON.stringify(marketplaceName)}.source_type="local"`,
        '-c',
        `marketplaces.${JSON.stringify(marketplaceName)}.source=${JSON.stringify(homeDirectory)}`,
        'plugin',
        'add',
        `${pluginName}@${marketplaceName}`,
        '--json',
      ],
      commandOptions,
    );
    const listed = await runCommand(
      cliPath,
      ['plugin', 'list', '--marketplace', marketplaceName, '--json'],
      commandOptions,
    );
    const state = JSON.parse(listed.stdout);
    if (
      !Array.isArray(state.installed) ||
      !state.installed.some(
        (
          entry: {
            pluginId?: string;
            installed?: boolean;
            enabled?: boolean;
          } | null,
        ) =>
          entry?.pluginId === `${pluginName}@${marketplaceName}` &&
          entry.installed === true &&
          entry.enabled === true,
      )
    ) {
      throw new Error('plugin_install_not_confirmed');
    }
  } catch {
    throw new Error(
      'Could not connect Pluto to ChatGPT Desktop. Update ChatGPT Desktop and try again.',
    );
  }
}

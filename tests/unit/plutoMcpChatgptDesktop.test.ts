import { constants } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { installInChatGptDesktop } from '../../electron/mcp/chatgptDesktop';

function fixture() {
  const runCommand = vi.fn(
    async (
      _command: string,
      _args: string[],
      _options: { encoding: 'utf8'; timeout: number; maxBuffer: number },
    ) => ({
      stdout:
        _command === '/usr/bin/osascript'
          ? '/Applications/ChatGPT.app/\n'
          : JSON.stringify({
              installed: [
                {
                  pluginId: 'pluto-notes@personal',
                  installed: true,
                  enabled: true,
                },
              ],
            }),
      stderr: '',
    }),
  );
  const accessFile = vi.fn(async () => undefined);
  const options = {
    homeDirectory: '/Users/Fictional Person/.codex',
    pluginName: 'pluto-notes',
    marketplaceName: 'personal',
    runCommand,
    accessFile,
  };
  return { runCommand, accessFile, options };
}

describe('ChatGPT Desktop local plugin installer', () => {
  it('locates the installed app and uses its supported CLI without a shell or editing config', async () => {
    const { options, runCommand, accessFile } = fixture();
    await installInChatGptDesktop(options);
    const commandOptions = {
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    };
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      '/usr/bin/osascript',
      ['-e', 'POSIX path of (path to application id "com.openai.codex")'],
      commandOptions,
    );
    const cliPath =
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
    expect(accessFile).toHaveBeenCalledWith(cliPath, constants.X_OK);
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      cliPath,
      [
        '-c',
        'marketplaces."personal".source_type="local"',
        '-c',
        'marketplaces."personal".source="/Users/Fictional Person/.codex"',
        'plugin',
        'add',
        'pluto-notes@personal',
        '--json',
      ],
      commandOptions,
    );
  });
  it.each([
    '{}',
    'not json',
    JSON.stringify({
      installed: [
        { pluginId: 'other@personal', installed: true, enabled: true },
      ],
    }),
    JSON.stringify({
      installed: [
        { pluginId: 'pluto-notes@personal', installed: true, enabled: false },
      ],
    }),
  ])(
    'does not report success when host installation is unconfirmed: %s',
    async (stdout) => {
      const { options, runCommand } = fixture();
      runCommand.mockResolvedValueOnce({
        stdout: '/Applications/ChatGPT.app/',
        stderr: '',
      });
      runCommand.mockResolvedValueOnce({ stdout: '{}', stderr: '' });
      runCommand.mockResolvedValueOnce({ stdout, stderr: '' });
      await expect(installInChatGptDesktop(options)).rejects.toThrow(
        'Could not connect',
      );
    },
  );
  it('encodes quotes and shell syntax in the local marketplace path as a single CLI argument', async () => {
    const { options, runCommand } = fixture();
    options.homeDirectory =
      '/Users/Fictional "Person"/$(private-placeholder)/.codex';
    await installInChatGptDesktop(options);
    const args = runCommand.mock.calls[1]?.[1];
    expect(args?.[3]).toBe(
      `marketplaces."personal".source=${JSON.stringify(options.homeDirectory)}`,
    );
    expect(args).toHaveLength(8);
  });
  it('reports a missing app without leaking command output or personal paths', async () => {
    const { options, runCommand, accessFile } = fixture();
    runCommand.mockRejectedValueOnce(new Error('private path and credentials'));
    await expect(installInChatGptDesktop(options)).rejects.toThrow(
      'Install ChatGPT Desktop',
    );
    expect(accessFile).not.toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
  it('rejects unsupported installations before invoking the plugin command', async () => {
    const { options, runCommand, accessFile } = fixture();
    accessFile.mockRejectedValueOnce(new Error('private CLI path'));
    await expect(installInChatGptDesktop(options)).rejects.toThrow(
      'Update ChatGPT Desktop',
    );
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
  it('sanitizes failed, unsupported, and timed-out plugin commands', async () => {
    const { options, runCommand } = fixture();
    runCommand.mockResolvedValueOnce({
      stdout: '/Applications/ChatGPT.app/',
      stderr: '',
    });
    runCommand.mockRejectedValueOnce(
      new Error('private CLI output token timeout'),
    );
    await expect(installInChatGptDesktop(options)).rejects.toThrow(
      'Could not connect Pluto to ChatGPT Desktop. Update ChatGPT Desktop and try again.',
    );
  });
  it('rejects malformed locator results and invalid inputs without shell execution', async () => {
    const { options, runCommand, accessFile } = fixture();
    runCommand.mockResolvedValueOnce({
      stdout: 'not/an/application',
      stderr: '',
    });
    await expect(installInChatGptDesktop(options)).rejects.toThrow(
      'Install ChatGPT Desktop',
    );
    expect(accessFile).not.toHaveBeenCalled();
    runCommand.mockClear();
    await expect(
      installInChatGptDesktop({
        ...options,
        marketplaceName: 'personal".injected',
      }),
    ).rejects.toThrow('Could not prepare');
    await expect(
      installInChatGptDesktop({ ...options, homeDirectory: 'relative' }),
    ).rejects.toThrow('Could not prepare');
    expect(runCommand).not.toHaveBeenCalled();
  });
});

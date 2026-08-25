import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('preload IPC listener cleanup', () => {
  const source = readFileSync('electron/preload.ts', 'utf8');

  it('removes the exact wrapped listener registered with Electron', () => {
    expect(source).toContain('const wrapped: IpcListener');
    expect(source).toContain('ipcRenderer.on(channel, wrapped)');
    expect(source).toContain('return () => ipcRenderer.off(channel, wrapped)');
  });
});

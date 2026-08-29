import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Electron renderer navigation boundary', () => {
  const main = readFileSync('electron/main.ts', 'utf8');

  it('denies renderer navigation and new windows before exposing local IPC', () => {
    expect(main).toContain("win.webContents.on('will-navigate'");
    expect(main).toContain('event.preventDefault()');
    expect(main).toContain('win.webContents.setWindowOpenHandler');
    expect(main).toContain("return { action: 'deny' }");
  });
});

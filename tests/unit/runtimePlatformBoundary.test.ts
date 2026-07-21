import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('renderer runtime platform boundary', () => {
  it('exposes a frozen, allowlisted platform descriptor from preload', () => {
    const preload = readFileSync('electron/preload.ts', 'utf8');

    expect(preload).toContain("exposeInMainWorld('plutoRuntimePlatform'");
    expect(preload).toContain('Object.freeze');
    expect(preload).not.toContain("exposeInMainWorld('process'");
  });

  it('installs a browser-safe descriptor before the IPC fallback', () => {
    const fallback = readFileSync('src/utils/browserIpcFallback.ts', 'utf8');
    const platformPosition = fallback.indexOf('window.plutoRuntimePlatform =');
    const ipcGuardPosition = fallback.indexOf(
      'if (window.ipcRenderer) return;',
    );

    expect(platformPosition).toBeGreaterThan(-1);
    expect(platformPosition).toBeLessThan(ipcGuardPosition);
    expect(fallback).toContain("arch: 'unknown'");
  });
});

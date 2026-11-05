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
    const runtime = readFileSync('src/utils/runtimeEnvironment.ts', 'utf8');
    const platformPosition = runtime.indexOf('window.plutoRuntimePlatform =');
    const ipcGuardPosition = runtime.indexOf('return !window.ipcRenderer;');

    expect(platformPosition).toBeGreaterThan(-1);
    expect(platformPosition).toBeLessThan(ipcGuardPosition);
    expect(runtime).toContain("arch: 'unknown'");

    const fallback = readFileSync('src/utils/browserIpcFallback.ts', 'utf8');
    expect(fallback).toContain('if (!prepareRuntimeEnvironment()) return;');
  });
});

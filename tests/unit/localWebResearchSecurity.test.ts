import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('electron/web/localWebResearch.ts', 'utf8');

describe('local web research security boundary', () => {
  it('keeps the hidden browser sandboxed, ephemeral, and non-interactive', () => {
    expect(source).toContain("session.fromPartition('person-chat-web')");
    expect(source).not.toContain("session.fromPartition('persist:");
    expect(source).toContain('show: false');
    expect(source).toContain('sandbox: true');
    expect(source).toContain('nodeIntegration: false');
    expect(source).toContain('contextIsolation: true');
    expect(source).toContain(
      "setWindowOpenHandler(() => ({ action: 'deny' }))",
    );
    expect(source).toContain('setPermissionRequestHandler');
    expect(source).toContain("on('will-redirect', preventInsecureNavigation)");
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('clearStorageData()');
    expect(source).toContain('clearCache()');
    expect(source).toContain('window.destroy()');
  });

  it('bounds search, article retrieval, and response size', () => {
    expect(source).toContain('if (results.length === 3) break');
    expect(source).toContain('if (index >= 2');
    expect(source).toContain('MAX_PAGE_BYTES');
    expect(source).toContain('MAX_PASSAGE_CHARS');
    expect(source).toContain("redirect: 'error'");
    expect(source).toContain('isIP(ipHostname) !== 0');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { ensureElectronSqliteAbi } from '../../scripts/ensure_sqlite_abi.mjs';

describe('Electron SQLite ABI preflight', () => {
  it('skips rebuilding when Electron can open a database', () => {
    const probe = vi.fn(() => true);
    const rebuild = vi.fn(() => true);

    expect(ensureElectronSqliteAbi({ probe, rebuild, log: vi.fn() })).toBe(
      'current',
    );
    expect(probe).toHaveBeenCalledTimes(1);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('rebuilds and verifies a mismatched binding', () => {
    const probe = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const rebuild = vi.fn(() => true);

    expect(ensureElectronSqliteAbi({ probe, rebuild, log: vi.fn() })).toBe(
      'rebuilt',
    );
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('fails before launch when rebuilding does not repair the binding', () => {
    const probe = vi.fn(() => false);

    expect(() =>
      ensureElectronSqliteAbi({
        probe,
        rebuild: vi.fn(() => true),
        log: vi.fn(),
      }),
    ).toThrow('Electron SQLite ABI verification failed after rebuild');
  });
});

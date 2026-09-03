import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(
  new URL('../../electron/main.ts', import.meta.url),
  'utf8',
);

describe('idle dreaming production wiring', () => {
  it('recovers leases before creating and scheduling the coordinator', () => {
    const recovery = mainSource.indexOf(
      'dreamingProposalStore.recoverStaleRuns',
    );
    const coordinator = mainSource.indexOf('createIdleDreamingCoordinator({');
    const schedule = mainSource.indexOf('scheduleDreaming(0)');
    expect(recovery).toBeGreaterThan(0);
    expect(recovery).toBeLessThan(coordinator);
    expect(coordinator).toBeLessThan(schedule);
  });

  it('uses bounded dirty scheduling and forwards content-free activity', () => {
    expect(mainSource).toContain('createDirtyEntityQueue({');
    expect(mainSource).not.toMatch(
      /setInterval\(\(\) => \{\s*void idleDreamingCoordinator\?\.attemptIdleRun/,
    );
    expect(mainSource).toContain(
      "win.webContents.on('before-input-event', notifyRendererActivity)",
    );
    expect(mainSource).toContain('invalidateDreamingCatalog()');
  });
});

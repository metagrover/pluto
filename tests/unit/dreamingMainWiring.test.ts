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

  it.each([
    'LINK_ENTITIES',
    'ADD_MEETING_ENTITY',
    'RECORD_ENTITY_CORRECTION',
    'SET_ENTITY_LINK_STATE',
    'RESOLVE_CONFLICT',
    'RESOLVE_PERSON_COMMITMENT_OWNER',
  ])('invalidates dreaming inputs after %s', (channel) => {
    const start = mainSource.indexOf(`'${channel}'`);
    expect(start).toBeGreaterThan(0);
    expect(mainSource.slice(start, start + 700)).toContain(
      'invalidateDreamingCatalog()',
    );
  });

  it('awaits coordinator close during guarded application shutdown', () => {
    expect(mainSource).toContain('event.preventDefault()');
    expect(mainSource).toContain('await idleDreamingCoordinator?.close()');
  });

  it('validates a required entity id at the manual IPC boundary', () => {
    const start = mainSource.indexOf("'TRIGGER_DREAMING_NOW'");
    const handler = mainSource.slice(start, start + 650);
    expect(handler).toContain('options: { entityId: string }');
    expect(handler).toContain("typeof options.entityId !== 'string'");
    expect(handler).not.toContain('force');
  });

  it('does not treat another serialized model request as a dreaming pause lock', () => {
    const coordinator = mainSource.indexOf('createIdleDreamingCoordinator({');
    const policy = mainSource.slice(coordinator, coordinator + 900);
    expect(policy).toContain("reason !== 'llm_active'");
    expect(policy).toContain('Number(count) > 0');

    const pauseListener = mainSource.indexOf(
      'configureKnowledgeSynthesisPause((paused) =>',
    );
    const listener = mainSource.slice(pauseListener, pauseListener + 500);
    expect(listener).toContain("reason !== 'llm_active'");
    expect(listener).toContain('notifyForegroundActivity()');
  });
});

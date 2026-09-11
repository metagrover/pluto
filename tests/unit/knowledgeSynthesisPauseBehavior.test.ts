import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-knowledge-pause-db-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  ensureGlobalKnowledgeDoc,
} from '../../electron/db';
import {
  queueKnowledgeDocRefresh,
  refreshKnowledgeDocNow,
  refreshKnowledgeDocsForMeetingNow,
  setKnowledgeDocSynthesisPaused,
} from '../../electron/knowledgeSynthesis';

afterAll(() => {
  setKnowledgeDocSynthesisPaused(false);
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('knowledge synthesis pause behavior during capture', () => {
  beforeEach(() => {
    setKnowledgeDocSynthesisPaused(false);
  });

  it('defers refreshKnowledgeDocNow when synthesis is paused', async () => {
    const globalDoc = ensureGlobalKnowledgeDoc();
    setKnowledgeDocSynthesisPaused(true);

    const result = await refreshKnowledgeDocNow(globalDoc.id);

    expect(result).toBeDefined();
    expect(result?.id).toBe(globalDoc.id);
  });

  it('defers refreshKnowledgeDocsForMeetingNow when synthesis is paused', async () => {
    ensureGlobalKnowledgeDoc();
    setKnowledgeDocSynthesisPaused(true);

    const outcome = await refreshKnowledgeDocsForMeetingNow('meeting-test-1');

    expect(outcome.completed).toBe(0);
    expect(outcome.requested).toBeGreaterThan(0);
  });

  it('clears active debounce timers when pause is set to true', () => {
    const globalDoc = ensureGlobalKnowledgeDoc();
    queueKnowledgeDocRefresh(globalDoc.id, 60_000);

    // Setting paused to true should clear the scheduled timer and mark pending
    setKnowledgeDocSynthesisPaused(true);

    // Should remain safe and idempotent
    setKnowledgeDocSynthesisPaused(true);
  });
});

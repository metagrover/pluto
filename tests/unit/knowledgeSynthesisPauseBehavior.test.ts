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
  getKnowledgeDoc,
  upsertKnowledgeDoc,
} from '../../electron/db';
import {
  configureKnowledgeDocBackgroundScheduler,
  initializeKnowledgeDocs,
  queueKnowledgeDocRefresh,
  refreshKnowledgeDocNow,
  refreshKnowledgeDocsForMeetingNow,
  setKnowledgeDocSynthesisPaused,
} from '../../electron/knowledgeSynthesis';
import {
  configureKnowledgeSynthesisPause,
  knowledgeSynthesisPause,
} from '../../electron/knowledgeSynthesisPause';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';

afterAll(() => {
  configureKnowledgeDocBackgroundScheduler(null);
  setKnowledgeDocSynthesisPaused(false);
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('knowledge synthesis pause behavior during capture', () => {
  beforeEach(() => {
    configureKnowledgeDocBackgroundScheduler(null);
    setKnowledgeDocSynthesisPaused(false);
  });

  it('defers refreshKnowledgeDocNow when synthesis is paused', async () => {
    const globalDoc = ensureGlobalKnowledgeDoc();
    setKnowledgeDocSynthesisPaused(true);

    const result = await refreshKnowledgeDocNow(globalDoc.id);

    expect(result).toBeDefined();
    expect(result?.id).toBe(globalDoc.id);
  });

  it('resumes a user-requested refresh without waiting for the idle background scheduler', async () => {
    vi.useFakeTimers();
    const scheduleInBackground = vi.fn();
    configureKnowledgeDocBackgroundScheduler(scheduleInBackground);
    const doc = upsertKnowledgeDoc({
      scope_type: 'person_context',
      scope_key: 'user-requested-person',
      title: 'Avery Chen',
      status: 'up_to_date',
    });
    try {
      setKnowledgeDocSynthesisPaused(true);
      const deferred = await refreshKnowledgeDocNow(doc.id, {
        userRequested: true,
      });
      expect(deferred?.status).toBe('stale');
      setKnowledgeDocSynthesisPaused(false);
      await vi.advanceTimersByTimeAsync(300);
      expect(scheduleInBackground).not.toHaveBeenCalledWith(doc.id);
      expect(getKnowledgeDoc(doc.id)?.status).toBe('up_to_date');
    } finally {
      configureKnowledgeDocBackgroundScheduler(null);
      setKnowledgeDocSynthesisPaused(false);
      vi.useRealTimers();
    }
  });

  it('defers refreshKnowledgeDocsForMeetingNow when synthesis is paused', async () => {
    ensureGlobalKnowledgeDoc();
    setKnowledgeDocSynthesisPaused(true);

    const outcome = await refreshKnowledgeDocsForMeetingNow('meeting-test-1');

    expect(outcome.completed).toBe(0);
    expect(outcome.requested).toBeGreaterThan(0);
  });

  it.each(['background', 'project_review', undefined] as const)(
    'respects %s scope review priority during the post-meeting refresh',
    async (workClass) => {
      const doc = ensureGlobalKnowledgeDoc();
      upsertKnowledgeDoc({ ...doc, status: 'stale' });
      configureKnowledgeDocBackgroundScheduler(() => {});
      configureKnowledgeSynthesisPause(setKnowledgeDocSynthesisPaused);
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: 'gemma4:12b',
      });
      let finish!: () => void;
      const pending = new Promise<string>((resolve) => {
        finish = () => resolve('{}');
      });
      const transport = provider as unknown as {
        generateWithOllama: () => Promise<string>;
      };
      const generate = vi
        .spyOn(transport, 'generateWithOllama')
        .mockImplementation(() => pending);
      const scope = provider.synthesizeKnowledgeDocument(
        'Review project scope',
        {
          purpose: 'projectScope',
          workClass,
        },
      );
      try {
        const background = workClass === 'background';
        expect(knowledgeSynthesisPause.snapshot()).toEqual(
          background ? {} : { llm_active: 1 },
        );
        const outcome =
          await refreshKnowledgeDocsForMeetingNow('meeting-test-1');
        expect(outcome.requested).toBeGreaterThan(0);
        expect(outcome.completed).toBe(background ? outcome.requested : 0);
        expect(getKnowledgeDoc(doc.id)?.status).toBe(
          background ? 'up_to_date' : 'stale',
        );
      } finally {
        finish();
        await scope;
        generate.mockRestore();
        configureKnowledgeSynthesisPause(() => {});
        setKnowledgeDocSynthesisPaused(false);
      }
      expect(knowledgeSynthesisPause.snapshot()).toEqual({});
    },
  );

  it('clears active debounce timers when pause is set to true', () => {
    const globalDoc = ensureGlobalKnowledgeDoc();
    queueKnowledgeDocRefresh(globalDoc.id, 60_000);

    // Setting paused to true should clear the scheduled timer and mark pending
    setKnowledgeDocSynthesisPaused(true);

    // Should remain safe and idempotent
    setKnowledgeDocSynthesisPaused(true);
  });

  it('routes queued refreshes through the configured background scheduler', () => {
    const globalDoc = ensureGlobalKnowledgeDoc();
    const scheduleInBackground = vi.fn();
    configureKnowledgeDocBackgroundScheduler(scheduleInBackground);

    queueKnowledgeDocRefresh(globalDoc.id);

    expect(scheduleInBackground).toHaveBeenCalledWith(globalDoc.id);
  });

  it('does not schedule startup discovery when queueing is disabled', async () => {
    ensureGlobalKnowledgeDoc();
    const scheduleInBackground = vi.fn();
    configureKnowledgeDocBackgroundScheduler(scheduleInBackground);

    await initializeKnowledgeDocs({ queue: false });

    expect(scheduleInBackground).not.toHaveBeenCalled();
  });
});

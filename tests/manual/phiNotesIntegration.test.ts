import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as ApplicationDatabase from '../../electron/database/applicationDatabase';
import type { packageEntityNotes as PackageEntityNotes } from '../../electron/dreaming/packageEntityNotes';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { createMeetingAnalysisRunCoordinator } from '../../electron/meetingAnalysisRuns';
import {
  GEMMA_NOTES_CONTROL_CONFIGURATION,
  PHI_NOTES_EXPERIMENT_CONFIGURATION,
} from '../../scripts/lib/local_intelligence_evaluation';
import { captureDryRunWire } from './fixtures/localIntelligenceDryTransport';

const profile = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      if (!profile.root) throw new Error('integration_profile_not_initialized');
      return profile.root;
    },
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

const enabled = process.env.RUN_PHI_NOTES_INTEGRATION === '1';
const dry = process.env.LOCAL_INTELLIGENCE_EVALUATION_DRY_RUN === '1';
const suite = enabled ? describe : describe.skip;
const candidate = PHI_NOTES_EXPERIMENT_CONFIGURATION;
let db: typeof import('../../electron/db');
let applicationDatabase: typeof ApplicationDatabase;
let packageEntityNotes: typeof PackageEntityNotes;

const loadDatabase = async () => {
  applicationDatabase = await import(
    '../../electron/database/applicationDatabase'
  );
  db = await import('../../electron/db');
  ({ packageEntityNotes } = await import(
    '../../electron/dreaming/packageEntityNotes'
  ));
};

beforeAll(async () => {
  if (!enabled) return;
  if (dry) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('integration_dry_run_network_forbidden');
    });
  }
  profile.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-phi-publication-')),
  );
  fs.chmodSync(profile.root, 0o700);
  await loadDatabase();
  const databases = applicationDatabase
    .getApplicationDatabase()
    .pragma('database_list') as Array<{
    name: string;
    file: string;
  }>;
  expect(databases.find(({ name }) => name === 'main')?.file).toBe(
    path.join(profile.root, 'pluto.db'),
  );
});

afterAll(() => {
  if (!profile.root) return;
  try {
    if (dry) expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    applicationDatabase?.closeApplicationDatabase();
    fs.rmSync(profile.root, { recursive: true, force: true });
    vi.restoreAllMocks();
  }
});

const seed = (
  id: string,
  text = 'The synthetic project remains in planning.',
) => {
  db.saveMeeting({
    id,
    title: 'Synthetic integration meeting',
    transcript_status: 'validated',
    finalization_status: 'finalized',
    transcript_json: JSON.stringify({ segments: [{ speaker: 7, text }] }),
    transcript_integrity_json: JSON.stringify({ trust: 'eligible' }),
    user_notes: '',
  });
};

const getMeeting = (id: string | number) =>
  db.getMeeting(id) as Parameters<typeof db.saveMeeting>[0];

const setup = () => {
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'gemma4:12b',
    ollama_fast_model: 'gemma4:12b',
    ollama_seed: 41,
    ollama_structured_thinking: false,
  });
  const onPublished = vi.fn();
  const coordinator = createMeetingAnalysisRunCoordinator({
    db: {
      ...db,
      getMeeting,
      getMeetingAnalysisPublicationRevisions: (meeting) =>
        db.getMeetingAnalysisPublicationRevisions(
          meeting as ReturnType<typeof getMeeting>,
        ),
    },
    getSettings: async () => ({
      llm_provider: 'ollama',
      ollama_model: 'gemma4:12b',
      ollama_seed: 41,
      ollama_structured_thinking: false,
    }),
    getProvider: async () => provider,
    notesDeadlineMs: 600_000,
    notesExperiment: {
      environment: 'disposable_integration',
      configId: candidate.configId,
      sourceFirstReconciliation: true,
      compactWriterContract: true,
      model: candidate.tag,
      digest: candidate.digest,
    },
    onPublished,
  });
  const generate = (meetingId: string, requestId = meetingId) =>
    coordinator.generateAndPublishMeetingNotes({
      meetingId,
      requestId,
      template: 'auto',
      reason: 'manual',
    });
  return { provider, coordinator, onPublished, generate };
};

suite('Phi notes provider to persisted publication', () => {
  it.runIf(dry)(
    'rejects an installed Phi digest mismatch before inference or publication',
    async () => {
      const id = 'phi-wrong-digest';
      seed(id);
      const { provider, generate, onPublished } = setup();
      await expect(
        captureDryRunWire(
          provider,
          { ...candidate, digest: '0'.repeat(64) },
          () => generate(id),
        ),
      ).rejects.toThrow('notes_source_first_model_digest_mismatch');
      expect(onPublished).not.toHaveBeenCalled();
      expect(getMeeting(id).analysis_json).toBeNull();
      expect(db.getMeetingAnalysisRun(id)?.notes_status).toBe('failed');
    },
  );

  it('publishes through the real pipeline and exposes current notes to the downstream package', async () => {
    const id = 'phi-published';
    seed(id);
    const { provider, generate, onPublished } = setup();
    if (dry) {
      const wire = await captureDryRunWire(provider, candidate, () =>
        generate(id),
      );
      expect(wire).toHaveLength(2);
      expect(wire.every(({ body }) => body.model === candidate.tag)).toBe(true);
      expect(wire[0].body.format).toHaveProperty('properties.facts');
      expect(wire[1].body.format).toHaveProperty('properties.dispositions');
      const chatWire = await captureDryRunWire(
        provider,
        GEMMA_NOTES_CONTROL_CONFIGURATION,
        () =>
          provider.answerAskPluto('Synthetic routing check.', { mode: 'fast' }),
      );
      expect(chatWire.length).toBeGreaterThan(0);
      expect(
        chatWire.every(
          ({ body }) => body.model === GEMMA_NOTES_CONTROL_CONFIGURATION.tag,
        ),
      ).toBe(true);
    } else {
      await generate(id);
    }
    expect(onPublished).toHaveBeenCalledTimes(1);
    expect(db.getMeetingAnalysisRun(id)?.notes_status).toBe('published');
    const meeting = getMeeting(id);
    const document = JSON.parse(meeting.analysis_json!);
    const source = createNotesSource(meeting.transcript_json!);
    expect(document.generation_metadata).toMatchObject({
      model: candidate.tag,
      pipeline_version: 'notes-v30-source-first',
      source_provenance: { source_revision: source.revision },
    });
    const project = db.upsertEntity({
      type: 'project',
      name: 'Synthetic integration',
      dedupe_by_name: false,
    });
    const unrelated = db.upsertEntity({
      type: 'project',
      name: 'Synthetic integration',
      dedupe_by_name: false,
    });
    db.addMeetingEntity({ meeting_id: id, entity_id: project.id });
    const packaged = packageEntityNotes(project.id);
    expect(
      packaged?.recentMeetingNotes.map(({ meetingId }) => meetingId),
    ).toEqual([id]);
    expect(packaged?.recentMeetingNotes[0].notesContent).toBe(
      meeting.enhanced_notes?.trim(),
    );
    expect(packageEntityNotes(unrelated.id)?.recentMeetingNotes).toEqual([]);
  }, 660_000);

  it.runIf(dry)(
    'recovers a persisted interrupted run after reopening SQLite and preserves prior notes',
    async () => {
      const id = 'phi-restart';
      seed(id);
      const initial = setup();
      await captureDryRunWire(initial.provider, candidate, () =>
        initial.generate(id),
      );
      const prior = getMeeting(id).analysis_json;
      const revisions = db.getMeetingAnalysisPublicationRevisions(
        getMeeting(id),
      );
      if (!revisions) throw new Error('integration_source_ineligible');
      db.beginMeetingAnalysisRun({
        meetingId: id,
        runId: 'interrupted',
        inputRevision: 'interrupted-fingerprint',
        reason: 'manual',
        ...revisions,
      });
      applicationDatabase.closeApplicationDatabase();
      vi.resetModules();
      await loadDatabase();
      db.recoverInterruptedMeetingAnalysisRuns();
      expect(db.getMeetingAnalysisRun(id)).toMatchObject({
        notes_status: 'failed',
        error_code: 'notes_interrupted',
      });
      expect(getMeeting(id).analysis_json).toBe(prior);
      const retry = setup();
      await captureDryRunWire(retry.provider, candidate, () =>
        retry.generate(id),
      );
      expect(retry.onPublished).toHaveBeenCalledTimes(1);
      expect(db.getMeetingAnalysisRun(id)?.notes_status).toBe('published');
    },
  );

  it
    .runIf(dry)
    .each(['source_edit', 'transport_failure', 'cancellation'] as const)(
    'preserves prior notes on %s and converges after retry',
    async (fault) => {
      const id = `phi-${fault}`;
      seed(id);
      const initial = setup();
      await captureDryRunWire(initial.provider, candidate, () =>
        initial.generate(id),
      );
      const prior = getMeeting(id).analysis_json;
      const run = setup();
      let injected = false;
      const attempt = captureDryRunWire(
        run.provider,
        candidate,
        () => run.generate(id),
        {
          beforeResponse: async ({ body }) => {
            if (
              injected ||
              !(body.format as { properties?: { dispositions?: unknown } })
                .properties?.dispositions
            )
              return;
            injected = true;
            if (fault === 'source_edit') {
              db.saveMeeting({
                ...getMeeting(id),
                transcript_json: JSON.stringify({
                  segments: [
                    {
                      speaker: 7,
                      text: 'The synthetic project has been cancelled.',
                    },
                  ],
                }),
              });
            } else if (fault === 'cancellation') {
              await run.coordinator.cancelMeetingNotes({
                meetingId: id,
                requestId: id,
              });
            } else {
              throw new Error('synthetic_transport_failure');
            }
          },
        },
      );
      await expect(attempt).rejects.toThrow();
      expect(injected).toBe(true);
      expect(run.onPublished).not.toHaveBeenCalled();
      expect(getMeeting(id).analysis_json).toBe(prior);
      expect(db.getMeetingAnalysisRun(id)?.notes_status).toBe(
        fault === 'cancellation' ? 'cancelled' : 'failed',
      );
      const retry = setup();
      await captureDryRunWire(retry.provider, candidate, () =>
        retry.generate(id, `${id}-retry`),
      );
      expect(retry.onPublished).toHaveBeenCalledTimes(1);
      expect(db.getMeetingAnalysisRun(id)?.notes_status).toBe('published');
      expect(
        JSON.parse(getMeeting(id).analysis_json!).generation_metadata
          .source_provenance.source_revision,
      ).toBe(createNotesSource(getMeeting(id).transcript_json!).revision);
    },
  );
});

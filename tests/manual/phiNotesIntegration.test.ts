import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as ApplicationDatabase from '../../electron/database/applicationDatabase';
import {
  createIdleDreamingCoordinator,
  generateDreamingWithProvider,
} from '../../electron/dreaming/idleDreamingCoordinator';
import type { packageEntityNotes as PackageEntityNotes } from '../../electron/dreaming/packageEntityNotes';
import type {
  RawDreamingOutput,
  RawDreamingProposal,
} from '../../electron/dreaming/types';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { createMeetingAnalysisRunCoordinator } from '../../electron/meetingAnalysisRuns';
import {
  GEMMA_NOTES_CONTROL_CONFIGURATION,
  PHI_NOTES_EXPERIMENT_CONFIGURATION,
} from '../../scripts/lib/local_intelligence_evaluation';
import { captureDryRunWire } from './fixtures/localIntelligenceDryTransport';
import {
  type DownstreamSource,
  phiDownstreamCases,
  scoreDownstreamFixture,
} from './fixtures/phiNotesDownstream';

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
  it.runIf(dry).each(['source_changed', 'foreground_preempted'] as const)(
    'cancels downstream %s before persistence and allows explicit retry',
    async (fault) => {
      const id = `downstream-${fault}`;
      seed(id);
      const notes = setup();
      await captureDryRunWire(notes.provider, candidate, () =>
        notes.generate(id),
      );
      const project = db.upsertEntity({
        type: 'project',
        name: id,
        dedupe_by_name: false,
      });
      db.addMeetingEntity({ meeting_id: id, entity_id: project.id });
      const { provider } = setup();
      const downstream = createIdleDreamingCoordinator({
        getPolicy: () => ({
          systemIdleSeconds: 600,
          onBattery: false,
          thermalState: 'nominal',
          paused: false,
        }),
        getNextDirtyEntityId: () => ({ entityId: project.id, type: 'project' }),
        getEntity: db.getEntity,
        packageNotes: packageEntityNotes,
        proposalStore: db.dreamingProposalStore,
        generate: (...args) => generateDreamingWithProvider(provider, ...args),
      });
      let status: string | undefined;
      await captureDryRunWire(
        provider,
        GEMMA_NOTES_CONTROL_CONFIGURATION,
        async () => {
          status = (await downstream.attemptIdleRun()).status;
        },
        {
          beforeResponse: () => {
            if (fault === 'source_changed') {
              db.saveMeeting({
                ...getMeeting(id),
                enhanced_notes:
                  'Updated synthetic notes. No action item is assigned.',
              });
            } else downstream.notifyForegroundActivity();
          },
          response: () => ({ status: 'no_change', proposals: [] }),
        },
      );
      expect(status).toBe('cancelled');
      expect(
        db.dreamingProposalStore
          .listRuns(project.id, 'project')
          .every((run) => run.status === 'cancelled'),
      ).toBe(true);
      expect(
        db.dreamingProposalStore.listPendingProposals(project.id, 'project'),
      ).toEqual([]);
      await captureDryRunWire(
        provider,
        GEMMA_NOTES_CONTROL_CONFIGURATION,
        async () => {
          status = (await downstream.triggerNow({ entityId: project.id }))
            .status;
        },
        { response: () => ({ status: 'no_change', proposals: [] }) },
      );
      expect(status).toBe('no_change');
      expect(
        db.dreamingProposalStore.listPendingProposals(project.id, 'project'),
      ).toEqual([]);
    },
  );

  it.runIf(dry).each(phiDownstreamCases)(
    'persists and adjudicates downstream $id against original sources',
    async (fixture) => {
      const project = db.upsertEntity({
        type: 'project',
        name: `Atlas ${fixture.id}`,
        dedupe_by_name: false,
      });
      const unrelated = db.upsertEntity({
        type: 'project',
        name: `Atlas ${fixture.id}`,
        dedupe_by_name: false,
      });
      const sources = new Map<string, DownstreamSource>();
      for (const [index, text] of [
        fixture.earlier,
        fixture.current,
      ].entries()) {
        const id = `downstream-${fixture.id}-${index}`;
        seed(id, text);
        db.saveMeeting({
          ...getMeeting(id),
          started_at: `2026-09-0${index + 1}T12:00:00.000Z`,
        });
        const notes = setup();
        await captureDryRunWire(notes.provider, candidate, () =>
          notes.generate(id),
        );
        db.addMeetingEntity({ meeting_id: id, entity_id: project.id });
        const meeting = getMeeting(id);
        sources.set(id, {
          transcript: meeting.transcript_json!,
          analysis: JSON.parse(meeting.analysis_json!),
        });
      }
      const currentId = `downstream-${fixture.id}-1`;
      const output: RawDreamingOutput =
        fixture.expectedTask === null
          ? { status: 'no_change', proposals: [] }
          : {
              status: 'proposed',
              proposals: [
                {
                  kind: 'project_commitment',
                  payload: { task: fixture.expectedTask },
                  evidence: [
                    { meetingId: currentId, excerpt: fixture.expectedTask },
                  ],
                },
              ],
            };
      const { provider } = setup();
      const downstream = createIdleDreamingCoordinator({
        getPolicy: () => ({
          systemIdleSeconds: 600,
          onBattery: false,
          thermalState: 'nominal',
          paused: false,
        }),
        getNextDirtyEntityId: () => ({ entityId: project.id, type: 'project' }),
        getEntity: db.getEntity,
        packageNotes: packageEntityNotes,
        proposalStore: db.dreamingProposalStore,
        generate: (...args) => generateDreamingWithProvider(provider, ...args),
      });
      let result: Awaited<ReturnType<typeof downstream.triggerNow>> | undefined;
      const wire = await captureDryRunWire(
        provider,
        GEMMA_NOTES_CONTROL_CONFIGURATION,
        async () => {
          result = await downstream.triggerNow({ entityId: project.id });
        },
        { response: () => output },
      );
      expect(result, JSON.stringify(result)).toMatchObject({
        status: output.status,
      });
      expect(wire).toHaveLength(1);
      expect(wire[0].body.model).toBe(GEMMA_NOTES_CONTROL_CONFIGURATION.tag);
      const proposals = db.dreamingProposalStore.listPendingProposals(
        project.id,
        'project',
      );
      expect(
        scoreDownstreamFixture(proposals, fixture.expectedTask, sources),
      ).toEqual({ passed: true, errors: [] });
      expect(
        db.dreamingProposalStore.listRuns(project.id, 'project'),
      ).toHaveLength(1);
      expect(
        db.dreamingProposalStore.listPendingProposals(unrelated.id, 'project'),
      ).toEqual([]);
      expect(packageEntityNotes(unrelated.id)?.recentMeetingNotes).toEqual([]);
      // Repeated scheduling must not duplicate persisted proposals or inference.
      expect(
        (await downstream.triggerNow({ entityId: project.id })).status,
      ).toBe('existing');
      expect(
        db.dreamingProposalStore.listPendingProposals(project.id, 'project'),
      ).toHaveLength(proposals.length);
      const wrong: RawDreamingProposal = {
        kind: 'project_commitment',
        payload: { task: fixture.forbiddenTask },
        evidence: [
          { meetingId: `downstream-${fixture.id}-0`, excerpt: fixture.earlier },
        ],
      };
      expect(
        scoreDownstreamFixture([wrong], fixture.expectedTask, sources).errors,
      ).toContain('current_commitment_mismatch');
      if (proposals.length) {
        expect(
          scoreDownstreamFixture([], fixture.expectedTask, sources).errors,
        ).toContain('proposal_count_mismatch');
        const staleSources = new Map(sources);
        const current = staleSources.get(currentId)!;
        staleSources.set(currentId, {
          ...current,
          transcript: JSON.stringify({
            segments: [{ speaker: 7, text: 'Changed original transcript.' }],
          }),
        });
        expect(
          scoreDownstreamFixture(proposals, fixture.expectedTask, staleSources)
            .errors,
        ).toContain('original_source_unresolved');
        expect(
          scoreDownstreamFixture(
            proposals.map((p) => ({
              ...p,
              evidence: [
                { meetingId: 'unrelated-meeting', excerpt: fixture.current },
              ],
            })),
            fixture.expectedTask,
            sources,
          ).errors,
        ).toContain('unrelated_meeting');
      }
    },
  );

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

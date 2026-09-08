import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  createApplicationDatabase,
  resolveApplicationDatabasePath,
  resolveMigrationsFolder,
} from '../../electron/database/applicationDatabase';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import {
  PHI_NOTES_EXPERIMENT_DIGEST,
  PHI_NOTES_EXPERIMENT_MODEL,
} from '../../electron/llm/meetingNotesTypes';
import { createMeetingAnalysisRunCoordinator } from '../../electron/meetingAnalysisRuns';
import { writeOwnerOnlyPrivateFile } from '../../scripts/lib/privateEvaluationFile';

const enabled = process.env.RUN_LOCAL_INTELLIGENCE_MIXED_WORKLOAD === '1';
const dryRun = process.env.LOCAL_INTELLIGENCE_EVALUATION_DRY_RUN === '1';
const drySuite = enabled && dryRun ? describe : describe.skip;
const temporaryRoots: string[] = [];

// A requested sustained run must not exit green with every test skipped.
if (enabled && !dryRun) {
  throw new Error(
    'mixed_workload_acceptance_not_implemented: use RUN_PHI_NOTES_INTEGRATION for the provider/publication smoke suite',
  );
}

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

export const mixedWorkloadScenarioInventory = {
  profile: 'disposable_integration',
  source: 'synthetic_only',
  notesConfiguration: 'phi-notes-source-first',
  unchangedWorkloadModels: true,
  downstream: [
    'correction',
    'withdrawal',
    'conditional_task',
    'same_name_unrelated_project',
    'legitimate_no_change',
    'legitimate_new_proposal',
  ],
  sustained: [
    'transcription_control_30m',
    'mixed_workload_30m',
    'cached_navigation',
    'ask_pluto_burst',
    'new_recording_during_dreaming',
    'notes_convergence_after_foreground',
  ],
  recovery: [
    'source_edit_during_generation',
    'runtime_crash',
    'app_restart_after_persisted_start',
    'sleep_wake',
    'user_cancellation',
    'repeated_preemption',
  ],
} as const;

drySuite('local intelligence disposable mixed-workload entry', () => {
  it('creates an isolated profile, database, and settings boundary', () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-phi-notes-integration-'),
    );
    temporaryRoots.push(root);
    const userDataPath = path.join(root, 'user-data');
    const databasePath = resolveApplicationDatabasePath({ userDataPath });
    const settingsPath = path.join(userDataPath, 'settings.private.json');
    expect(path.isAbsolute(userDataPath)).toBe(true);
    expect(path.isAbsolute(databasePath)).toBe(true);
    expect(databasePath.startsWith(root)).toBe(true);
    expect(databasePath).not.toBe(
      resolveApplicationDatabasePath({
        userDataPath: path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'Pluto',
        ),
      }),
    );

    const database = createApplicationDatabase({
      databasePath,
      migrationsFolder: resolveMigrationsFolder({
        isPackaged: false,
        appRoot: process.cwd(),
        resourcesPath: process.cwd(),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const connection = database.initialize();
    expect(
      connection
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'",
        )
        .get(),
    ).toMatchObject({ count: expect.any(Number) });
    writeOwnerOnlyPrivateFile(
      settingsPath,
      `${JSON.stringify({
        profile: 'disposable_integration',
        llm_provider: 'ollama',
        ollama_model: 'gemma4:12b',
        notesExperiment: 'phi-notes-source-first',
      })}\n`,
    );
    expect(fs.statSync(settingsPath).mode & 0o777).toBe(0o600);
    database.close();
  });

  it('validates candidate activation and the complete scenario inventory without inference', async () => {
    const getSettings = vi.fn();
    const getProvider = vi.fn();
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: vi.fn(),
        getMeetingAnalysisPublicationRevisions: vi.fn(),
        getMeetingAnalysisRun: vi.fn(),
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn(),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn(),
        isMeetingAnalysisRunCurrent: vi.fn(),
        publishMeetingNotesIfCurrent: vi.fn(),
        getAllEntities: vi.fn(() => []),
      },
      getSettings,
      getProvider,
      notesExperiment: {
        environment: 'disposable_integration',
        configId: 'phi-notes-source-first',
        sourceFirstReconciliation: true,
        compactWriterContract: true,
        model: PHI_NOTES_EXPERIMENT_MODEL,
        digest: PHI_NOTES_EXPERIMENT_DIGEST,
      },
    });

    await expect(
      coordinator.precomputeIncrementalMeetingNotes({
        source: createNotesSource(
          JSON.stringify({
            segments: [
              { speaker: 'Synthetic', text: 'No inference in dry mode.' },
            ],
          }),
        ),
        userNotes: '',
        template: 'auto',
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('discarded');
    expect(getSettings).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
    expect(mixedWorkloadScenarioInventory.downstream).toHaveLength(6);
    expect(mixedWorkloadScenarioInventory.sustained).toHaveLength(6);
    expect(mixedWorkloadScenarioInventory.recovery).toHaveLength(6);
  });
});

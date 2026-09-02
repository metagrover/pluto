import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-idle-dreaming-e2e-${process.pid}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
import { createIdleDreamingCoordinator } from '../../electron/dreaming/idleDreamingCoordinator';
import { packageEntityNotes } from '../../electron/dreaming/packageEntityNotes';
import { reconcileDreamingOutput } from '../../electron/dreaming/reconcileDreamingOutput';
import { validateProjectDreamingOutput } from '../../electron/dreaming/validateDreamingOutput';

afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

describe('Idle Dreaming End-to-End Engine', () => {
  it('consolidates meeting notes, stages alias suggestions, respects negative constraints, and preempts instantly', async () => {
    // 1. Create project entity
    const project = db.upsertEntity({
      type: 'project',
      name: 'Mobile App Redesign',
    });

    // 2. Create meeting with enhanced_notes linked to project
    const meetingId = 'meeting-e2e-1';
    db.saveMeeting({
      id: meetingId,
      title: 'Mobile App Sync',
      folder: 'Work',
      date: '2026-08-30',
      duration: 1800,
      enhanced_notes:
        'Discussed finishing offline caching and launching beta on iOS.',
    });
    db.addMeetingEntity({
      meeting_id: meetingId,
      entity_id: project.id,
      context: 'Mobile App Sync',
    });

    // 3. Mock model response
    const modelResponse = JSON.stringify({
      status: 'updated',
      dossier_summary:
        'Mobile app redesign aiming for offline caching and iOS beta.',
      milestones: [
        {
          name: 'iOS Offline Caching Implemented',
          status: 'completed',
          source_meeting_id: meetingId,
          evidence_snippet: 'finishing offline caching',
        },
      ],
      suggested_aliases: ['iOS Mobile App'],
    });

    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => ({
        systemIdleSeconds: 600,
        onBattery: false,
        thermalState: 'nominal',
        paused: false,
      }),
      getNextDirtyEntityId: () => ({ entityId: project.id, type: 'project' }),
      packageNotes: (entityId) => packageEntityNotes(entityId),
      generate: async (_prompt, _schema, signal) => {
        signal.throwIfAborted();
        return modelResponse;
      },
      reconcile: async (entityId, type, output) => {
        await reconcileDreamingOutput(entityId, type, output, {
          getEntity: db.getEntity,
          upsertEntity: db.upsertEntity,
          saveAliasSuggestion: db.saveEntityAliasSuggestion,
          isItemDismissed: db.isItemDismissed,
        });
      },
    });

    // 4. Run dreaming via manual trigger
    const runResult = await coordinator.triggerNow({ entityId: project.id, force: true });
    expect(runResult.status).toBe('completed');

    // 5. Verify milestone was reconciled into project metadata
    const updatedProject = db.getEntity(project.id);
    const metadata = JSON.parse(updatedProject?.metadata || '{}');
    expect(metadata.dossierSummary).toBe('Mobile app redesign aiming for offline caching and iOS beta.');
    expect(metadata.projectMilestones).toHaveLength(1);
    expect(metadata.projectMilestones[0].title).toBe('iOS Offline Caching Implemented');

    // 6. Verify alias suggestion was staged
    const aliases = db.getEntityAliasSuggestions(project.id);
    expect(aliases).toHaveLength(1);
    expect(aliases[0].suggested_name).toBe('iOS Mobile App');

    // 7. User removes milestone / reports inaccurate -> negative constraint recorded
    db.recordEntityCorrection({
      entityId: project.id,
      itemType: 'milestone',
      fingerprint: 'iOS Offline Caching Implemented',
      reason: 'removed_by_user',
    });

    // Clear project milestones from metadata simulating user deletion
    db.upsertEntity({
      ...project,
      metadata: { ...metadata, projectMilestones: [] },
    });

    // 8. Run dreaming again with same proposal: validator must filter out the dismissed milestone
    await coordinator.triggerNow({ entityId: project.id, force: true });
    const recheckedProject = db.getEntity(project.id);
    const recheckedMetadata = JSON.parse(recheckedProject?.metadata || '{}');
    // It should not have been re-added!
    expect(recheckedMetadata.projectMilestones).toHaveLength(0);

    // 9. Instant Preemption test: when user becomes active, running dream must abort immediately
    let abortedImmediately = false;
    const hangingCoordinator = createIdleDreamingCoordinator({
      getPolicy: () => ({
        systemIdleSeconds: 600,
        onBattery: false,
        thermalState: 'nominal',
        paused: false,
      }),
      getNextDirtyEntityId: () => ({ entityId: project.id, type: 'project' }),
      packageNotes: (entityId) => packageEntityNotes(entityId),
      generate: async (_prompt, _schema, signal) => {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            abortedImmediately = true;
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      },
      reconcile: async () => {},
    });

    const pendingPromise = hangingCoordinator.triggerNow({ entityId: project.id, force: true });
    // User moves mouse / foreground activity happens
    hangingCoordinator.notifyForegroundActivity();

    const pendingResult = await pendingPromise;
    expect(pendingResult.status).toBe('aborted');
    expect(abortedImmediately).toBe(true);
  });
});

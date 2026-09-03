import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-idle-dreaming-e2e-${process.pid}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
import { createIdleDreamingCoordinator } from '../../electron/dreaming/idleDreamingCoordinator';
import { packageEntityNotes } from '../../electron/dreaming/packageEntityNotes';

afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

describe('Idle Dreaming End-to-End Engine', () => {
  it('validates proposals without canonical mutation, respects corrections, and preempts instantly', async () => {
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
      status: 'proposed',
      proposals: [
        {
          kind: 'project_milestone',
          payload: {
            name: 'iOS Offline Caching Implemented',
            status: 'completed',
          },
          evidence: [{ meetingId, excerpt: 'finishing offline caching' }],
        },
      ],
    });

    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => ({
        systemIdleSeconds: 600,
        onBattery: false,
        thermalState: 'nominal',
        paused: false,
      }),
      getNextDirtyEntityId: () => ({ entityId: project.id, type: 'project' }),
      getEntity: (entityId) => db.getEntity(entityId),
      packageNotes: (entityId) => packageEntityNotes(entityId),
      generate: async (_prompt, _schema, signal) => {
        signal.throwIfAborted();
        return modelResponse;
      },
    });

    // 4. Run dreaming via manual trigger
    const runResult = await coordinator.triggerNow({
      entityId: project.id,
    });
    expect(runResult.status).toBe('proposed');

    // 5. Verify generation did not mutate the canonical project
    const updatedProject = db.getEntity(project.id);
    const metadata = JSON.parse(updatedProject?.metadata || '{}');
    expect(metadata.projectMilestones).toBeUndefined();
    expect(db.getEntityAliasSuggestions(project.id)).toEqual([]);

    // 7. User removes milestone / reports inaccurate -> negative constraint recorded
    db.recordEntityCorrection({
      entityId: project.id,
      itemType: 'milestone',
      fingerprint: 'iOS Offline Caching Implemented',
      reason: 'removed_by_user',
    });

    // 8. The same corrected proposal fails the whole validation boundary.
    expect(
      await coordinator.triggerNow({ entityId: project.id }),
    ).toMatchObject({ status: 'failed', errorCode: 'proposal_corrected' });

    // 9. Automatic work still preempts instantly when foreground activity resumes.
    let abortedImmediately = false;
    const hangingCoordinator = createIdleDreamingCoordinator({
      getPolicy: () => ({
        systemIdleSeconds: 600,
        onBattery: false,
        thermalState: 'nominal',
        paused: false,
      }),
      getNextDirtyEntityId: () => ({ entityId: project.id, type: 'project' }),
      getEntity: (entityId) => db.getEntity(entityId),
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
    });

    const pendingPromise = hangingCoordinator.attemptIdleRun();
    // User moves mouse / foreground activity happens
    hangingCoordinator.notifyForegroundActivity();

    const pendingResult = await pendingPromise;
    expect(pendingResult.status).toBe('cancelled');
    expect(abortedImmediately).toBe(true);
  });
});

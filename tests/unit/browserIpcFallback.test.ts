import { describe, expect, it } from 'vitest';

import { createBrowserIpcFallback } from '../../src/utils/browserIpcFallback';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

describe('browser IPC capture journal fallback', () => {
  it('provides a realistic connected calendar for dashboard previews', async () => {
    const ipc = createBrowserIpcFallback();

    await expect(ipc.invoke('CALENDAR_GET_STATE')).resolves.toMatchObject({
      state: 'ready',
      enabled: true,
      selectedCalendar: { title: 'Work' },
    });
    await expect(
      ipc.invoke('CALENDAR_LIST_DAY', {
        start: new Date().toISOString(),
        end: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).resolves.toMatchObject([
      { title: 'Product design review', calendarIdentifier: 'preview-work' },
      { title: 'Weekly team sync', calendarIdentifier: 'preview-work' },
      { title: 'Customer research', calendarIdentifier: 'preview-work' },
    ]);
  });

  it('reports Parakeet final transcription setup as ready', async () => {
    const ipc = createBrowserIpcFallback();

    await expect(ipc.invoke('RECORDING_READINESS_STATUS')).resolves.toEqual({
      details: {
        parakeetClient: true,
        parakeetModel: true,
        parakeetEouReady: true,
        audiocapExists: true,
        audiocapExecutable: true,
      },
    });
    await expect(ipc.invoke('TRANSCRIPTION_PREPARE_FINAL')).resolves.toEqual({
      ready: true,
      engine: 'parakeet_coreml',
    });
    await expect(ipc.invoke('CHECK_SYSTEM_AUDIO_PERMISSION')).resolves.toBe(
      'granted',
    );
  });

  it('provides a source-disclosed person dossier for browser previews', async () => {
    const ipc = createBrowserIpcFallback();

    await expect(
      ipc.invoke('GET_PERSON_BRIEFING', 'preview-avery'),
    ).resolves.toMatchObject({
      person: { id: 'preview-avery', name: 'Avery Chen' },
      meetings: [
        { title: 'Product review', evidence: 'confirmed' },
        { title: 'Launch handoff', evidence: 'confirmed' },
        { title: 'Roadmap planning', evidence: 'mentioned' },
      ],
      commitments: {
        open: [{ text: 'Send the final launch review' }],
        delivered: [{ text: 'Shared the prototype walkthrough' }],
      },
      knowledgeDoc: {
        scope_type: 'person_context',
        status: 'up_to_date',
      },
    });
    await expect(ipc.invoke('SEARCH_ENTITIES', 'Avery')).resolves.toMatchObject(
      [{ id: 'preview-avery', type: 'person' }],
    );
  });

  it('provides bounded People summaries and identity actions for browser previews', async () => {
    const ipc = createBrowserIpcFallback();

    await expect(ipc.invoke('GET_PROJECT_PORTFOLIO')).resolves.toEqual([]);
    await expect(
      ipc.invoke('GET_PEOPLE_BRIEFING_SUMMARIES'),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'preview-avery',
          name: 'Avery Chen',
          meetingCount: 1,
          openCommitmentCount: 1,
          possibleDuplicateCount: 0,
        }),
      ]),
    );
    await expect(
      ipc.invoke('UPDATE_PERSON_NAME', {
        personId: 'preview-avery',
        name: 'Avery C.',
      }),
    ).resolves.toMatchObject({ id: 'preview-avery', name: 'Avery C.' });
    await expect(
      ipc.invoke('MERGE_PERSON', {
        canonicalId: 'preview-avery',
        duplicateId: 'preview-maya',
      }),
    ).resolves.toBeUndefined();
    await expect(
      ipc.invoke('RESTORE_PERSON_MERGE', 'preview-maya'),
    ).resolves.toBeUndefined();
  });

  it('returns the exact latest activity evidence when sealing a started journal', async () => {
    const ipc = createBrowserIpcFallback();
    const activityEvidence = await buildCaptureActivityEvidence(
      [{ startTime: 1, endTime: 2, speaker: 'Me' }],
      {
        clock: {
          kind: 'meeting_relative_seconds',
          origin: 'recording_start',
        },
        thresholds: {
          rms: 0.01,
          dominanceRatio: 1.5,
          minimumSwitchIntervalMs: 250,
        },
        algorithmVersion: 'speaker_activity_v1',
      },
    );

    const started = await ipc.invoke<{
      schemaVersion: number;
      revision: number;
      supported: boolean;
    }>('AUDIO_CAPTURE_JOURNAL_START', {
      meetingId: 'preview-meeting',
      startedAtMs: 1_000,
    });
    expect(started).toMatchObject({
      schemaVersion: 3,
      revision: 0,
      supported: false,
    });
    await expect(
      ipc.invoke('AUDIO_CAPTURE_JOURNAL_INTERVAL_AUTHORIZE', {
        meetingId: 'preview-meeting',
      }),
    ).resolves.toMatchObject({
      supported: false,
      reason: 'electron_capture_journal_required',
    });
    await ipc.invoke('AUDIO_CAPTURE_JOURNAL_ACTIVITY_UPDATE', {
      meetingId: 'preview-meeting',
      activityEvidence,
    });
    const sealed = await ipc.invoke<{
      activityEvidence: typeof activityEvidence;
    }>('AUDIO_CAPTURE_JOURNAL_SEAL', {
      meetingId: 'preview-meeting',
      endedAtMs: 2_000,
    });

    expect(sealed.activityEvidence).toBe(activityEvidence);
    await expect(
      ipc.invoke('AUDIO_CAPTURE_JOURNAL_SEAL', {
        meetingId: 'preview-meeting',
        endedAtMs: 2_000,
      }),
    ).resolves.toBeNull();
  });
});

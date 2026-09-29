import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserIpcFallback,
  installBrowserIpcFallback,
} from '../../src/utils/browserIpcFallback';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

describe('browser IPC capture journal fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('still provides preview data in a real browser', () => {
    const browserWindow: Record<string, unknown> = { location: { search: '' } };
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Chrome/140.0.0.0',
      platform: 'MacIntel',
    });
    installBrowserIpcFallback();
    expect(browserWindow.__PLUTO_BROWSER_PREVIEW__).toBe(true);
    expect(browserWindow.ipcRenderer).toBeDefined();
  });

  it('does not show preview data when the Electron preload bridge is missing', () => {
    const desktopWindow = {};
    vi.stubGlobal('window', desktopWindow);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Electron/40.8.0',
      platform: 'MacIntel',
    });
    expect(() => installBrowserIpcFallback()).toThrow('preload did not load');
    expect(desktopWindow).not.toHaveProperty('ipcRenderer');
    expect(desktopWindow).not.toHaveProperty('__PLUTO_BROWSER_PREVIEW__');
  });

  it('keeps the real desktop bridge when it is available', () => {
    const bridge = { invoke: vi.fn() };
    const desktopWindow = {
      ipcRenderer: bridge,
      plutoRuntimePlatform: { platform: 'darwin', arch: 'arm64' },
    };
    vi.stubGlobal('window', desktopWindow);
    vi.stubGlobal('navigator', { userAgent: 'Electron/40.8.0' });
    installBrowserIpcFallback();
    expect(desktopWindow.ipcRenderer).toBe(bridge);
    expect(desktopWindow).not.toHaveProperty('__PLUTO_BROWSER_PREVIEW__');
  });

  it('keeps preview meeting lists summary-only and detail explicit', async () => {
    vi.stubGlobal('window', { location: { search: '?preview=meeting' } });
    const ipc = createBrowserIpcFallback();

    const summaries = (await ipc.invoke('GET_MEETINGS')) as Array<
      Record<string, unknown>
    >;
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0]).not.toHaveProperty('transcript_json');
    expect(summaries[0]).not.toHaveProperty('analysis_json');

    await expect(
      ipc.invoke('GET_MEETING', 'preview-pricing-review'),
    ).resolves.toMatchObject({
      id: 'preview-pricing-review',
      transcript_json: expect.any(String),
      analysis_json: expect.any(String),
    });
    await expect(
      ipc.invoke('GET_MEETING_STATUS', 'preview-pricing-review'),
    ).resolves.toMatchObject({
      id: 'preview-pricing-review',
      transcript_status: 'validated',
    });
    await expect(
      ipc.invoke('GET_MEETING_PROCESSING_STATUSES'),
    ).resolves.toEqual(expect.any(Array));
    await expect(ipc.invoke('GET_DASHBOARD_MEETING_PREVIEWS')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'preview-pricing-review',
          dashboard_detail: expect.any(String),
        }),
      ]),
    );
  });

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
      {
        title: 'Q4 Launch & Customer Pricing',
        calendarIdentifier: 'preview-work',
      },
      { title: 'Acme Corp Customer Sync', calendarIdentifier: 'preview-work' },
      { title: 'Simple Team Setup Review', calendarIdentifier: 'preview-work' },
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
      person: { id: 'preview-avery', name: 'Avery Taylor' },
      meetings: [
        { title: 'Q4 Launch & Customer Pricing', evidence: 'confirmed' },
      ],
      commitments: {
        open: [{ text: 'Finish testing the team invite steps' }],
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
    await expect(ipc.invoke('GET_PEOPLE_BRIEFING_SUMMARIES')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'preview-avery',
          name: 'Avery Taylor',
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
    await expect(
      ipc.invoke('intelligence:person-chat:capability'),
    ).resolves.toEqual({ enabled: true });
    await expect(
      ipc.invoke('intelligence:person-chat:list-threads', {
        personId: 'preview-avery',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          personId: 'preview-avery',
          title: 'What is Avery focused on?',
          archivedAt: null,
        }),
        expect.objectContaining({
          title: 'Launch handoff follow-ups',
          archivedAt: expect.any(String),
        }),
      ]),
    );
    await expect(
      ipc.invoke('intelligence:person-chat:list-messages', {
        personId: 'preview-avery',
        threadId: 'preview-person-chat-current',
      }),
    ).resolves.toEqual([]);
    await expect(
      ipc.invoke('GET_PENDING_DREAMING_PROPOSALS', {
        entityId: 'preview-avery',
        entityType: 'person',
      }),
    ).resolves.toEqual([]);
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

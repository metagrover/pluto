// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const runFinal = vi.hoisted(() => vi.fn());
const requestedRetry = vi.hoisted(() => ({
  kind: 'transcript' as 'transcript' | 'speaker_labels',
}));
vi.mock(
  '../../src/services/finalTranscription/runPersistedMeetingFinalTranscription',
  () => ({
    runPersistedMeetingFinalTranscription: runFinal,
  }),
);
vi.mock('../../src/components/AudioManager', () => ({
  AudioManager: () => null,
}));
vi.mock('../../src/components/features/Dashboard', () => ({
  Dashboard: ({
    setSelectedMeetingId,
  }: { setSelectedMeetingId: (id: string) => void }) => (
    <button type="button" onClick={() => setSelectedMeetingId('retry-meeting')}>
      Open retry meeting
    </button>
  ),
}));
vi.mock('../../src/components/features/MeetingView', () => ({
  MeetingView: ({
    onRetryTranscriptValidation,
    selectedMeeting,
  }: {
    selectedMeeting?: {
      transcript_status?: string;
      finalization_status?: string;
      transcript_integrity_json?: string;
    };
    onRetryTranscriptValidation: (
      kind: 'transcript' | 'speaker_labels',
    ) => void;
  }) => (
    <>
      <p data-testid="selected-transcript-state">
        {selectedMeeting?.transcript_status} /{' '}
        {selectedMeeting?.finalization_status} /{' '}
        {selectedMeeting?.transcript_integrity_json}
      </p>
      <button
        type="button"
        onClick={() => onRetryTranscriptValidation(requestedRetry.kind)}
      >
        Retry transcript
      </button>
    </>
  ),
}));

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
afterEach(() => {
  vi.clearAllMocks();
  requestedRetry.kind = 'transcript';
  window.__PLUTO_BROWSER_PREVIEW__ = undefined;
});

describe('App final transcription retry boundary', () => {
  it.each([false, true])(
    'refreshes the open meeting after asynchronous integrity rejection (detail IPC fails: %s)',
    async (detailRefreshFails) => {
      const refreshError = new Error('meeting detail IPC unavailable');
      const errors = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const meeting = {
        id: 'retry-meeting',
        title: 'Recording check',
        created_at: '2026-09-04T00:00:00Z',
        transcript_status: 'provisional',
        finalization_status: 'finalized',
        capture_journal_generation: 'generation-1',
        audio_path: '/fixture/mic.wav',
        system_audio_path: '/fixture/system.wav',
        mixed_audio_path: '/fixture/mix.wav',
        transcript_json: JSON.stringify({
          segments: [{ text: 'retained words', startTime: 0, endTime: 1 }],
        }),
        transcript_integrity_json: '{}',
      };
      let finishWorker!: () => void;
      let detailRefreshRejected = false;
      runFinal.mockImplementation(
        () =>
          new Promise((resolve) => {
            meeting.transcript_status = 'validating';
            finishWorker = () => {
              meeting.transcript_status = 'needs_attention';
              meeting.finalization_status = 'needs_attention';
              meeting.transcript_integrity_json = JSON.stringify({
                finalTranscription: {
                  state: 'needs_attention',
                  failure: 'integrity_rejected',
                },
              });
              resolve({ status: 'needs_attention' });
            };
          }),
      );
      window.__PLUTO_BROWSER_PREVIEW__ = false;
      Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: {
          invoke: vi.fn(async (channel: string, key?: string) => {
            if (channel === 'GET_SETTING')
              return key === 'setup_complete' ? 'true' : null;
            if (channel === 'GET_MEETINGS') return structuredClone([meeting]);
            if (channel === 'GET_MEETING') {
              if (
                detailRefreshFails &&
                !detailRefreshRejected &&
                meeting.transcript_status === 'needs_attention'
              ) {
                detailRefreshRejected = true;
                throw refreshError;
              }
              return structuredClone(meeting);
            }
            if (channel === 'CALENDAR_GET_STATE') return { enabled: false };
            if (channel === 'BOOT_PROBE_STATUS') return true;
            if (channel === 'DETECT_ACTIVE_CALL') return { active: false };
            if (channel === 'RECORDING_READINESS_STATUS')
              return {
                details: {
                  parakeetClient: true,
                  parakeetModel: true,
                  parakeetEouReady: true,
                  audiocapExists: true,
                  audiocapExecutable: true,
                },
              };
            return null;
          }),
          send: vi.fn(),
          on: vi.fn(() => () => undefined),
          off: vi.fn(),
        },
      });
      const { default: App } = await import('../../src/App');
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(<App />);
          await flush();
        });
        expect(runFinal).toHaveBeenCalledOnce();
        await act(async () => {
          Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent === 'Open retry meeting')
            ?.click();
          await flush();
        });
        const selectedState = () =>
          container.querySelector('[data-testid="selected-transcript-state"]')
            ?.textContent;
        expect(selectedState()).toContain('validating / finalized');
        await act(async () => {
          finishWorker();
          await flush();
        });
        if (detailRefreshFails) {
          expect(errors).toHaveBeenCalledExactlyOnceWith(
            '[Pluto] Failed to refresh final transcription state',
            refreshError,
          );
          expect(selectedState()).toContain('validating / finalized');
        } else {
          expect(selectedState()).toContain(
            'needs_attention / needs_attention',
          );
          expect(selectedState()).toContain('integrity_rejected');
          expect(errors).not.toHaveBeenCalled();
        }
        expect(meeting.transcript_status).toBe('needs_attention');
        expect(meeting.finalization_status).toBe('needs_attention');
        expect(meeting.transcript_integrity_json).toContain(
          'integrity_rejected',
        );
        expect(runFinal).toHaveBeenCalledOnce();
      } finally {
        await act(async () => root.unmount());
        container.remove();
        errors.mockRestore();
      }
    },
    15_000,
  );

  it.each([
    {
      reason: 'manual',
      retryKind: 'transcript' as const,
      manualRetry: true,
      rebuildSealedAudio: false,
      recovered: false,
      systemCaptureIncomplete: false,
    },
    {
      reason: 'manual incomplete system capture',
      retryKind: 'transcript' as const,
      manualRetry: true,
      rebuildSealedAudio: true,
      recovered: false,
      systemCaptureIncomplete: true,
    },
    {
      reason: 'speaker labels',
      retryKind: 'speaker_labels' as const,
      manualRetry: true,
      rebuildSealedAudio: true,
      recovered: false,
      systemCaptureIncomplete: false,
    },
    {
      reason: 'automatic',
      retryKind: 'transcript' as const,
      manualRetry: false,
      rebuildSealedAudio: false,
      recovered: false,
      systemCaptureIncomplete: false,
    },
    {
      reason: 'automatic recovered recording',
      retryKind: 'transcript' as const,
      manualRetry: false,
      rebuildSealedAudio: true,
      recovered: true,
      systemCaptureIncomplete: false,
    },
  ])(
    'forwards $reason admission to the persisted worker',
    async ({
      reason,
      retryKind,
      manualRetry,
      rebuildSealedAudio,
      recovered,
      systemCaptureIncomplete,
    }) => {
      requestedRetry.kind = retryKind;
      const meeting = {
        id: 'retry-meeting',
        title: recovered ? 'Recovered recording' : 'Retry meeting',
        created_at: '2026-09-04T00:00:00Z',
        transcript_status:
          reason === 'automatic' && !recovered
            ? 'provisional'
            : 'needs_attention',
        finalization_status: 'finalized',
        capture_journal_generation: 'generation-1',
        audio_path: '/fixture/mic.wav',
        system_audio_path: '/fixture/system.wav',
        mixed_audio_path: recovered ? null : '/fixture/mix.wav',
        transcript_json: JSON.stringify({
          segments: [{ text: 'retained words', startTime: 0, endTime: 1 }],
        }),
        transcript_integrity_json: JSON.stringify(
          recovered
            ? {
                causes: [{ code: 'recovered_awaiting_validation' }],
                recovery: {
                  source: 'capture_journal',
                  gapDetected: false,
                },
              }
            : systemCaptureIncomplete
              ? {
                  reasons: ['system_capture_incomplete'],
                  finalTranscription: {
                    policy: 'parakeet_final_v1',
                    state: 'needs_attention',
                  },
                }
              : {
                  finalTranscription: {
                    policy: 'parakeet_final_v1',
                    state: 'needs_attention',
                  },
                },
        ),
      };
      runFinal.mockImplementation(async () => {
        meeting.transcript_status = 'validating';
        return { status: 'superseded' };
      });
      window.__PLUTO_BROWSER_PREVIEW__ = false;
      Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: {
          invoke: vi.fn(async (channel: string, key?: string) => {
            if (channel === 'GET_SETTING')
              return key === 'setup_complete' ? 'true' : null;
            if (channel === 'GET_MEETINGS') return [meeting];
            if (channel === 'GET_MEETING') return meeting;
            if (channel === 'CALENDAR_GET_STATE') return { enabled: false };
            if (channel === 'BOOT_PROBE_STATUS') return true;
            if (channel === 'DETECT_ACTIVE_CALL') return { active: false };
            if (channel === 'RECORDING_READINESS_STATUS')
              return {
                details: {
                  parakeetClient: true,
                  parakeetModel: true,
                  parakeetEouReady: true,
                  audiocapExists: true,
                  audiocapExecutable: true,
                },
              };
            return null;
          }),
          send: vi.fn(),
          on: vi.fn(() => () => undefined),
          off: vi.fn(),
        },
      });
      const { default: App } = await import('../../src/App');
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(<App />);
          await flush();
        });
        if (manualRetry) {
          expect(runFinal).not.toHaveBeenCalled();
          await act(async () => {
            Array.from(container.querySelectorAll('button'))
              .find((button) => button.textContent === 'Open retry meeting')
              ?.click();
            await flush();
          });
          const retry = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent === 'Retry transcript',
          );
          expect(retry).toBeDefined();
          await act(async () => {
            retry?.click();
            await flush();
          });
        }
        expect(runFinal).toHaveBeenCalledOnce();
        expect(runFinal.mock.calls[0][2]).toMatchObject({
          manualRetry,
          rebuildSealedAudio,
          signal: expect.any(AbortSignal),
        });
      } finally {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      }
    },
  );
});

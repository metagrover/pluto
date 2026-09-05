// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const runFinal = vi.hoisted(() => vi.fn());
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
  }: { onRetryTranscriptValidation: (kind: 'transcript') => void }) => (
    <button
      type="button"
      onClick={() => onRetryTranscriptValidation('transcript')}
    >
      Retry transcript
    </button>
  ),
}));

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
afterEach(() => {
  vi.clearAllMocks();
  window.__PLUTO_BROWSER_PREVIEW__ = undefined;
});

describe('App final transcription retry boundary', () => {
  it.each(['manual', 'automatic'] as const)(
    'forwards %s admission to the persisted worker',
    async (reason) => {
      const meeting = {
        id: 'retry-meeting',
        title: 'Retry meeting',
        created_at: '2026-09-04T00:00:00Z',
        transcript_status:
          reason === 'manual' ? 'needs_attention' : 'provisional',
        finalization_status: 'finalized',
        capture_journal_generation: 'generation-1',
        audio_path: '/fixture/mic.wav',
        system_audio_path: '/fixture/system.wav',
        mixed_audio_path: '/fixture/mix.wav',
        transcript_json: JSON.stringify({
          segments: [{ text: 'retained words', startTime: 0, endTime: 1 }],
        }),
        transcript_integrity_json: JSON.stringify({
          finalTranscription: {
            policy: 'parakeet_final_v1',
            state: 'needs_attention',
          },
        }),
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
        if (reason === 'manual') {
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
          manualRetry: reason === 'manual',
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

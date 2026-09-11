// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const recordingState = vi.hoisted(() => ({
  triggerRecordingChange: null as null | ((recording: boolean) => void),
}));

vi.mock('../../src/components/RuntimeReadinessGate', () => ({
  RuntimeReadinessGate: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('../../src/components/AudioManager', () => ({
  AudioManager: ({
    onRecordingChange,
  }: {
    onRecordingChange?: (recording: boolean) => void;
  }) => {
    recordingState.triggerRecordingChange = onRecordingChange ?? null;
    return null;
  },
}));

vi.mock('../../src/components/features/Dashboard', () => ({
  Dashboard: () => null,
}));

vi.mock('../../src/components/features/MeetingView', () => ({
  MeetingView: () => null,
}));

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

afterEach(() => {
  vi.clearAllMocks();
  window.__PLUTO_BROWSER_PREVIEW__ = undefined;
});

describe('App automatic downstream processing during active recording', () => {
  it('suppresses automatic downstream notes generation while recording is active', async () => {
    const candidateMeeting = {
      id: 'candidate-meeting-1',
      title: 'Candidate',
      created_at: '2026-09-04T00:00:00Z',
      finalization_status: 'finalized',
      transcript_status: 'validated',
      transcript_validated_at: '2026-09-04T00:01:00Z',
      audio_path: '/path/mic.wav',
      transcript_json: JSON.stringify({
        segments: [{ text: 'Validated words', startTime: 0, endTime: 1 }],
      }),
      downstream_processing_json: JSON.stringify({ state: 'idle' }),
    };

    let currentMeetings: unknown[] = [];
    const invoke = vi.fn(async (channel: string, key?: string) => {
      if (channel === 'GET_SETTING')
        return key === 'setup_complete' ? 'true' : null;
      if (channel === 'GET_MEETINGS') return currentMeetings;
      if (channel === 'GET_MEETING') return candidateMeeting;
      if (channel === 'GET_MEETING_STATUS') return candidateMeeting;
      if (channel === 'CALENDAR_GET_STATE') return { enabled: false };
      if (channel === 'BOOT_PROBE_STATUS') return true;
      if (channel === 'DETECT_ACTIVE_CALL') return { active: false };
      if (channel === 'RECORDING_READINESS_STATUS')
        return {
          details: {
            parakeetClient: true,
            modelRootExists: true,
            audiocapBinaryExists: true,
          },
        };
      if (channel === 'GENERATE_MEETING_NOTES') {
        return {
          meetingId: candidateMeeting.id,
          runId: 'run-1',
          status: 'published',
        };
      }
      return {};
    });

    window.__PLUTO_BROWSER_PREVIEW__ = false;
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn(() => () => {}),
      },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const { default: App } = await import('../../src/App');

    // Mount and wait for setup check and initial load
    await act(async () => {
      root.render(<App />);
      await flush();
    });

    expect(recordingState.triggerRecordingChange).toBeTypeOf('function');

    // Start active recording
    await act(async () => {
      recordingState.triggerRecordingChange?.(true);
      await flush();
    });

    // An unsealed meeting is now saved in DB and notified via IPC
    currentMeetings = [candidateMeeting];
    const triggerIpcUpdated = (window.ipcRenderer.on as any).mock.calls.find(
      ([channel]: [string]) => channel === 'MEETING_NOTES_UPDATED',
    )?.[1];
    await act(async () => {
      triggerIpcUpdated?.({}, candidateMeeting.id);
      await flush();
    });

    // Verify GENERATE_MEETING_NOTES was NOT called while recording was active
    const notesCallsWhileRecording = invoke.mock.calls.filter(
      ([channel]) => channel === 'GENERATE_MEETING_NOTES',
    );
    expect(notesCallsWhileRecording.length).toBe(0);

    // Stop recording
    await act(async () => {
      recordingState.triggerRecordingChange?.(false);
      await flush();
    });

    // Now automatic downstream processing SHOULD be triggered
    const notesCallsAfterRecording = invoke.mock.calls.filter(
      ([channel]) => channel === 'GENERATE_MEETING_NOTES',
    );
    expect(notesCallsAfterRecording.length).toBe(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

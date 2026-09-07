// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../src/components/AudioManager', () => ({
  AudioManager: () => null,
}));
vi.mock('../../src/components/features/Dashboard', () => ({
  Dashboard: ({
    setSelectedMeetingId,
  }: { setSelectedMeetingId: (id: string) => void }) => (
    <button
      type="button"
      onClick={() => setSelectedMeetingId('updated-meeting')}
    >
      Open meeting
    </button>
  ),
}));
vi.mock('../../src/components/features/MeetingView', () => ({
  MeetingView: ({
    selectedMeeting,
  }: { selectedMeeting?: { title: string; enhanced_notes?: string } }) => (
    <p>
      {selectedMeeting?.title}: {selectedMeeting?.enhanced_notes}
    </p>
  ),
}));
const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

describe('App meeting status events', () => {
  it.each([true, false])(
    'consumes the Electron event separately from the optional meeting id (id supplied: %s)',
    async (hasMeetingId) => {
      const listeners = new Map<string, (...args: unknown[]) => void>();
      let published = false;
      const meeting = {
        id: 'updated-meeting',
        title: 'Meeting',
        created_at: '2026-09-04T00:00:00Z',
        transcript_status: 'validated',
        enhanced_notes: 'Original notes',
      };
      const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
        structuredClone(args); // Electron rejects event objects containing methods.
        if (channel === 'GET_SETTING')
          return args[0] === 'setup_complete' ? 'true' : null;
        if (channel === 'GET_MEETINGS') return [meeting];
        if (channel === 'GET_MEETING')
          return {
            ...meeting,
            enhanced_notes: published ? 'Published notes' : 'Original notes',
          };
        if (channel === 'GET_MEETING_STATUS')
          return {
            ...meeting,
            analysis_run_json: JSON.stringify({ notes_status: 'published' }),
          };
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
      });
      const errors = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      window.__PLUTO_BROWSER_PREVIEW__ = false;
      Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: {
          invoke,
          send: vi.fn(),
          off: vi.fn(),
          on: vi.fn(
            (channel: string, listener: (...args: unknown[]) => void) => {
              listeners.set(channel, listener);
              return () => listeners.delete(channel);
            },
          ),
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
        expect(
          invoke.mock.calls.some(([channel]) => channel === 'CALENDAR_REFRESH'),
        ).toBe(true);
        const open = Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === 'Open meeting',
        );
        expect(open).toBeDefined();
        await act(async () => {
          open?.click();
          await flush();
        });
        expect(container.textContent).toContain('Original notes');
        const listsBefore = invoke.mock.calls.filter(
          ([channel]) => channel === 'GET_MEETINGS',
        ).length;
        published = true;
        await act(async () => {
          listeners.get('MEETING_NOTES_UPDATED')?.(
            { sender: { send: () => undefined } },
            ...(hasMeetingId ? [meeting.id] : []),
          );
          await flush();
        });
        if (hasMeetingId) {
          expect(
            invoke.mock.calls.filter(
              ([channel]) => channel === 'GET_MEETING_STATUS',
            ),
          ).toEqual([['GET_MEETING_STATUS', meeting.id]]);
          expect(container.textContent).toContain('Published notes');
        } else {
          expect(
            invoke.mock.calls.filter(([channel]) => channel === 'GET_MEETINGS'),
          ).toHaveLength(listsBefore + 1);
          expect(
            invoke.mock.calls.some(
              ([channel]) => channel === 'GET_MEETING_STATUS',
            ),
          ).toBe(false);
        }
        expect(errors).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        container.remove();
        errors.mockRestore();
        window.__PLUTO_BROWSER_PREVIEW__ = undefined;
      }
    },
  );
});

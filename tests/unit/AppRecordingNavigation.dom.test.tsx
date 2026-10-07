// @vitest-environment happy-dom

import type React from 'react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../electron/calendar/types';
import type {
  CaptureHealthState,
  LiveTranscriptIntegrity,
  LiveTranscriptSegment,
} from '../../src/components/features/recordingWorkspaceModel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let recordingCompleted = false;
let holdRecordingStart = false;
let completePendingStart: (() => void) | null = null;
let completePendingStop: (() => void) | null = null;
let startAdmissionCount = 0;
let rejectCalendarStart = false;
let titleAtCalendarStart: string | null = null;
let notesAtCalendarStart: string | null = null;
let notesAtManualStart: string | null = null;
let calendarForTest: CalendarEvent | null = null;
let publishRecordingPreview: (() => void) | null = null;
const calendarListeners = new Map<string, (...args: unknown[]) => void>();

vi.mock('../../src/components/AudioManager', () => ({
  AudioManager: ({
    onStartSessionRef,
    onStopSessionRef,
    userTitle,
    userNotes,
    onRecordingStarted,
    onStartingChange,
    onRecordingChange,
    onProcessingChange,
    onFinalizationStarted,
    onSessionComplete,
    onCaptureHealthChange,
    onLiveTranscriptIntegrityChange,
    onCaptureLifecycleChange,
    onLiveTranscript,
    onInterimTranscript,
  }: {
    onStartSessionRef?: React.MutableRefObject<(() => void) | null>;
    userTitle?: string;
    userNotes?: string;
    onStopSessionRef?: React.MutableRefObject<(() => void) | null>;
    onRecordingStarted?: (startedAtMs: number) => void;
    onStartingChange?: (starting: boolean) => void;
    onRecordingChange?: (recording: boolean) => void;
    onProcessingChange?: (processing: boolean) => void;
    onFinalizationStarted?: (meeting: {
      id: string;
      title: string;
      startedAt: string;
      endedAt: string;
      durationSeconds: number;
      userNotes: string;
    }) => void;
    onSessionComplete?: (meetingId: string) => void | Promise<void>;
    onCaptureHealthChange?: (health: CaptureHealthState) => void;
    onLiveTranscriptIntegrityChange?: (state: LiveTranscriptIntegrity) => void;
    onLiveTranscript?: (segments: LiveTranscriptSegment[]) => void;
    onInterimTranscript?: (text: string) => void;
    onCaptureLifecycleChange?: (snapshot: {
      state: 'idle' | 'starting' | 'recording' | 'sealing';
    }) => void;
  }) => {
    publishRecordingPreview = () => {
      onRecordingStarted?.(Date.now() - 192_000);
      onLiveTranscript?.([
        {
          id: 'previous-recording-segment',
          speaker: 'Me',
          text: 'Speech from the previous recording.',
          timestampMs: 0,
          confirmed: true,
        },
      ]);
      onInterimTranscript?.('Previous unfinished speech');
      onCaptureHealthChange?.({
        microphone: 'warning',
        systemAudio: 'healthy',
        captureDurability: 'healthy',
      });
      onLiveTranscriptIntegrityChange?.('lagging');
    };
    useEffect(() => {
      if (onStartSessionRef) {
        onStartSessionRef.current = (event?: CalendarEvent) => {
          if (event) {
            titleAtCalendarStart = userTitle || null;
            notesAtCalendarStart = userNotes || null;
          } else notesAtManualStart = userNotes || null;
          startAdmissionCount += 1;
          if (event && rejectCalendarStart)
            return { admitted: false, state: 'idle' };
          onCaptureLifecycleChange?.({ state: 'starting' });
          onStartingChange?.(true);
          const complete = () => {
            onRecordingStarted?.(Date.now());
            onCaptureHealthChange?.({
              microphone: 'healthy',
              systemAudio: 'healthy',
              captureDurability: 'healthy',
            });
            onLiveTranscriptIntegrityChange?.('healthy');
            onProcessingChange?.(false);
            onRecordingChange?.(true);
            onStartingChange?.(false);
            onCaptureLifecycleChange?.({ state: 'recording' });
          };
          if (holdRecordingStart) completePendingStart = complete;
          else complete();
          return { admitted: true, state: 'recording' };
        };
      }
      if (onStopSessionRef) {
        onStopSessionRef.current = () => {
          onCaptureLifecycleChange?.({ state: 'sealing' });
          onRecordingChange?.(false);
          onProcessingChange?.(true);
          onFinalizationStarted?.({
            id: 'meeting-just-stopped',
            title: 'Just stopped meeting',
            startedAt: '2026-08-17T18:00:00.000Z',
            endedAt: '2026-08-17T18:03:12.000Z',
            durationSeconds: 192,
            userNotes: 'A note captured during the meeting.',
          });
          completePendingStop = () => {
            recordingCompleted = true;
            onCaptureLifecycleChange?.({ state: 'idle' });
            void onSessionComplete?.('meeting-just-stopped');
          };
        };
      }
      return () => {
        if (onStartSessionRef) onStartSessionRef.current = null;
        if (onStopSessionRef) onStopSessionRef.current = null;
      };
    }, [
      onStartSessionRef,
      onStopSessionRef,
      userTitle,
      userNotes,
      onRecordingStarted,
      onStartingChange,
      onRecordingChange,
      onProcessingChange,
      onFinalizationStarted,
      onSessionComplete,
      onCaptureHealthChange,
      onLiveTranscriptIntegrityChange,
      onCaptureLifecycleChange,
    ]);
    return null;
  },
}));

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const makeCalendarEvent = (): CalendarEvent =>
  ({
    occurrenceKey: 'calendar-launch',
    eventIdentifier: 'calendar-launch',
    calendarIdentifier: 'work',
    title: 'Customer launch review',
    start: new Date(Date.now() - 60_000).toISOString(),
    end: new Date(Date.now() + 30 * 60_000).toISOString(),
    isAllDay: false,
    isCancelled: false,
    availability: 'busy',
    organizer: { name: 'Alex', email: 'alex@example.com' },
    attendees: [],
    lastModified: null,
  }) as CalendarEvent;

describe('App recording navigation', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    recordingCompleted = false;
    holdRecordingStart = false;
    completePendingStart = null;
    completePendingStop = null;
    startAdmissionCount = 0;
    rejectCalendarStart = false;
    titleAtCalendarStart = null;
    notesAtCalendarStart = null;
    notesAtManualStart = null;
    window.localStorage.clear();
    calendarForTest = null;
    publishRecordingPreview = null;
    calendarListeners.clear();
    container = document.createElement('div');
    document.body.append(container);
    window.__PLUTO_BROWSER_PREVIEW__ = false;
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke: vi.fn(async (channel: string, key?: string) => {
          if (
            channel === 'CALENDAR_GET_STATE' ||
            channel === 'CALENDAR_REFRESH'
          )
            return calendarForTest
              ? { enabled: true, state: 'ready' }
              : { enabled: false };
          if (channel === 'CALENDAR_LIST_DAY')
            return calendarForTest ? [calendarForTest] : [];
          if (channel === 'MEETING_PREP_OPEN')
            return { notes: 'Ask about the launch checklist' };
          if (channel === 'GET_SETTING') {
            if (key === 'setup_complete') return 'true';
            if (key === 'theme') return 'system';
            if (key === 'auto_end_enabled') return 'false';
            if (key === 'llm_provider') return 'ollama';
            if (key === 'transcription_language') return '';
            return null;
          }
          if (channel === 'RECORDING_READINESS_STATUS') {
            return {
              details: {
                parakeetClient: true,
                parakeetModel: true,
                parakeetEouReady: true,
                audiocapExists: true,
                audiocapExecutable: true,
              },
            };
          }
          if (channel === 'GET_MEETING_ENTITIES') return [];
          if (channel === 'intelligence:alerts') return [];
          if (channel === 'intelligence:meeting-chat') {
            return {
              status: 'answered',
              answer: 'The team is reviewing launch pricing.',
              scope: {
                type: 'live_meeting',
                meetingId: 'active-recording',
                title: 'Meeting',
              },
              trustStatus: 'weak_evidence',
              claims: [],
              citations: [],
            };
          }
          if (channel === 'GET_MEETINGS') {
            return recordingCompleted
              ? [
                  {
                    id: 'meeting-just-stopped',
                    title: 'Just stopped meeting',
                    meeting_type: 'Recording',
                    created_at: '2026-08-17T18:00:00.000Z',
                    started_at: '2026-08-17T18:00:00.000Z',
                    duration_seconds: 34,
                    transcript_status: 'validating',
                    finalization_status: 'finalized',
                    user_notes: 'A note captured during the meeting.',
                    transcript_json: JSON.stringify({
                      lifecycleStatus: 'validating',
                      segments: [
                        {
                          speaker: '',
                          text: 'Visible as soon as recording stops.',
                          startTime: 0,
                          endTime: 2,
                        },
                      ],
                    }),
                  },
                ]
              : [];
          }
          if (channel === 'BOOT_PROBE_STATUS') return true;
          if (channel === 'DETECT_ACTIVE_CALL') return { active: false };
          return null;
        }),
        send: vi.fn(),
        on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
          calendarListeners.set(channel, listener);
          return () => calendarListeners.delete(channel);
        }),
        off: vi.fn(),
      },
    });
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    window.__PLUTO_BROWSER_PREVIEW__ = undefined;
  });

  it('commits the calendar heading and prep notes before starting the selected occurrence', async () => {
    calendarForTest = makeCalendarEvent();
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });
    const startFromCalendar = calendarListeners.get(
      'CALENDAR_PROMPT_START_RECORDING',
    );
    expect(startFromCalendar).toBeDefined();
    await act(async () => {
      await startFromCalendar?.(null, {
        occurrenceKey: calendarForTest!.occurrenceKey,
      });
      await flushPromises();
    });
    expect(titleAtCalendarStart).toBe('Customer launch review');
    expect(notesAtCalendarStart).toBe('Ask about the launch checklist');
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Edit meeting title: Customer launch review"]',
      )?.textContent,
    ).toBe('Customer launch review');
    expect(
      container.querySelector<HTMLTextAreaElement>('#recording-notes')?.value,
    ).toBe('Ask about the launch checklist');
    await act(async () => root.unmount());
  });

  it('restores the previous scratchpad after a calendar recording is rejected', async () => {
    calendarForTest = makeCalendarEvent();
    rejectCalendarStart = true;
    window.localStorage.setItem(
      'pluto.recording-scratchpad',
      'Unrelated draft',
    );
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });
    let startError: unknown;
    await act(async () => {
      try {
        await calendarListeners.get('CALENDAR_PROMPT_START_RECORDING')?.(null, {
          occurrenceKey: calendarForTest!.occurrenceKey,
        });
      } catch (error) {
        startError = error;
      }
      await flushPromises();
    });
    expect(startError).toBeInstanceOf(Error);
    expect(notesAtCalendarStart).toBe('Ask about the launch checklist');
    rejectCalendarStart = false;
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });
    expect(notesAtManualStart).toBe('Unrelated draft');
    await act(async () => root.unmount());
  });

  it.each(['Existing meeting note', ''])(
    'preserves existing meeting notes with value %j',
    async (existingNotes) => {
      calendarForTest = makeCalendarEvent();
      window.localStorage.setItem(
        'pluto.meeting-notes:calendar-launch',
        existingNotes,
      );
      const { default: App } = await import('../../src/App');
      const root = createRoot(container);
      await act(async () => {
        root.render(<App />);
        await flushPromises();
      });
      await act(async () => {
        await calendarListeners.get('CALENDAR_PROMPT_START_RECORDING')?.(null, {
          occurrenceKey: calendarForTest!.occurrenceKey,
        });
        await flushPromises();
      });
      expect(notesAtCalendarStart).toBe(existingNotes || null);
      expect(
        container.querySelector<HTMLTextAreaElement>('#recording-notes')?.value,
      ).toBe(existingNotes);
      await act(async () => root.unmount());
    },
  );

  it('returns to the active Zen meeting from the sidebar after going home', async () => {
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });
    expect(container.textContent).toContain('Dashboard');

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });
    expect(container.textContent).toContain('Back home');
    expect(container.textContent).toContain('Live transcript');
    expect(container.textContent).not.toContain('Active recording');

    const backHome = container.querySelector<HTMLButtonElement>(
      'button.recording-back-home',
    );
    expect(backHome).not.toBeNull();
    await act(async () => {
      backHome?.click();
      await flushPromises();
    });
    expect(container.textContent).toContain('Dashboard');
    const returnToRecording = Array.from(
      container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Return to recording'));
    expect(returnToRecording).not.toBeUndefined();

    await act(async () => {
      returnToRecording?.click();
      await flushPromises();
    });
    expect(container.textContent).toContain('Back home');
    expect(container.textContent).toContain('Live transcript');

    await act(async () => root.unmount());
  });

  it('preserves a minimized Ask Pluto dock when rejoining the same call', async () => {
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Ask about this meeting"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'What did I miss?');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      await flushPromises();
      input?.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();
    });

    const minimize = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Minimize Ask Pluto"]',
    );
    expect(minimize).not.toBeNull();
    await act(async () => {
      minimize?.click();
      await flushPromises();
      container
        .querySelector<HTMLButtonElement>('button.recording-back-home')
        ?.click();
      await flushPromises();
    });

    const returnToRecording = Array.from(
      container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Return to recording'));
    await act(async () => {
      returnToRecording?.click();
      await flushPromises();
    });

    expect(
      container.querySelector(
        'button[aria-label="Restore Ask Pluto conversation"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).not.toContain(
      'The team is reviewing launch pricing.',
    );

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Finish recording'))
        ?.click();
      await flushPromises();
      completePendingStop?.();
      await flushPromises();
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });

    expect(
      container.querySelector(
        'button[aria-label="Restore Ask Pluto conversation"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('textarea[aria-label="Ask about this meeting"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
  });

  it('clears the previous recording while the next capture is still starting', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_791_216_000_000);
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });
    await act(async () => {
      publishRecordingPreview?.();
      await flushPromises();
    });
    expect(
      container.querySelector('.recording-capture-bar time')?.textContent,
    ).toBe('03:12');
    expect(container.textContent).toContain(
      'Speech from the previous recording.',
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.recording-finish')?.click();
      await flushPromises();
      completePendingStop?.();
      await flushPromises();
    });
    holdRecordingStart = true;
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });

    expect(container.textContent).toContain('Starting recording');
    expect(
      container.querySelector('.recording-capture-bar time')?.textContent,
    ).toBe('00:00');
    expect(container.textContent).toContain('Preparing capture');
    expect(container.textContent).not.toContain(
      'Speech from the previous recording.',
    );
    expect(container.textContent).not.toContain('Previous unfinished speech');
    expect(container.querySelector('.recording-health--warning')).toBeNull();

    await act(async () => {
      completePendingStart?.();
      await flushPromises();
    });
    expect(container.textContent).toContain('Finish recording');
    expect(
      container.querySelector('.recording-capture-bar time')?.textContent,
    ).toBe('00:00');
    await act(async () => root.unmount());
  });

  it('shows a finite starting state before capture admission completes', async () => {
    holdRecordingStart = true;
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });

    expect(container.textContent).toContain('Starting recording');
    expect(container.textContent).toContain('Preparing capture');
    expect(container.textContent).not.toContain('Finish recording');

    await act(async () => {
      completePendingStart?.();
      await flushPromises();
    });
    expect(container.textContent).toContain('Finish recording');

    await act(async () => root.unmount());
  });

  it('opens a completed meeting on the note with Transcript secondary', async () => {
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });

    const finish = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Finish recording'),
    );
    expect(finish).not.toBeUndefined();

    await act(async () => {
      finish?.click();
      await flushPromises();
    });

    expect(container.textContent).toContain('Preparing your meeting');
    expect(container.textContent).toContain('Finishing meeting');
    expect(container.textContent).toContain(
      'Transcript and notes will appear here as they become ready.',
    );
    expect(container.textContent).toContain(
      'A note captured during the meeting.',
    );
    expect(container.textContent).not.toContain('Live transcript');
    expect(container.textContent).not.toContain('Finish recording');

    await act(async () => {
      completePendingStop?.();
      await flushPromises();
    });

    expect(container.textContent).toContain('Just stopped meeting');
    expect(container.textContent).toContain('New meeting');
    expect(container.textContent).not.toContain('Preparing meeting');
    expect(container.textContent).toContain('< 1 min');
    expect(container.textContent).not.toContain('0 min');
    expect(container.textContent).toContain(
      'A note captured during the meeting.',
    );
    expect(
      container
        .querySelector('[data-meeting-page]')
        ?.classList.contains('meeting-document--processing'),
    ).toBe(true);
    expect(
      container
        .querySelector('[data-meeting-artifact="user-notes"]')
        ?.classList.contains('meeting-pending-notes'),
    ).toBe(true);
    expect(
      container.querySelector('[data-meeting-artifact="analysis"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-meeting-artifact="transcript"]'),
    ).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-meeting-transcript-toggle]')
        ?.click();
      await flushPromises();
    });
    expect(
      container.querySelector('[data-meeting-artifact="analysis"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-meeting-artifact="transcript"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      'Visible as soon as recording stops.',
    );

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });
    expect(startAdmissionCount).toBe(2);

    await act(async () => root.unmount());
  });
});

// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingIdentityState } from '../../src/api/identity';
import { SpeakerIdentificationModal } from '../../src/components/features/SpeakerIdentificationModal';
import { emptyIdentityProfile } from '../../src/types/identity';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const people = [
  { id: 'person-aditya', name: 'Aditya Grover' },
  { id: 'person-jordan', name: 'Jordan Doe' },
  { id: 'person-alex', name: 'Alex Chen' },
];

const workspace = {
  selfPersonId: 'person-aditya',
  people,
  revision: 10,
  profile: {
    ...emptyIdentityProfile(),
    preferredName: 'Aditya Grover',
    aliases: ['Grover', 'Meta'],
  },
};

const meeting = (id = 'meeting-modal'): MeetingIdentityState => ({
  ...workspace,
  meetingId: id,
  speakers: ['Me', 'Remote Speaker 1', 'Remote Speaker 2'],
  bindings: [],
  capture: { origin: 'local', selfPersonId: 'person-aditya' },
  job: null,
});

describe('SpeakerIdentificationModal', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    invoke = vi.fn(
      async (
        channel: string,
        payload: { meetingId?: string; speaker?: string; selection?: unknown },
      ) => {
        if (channel === 'GET_IDENTITY_STATE') return workspace;
        if (channel === 'GET_MEETING_IDENTITY')
          return meeting(payload.meetingId);
        if (channel === 'SET_MEETING_IDENTITY_BINDING') {
          const next = meeting(payload.meetingId);
          next.bindings.push({
            speaker: payload.speaker!,
            source: 'user',
            personId:
              (payload.selection as { personId?: string })?.personId ?? null,
            individual: true,
          });
          return next;
        }
        return null;
      },
    );
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const click = async (text: string) => {
    const button = [...document.body.querySelectorAll('button')].find(
      (item) =>
        item.textContent?.trim() === text ||
        item.getAttribute('aria-label') === text,
    );
    expect(
      button,
      `Button with text/label "${text}" should exist`,
    ).toBeTruthy();
    await act(async () => button?.click());
  };

  it('renders nothing when isOpen is false', () => {
    act(() => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={false}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          attendeeNames={['Jordan Doe']}
          hasSystemAudio={true}
          speakerSummaries={{}}
        />,
      );
    });
    expect(document.body.querySelector('dialog, [role="dialog"]')).toBeNull();
  });

  it('renders modal with step indicator and skips workspace user from suggested chips', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          attendeeNames={['Aditya Grover', 'Grover', 'Jordan Doe']}
          hasSystemAudio={true}
          speakerSummaries={{
            'Remote Speaker 1': {
              turnCount: 3,
              excerpt: 'Blue notebook is on the desk.',
            },
            'Remote Speaker 2': {
              turnCount: 5,
              excerpt: 'I will send the report.',
            },
          }}
        />,
      );
    });

    const dialog = document.body.querySelector('dialog, [role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Identify Speakers');
    expect(dialog?.textContent).toContain('Speaker 1 of 2');
    expect(dialog?.textContent).toContain('Blue notebook is on the desk.');
    expect(dialog?.textContent).toContain('Jordan Doe');
    // Workspace self & nicknames must be excluded
    expect(dialog?.textContent).not.toContain('Aditya Grover ·');
    expect(dialog?.textContent).not.toContain('Grover ·');
  });

  it('1-click attendee chip auto-advances to next speaker and saves binding', async () => {
    const onDisplayNamesChange = vi.fn();
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          attendeeNames={['Jordan Doe']}
          hasSystemAudio={true}
          speakerSummaries={{
            'Remote Speaker 1': { turnCount: 3, excerpt: 'Quote 1' },
            'Remote Speaker 2': { turnCount: 5, excerpt: 'Quote 2' },
          }}
          onDisplayNamesChange={onDisplayNamesChange}
        />,
      );
    });

    expect(document.body.textContent).toContain('Speaker 1 of 2');
    await click('+ Jordan Doe');

    // Should have saved binding for Remote Speaker 1
    expect(invoke).toHaveBeenCalledWith(
      'SET_MEETING_IDENTITY_BINDING',
      expect.objectContaining({
        speaker: 'Remote Speaker 1',
        personId: 'person-jordan',
      }),
    );

    // Auto-advanced to Speaker 2 of 2
    expect(document.body.textContent).toContain('Speaker 2 of 2');
    expect(document.body.textContent).toContain('Quote 2');
  });

  it('supports Skip, Back, and Done in completion summary', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={onClose}
          meetingId="meeting-modal"
          attendeeNames={['Jordan Doe']}
          hasSystemAudio={true}
          speakerSummaries={{
            'Remote Speaker 1': { turnCount: 3, excerpt: 'Quote 1' },
            'Remote Speaker 2': { turnCount: 5, excerpt: 'Quote 2' },
          }}
        />,
      );
    });

    expect(document.body.textContent).toContain('Speaker 1 of 2');
    await click('Skip');

    expect(document.body.textContent).toContain('Speaker 2 of 2');
    await click('Back');

    expect(document.body.textContent).toContain('Speaker 1 of 2');
    await click('Skip');
    expect(document.body.textContent).toContain('Speaker 2 of 2');
    await click('Skip');

    // Completion summary
    expect(document.body.textContent).toContain('All speakers reviewed');
    await click('Done');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when pressing Escape key', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={onClose}
          meetingId="meeting-modal"
          attendeeNames={[]}
          hasSystemAudio={true}
          speakerSummaries={{}}
        />,
      );
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    });
    document.dispatchEvent(event);
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates directly to initialSpeaker step when provided', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          initialSpeaker="Remote Speaker 2"
          attendeeNames={['Jordan Doe']}
          hasSystemAudio={true}
          speakerSummaries={{
            'Remote Speaker 1': { turnCount: 3, excerpt: 'Quote 1' },
            'Remote Speaker 2': { turnCount: 5, excerpt: 'Quote 2' },
          }}
        />,
      );
    });

    expect(document.body.textContent).toContain('Speaker 2 of 2');
    expect(document.body.textContent).toContain('Quote 2');
  });
});

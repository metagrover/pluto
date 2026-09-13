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
        payload: {
          meetingId?: string;
          speaker?: string;
          personId?: string;
          newName?: string;
        },
      ) => {
        if (channel === 'GET_IDENTITY_STATE') return workspace;
        if (channel === 'GET_MEETING_IDENTITY')
          return meeting(payload.meetingId);
        if (channel === 'GET_MEETING_SPEAKER_SAMPLE_AVAILABILITY') {
          return { status: 'available', sampleCount: 1, scope: 'speaker' };
        }
        if (channel === 'SET_MEETING_IDENTITY_BINDING') {
          const next = meeting(payload.meetingId);
          if (payload.newName) {
            const newPerson = {
              id: `person-${payload.newName.toLowerCase().replace(/\s+/g, '-')}`,
              name: payload.newName,
            };
            next.people = [...next.people, newPerson];
            next.bindings.push({
              speaker: payload.speaker!,
              source: 'user',
              personId: newPerson.id,
              individual: true,
            });
          } else {
            next.bindings.push({
              speaker: payload.speaker!,
              source: 'user',
              personId: payload.personId ?? null,
              individual: true,
            });
          }
          return next;
        }
        if (channel === 'CLEAR_MEETING_IDENTITY_BINDING') {
          const next = meeting(payload.meetingId);
          next.bindings = next.bindings.filter(
            (b) => b.speaker !== payload.speaker,
          );
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

  const typeInput = (input: HTMLInputElement, value: string) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    nativeSetter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

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

  it('presents aggregate System audio as a recording excerpt', async () => {
    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_MEETING_IDENTITY') {
        return { ...meeting(payload.meetingId), speakers: ['Me', 'Them'] };
      }
      if (channel === 'GET_MEETING_SPEAKER_SAMPLE_AVAILABILITY') {
        return {
          status: 'available',
          sampleCount: 1,
          scope: 'remote_channel',
        };
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          hasSystemAudio={true}
          speakerSummaries={{
            Them: { turnCount: 15, excerpt: 'A participant excerpt.' },
          }}
        />,
      );
    });

    expect(document.body.textContent).toContain('Play recording excerpt');
    expect(document.body.textContent).not.toContain('Play voice sample');
  });

  it('explains why a known recording cannot provide a speaker excerpt', async () => {
    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_MEETING_IDENTITY') return meeting(payload.meetingId);
      if (channel === 'GET_MEETING_SPEAKER_SAMPLE_AVAILABILITY') {
        return { status: 'unavailable', reason: 'no_speaker_excerpt' };
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          hasSystemAudio={true}
          speakerSummaries={{}}
        />,
      );
    });

    expect(document.body.textContent).toContain(
      'No transcript-backed recording excerpt is available for this speaker.',
    );
    expect(document.body.textContent).not.toContain('Play voice sample');
  });

  it('reviews an aggregate Them speaker when no numbered speaker exists', async () => {
    invoke.mockImplementation(
      async (channel: string, payload: { meetingId?: string }) => {
        if (channel === 'GET_MEETING_IDENTITY') {
          return {
            ...meeting(payload.meetingId),
            speakers: ['Me', 'Them'],
          };
        }
        return workspace;
      },
    );

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          attendeeNames={['Jordan Doe']}
          hasSystemAudio={true}
          speakerSummaries={{
            Them: { turnCount: 4, excerpt: 'The aggregate remote voice.' },
          }}
        />,
      );
    });

    expect(document.body.textContent).toContain('Speaker 1 of 1');
    expect(document.body.textContent).toContain('Them');
    expect(document.body.textContent).toContain('The aggregate remote voice.');
    await click('+ Jordan Doe');
    expect(invoke).toHaveBeenCalledWith(
      'SET_MEETING_IDENTITY_BINDING',
      expect.objectContaining({
        speaker: 'Them',
        personId: 'person-jordan',
      }),
    );
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

  it('filters people in combobox suggestions on input typing and auto-advances when clicked', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          attendeeNames={[]}
          hasSystemAudio={true}
          speakerSummaries={{
            'Remote Speaker 1': { turnCount: 2, excerpt: 'Quote 1' },
            'Remote Speaker 2': { turnCount: 4, excerpt: 'Quote 2' },
          }}
        />,
      );
    });

    const input = document.body.querySelector(
      'input[role="combobox"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    // Type "Alex"
    await act(async () => {
      input.focus();
      typeInput(input, 'Alex');
    });

    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    expect(listbox?.textContent).toContain('Alex Chen');
    expect(listbox?.textContent).not.toContain('Jordan Doe');

    // Click Alex Chen option
    const option = [...document.body.querySelectorAll('[role="option"]')].find(
      (el) => el.textContent?.includes('Alex Chen'),
    );
    expect(option).toBeTruthy();
    await act(async () => {
      option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(invoke).toHaveBeenCalledWith(
      'SET_MEETING_IDENTITY_BINDING',
      expect.objectContaining({
        speaker: 'Remote Speaker 1',
        personId: 'person-alex',
      }),
    );

    // Auto-advances to Remote Speaker 2
    expect(document.body.textContent).toContain('Speaker 2 of 2');
    expect(document.body.textContent).toContain('Quote 2');
  });

  it('supports ArrowDown, ArrowUp, and Enter keyboard navigation in combobox', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          attendeeNames={[]}
          hasSystemAudio={true}
          speakerSummaries={{
            'Remote Speaker 1': { turnCount: 2, excerpt: 'Quote 1' },
            'Remote Speaker 2': { turnCount: 4, excerpt: 'Quote 2' },
          }}
        />,
      );
    });

    const input = document.body.querySelector(
      'input[role="combobox"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    // Focus and press ArrowDown to open listbox
    await act(async () => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
    });

    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();

    // Press Enter to select the highlighted first person (Aditya Grover)
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

    expect(invoke).toHaveBeenCalledWith(
      'SET_MEETING_IDENTITY_BINDING',
      expect.objectContaining({
        speaker: 'Remote Speaker 1',
        personId: 'person-aditya',
      }),
    );

    // Auto-advances to Remote Speaker 2
    expect(document.body.textContent).toContain('Speaker 2 of 2');
  });

  it('supports creating a new distinct person from search query and auto-advances', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          attendeeNames={[]}
          hasSystemAudio={true}
          speakerSummaries={{
            'Remote Speaker 1': { turnCount: 2, excerpt: 'Quote 1' },
            'Remote Speaker 2': { turnCount: 4, excerpt: 'Quote 2' },
          }}
        />,
      );
    });

    const input = document.body.querySelector(
      'input[role="combobox"]',
    ) as HTMLInputElement;

    // Type a new name
    await act(async () => {
      input.focus();
      typeInput(input, 'Samantha Miller');
    });

    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox?.textContent).toContain('Create “Samantha Miller”');
    expect(listbox?.textContent).toContain('New person');

    // Click the create new person item
    const createOption = [
      ...document.body.querySelectorAll('[role="option"]'),
    ].find((el) => el.textContent?.includes('Samantha Miller'));
    expect(createOption).toBeTruthy();
    await act(async () => {
      createOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(invoke).toHaveBeenCalledWith(
      'SET_MEETING_IDENTITY_BINDING',
      expect.objectContaining({
        speaker: 'Remote Speaker 1',
        newName: 'Samantha Miller',
      }),
    );

    // Auto-advances to Remote Speaker 2
    expect(document.body.textContent).toContain('Speaker 2 of 2');
  });

  it('Escape key closes combobox suggestions first, without closing modal', async () => {
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

    const input = document.body.querySelector(
      'input[role="combobox"]',
    ) as HTMLInputElement;

    // Open combobox
    await act(async () => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
    });

    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();

    // First Escape: closes suggestions dropdown, modal remains open
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // Second Escape: closes modal
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears combobox input and resets selection on Clear click', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          attendeeNames={[]}
          hasSystemAudio={true}
          speakerSummaries={{}}
        />,
      );
    });

    const input = document.body.querySelector(
      'input[role="combobox"]',
    ) as HTMLInputElement;

    await act(async () => {
      input.focus();
      typeInput(input, 'Jordan');
    });

    expect(input.value).toBe('Jordan');
    const clearButton = document.body.querySelector(
      'button[aria-label="Clear person input"]',
    ) as HTMLButtonElement;
    expect(clearButton).toBeTruthy();

    await act(async () => {
      clearButton.click();
    });

    expect(input.value).toBe('');
  });

  it('excludes generic speaker placeholder names from suggestions and attendee chips, and prevents creating them', async () => {
    // Inject a generic speaker into people state
    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_MEETING_IDENTITY') {
        const base = meeting(payload.meetingId);
        return {
          ...base,
          people: [
            ...base.people,
            { id: 'person-remote-1', name: 'Remote Speaker 1' },
            { id: 'person-speaker-2', name: 'Speaker 2' },
            { id: 'person-me', name: 'Me' },
          ],
        };
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="meeting-modal"
          attendeeNames={['Remote Speaker 1', 'Alice Walker']}
          hasSystemAudio={true}
          speakerSummaries={{
            'Remote Speaker 1': { turnCount: 2, excerpt: 'Hello' },
          }}
        />,
      );
    });

    // Attendee chips should have Alice Walker but NOT Remote Speaker 1
    expect(document.body.textContent).toContain('+ Alice Walker');
    expect(document.body.textContent).not.toContain('+ Remote Speaker 1');

    const input = document.body.querySelector(
      'input[role="combobox"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    // Open suggestions list
    await act(async () => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
    });

    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();

    // Suggestions should NOT contain Remote Speaker 1, Speaker 2, or Me
    expect(listbox?.textContent).not.toContain('Remote Speaker 1');
    expect(listbox?.textContent).not.toContain('Speaker 2');
    expect(listbox?.textContent).not.toContain('Me');
    // Valid people should be present
    expect(listbox?.textContent).toContain('Alex Chen');

    // Type a generic speaker name
    await act(async () => {
      typeInput(input, 'Remote Speaker 3');
    });

    // Should NOT offer to create "Remote Speaker 3"
    expect(document.body.textContent).not.toContain(
      'Create “Remote Speaker 3”',
    );
    expect(document.body.textContent).toContain('No matching people found.');
  });
});

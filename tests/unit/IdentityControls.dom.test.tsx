// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingIdentityState } from '../../src/api/identity';
import { IdentitySettings } from '../../src/components/features/IdentitySettings';
import { MeetingIdentityControls } from '../../src/components/features/MeetingIdentityControls';
import { emptyIdentityProfile } from '../../src/types/identity';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const people = [
  { id: 'person-a', name: 'Alex' },
  { id: 'person-b', name: 'Alex' },
];
const workspace = {
  selfPersonId: null,
  people,
  revision: 4,
  profile: emptyIdentityProfile(),
};
const meeting = (id = 'meeting-a'): MeetingIdentityState => ({
  ...workspace,
  meetingId: id,
  speakers: ['Them'],
  bindings: [],
  capture: { origin: 'imported', selfPersonId: null },
  job: null,
});

describe('identity controls', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    invoke = vi.fn(async (channel: string, payload: { meetingId?: string }) =>
      channel === 'GET_IDENTITY_STATE' ? workspace : meeting(payload.meetingId),
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
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === text,
    );
    expect(button, text).toBeTruthy();
    await act(async () => button?.click());
  };
  const select = async (label: string, value: string) => {
    if (label === 'Your person') {
      const field = container.querySelector<HTMLInputElement>(
        '[aria-label="Your person"]',
      )!;
      await act(async () => field.click());
      const optionIndex =
        value === '__new__'
          ? workspace.people.length + 1
          : workspace.people.findIndex((person) => person.id === value) + 1;
      const option =
        document.querySelectorAll<HTMLElement>('[role="option"]')[optionIndex];
      expect(option).toBeTruthy();
      await act(async () => option.click());
      return;
    }
    const field = container.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    );
    expect(field).toBeTruthy();
    await act(async () => {
      if (!field) return;
      field.value = value;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const input = async (label: string, value: string) => {
    const field = container.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    );
    expect(field).toBeTruthy();
    await act(async () => {
      if (!field) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const openMeeting = async (id = 'meeting-a') => {
    await act(async () =>
      root.render(<MeetingIdentityControls meetingId={id} />),
    );
    await click('Speaker identities');
  };
  const confirmScope = async () => {
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    await act(async () => checkbox?.click());
  };

  it('selects a stable self ID, distinguishes same names, and explains capture scope', async () => {
    await act(async () => root.render(<IdentitySettings />));
    expect(container.textContent).toContain('future local recordings');
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('[aria-label="Your person"]')!
        .click(),
    );
    const options = [...document.querySelectorAll('[role="option"]')].filter(
      (o) => o.textContent?.includes('Alex'),
    );
    expect(options[0].textContent).not.toBe(options[1].textContent);
    await select('Your person', 'person-b');
    invoke.mockResolvedValueOnce({
      ...workspace,
      selfPersonId: 'person-b',
      revision: 5,
    });
    await click('Save identity');
    expect(invoke).toHaveBeenLastCalledWith('SET_SELF_IDENTITY', {
      personId: 'person-b',
      expectedRevision: 4,
    });
    expect(container.textContent).toContain('Saved');
  });

  it('creates a distinct person and clears the saved self identity', async () => {
    await act(async () => root.render(<IdentitySettings />));
    await select('Your person', '__new__');
    await input('New person name', '  Alex  ');
    invoke.mockResolvedValueOnce({
      ...workspace,
      selfPersonId: 'person-c',
      people: [...people, { id: 'person-c', name: 'Alex' }],
      revision: 5,
    });
    await click('Save identity');
    expect(invoke).toHaveBeenLastCalledWith('SET_SELF_IDENTITY', {
      newName: 'Alex',
      expectedRevision: 4,
    });
    invoke.mockResolvedValueOnce({ ...workspace, revision: 6 });
    await act(async () =>
      container
        .querySelector<HTMLInputElement>(
          'input[aria-label="Confirm clearing identity"]',
        )
        ?.click(),
    );
    await click('Clear identity');
    expect(invoke).toHaveBeenLastCalledWith('SET_SELF_IDENTITY', {
      personId: null,
      expectedRevision: 5,
    });
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Your person"]')
        ?.value,
    ).toBe('Not set');
  });

  it('keeps a failed self save editable and reloads stale revisions', async () => {
    await act(async () => root.render(<IdentitySettings />));
    await select('Your person', 'person-a');
    invoke.mockRejectedValueOnce(new Error('identity_revision_stale'));
    invoke.mockResolvedValueOnce({ ...workspace, revision: 9 });
    await click('Save identity');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'changed',
    );
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Your person"]')
        ?.disabled,
    ).toBe(false);
    await select('Your person', 'person-b');
    invoke.mockResolvedValueOnce({
      ...workspace,
      selfPersonId: 'person-b',
      revision: 10,
    });
    await click('Save identity');
    expect(invoke).toHaveBeenLastCalledWith('SET_SELF_IDENTITY', {
      personId: 'person-b',
      expectedRevision: 9,
    });
  });

  it('retries initial load failures without hiding the error', async () => {
    invoke.mockRejectedValueOnce(new Error('offline'));
    await act(async () => root.render(<IdentitySettings />));
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    await click('Reload identity');
    expect(container.querySelector('[aria-label="Your person"]')).toBeTruthy();
  });

  it('requires explicit individual scope for channel labels and preserves imported provenance', async () => {
    await openMeeting();
    expect(container.textContent).toContain('Imported recording');
    expect(container.textContent).toContain('original transcript');
    await select('Person for Them', 'person-a');
    expect(
      [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'Save correction',
      )?.disabled,
    ).toBe(true);
    await confirmScope();
    invoke.mockResolvedValueOnce({
      ...meeting(),
      bindings: [
        {
          speaker: 'Them',
          personId: 'person-a',
          individual: true,
          source: 'user',
          sourceRevision: 'source-1',
          evidence: [],
        },
      ],
      revision: 5,
      job: { state: 'pending', attempts: 0, error: null },
    });
    await click('Save correction');
    expect(invoke).toHaveBeenLastCalledWith('SET_MEETING_IDENTITY_BINDING', {
      meetingId: 'meeting-a',
      speaker: 'Them',
      personId: 'person-a',
      individual: true,
      expectedRevision: 4,
    });
    expect(container.textContent).toContain('recheck pending');
  });

  it('offers calendar attendees as direct choices for anonymous remote speakers', async () => {
    invoke.mockResolvedValueOnce({
      ...meeting(),
      speakers: ['Remote Speaker 1'],
      people: [{ id: 'person-sam', name: 'Sam Lee' }],
    });
    await act(async () =>
      root.render(
        <MeetingIdentityControls
          meetingId="meeting-a"
          attendeeNames={['Sam Lee', 'Jordan Doe']}
          speakerSummaries={{
            'Remote Speaker 1': {
              turnCount: 3,
              excerpt: 'The launch plan is ready for review.',
            },
          }}
        />,
      ),
    );
    expect(container.textContent).toContain('1 unidentified speaker');
    await click('1 unidentified speaker · Review');
    expect(container.textContent).toContain('Speaker 1');
    expect(container.textContent).toContain(
      'The launch plan is ready for review.',
    );
    expect(container.textContent).toContain('Jordan Doe');
    invoke.mockResolvedValueOnce({
      ...meeting(),
      speakers: ['Remote Speaker 1'],
      revision: 5,
      people: [{ id: 'person-sam', name: 'Sam Lee' }],
      bindings: [
        {
          speaker: 'Remote Speaker 1',
          personId: 'person-sam',
          individual: true,
          source: 'user',
          sourceRevision: 'source-1',
          evidence: [],
        },
      ],
    });
    await click('Sam Lee · Invited');
    expect(container.textContent).toContain('Speaker 1 will appear as Sam Lee');
    expect(container.textContent).toContain(
      '3 transcript turns will be linked to Sam Lee in People',
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'SET_MEETING_IDENTITY_BINDING',
      expect.anything(),
    );
    await click('Confirm Sam Lee');
    expect(invoke).toHaveBeenLastCalledWith('SET_MEETING_IDENTITY_BINDING', {
      meetingId: 'meeting-a',
      speaker: 'Remote Speaker 1',
      personId: 'person-sam',
      individual: true,
      expectedRevision: 4,
    });
    expect(container.textContent).toContain('Speaker 1 is Sam Lee');
    invoke.mockResolvedValueOnce({
      ...meeting(),
      speakers: ['Remote Speaker 1'],
      revision: 6,
      people: [{ id: 'person-sam', name: 'Sam Lee' }],
      bindings: [],
    });
    await click('Undo');
    expect(invoke).toHaveBeenLastCalledWith('CLEAR_MEETING_IDENTITY_BINDING', {
      meetingId: 'meeting-a',
      speaker: 'Remote Speaker 1',
      expectedRevision: 5,
    });
  });

  it('does not offer an ambiguous same-name person as a direct calendar choice', async () => {
    invoke.mockResolvedValueOnce({
      ...meeting(),
      speakers: ['Remote Speaker 1'],
      people: [
        { id: 'person-sam-a', name: 'Sam Lee' },
        { id: 'person-sam-b', name: 'Sam Lee' },
      ],
    });
    await act(async () =>
      root.render(
        <MeetingIdentityControls
          meetingId="meeting-a"
          attendeeNames={['Sam Lee']}
        />,
      ),
    );
    await click('1 unidentified speaker · Review');

    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === 'Sam Lee',
      ),
    ).toBe(false);
  });

  it('does not collapse two same-name calendar attendees into one direct choice', async () => {
    invoke.mockResolvedValueOnce({
      ...meeting(),
      speakers: ['Remote Speaker 1'],
      people: [],
    });
    await act(async () =>
      root.render(
        <MeetingIdentityControls
          meetingId="meeting-a"
          attendeeNames={['Sam Lee', 'Sam Lee']}
        />,
      ),
    );
    await click('1 unidentified speaker · Review');

    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === 'Sam Lee',
      ),
    ).toBe(false);
  });

  it('does not offer the workspace user or their nicknames as remote attendee choices', async () => {
    invoke.mockResolvedValueOnce({
      ...meeting(),
      selfPersonId: 'person-aditya',
      profile: {
        ...emptyIdentityProfile(),
        preferredName: 'Aditya Grover',
        aliases: ['Grover', 'Meta'],
      },
      speakers: ['Remote Speaker 1'],
      people: [
        { id: 'person-aditya', name: 'Aditya Grover' },
        { id: 'person-jordan', name: 'Jordan Doe' },
      ],
    });
    await act(async () =>
      root.render(
        <MeetingIdentityControls
          meetingId="meeting-a"
          attendeeNames={['Aditya Grover', 'Grover', 'Jordan Doe']}
        />,
      ),
    );
    await click('1 unidentified speaker · Review');

    expect(container.textContent).toContain('Jordan Doe · Invited');
    expect(container.textContent).not.toContain('Aditya Grover · Invited');
    expect(container.textContent).not.toContain('Grover · Invited');
  });

  it('plays isolated samples one at a time, offers an alternate, and cleans up object URLs', async () => {
    const createObjectURL = vi.fn(() => `blob:sample-${Math.random()}`);
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const play = vi.fn(async () => {});
    const pause = vi.fn();
    vi.stubGlobal(
      'Audio',
      class {
        play = play;
        pause = pause;
        addEventListener = vi.fn();
        constructor(public src: string) {}
      },
    );
    invoke.mockImplementation(
      async (
        channel: string,
        payload: { meetingId?: string; sampleIndex?: number },
      ) =>
        channel === 'GET_MEETING_SPEAKER_SAMPLE'
          ? {
              bytes: new Uint8Array([1, 2, 3]),
              mimeType: 'audio/wav',
              durationSeconds: 5,
              excerpt: 'A clean sample excerpt.',
              sampleIndex: payload.sampleIndex ?? 0,
              sampleCount: 2,
            }
          : {
              ...meeting(payload.meetingId),
              speakers: ['Remote Speaker 1'],
            },
    );

    await act(async () =>
      root.render(
        <MeetingIdentityControls
          meetingId="meeting-a"
          hasSystemAudio
          speakerSummaries={{
            'Remote Speaker 1': { turnCount: 2, excerpt: 'Initial excerpt.' },
          }}
        />,
      ),
    );
    await click('1 unidentified speaker · Review');
    await click('Play voice sample');
    expect(invoke).toHaveBeenLastCalledWith('GET_MEETING_SPEAKER_SAMPLE', {
      meetingId: 'meeting-a',
      speaker: 'Remote Speaker 1',
      sampleIndex: 0,
    });
    expect(play).toHaveBeenCalledTimes(1);
    await click('Try another sample');
    expect(pause).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenLastCalledWith('GET_MEETING_SPEAKER_SAMPLE', {
      meetingId: 'meeting-a',
      speaker: 'Remote Speaker 1',
      sampleIndex: 1,
    });

    await act(async () =>
      root.render(<MeetingIdentityControls meetingId="meeting-b" />),
    );
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('explains when a meeting has no isolated voice sample', async () => {
    invoke.mockResolvedValueOnce({
      ...meeting(),
      speakers: ['Remote Speaker 1'],
    });
    await act(async () =>
      root.render(<MeetingIdentityControls meetingId="meeting-a" />),
    );
    await click('1 unidentified speaker · Review');
    expect(container.textContent).toContain(
      'Voice sample unavailable for this meeting.',
    );
  });

  it('publishes confirmed display names when identity state loads', async () => {
    const onDisplayNamesChange = vi.fn();
    invoke.mockResolvedValueOnce({
      ...meeting(),
      speakers: ['Remote Speaker 1'],
      people: [{ id: 'person-avery', name: 'Avery Chen' }],
      bindings: [
        {
          speaker: 'Remote Speaker 1',
          personId: 'person-avery',
          individual: true,
          source: 'user',
          sourceRevision: 'source-1',
          evidence: [],
        },
      ],
    });

    await act(async () =>
      root.render(
        <MeetingIdentityControls
          meetingId="meeting-a"
          onDisplayNamesChange={onDisplayNamesChange}
        />,
      ),
    );

    expect(onDisplayNamesChange).toHaveBeenLastCalledWith({
      'Remote Speaker 1': 'Avery Chen',
    });
  });

  it('confirms an unnamed individual without inventing a person', async () => {
    await openMeeting();
    await confirmScope();
    await click('Save correction');
    expect(invoke).toHaveBeenLastCalledWith('SET_MEETING_IDENTITY_BINDING', {
      meetingId: 'meeting-a',
      speaker: 'Them',
      personId: null,
      individual: true,
      expectedRevision: 4,
    });
  });

  it('does not treat inferred channel scope as explicit user confirmation', async () => {
    invoke.mockResolvedValueOnce({
      ...meeting(),
      bindings: [
        {
          speaker: 'Them',
          personId: 'person-a',
          individual: true,
          source: 'source',
          sourceRevision: 'source-1',
          evidence: [],
        },
      ],
    });
    await openMeeting();
    await select('Person for Them', 'person-b');
    expect(
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(false);
    expect(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Save correction',
      )?.disabled,
    ).toBe(true);
  });

  it('retains the editable choice and displays an ordinary save failure', async () => {
    await openMeeting();
    await select('Person for Them', 'person-b');
    await confirmScope();
    invoke.mockRejectedValueOnce(new Error('storage unavailable'));
    await click('Save correction');
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.querySelector('select')?.value).toBe('person-b');
    expect(container.querySelector('select')?.disabled).toBe(false);
  });

  it('creates a meeting person and clears a correction using the returned revision', async () => {
    await openMeeting();
    await select('Person for Them', '__new__');
    await input('New person name for Them', 'Jordan');
    await confirmScope();
    invoke.mockResolvedValueOnce({
      ...meeting(),
      revision: 5,
      people: [...people, { id: 'person-c', name: 'Jordan' }],
      bindings: [
        {
          speaker: 'Them',
          personId: 'person-c',
          individual: true,
          source: 'user',
          sourceRevision: 'source-1',
          evidence: [],
        },
      ],
    });
    await click('Save correction');
    expect(invoke).toHaveBeenLastCalledWith('SET_MEETING_IDENTITY_BINDING', {
      meetingId: 'meeting-a',
      speaker: 'Them',
      newName: 'Jordan',
      individual: true,
      expectedRevision: 4,
    });
    await click('Clear correction');
    expect(invoke).toHaveBeenLastCalledWith('CLEAR_MEETING_IDENTITY_BINDING', {
      meetingId: 'meeting-a',
      speaker: 'Them',
      expectedRevision: 5,
    });
  });

  it('shows failed reconciliation, retains retry errors, and retries successfully', async () => {
    invoke.mockResolvedValueOnce({
      ...meeting(),
      job: { state: 'failed', attempts: 3, error: 'provider unavailable' },
    });
    await openMeeting();
    expect(container.textContent).toContain('Recheck failed');
    invoke.mockRejectedValueOnce(new Error('offline'));
    await click('Retry recheck');
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    invoke.mockResolvedValueOnce({
      ...meeting(),
      job: { state: 'running', attempts: 1, error: null },
    });
    await click('Retry recheck');
    expect(invoke).toHaveBeenLastCalledWith('RETRY_IDENTITY_RECONCILIATION', {
      meetingId: 'meeting-a',
    });
    expect(container.textContent).toContain('Rechecking');
  });

  it('reloads meeting revisions after conflicting writes and leaves controls usable', async () => {
    await openMeeting();
    await confirmScope();
    invoke.mockRejectedValueOnce(new Error('identity_revision_stale'));
    invoke.mockResolvedValueOnce({ ...meeting(), revision: 7 });
    await click('Save correction');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'changed',
    );
    expect(invoke).toHaveBeenLastCalledWith('GET_MEETING_IDENTITY', {
      meetingId: 'meeting-a',
    });
  });

  it('ignores old meeting load responses after the selected meeting changes', async () => {
    let resolveOld!: (value: MeetingIdentityState) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await openMeeting();
    await act(async () =>
      root.render(<MeetingIdentityControls meetingId="meeting-b" />),
    );
    await click('Speaker identities');
    await act(async () =>
      resolveOld({ ...meeting(), speakers: ['Old speaker'] }),
    );
    expect(container.textContent).not.toContain('Old speaker');
    expect(invoke).toHaveBeenLastCalledWith('GET_MEETING_IDENTITY', {
      meetingId: 'meeting-b',
    });
  });

  it('ignores a save response after switching meetings', async () => {
    await openMeeting();
    await confirmScope();
    let resolveSave!: (value: MeetingIdentityState) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    await click('Save correction');
    await act(async () =>
      root.render(<MeetingIdentityControls meetingId="meeting-b" />),
    );
    await click('Speaker identities');
    await act(async () =>
      resolveSave({ ...meeting(), speakers: ['Stale speaker'] }),
    );
    expect(container.textContent).not.toContain('Stale speaker');
  });

  it('refreshes pending work until completion without claiming all owners resolved', async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValueOnce({
      ...meeting(),
      job: { state: 'pending', attempts: 0, error: null },
    });
    await openMeeting();
    invoke.mockResolvedValueOnce({
      ...meeting(),
      job: { state: 'complete', attempts: 1, error: null },
    });
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(container.textContent).toContain('Recheck complete');
    expect(container.textContent).not.toContain('All owners resolved');
  });

  it('finishes an in-flight save after the disclosure is closed and reopened', async () => {
    await openMeeting();
    await confirmScope();
    let resolveSave!: (value: MeetingIdentityState) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    await click('Save correction');
    await click('Speaker identities');
    await act(async () => resolveSave({ ...meeting(), revision: 5 }));
    await click('Speaker identities');
    expect(container.querySelector('select')?.disabled).toBe(false);
  });

  it('preserves an unsaved correction while background status refreshes', async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValueOnce({
      ...meeting(),
      job: { state: 'pending', attempts: 0, error: null },
    });
    await openMeeting();
    await select('Person for Them', 'person-b');
    await confirmScope();
    invoke.mockResolvedValueOnce({
      ...meeting(),
      job: { state: 'running', attempts: 1, error: null },
    });
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(container.querySelector('select')?.value).toBe('person-b');
    expect(
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(true);
  });
});

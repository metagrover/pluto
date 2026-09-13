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
  { id: 'person-alex', name: 'Alex Chen' },
];
const sourceRevision = '7591ab6e-da76-4c45-a04f-ab96b1a6f3bf';

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
  speakers: ['Remote Speaker 1'],
  bindings: [],
  capture: { origin: 'local', selfPersonId: 'person-aditya' },
  job: null,
});

describe('SpeakerIdentificationModal voice profile suggestions and enrollment', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;
  let enrollmentShouldFail: boolean;
  let candidatesAvailable: boolean;
  let enrollmentAvailable: boolean;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    enrollmentShouldFail = false;
    candidatesAvailable = true;
    enrollmentAvailable = true;
    invoke = vi.fn(async (channel: string, payload: any) => {
      if (channel === 'GET_IDENTITY_STATE') return workspace;
      if (channel === 'GET_MEETING_IDENTITY') return meeting(payload.meetingId);
      if (channel === 'SPEAKER_VOICE_GET_SUGGESTIONS') {
        if (!candidatesAvailable) {
          return {
            suggestions: {},
            candidates: {},
            enrollmentAvailability: {
              'Remote Speaker 1': enrollmentAvailable,
            },
          };
        }
        return {
          suggestions: {
            'Remote Speaker 1': {
              speaker: 'Remote Speaker 1',
              suggestedPersonId: 'person-alex',
              suggestedPersonName: 'Alex Chen',
              similarityScore: 0.94,
              confidenceTier: 'strong',
              isCalendarAttendee: true,
              candidateDigest: 'cand-digest-1',
              sourceRevision,
              referenceInterval: {
                startTime: 1.0,
                endTime: 3.5,
                excerpt: 'Hello there',
                sourceMeetingId: 'm-ref',
              },
            },
          },
          candidates: {
            'Remote Speaker 1': {
              candidateDigest: 'cand-digest-1',
              sourceRevision,
              isEligibleForEnrollment: true,
              cleanDurationSeconds: 4.5,
            },
          },
        };
      }
      if (channel === 'SET_MEETING_IDENTITY_BINDING') {
        const next = meeting(payload.meetingId);
        const personId = payload.personId ?? 'person-new-peer';
        if (!next.people.some((person) => person.id === personId)) {
          next.people.push({ id: personId, name: payload.newName });
        }
        next.bindings.push({
          speaker: payload.speaker,
          source: 'user',
          personId,
          individual: true,
        });
        return next;
      }
      if (channel === 'SPEAKER_VOICE_REJECT') {
        return { success: true };
      }
      if (channel === 'SPEAKER_VOICE_ENROLL') {
        if (enrollmentShouldFail) {
          throw new Error('speaker_candidate_stale');
        }
        return { success: true, enrollmentId: 'enroll-1' };
      }
      return null;
    });

    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders voice match suggestion banner with badges and confirm/reject actions', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('Speaker 1 may be Alex Chen');
    expect(bodyText).toContain('Strong match');
    expect(bodyText).toContain('On calendar');
    expect(bodyText).not.toContain('Play reference sample');
    expect(bodyText).not.toContain('Confirm & Next');
    expect(bodyText).toContain('Confirm Alex Chen');
    expect(bodyText).toContain('Not Alex Chen');
    expect(bodyText).not.toContain('Remember this voice for future meetings');
    expect(bodyText).toContain(
      'Confirming identifies this speaker. Eligible voice samples help with future meetings.',
    );
  });

  it.each([
    [
      'queued',
      'Voice analysis is queued until processing capacity is available.',
    ],
    [
      'retryable_failure',
      'Voice analysis was interrupted. Pluto will retry automatically.',
    ],
    [
      'abstained',
      'There was not enough reliable isolated speech for voice identification.',
    ],
    ['eligible', 'No saved voice profile matched with enough confidence.'],
  ])('explains the %s voice-analysis outcome', async (analysisStatus, copy) => {
    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_IDENTITY_STATE') return workspace;
      if (channel === 'GET_MEETING_IDENTITY') return meeting(payload.meetingId);
      if (channel === 'SPEAKER_VOICE_GET_SUGGESTIONS') {
        return {
          suggestions: {},
          candidates: {
            'Remote Speaker 1': {
              sourceRevision,
              isEligibleForEnrollment: analysisStatus === 'eligible',
              cleanDurationSeconds: 0,
              analysisStatus,
            },
          },
          enrollmentAvailability: { 'Remote Speaker 1': true },
        };
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    expect(document.body.textContent).toContain(copy);
  });

  it('explains an ambiguous profile match without naming either candidate', async () => {
    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_IDENTITY_STATE') return workspace;
      if (channel === 'GET_MEETING_IDENTITY') return meeting(payload.meetingId);
      if (channel === 'SPEAKER_VOICE_GET_SUGGESTIONS') {
        return {
          suggestions: {},
          candidates: {
            'Remote Speaker 1': {
              sourceRevision,
              isEligibleForEnrollment: true,
              cleanDurationSeconds: 4.5,
              analysisStatus: 'eligible',
            },
          },
          outcomes: {
            'Remote Speaker 1': { category: 'ambiguous' },
          },
          enrollmentAvailability: { 'Remote Speaker 1': true },
        };
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    expect(document.body.textContent).toContain(
      'Voice evidence matched more than one saved profile too closely. Choose the participant manually.',
    );
    expect(document.body.textContent).not.toContain('may be Alex Chen');
  });

  it('confirms suggestion and enrolls the voice profile automatically', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    // Click "Confirm Alex Chen"
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Confirm Alex Chen'),
    );
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton?.click();
    });

    // Verify SET_MEETING_IDENTITY_BINDING was called
    expect(invoke).toHaveBeenCalledWith(
      'SET_MEETING_IDENTITY_BINDING',
      expect.objectContaining({
        speaker: 'Remote Speaker 1',
        personId: 'person-alex',
      }),
    );

    // Verify SPEAKER_VOICE_ENROLL was called with candidate digest
    expect(invoke).toHaveBeenCalledWith('SPEAKER_VOICE_ENROLL', {
      personId: 'person-alex',
      sourceMeetingId: 'meeting-voice',
      sourceRevision,
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-1',
      expectedRevision: 10,
    });
  });

  it('enrolls the resolved person after creating a new peer', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    const input = document.querySelector(
      'input[placeholder="Search people or type a new name…"]',
    ) as HTMLInputElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Jordan Lee');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const createButton = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find(
      (option) =>
        option.textContent?.includes('Create') &&
        option.textContent?.includes('Jordan Lee'),
    ) as HTMLElement | undefined;
    expect(createButton).toBeDefined();

    await act(async () => {
      createButton?.click();
    });

    expect(invoke).toHaveBeenCalledWith('SPEAKER_VOICE_ENROLL', {
      personId: 'person-new-peer',
      sourceMeetingId: 'meeting-voice',
      sourceRevision,
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-1',
      expectedRevision: 10,
    });
  });

  it('offers reviewed-sample enrollment without a precomputed candidate', async () => {
    candidatesAvailable = false;
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    const input = document.querySelector(
      'input[placeholder="Search people or type a new name…"]',
    ) as HTMLInputElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Alex Chen');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const alexOption = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((option) => option.textContent?.includes('Alex Chen')) as
      | HTMLElement
      | undefined;
    await act(async () => alexOption?.click());

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirm & Next'),
    );
    await act(async () => confirmButton?.click());

    expect(invoke).toHaveBeenCalledWith('SPEAKER_VOICE_ENROLL', {
      personId: 'person-alex',
      sourceMeetingId: 'meeting-voice',
      speaker: 'Remote Speaker 1',
      expectedRevision: 10,
    });
  });

  it('does not attempt voice enrollment when reviewed evidence is unavailable', async () => {
    candidatesAvailable = false;
    enrollmentAvailable = false;
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    expect(document.body.textContent).not.toContain(
      'Remember this voice for future meetings',
    );
    expect(document.body.textContent).not.toContain(
      'Confirming identifies this speaker. Eligible voice samples help with future meetings.',
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'SPEAKER_VOICE_ENROLL',
      expect.anything(),
    );
  });

  it('persists identity and advances cleanly without noisy error when voice enrollment fails', async () => {
    enrollmentShouldFail = true;
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirm Alex Chen'),
    );
    await act(async () => confirmButton?.click());

    expect(invoke).toHaveBeenCalledWith(
      'SET_MEETING_IDENTITY_BINDING',
      expect.objectContaining({
        speaker: 'Remote Speaker 1',
        personId: 'person-alex',
      }),
    );
    expect(document.body.textContent).toContain('All speakers reviewed');
    expect(document.body.textContent).toContain('is Alex Chen');
    expect(document.body.textContent).not.toContain(
      'This person was identified, but Pluto could not remember their voice. Try again.',
    );
  });

  it('does not require a separate per-person voice checkbox after reopening', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    expect(document.querySelector('input[type="checkbox"]')).toBeNull();

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={false}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('rejects suggestion when Not Alex Chen is clicked and clears suggestion banner', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    const notButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Not Alex Chen'),
    );
    expect(notButton).toBeDefined();

    await act(async () => {
      notButton?.click();
    });

    // Verify SPEAKER_VOICE_REJECT was called
    expect(invoke).toHaveBeenCalledWith('SPEAKER_VOICE_REJECT', {
      meetingId: 'meeting-voice',
      speaker: 'Remote Speaker 1',
      sourceRevision,
      candidateDigest: 'cand-digest-1',
      personId: 'person-alex',
    });

    // Suggestion banner should be gone
    expect(document.body.textContent).not.toContain(
      'Speaker 1 may be Alex Chen',
    );
  });

  it('keeps the next speaker selected after confirming a suggestion opened on a specific speaker', async () => {
    const defaultInvoke = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'SPEAKER_VOICE_ENROLL') return new Promise(() => {});
      const result = await defaultInvoke(channel, payload);
      if (
        channel === 'GET_MEETING_IDENTITY' ||
        channel === 'SET_MEETING_IDENTITY_BINDING'
      ) {
        return {
          ...result,
          speakers: ['Remote Speaker 1', 'Remote Speaker 2'],
        };
      }
      return result;
    });
    const render = () =>
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
          initialSpeaker="Remote Speaker 1"
        />,
      );
    await act(async () => render());
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Confirm Alex Chen',
    );
    expect(confirm).toBeDefined();
    await act(async () => confirm!.click());
    await act(async () => render());
    expect(document.body.textContent).toContain('Speaker 2 of 2');
    expect(document.body.textContent).not.toContain('Confirm Alex Chen');
    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === 'SET_MEETING_IDENTITY_BINDING',
      ),
    ).toHaveLength(1);
  });

  it('advances to the next speaker immediately without stalling on voice enrollment', async () => {
    const multiMeeting: MeetingIdentityState = {
      ...workspace,
      meetingId: 'meeting-multi',
      speakers: ['Remote Speaker 1', 'Remote Speaker 2'],
      bindings: [],
      capture: { origin: 'local', selfPersonId: 'person-aditya' },
      job: null,
    };

    let resolveEnrollment: ((val: any) => void) | null = null;
    const slowEnrollmentPromise = new Promise((resolve) => {
      resolveEnrollment = resolve;
    });

    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_IDENTITY_STATE') return workspace;
      if (channel === 'GET_MEETING_IDENTITY') return multiMeeting;
      if (channel === 'SPEAKER_VOICE_GET_SUGGESTIONS') {
        return {
          suggestions: {},
          candidates: {},
          enrollmentAvailability: {
            'Remote Speaker 1': true,
            'Remote Speaker 2': true,
          },
        };
      }
      if (channel === 'SET_MEETING_IDENTITY_BINDING') {
        const next = { ...multiMeeting, bindings: [...multiMeeting.bindings] };
        next.bindings.push({
          speaker: payload.speaker,
          source: 'user',
          personId: payload.personId,
          individual: true,
        });
        return next;
      }
      if (channel === 'SPEAKER_VOICE_ENROLL') {
        return await slowEnrollmentPromise;
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-multi"
          initialSpeaker="Remote Speaker 1"
        />,
      );
    });

    expect(document.body.textContent).toContain('Speaker 1 of 2');

    const input = document.querySelector(
      'input[placeholder="Search people or type a new name…"]',
    ) as HTMLInputElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Alex Chen');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const alexOption = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((option) => option.textContent?.includes('Alex Chen')) as
      | HTMLElement
      | undefined;
    await act(async () => alexOption?.click());

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirm & Next'),
    );
    await act(async () => confirmButton?.click());

    // Immediately advanced to Speaker 2 of 2 without waiting for enrollment
    expect(document.body.textContent).toContain('Speaker 2 of 2');

    // Cleanly resolve the in-flight enrollment promise
    await act(async () => {
      resolveEnrollment?.({ success: true, enrollmentId: 'enroll-1' });
    });
  });

  it('enrolls voice profile even when user confirms while voice suggestions are still loading', async () => {
    let resolveSuggestions: ((val: any) => void) | null = null;
    const pendingSuggestionsPromise = new Promise((resolve) => {
      resolveSuggestions = resolve;
    });

    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_IDENTITY_STATE') return workspace;
      if (channel === 'GET_MEETING_IDENTITY')
        return meeting(payload?.meetingId ?? 'meeting-voice');
      if (channel === 'SPEAKER_VOICE_GET_SUGGESTIONS') {
        return await pendingSuggestionsPromise;
      }
      if (channel === 'SET_MEETING_IDENTITY_BINDING') {
        return {
          ...meeting(payload?.meetingId ?? 'meeting-voice'),
          revision: 11,
          bindings: [
            {
              speaker: payload.speaker,
              source: 'user',
              personId: payload.personId,
              individual: true,
            },
          ],
        };
      }
      if (channel === 'SPEAKER_VOICE_ENROLL') {
        return { success: true, enrollmentId: 'enroll-late' };
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    const input = document.querySelector(
      'input[placeholder="Search people or type a new name…"]',
    ) as HTMLInputElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Alex Chen');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const alexOption = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((option) => option.textContent?.includes('Alex Chen')) as
      | HTMLElement
      | undefined;
    await act(async () => alexOption?.click());

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirm Alex Chen'),
    );
    await act(async () => confirmButton?.click());

    expect(invoke).toHaveBeenCalledWith(
      'SET_MEETING_IDENTITY_BINDING',
      expect.objectContaining({
        speaker: 'Remote Speaker 1',
        personId: 'person-alex',
      }),
    );

    expect(invoke).not.toHaveBeenCalledWith(
      'SPEAKER_VOICE_ENROLL',
      expect.anything(),
    );

    await act(async () => {
      resolveSuggestions?.({
        suggestions: {},
        candidates: {
          'Remote Speaker 1': {
            candidateDigest: 'cand-late-1',
            sourceRevision: 'rev-1',
            isEligibleForEnrollment: true,
            cleanDurationSeconds: 5,
          },
        },
        enrollmentAvailability: { 'Remote Speaker 1': true },
      });
    });

    expect(invoke).toHaveBeenCalledWith(
      'SPEAKER_VOICE_ENROLL',
      expect.objectContaining({
        personId: 'person-alex',
        speaker: 'Remote Speaker 1',
        candidateDigest: 'cand-late-1',
      }),
    );
  });

  it('retries voice enrollment when identity revision changes due to unrelated changes', async () => {
    let enrollmentAttempt = 0;
    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_IDENTITY_STATE') return workspace;
      if (channel === 'GET_MEETING_IDENTITY') {
        return {
          ...meeting(payload?.meetingId ?? 'meeting-voice'),
          revision: 12,
          bindings: [
            {
              speaker: 'Remote Speaker 1',
              source: 'user',
              personId: 'person-alex',
              individual: true,
            },
          ],
        };
      }
      if (channel === 'SPEAKER_VOICE_GET_SUGGESTIONS') {
        return {
          suggestions: {
            'Remote Speaker 1': {
              speaker: 'Remote Speaker 1',
              suggestedPersonId: 'person-alex',
              suggestedPersonName: 'Alex Chen',
              similarityScore: 0.95,
              confidenceTier: 'high',
              isCalendarAttendee: true,
              candidateDigest: 'cand-digest-1',
              sourceRevision,
            },
          },
          candidates: {},
          enrollmentAvailability: { 'Remote Speaker 1': true },
        };
      }
      if (channel === 'SET_MEETING_IDENTITY_BINDING') {
        return {
          ...meeting(payload?.meetingId ?? 'meeting-voice'),
          revision: 10,
          bindings: [
            {
              speaker: payload.speaker,
              source: 'user',
              personId: payload.personId,
              individual: true,
            },
          ],
        };
      }
      if (channel === 'SPEAKER_VOICE_ENROLL') {
        enrollmentAttempt++;
        if (enrollmentAttempt === 1) {
          throw new Error('identity_revision_stale');
        }
        return { success: true, enrollmentId: 'enroll-retried' };
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    const input = document.querySelector(
      'input[placeholder="Search people or type a new name…"]',
    ) as HTMLInputElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Alex Chen');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const alexOption = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((option) => option.textContent?.includes('Alex Chen')) as
      | HTMLElement
      | undefined;
    await act(async () => alexOption?.click());

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirm Alex Chen'),
    );
    await act(async () => confirmButton?.click());

    expect(invoke).toHaveBeenCalledWith(
      'SPEAKER_VOICE_ENROLL',
      expect.objectContaining({ expectedRevision: 10 }),
    );

    expect(invoke).toHaveBeenCalledWith(
      'SPEAKER_VOICE_ENROLL',
      expect.objectContaining({ expectedRevision: 12 }),
    );
    expect(enrollmentAttempt).toBe(2);
  });

  it('enrolls without candidate metadata when voice suggestions request fails', async () => {
    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_IDENTITY_STATE') return workspace;
      if (channel === 'GET_MEETING_IDENTITY')
        return meeting(payload?.meetingId ?? 'meeting-voice');
      if (channel === 'SPEAKER_VOICE_GET_SUGGESTIONS') {
        throw new Error('suggestions failed');
      }
      if (channel === 'SET_MEETING_IDENTITY_BINDING') {
        return {
          ...meeting(payload?.meetingId ?? 'meeting-voice'),
          revision: 10,
          bindings: [
            {
              speaker: payload.speaker,
              source: 'user',
              personId: payload.personId,
              individual: true,
            },
          ],
        };
      }
      if (channel === 'SPEAKER_VOICE_ENROLL') {
        return { success: true, enrollmentId: 'enroll-fallback' };
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    const input = document.querySelector(
      'input[placeholder="Search people or type a new name…"]',
    ) as HTMLInputElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Alex Chen');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const alexOption = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((option) => option.textContent?.includes('Alex Chen')) as
      | HTMLElement
      | undefined;
    await act(async () => alexOption?.click());

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirm Alex Chen'),
    );
    await act(async () => confirmButton?.click());

    expect(invoke).toHaveBeenCalledWith(
      'SPEAKER_VOICE_ENROLL',
      expect.objectContaining({
        personId: 'person-alex',
        speaker: 'Remote Speaker 1',
        expectedRevision: 10,
      }),
    );
    const enrollCall = invoke.mock.calls.find(
      ([channel]) => channel === 'SPEAKER_VOICE_ENROLL',
    );
    expect(enrollCall?.[1]?.candidateDigest).toBeUndefined();
  });

  it('falls back to enrollment when voice suggestions wait times out', async () => {
    invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === 'GET_IDENTITY_STATE') return workspace;
      if (channel === 'GET_MEETING_IDENTITY')
        return meeting(payload?.meetingId ?? 'meeting-voice');
      if (channel === 'SPEAKER_VOICE_GET_SUGGESTIONS') {
        return new Promise<never>(() => {});
      }
      if (channel === 'SET_MEETING_IDENTITY_BINDING') {
        return {
          ...meeting(payload?.meetingId ?? 'meeting-voice'),
          revision: 10,
          bindings: [
            {
              speaker: payload.speaker,
              source: 'user',
              personId: payload.personId,
              individual: true,
            },
          ],
        };
      }
      if (channel === 'SPEAKER_VOICE_ENROLL') {
        return { success: true, enrollmentId: 'enroll-timeout-fallback' };
      }
      return null;
    });

    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
          metadataWaitTimeoutMs={10}
        />,
      );
    });

    const input = document.querySelector(
      'input[placeholder="Search people or type a new name…"]',
    ) as HTMLInputElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, 'Alex Chen');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const alexOption = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((option) => option.textContent?.includes('Alex Chen')) as
      | HTMLElement
      | undefined;
    await act(async () => alexOption?.click());

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirm Alex Chen'),
    );
    await act(async () => confirmButton?.click());

    expect(invoke).not.toHaveBeenCalledWith(
      'SPEAKER_VOICE_ENROLL',
      expect.anything(),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(invoke).toHaveBeenCalledWith(
      'SPEAKER_VOICE_ENROLL',
      expect.objectContaining({
        personId: 'person-alex',
        speaker: 'Remote Speaker 1',
        expectedRevision: 10,
      }),
    );
    const enrollCall = invoke.mock.calls.find(
      ([channel]) => channel === 'SPEAKER_VOICE_ENROLL',
    );
    expect(enrollCall?.[1]?.candidateDigest).toBeUndefined();
  });
});

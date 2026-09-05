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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    invoke = vi.fn(async (channel: string, payload: any) => {
      if (channel === 'GET_IDENTITY_STATE') return workspace;
      if (channel === 'GET_MEETING_IDENTITY') return meeting(payload.meetingId);
      if (channel === 'SPEAKER_VOICE_GET_SUGGESTIONS') {
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
              sourceRevision: 'gen-1',
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
              sourceRevision: 'gen-1',
              isEligibleForEnrollment: true,
              cleanDurationSeconds: 4.5,
            },
          },
        };
      }
      if (channel === 'SET_MEETING_IDENTITY_BINDING') {
        const next = meeting(payload.meetingId);
        next.bindings.push({
          speaker: payload.speaker,
          source: 'user',
          personId: payload.personId,
          individual: true,
        });
        return next;
      }
      if (channel === 'SPEAKER_VOICE_REJECT') {
        return { success: true };
      }
      if (channel === 'SPEAKER_VOICE_ENROLL') {
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
    expect(bodyText).toContain('Play reference sample');
    expect(bodyText).toContain('Confirm Alex Chen');
    expect(bodyText).toContain('Not Alex Chen');
    expect(bodyText).toContain('Remember this voice for future meetings');
  });

  it('confirms suggestion and enrolls voice profile if checkbox is checked', async () => {
    await act(async () => {
      root.render(
        <SpeakerIdentificationModal
          isOpen={true}
          onClose={() => {}}
          meetingId="meeting-voice"
        />,
      );
    });

    // Check "Remember this voice for future meetings"
    const checkbox = document.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);

    await act(async () => {
      checkbox.click();
    });
    expect(checkbox.checked).toBe(true);

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
      sourceRevision: 'gen-1',
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-1',
      expectedRevision: 10,
    });
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
      sourceRevision: 'gen-1',
      candidateDigest: 'cand-digest-1',
      personId: 'person-alex',
    });

    // Suggestion banner should be gone
    expect(document.body.textContent).not.toContain(
      'Speaker 1 may be Alex Chen',
    );
  });
});

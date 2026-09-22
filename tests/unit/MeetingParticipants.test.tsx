// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeetingIdentityState } from '../../src/api/identity';
import type { Entity } from '../../src/api/knowledgeGraph';
import {
  MeetingParticipantsPopover,
  getInitials,
  resolveMeetingParticipants,
} from '../../src/components/features/MeetingParticipants';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('MeetingParticipants', () => {
  describe('getInitials', () => {
    it('returns uppercase initials for single and multi-word names', () => {
      expect(getInitials('Avery')).toBe('AV');
      expect(getInitials('Avery Davis')).toBe('AD');
      expect(getInitials('Avery Taylor Davis')).toBe('AD');
      expect(getInitials('You')).toBe('YO');
      expect(getInitials('Avery (You)')).toBe('AV');
      expect(getInitials('')).toBe('?');
    });
  });

  describe('resolveMeetingParticipants', () => {
    it('returns empty array when no segments or attendees are present', () => {
      const result = resolveMeetingParticipants({});
      expect(result).toEqual([]);
    });

    it('filters out unknown speakers and counts turns correctly for identified speakers', () => {
      const segments = [
        { speaker: 'Unknown' },
        { speaker: 'unknown' },
        { speaker: 'Speaker 1' },
        { speaker: 'Speaker 1' },
        { speaker: 'Speaker 2' },
      ];
      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
        speakerDisplayNames: {
          'Speaker 1': 'Avery Davis',
          'Speaker 2': 'Jordan Lee',
        },
      });
      expect(result).toHaveLength(2);
      const s1 = result.find((p) => p.speakerKey === 'Speaker 1');
      const s2 = result.find((p) => p.speakerKey === 'Speaker 2');
      expect(s1?.name).toBe('Avery Davis');
      expect(s1?.turnCount).toBe(2);
      expect(s2?.name).toBe('Jordan Lee');
      expect(s2?.turnCount).toBe(1);
    });

    it('excludes unidentified speakers without confirmed identities', () => {
      const segments = [
        { speaker: 'Me' },
        { speaker: 'Speaker 1' },
        { speaker: 'Speaker 2' },
      ];
      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
      });
      expect(result).toHaveLength(1);
      expect(result[0].isSelf).toBe(true);
      expect(result[0].name).toBe('You');
    });

    it('identifies self speaker from "Me" or "You" labels or selfPersonId', () => {
      const segments = [{ speaker: 'Me' }, { speaker: 'Speaker 1' }];
      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
      });
      const me = result.find((p) => p.speakerKey === 'Me');
      expect(me?.isSelf).toBe(true);
      expect(me?.name).toBe('You');
      expect(result).toHaveLength(1); // Speaker 1 excluded because unidentified
    });

    it('resolves personId and display name from identityState bindings and excludes unidentified speakers', () => {
      const segments = [{ speaker: 'Speaker 1' }, { speaker: 'Speaker 2' }];
      const identityState: MeetingIdentityState = {
        meetingId: 'm-1',
        speakers: ['Speaker 1', 'Speaker 2'],
        selfPersonId: 'person-self',
        revision: 1,
        profile: {
          preferredName: 'Alice',
          aliases: [],
          useCases: '',
          role: '',
          industry: '',
        },
        capture: { origin: 'local', selfPersonId: 'person-self' },
        job: null,
        speakerDisplayNames: {
          'Speaker 1': 'Avery Davis',
        },
        bindings: [
          {
            speaker: 'Speaker 1',
            personId: 'person-avery',
            status: 'confirmed',
            confidence: 1,
            source: 'manual',
            confirmedAt: '2026-09-01T00:00:00Z',
          },
        ],
        people: [
          {
            id: 'person-avery',
            name: 'Avery Davis',
            role: 'Lead Architect',
          },
          {
            id: 'person-self',
            name: 'Alice',
            role: 'Product Manager',
          },
        ],
      };

      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
        identityState,
      });

      expect(result).toHaveLength(1);
      const avery = result.find((p) => p.speakerKey === 'Speaker 1');
      expect(avery?.name).toBe('Avery Davis');
      expect(avery?.personId).toBe('person-avery');
      expect(avery?.role).toBe('Lead Architect');
      expect(avery?.isAnonymous).toBe(false);

      const s2 = result.find((p) => p.speakerKey === 'Speaker 2');
      expect(s2).toBeUndefined();
    });

    it('identifies voice matched participants with isVoiceMatched flag', () => {
      const segments = [{ speaker: 'Speaker 1' }];
      const identityState: MeetingIdentityState = {
        meetingId: 'm-voice',
        speakers: ['Speaker 1'],
        selfPersonId: 'person-self',
        revision: 1,
        profile: {
          preferredName: 'Alice',
          aliases: [],
          useCases: '',
          role: '',
          industry: '',
        },
        capture: { origin: 'local', selfPersonId: 'person-self' },
        job: null,
        speakerDisplayNames: {
          'Speaker 1': 'Avery Davis',
        },
        bindings: [
          {
            speaker: 'Speaker 1',
            personId: 'person-avery',
            status: 'confirmed',
            confidence: 1,
            source: 'user',
            assignment: {
              kind: 'voice_match_strong_v1',
            },
            confirmedAt: '2026-09-01T00:00:00Z',
          } as any,
        ],
        people: [
          {
            id: 'person-avery',
            name: 'Avery Davis',
          },
        ],
      };

      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
        identityState,
      });

      expect(result).toHaveLength(1);
      expect(result[0].isVoiceMatched).toBe(true);
    });

    it('does not add calendar attendees as non-speaking participants', () => {
      const segments = [{ speaker: 'Me' }];
      const calendarAttendeeNames = ['Avery Davis', 'Jordan Lee'];
      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
        calendarAttendeeNames,
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('You');
      expect(result.find((p) => p.name === 'Jordan Lee')).toBeUndefined();
    });

    it('does not add mentioned entities as participants, but augments roles for identified speakers', () => {
      const segments = [{ speaker: 'Marcus Brody' }];
      const entities: Entity[] = [
        {
          id: 'person-marcus',
          name: 'Marcus Brody',
          normalized_name: 'marcus brody',
          type: 'person',
          metadata: JSON.stringify({ role: 'Head of Operations' }),
          saliency_score: 1,
          domain_tag: 'work',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
        {
          id: 'person-mentioned',
          name: 'Sarah Connor',
          normalized_name: 'sarah connor',
          type: 'person',
          metadata: JSON.stringify({ role: 'Advisor' }),
          saliency_score: 1,
          domain_tag: 'work',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ];

      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
        meetingEntities: entities,
      });

      expect(result).toHaveLength(1);
      const marcus = result.find((p) => p.name === 'Marcus Brody');
      expect(marcus?.role).toBe('Head of Operations');
      expect(marcus?.personId).toBe('person-marcus');
      expect(result.find((p) => p.name === 'Sarah Connor')).toBeUndefined();
    });
  });

  describe('MeetingParticipantsPopover component', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.append(container);
      root = createRoot(container);
    });

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
    });

    it('renders participant list and handles profile navigation', async () => {
      const onOpenPerson = vi.fn();
      const onIdentifySpeaker = vi.fn();
      const onClose = vi.fn();

      const participants = [
        {
          id: 'p-1',
          name: 'You',
          speakerKey: 'Me',
          personId: 'person-self',
          isSelf: true,
          isAnonymous: false,
          turnCount: 4,
          role: 'Host',
          source: 'transcript' as const,
        },
        {
          id: 'p-2',
          name: 'Avery Davis',
          speakerKey: 'Speaker 1',
          personId: 'person-avery',
          isSelf: false,
          isAnonymous: false,
          isVoiceMatched: true,
          turnCount: 6,
          role: 'Lead Architect',
          source: 'identity' as const,
        },
        {
          id: 'p-3',
          name: 'Unidentified Speaker 2',
          speakerKey: 'Remote Speaker 2',
          personId: null,
          isSelf: false,
          isAnonymous: true,
          turnCount: 2,
          role: null,
          source: 'transcript' as const,
        },
      ];

      await act(async () => {
        root.render(
          <MeetingParticipantsPopover
            participants={participants}
            onClose={onClose}
            onOpenPerson={onOpenPerson}
            onIdentifySpeaker={onIdentifySpeaker}
          />,
        );
      });

      expect(container.textContent).toContain('Participants');
      expect(container.textContent).toContain('3');
      expect(container.textContent).toContain('You');
      expect(container.textContent).toContain('Avery Davis');
      expect(container.textContent).toContain('Lead Architect');
      expect(container.textContent).toContain('Unidentified Speaker 2');
      expect(container.textContent).toContain('Recognized voice');
      expect(container.textContent).not.toContain('turns');

      // Click "View profile" for Avery
      const viewProfileButton = container.querySelector<HTMLButtonElement>(
        '[data-open-person-id="person-avery"]',
      );
      expect(viewProfileButton).not.toBeNull();
      await act(async () => {
        viewProfileButton?.click();
      });
      expect(onOpenPerson).toHaveBeenCalledWith('person-avery');

      const changeSpeakerButton = container.querySelector<HTMLButtonElement>(
        '[title="Change speaker identification for Avery Davis"]',
      );
      expect(changeSpeakerButton).not.toBeNull();
      await act(async () => {
        changeSpeakerButton?.click();
      });
      expect(onIdentifySpeaker).toHaveBeenCalledWith('Speaker 1');

      // Click "Identify" for Speaker 2
      const identifyButton = container.querySelector<HTMLButtonElement>(
        '[data-identify-speaker="Remote Speaker 2"]',
      );
      expect(identifyButton).not.toBeNull();
      await act(async () => {
        identifyButton?.click();
      });
      expect(onIdentifySpeaker).toHaveBeenCalledWith('Remote Speaker 2');
    });

    it('closes on Escape key press', async () => {
      const onClose = vi.fn();
      await act(async () => {
        root.render(
          <MeetingParticipantsPopover
            participants={[]}
            onClose={onClose}
            onOpenPerson={vi.fn()}
            onIdentifySpeaker={vi.fn()}
          />,
        );
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });

      expect(onClose).toHaveBeenCalled();
    });
  });
});

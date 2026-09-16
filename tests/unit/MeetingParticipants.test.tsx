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

    it('filters out unknown speakers and counts turns correctly', () => {
      const segments = [
        { speaker: 'Unknown' },
        { speaker: 'unknown' },
        { speaker: 'Speaker 1' },
        { speaker: 'Speaker 1' },
        { speaker: 'Speaker 2' },
      ];
      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
      });
      expect(result).toHaveLength(2);
      const s1 = result.find((p) => p.speakerKey === 'Speaker 1');
      const s2 = result.find((p) => p.speakerKey === 'Speaker 2');
      expect(s1?.turnCount).toBe(2);
      expect(s2?.turnCount).toBe(1);
    });

    it('identifies self speaker from "Me" or "You" labels or selfPersonId', () => {
      const segments = [{ speaker: 'Me' }, { speaker: 'Speaker 1' }];
      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
      });
      const me = result.find((p) => p.speakerKey === 'Me');
      expect(me?.isSelf).toBe(true);
      expect(me?.name).toBe('You');
      expect(result[0].isSelf).toBe(true); // Self sorted first
    });

    it('resolves personId and display name from identityState bindings', () => {
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

      const avery = result.find((p) => p.speakerKey === 'Speaker 1');
      expect(avery?.name).toBe('Avery Davis');
      expect(avery?.personId).toBe('person-avery');
      expect(avery?.role).toBe('Lead Architect');
      expect(avery?.isAnonymous).toBe(false);

      const s2 = result.find((p) => p.speakerKey === 'Speaker 2');
      expect(s2?.isAnonymous).toBe(true);
      expect(s2?.personId).toBeNull();
    });

    it('merges calendar attendees as non-speakers if not in transcript', () => {
      const segments = [{ speaker: 'Me' }];
      const calendarAttendeeNames = ['Avery Davis', 'Jordan Lee'];
      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
        calendarAttendeeNames,
      });

      expect(result).toHaveLength(3);
      const jordan = result.find((p) => p.name === 'Jordan Lee');
      expect(jordan?.turnCount).toBe(0);
      expect(jordan?.source).toBe('calendar');
    });

    it('augments roles from meetingEntities if entity type is person', () => {
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
      ];

      const result = resolveMeetingParticipants({
        transcriptSegments: segments,
        meetingEntities: entities,
      });

      const marcus = result.find((p) => p.name === 'Marcus Brody');
      expect(marcus?.role).toBe('Head of Operations');
      expect(marcus?.personId).toBe('person-marcus');
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
          turnCount: 6,
          role: 'Lead Architect',
          source: 'identity' as const,
        },
        {
          id: 'p-3',
          name: 'Unidentified Speaker 2',
          speakerKey: 'Speaker 2',
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

      // Click "View profile" for Avery
      const viewProfileButton = container.querySelector<HTMLButtonElement>(
        '[data-open-person-id="person-avery"]',
      );
      expect(viewProfileButton).not.toBeNull();
      await act(async () => {
        viewProfileButton?.click();
      });
      expect(onOpenPerson).toHaveBeenCalledWith('person-avery');

      // Click "Identify" for Speaker 2
      const identifyButton = container.querySelector<HTMLButtonElement>(
        '[data-identify-speaker="Speaker 2"]',
      );
      expect(identifyButton).not.toBeNull();
      await act(async () => {
        identifyButton?.click();
      });
      expect(onIdentifySpeaker).toHaveBeenCalledWith('Speaker 2');
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

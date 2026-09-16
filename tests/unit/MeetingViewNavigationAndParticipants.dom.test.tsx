// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingView } from '../../src/components/features/MeetingView';
import type { Meeting } from '../../src/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/api/intelligence', () => ({
  getMeetingAlerts: vi.fn(async () => []),
  updateAlertStatus: vi.fn(),
}));

vi.mock('../../src/api/knowledgeGraph', () => ({
  ENTITY_ICONS: {},
  extractAndProcessEntities: vi.fn(),
  getEntityMeetings: vi.fn(async () => []),
  getEntityTypeLabel: vi.fn(() => ''),
  getMeetingEntities: vi.fn(async () => []),
  getPeopleBriefingSummaries: vi.fn(async () => []),
  getRelatedEntities: vi.fn(async () => []),
  updateEntityStatus: vi.fn(),
}));

const mockMeeting: Meeting = {
  id: 'meeting-nav-participants',
  title: 'Weekly Sync',
  meeting_type: 'Recording',
  created_at: '2026-09-01T10:00:00.000Z',
  started_at: '2026-09-01T10:00:00.000Z',
  transcript_status: 'validated',
  finalization_status: 'finalized',
  transcript_json: JSON.stringify({
    lifecycleStatus: 'validated',
    segments: [
      {
        speaker: 'Me',
        text: 'Welcome everyone to the weekly sync.',
        startTime: 0,
        endTime: 4,
      },
      {
        speaker: 'Speaker 1',
        text: 'Thanks, I have some updates on architecture.',
        startTime: 5,
        endTime: 10,
      },
    ],
  }),
  transcript_validated_at: '2026-09-01T10:01:00.000Z',
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview: 'Architecture updates discussed.',
    topics: [],
    all_action_items: [],
    all_decisions: [],
    meeting_type: 'general',
  }),
};

describe('MeetingView Navigation and Participants', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke: vi.fn(async (channel: string) => {
          if (channel === 'GET_MEETING_IDENTITY') {
            return {
              meetingId: mockMeeting.id,
              speakers: ['Me', 'Speaker 1'],
              bindings: [
                {
                  speaker: 'Speaker 1',
                  personId: 'person-avery',
                  status: 'confirmed',
                  confidence: 1,
                  source: 'manual',
                  confirmedAt: '2026-09-01T10:00:00Z',
                },
              ],
              capture: { origin: 'local', selfPersonId: 'person-self' },
              people: [
                { id: 'person-avery', name: 'Avery Davis' },
                { id: 'person-self', name: 'You' },
              ],
              selfPersonId: 'person-self',
              revision: 1,
              speakerDisplayNames: {
                'Speaker 1': 'Avery Davis',
              },
              profile: {},
              job: null,
            };
          }
          return null;
        }),
        on: vi.fn(() => () => {}),
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders topline back button when onBack is provided and calls onBack on click', async () => {
    const onBack = vi.fn();

    await act(async () => {
      root.render(
        <MeetingView
          selectedMeeting={mockMeeting}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue={mockMeeting.title}
          setTitleValue={vi.fn()}
          fetchMeetings={vi.fn()}
          handleCopySummary={vi.fn()}
          copySuccess={false}
          handleDeleteMeeting={vi.fn()}
          highlightEntities={(text) => text}
          transcriptVisible={true}
          setTranscriptVisible={vi.fn()}
          onBack={onBack}
          backLabel="Avery Davis"
        />,
      );
    });

    const backButton = container.querySelector<HTMLButtonElement>(
      '.meeting-document-back',
    );
    expect(backButton).not.toBeNull();
    expect(backButton?.textContent).toContain('Avery Davis');

    await act(async () => {
      backButton?.click();
    });

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not render topline back button when onBack is not provided', async () => {
    await act(async () => {
      root.render(
        <MeetingView
          selectedMeeting={mockMeeting}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue={mockMeeting.title}
          setTitleValue={vi.fn()}
          fetchMeetings={vi.fn()}
          handleCopySummary={vi.fn()}
          copySuccess={false}
          handleDeleteMeeting={vi.fn()}
          highlightEntities={(text) => text}
          transcriptVisible={true}
          setTranscriptVisible={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('.meeting-document-back')).toBeNull();
  });

  it('renders participant count trigger and opens popover on click', async () => {
    const onOpenPerson = vi.fn();

    await act(async () => {
      root.render(
        <MeetingView
          selectedMeeting={mockMeeting}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue={mockMeeting.title}
          setTitleValue={vi.fn()}
          fetchMeetings={vi.fn()}
          handleCopySummary={vi.fn()}
          copySuccess={false}
          handleDeleteMeeting={vi.fn()}
          highlightEntities={(text) => text}
          transcriptVisible={true}
          setTranscriptVisible={vi.fn()}
          onOpenPerson={onOpenPerson}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-meeting-participants-trigger]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain('2 participants');

    // Popover is initially closed
    expect(container.querySelector('.meeting-participants-popover')).toBeNull();

    // Click trigger to open popover
    await act(async () => {
      trigger?.click();
    });

    const popover = container.querySelector('.meeting-participants-popover');
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain('Avery Davis');

    // Click "Profile" on Avery Davis
    const profileButton = container.querySelector<HTMLButtonElement>(
      '[data-open-person-id="person-avery"]',
    );
    expect(profileButton).not.toBeNull();

    await act(async () => {
      profileButton?.click();
    });

    expect(onOpenPerson).toHaveBeenCalledWith('person-avery');
  });

  it('allows clicking identified speaker name in transcript turns to open their profile', async () => {
    const onOpenPerson = vi.fn();

    await act(async () => {
      root.render(
        <MeetingView
          selectedMeeting={mockMeeting}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue={mockMeeting.title}
          setTitleValue={vi.fn()}
          fetchMeetings={vi.fn()}
          handleCopySummary={vi.fn()}
          copySuccess={false}
          handleDeleteMeeting={vi.fn()}
          highlightEntities={(text) => text}
          transcriptVisible={true}
          setTranscriptVisible={vi.fn()}
          onOpenPerson={onOpenPerson}
        />,
      );
    });

    // In the transcript turns, Avery Davis should have title "View Avery Davis's profile"
    const averySpeakerButton = container.querySelector<HTMLElement>(
      '[title="View Avery Davis\'s profile"]',
    );
    expect(averySpeakerButton).not.toBeNull();
    expect(averySpeakerButton?.textContent).toContain('Avery Davis');

    await act(async () => {
      averySpeakerButton?.click();
    });

    expect(onOpenPerson).toHaveBeenCalledWith('person-avery');
  });
});

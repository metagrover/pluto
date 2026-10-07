// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingView } from '../../src/components/features/MeetingView';
import { buildMeetingTranscriptTurns } from '../../src/components/features/meetingTranscriptPresentation';
import type * as TranscriptPresentation from '../../src/components/features/meetingTranscriptPresentation';
import { getMeetingEntities } from '../../src/api/knowledgeGraph';
import type { Meeting } from '../../src/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock(
  '../../src/components/features/meetingTranscriptPresentation',
  async (importOriginal) => {
    const original = await importOriginal<typeof TranscriptPresentation>();
    return {
      ...original,
      buildMeetingTranscriptTurns: vi.fn(original.buildMeetingTranscriptTurns),
    };
  },
);

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

  it('shows saved notes and names without fetching identity or entities again, and loads identity when participants open', async () => {
    const meeting = {
      ...mockMeeting,
      speaker_display_names: { 'Speaker 1': 'Avery Davis' },
      meeting_entities: [],
    };
    vi.mocked(getMeetingEntities).mockClear();
    vi.mocked(buildMeetingTranscriptTurns).mockClear();
    const render = async (
      selectedMeeting = meeting,
      transcriptVisible = false,
    ) => {
      await act(async () =>
        root.render(
          <MeetingView
            selectedMeeting={selectedMeeting}
            editingTitle={false}
            setEditingTitle={vi.fn()}
            titleValue={selectedMeeting.title}
            setTitleValue={vi.fn()}
            fetchMeetings={vi.fn()}
            handleCopySummary={vi.fn()}
            copySuccess={false}
            handleDeleteMeeting={vi.fn()}
            highlightEntities={(text) => text}
            transcriptVisible={transcriptVisible}
            setTranscriptVisible={vi.fn()}
          />,
        ),
      );
    };
    await render();
    expect(container.textContent).toContain('Architecture updates discussed.');
    expect(
      container.querySelector('[data-meeting-skeleton="notes-loading"]'),
    ).toBeNull();
    expect(window.ipcRenderer.invoke).not.toHaveBeenCalledWith(
      'GET_MEETING_IDENTITY',
      expect.anything(),
    );
    expect(getMeetingEntities).not.toHaveBeenCalled();
    expect(buildMeetingTranscriptTurns).not.toHaveBeenCalled();

    // A detail refresh must replace the saved name without requiring a full identity fetch.
    await render({
      ...meeting,
      speaker_display_names: { 'Speaker 1': 'Avery Updated' },
    });
    const invoke = vi.mocked(window.ipcRenderer.invoke);
    const originalInvoke = invoke.getMockImplementation()!;
    let resolveIdentity!: (value: unknown) => void;
    invoke.mockImplementation((channel, ...args) =>
      channel === 'GET_MEETING_IDENTITY'
        ? new Promise((resolve) => {
            resolveIdentity = resolve;
          })
        : originalInvoke(channel, ...args),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-meeting-participants-trigger]',
        )!
        .click(),
    );
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'GET_MEETING_IDENTITY',
      { meetingId: meeting.id },
    );
    expect(container.textContent).toContain('Avery Updated');
    await act(async () =>
      resolveIdentity(
        await originalInvoke('GET_MEETING_IDENTITY', { meetingId: meeting.id }),
      ),
    );
    expect(container.textContent).toContain('Avery Davis');
    expect(getMeetingEntities).not.toHaveBeenCalled();
    expect(buildMeetingTranscriptTurns).not.toHaveBeenCalled();
    invoke.mockImplementation(originalInvoke);
    await render(meeting, true);
    expect(container.textContent).toContain(
      'Thanks, I have some updates on architecture.',
    );
    expect(buildMeetingTranscriptTurns).toHaveBeenCalled();
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
    expect(container.querySelector('[aria-label="Notes sections"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Meeting preparation"]'),
    ).toBeNull();
    expect(container.querySelector('[data-meeting-prep-document]')).toBeNull();
  });

  it('does not expose source attachment controls while Sources is disabled', async () => {
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

    expect(
      container.querySelector('[aria-label="Attach reference document"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain('Reference material');
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

  it('renders pre-hydrated speaker names and participants immediately without flashing unidentified speakers', async () => {
    const preHydratedMeeting: Meeting = {
      ...mockMeeting,
      id: 'meeting-prehydrated',
      speaker_display_names: {
        'Speaker 1': 'Avery Davis',
      },
      meeting_entities: [
        {
          id: 'person-avery',
          name: 'Avery Davis',
          type: 'person',
        } as any,
      ],
      identity_state: {
        meetingId: 'meeting-prehydrated',
        speakers: ['Me', 'Speaker 1'],
        bindings: [
          {
            speaker: 'Speaker 1',
            personId: 'person-avery',
            status: 'confirmed',
            confidence: 1,
            source: 'manual',
            confirmedAt: '2026-09-01T10:00:00Z',
          } as any,
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
        profile: {} as any,
        job: null,
      },
    };

    act(() => {
      root.render(
        <MeetingView
          selectedMeeting={preHydratedMeeting}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue={preHydratedMeeting.title}
          setTitleValue={vi.fn()}
          fetchMeetings={vi.fn()}
          handleCopySummary={vi.fn()}
          copySuccess={false}
          handleDeleteMeeting={vi.fn()}
          highlightEntities={(text) => text}
          transcriptVisible={true}
          setTranscriptVisible={vi.fn()}
          onOpenPerson={vi.fn()}
        />,
      );
    });

    // 1. Participant count trigger is rendered
    const participantsButton = container.querySelector<HTMLButtonElement>(
      '[data-meeting-participants-trigger]',
    );
    expect(participantsButton?.textContent).toContain('2 participants');

    // 2. Open popover immediately and verify Avery Davis is listed as participant
    await act(async () => {
      participantsButton?.click();
    });
    const popover = container.querySelector('.meeting-participants-popover');
    expect(popover?.textContent).toContain('Avery Davis');
    // Verify there are no anonymous/unidentified speaker action buttons
    expect(popover?.querySelector('button:has-text("Identify")')).toBeNull();

    // 3. Transcript speaker immediately shows Avery Davis
    const averySpeakerButton = container.querySelector<HTMLElement>(
      '[title="View Avery Davis\'s profile"]',
    );
    expect(averySpeakerButton).not.toBeNull();
    expect(averySpeakerButton?.textContent).toBe('Avery Davis');
  });

  it('renders gentle skeleton loader while meeting detail is loading and switches to notes once loaded', async () => {
    const summaryOnlyMeeting: Meeting = {
      id: 'meeting-summary-only',
      title: 'Sprint Planning',
      meeting_type: 'Recording',
      created_at: '2026-09-01T10:00:00.000Z',
      started_at: '2026-09-01T10:00:00.000Z',
      transcript_status: 'validated',
      finalization_status: 'finalized',
    };

    // 1. When switching meetings and detail is loading (summary only)
    await act(async () => {
      root.render(
        <MeetingView
          selectedMeeting={summaryOnlyMeeting}
          isLoadingDetail={true}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue={summaryOnlyMeeting.title}
          setTitleValue={vi.fn()}
          fetchMeetings={vi.fn()}
          handleCopySummary={vi.fn()}
          copySuccess={false}
          handleDeleteMeeting={vi.fn()}
          highlightEntities={(text) => text}
          transcriptVisible={false}
          setTranscriptVisible={vi.fn()}
        />,
      );
    });

    const skeleton = container.querySelector(
      '[data-meeting-skeleton="notes-loading"]',
    );
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute('aria-label')).toBe('Loading meeting notes');

    // 2. Once meeting detail arrives with analysis
    await act(async () => {
      root.render(
        <MeetingView
          selectedMeeting={mockMeeting}
          isLoadingDetail={false}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue={mockMeeting.title}
          setTitleValue={vi.fn()}
          fetchMeetings={vi.fn()}
          handleCopySummary={vi.fn()}
          copySuccess={false}
          handleDeleteMeeting={vi.fn()}
          highlightEntities={(text) => text}
          transcriptVisible={false}
          setTranscriptVisible={vi.fn()}
        />,
      );
    });

    expect(
      container.querySelector('[data-meeting-skeleton="notes-loading"]'),
    ).toBeNull();
    expect(container.textContent).toContain('Architecture updates discussed.');
  });

  it('renders gentle skeleton loader when selectedMeeting is undefined but isLoadingDetail is true', async () => {
    await act(async () => {
      root.render(
        <MeetingView
          selectedMeeting={undefined}
          isLoadingDetail={true}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue=""
          setTitleValue={vi.fn()}
          fetchMeetings={vi.fn()}
          handleCopySummary={vi.fn()}
          copySuccess={false}
          handleDeleteMeeting={vi.fn()}
          highlightEntities={(text) => text}
          transcriptVisible={false}
          setTranscriptVisible={vi.fn()}
        />,
      );
    });

    const skeleton = container.querySelector(
      '[data-meeting-skeleton="notes-loading"]',
    );
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute('aria-label')).toBe('Loading meeting notes');
  });
});

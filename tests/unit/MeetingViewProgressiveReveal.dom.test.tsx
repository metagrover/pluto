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
  getRelatedEntities: vi.fn(async () => []),
  updateEntityStatus: vi.fn(),
}));

vi.mock('../../src/components/KnowledgeGraph/EntitySidebar', () => ({
  EntitySidebar: () => null,
}));

const baseMeeting: Meeting = {
  id: 'meeting-progressive-dom',
  title: 'Design review',
  meeting_type: 'Recording',
  created_at: '2026-08-17T18:00:00.000Z',
  started_at: '2026-08-17T18:00:00.000Z',
  transcript_status: 'validating',
  finalization_status: 'finalized',
  transcript_json: JSON.stringify({
    lifecycleStatus: 'validating',
    segments: [
      {
        speaker: 'Me',
        text: 'The transcript is ready first.',
        startTime: 0,
        endTime: 2,
      },
    ],
  }),
};

const analyzedMeeting: Meeting = {
  ...baseMeeting,
  transcript_status: 'validated',
  transcript_validated_at: '2026-08-17T18:05:00.000Z',
  audio_path: '/tmp/mic.wav',
  system_audio_path: '/tmp/system.wav',
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview: 'The analysis arrived in place.',
    topics: [],
    all_action_items: [],
    all_decisions: [],
    meeting_type: 'general',
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
  }),
};

describe('MeetingView progressive reveal', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke: vi.fn(async () => null) },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderMeeting = (meeting: Meeting, transcriptVisible = false) =>
    root.render(
      <MeetingView
        selectedMeeting={meeting}
        editingTitle={false}
        setEditingTitle={vi.fn()}
        titleValue={meeting.title}
        setTitleValue={vi.fn()}
        fetchMeetings={vi.fn()}
        handleCopySummary={vi.fn()}
        copySuccess={false}
        handleDeleteMeeting={vi.fn()}
        highlightEntities={(text) => text}
        transcriptVisible={transcriptVisible}
        setTranscriptVisible={vi.fn()}
      />,
    );

  it('replaces the analysis skeleton in place when analysis arrives', async () => {
    await act(async () => renderMeeting(baseMeeting));

    const pageBefore = container.querySelector('[data-meeting-page]');
    expect(pageBefore).not.toBeNull();
    expect(
      container.querySelector('[data-meeting-skeleton="analysis"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-meeting-skeleton="analysis"]')
        ?.classList.contains('max-w-[760px]'),
    ).toBe(true);
    expect(container.textContent).not.toContain(
      'The transcript is ready first.',
    );

    await act(async () => renderMeeting(analyzedMeeting));

    expect(container.querySelector('[data-meeting-page]')).toBe(pageBefore);
    expect(
      container.querySelector('[data-meeting-skeleton="analysis"]'),
    ).toBeNull();
    expect(container.textContent).toContain('The analysis arrived in place.');
  });

  it('keeps the note primary and reveals the transcript progressively', async () => {
    await act(async () => renderMeeting(analyzedMeeting));

    const transcriptButton = container.querySelector<HTMLButtonElement>(
      'button[data-meeting-transcript-toggle]',
    );

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(transcriptButton?.textContent).toContain('Transcript');
    expect(container.textContent).toContain('The analysis arrived in place.');
    expect(
      container.querySelector('[data-meeting-artifact="transcript"]'),
    ).toBeNull();
  });

  it('renders timestamps from canonical transcript timing fields', async () => {
    await act(async () =>
      renderMeeting(
        {
          ...analyzedMeeting,
          transcript_json: JSON.stringify({
            lifecycleStatus: 'validated',
            segments: [
              {
                speaker: 'Me',
                text: 'The canonical timestamp is preserved.',
                startTime: 75,
                endTime: 80,
              },
            ],
          }),
        },
        true,
      ),
    );

    expect(
      container.querySelector('[data-meeting-artifact="transcript"] time')
        ?.textContent,
    ).toBe('1:15');
  });

  it('renders the readable transcript while preserving canonical timestamps', async () => {
    await act(async () =>
      renderMeeting(
        {
          ...analyzedMeeting,
          transcript_json: JSON.stringify({
            lifecycleStatus: 'validated',
            segments: [
              {
                speaker: 'Them',
                text: 'Um the rollout is uh ready',
                startTime: 75,
                endTime: 80,
              },
            ],
          }),
        },
        true,
      ),
    );

    const transcript = container.querySelector(
      '[data-meeting-artifact="transcript"]',
    );
    expect(transcript?.textContent).toContain('The rollout is ready.');
    expect(transcript?.textContent).not.toContain('Um the rollout');
    expect(transcript?.querySelector('time')?.textContent).toBe('1:15');
  });

  it('keeps the saved transcript at the end when analysis is unavailable', async () => {
    await act(async () =>
      renderMeeting({
        ...baseMeeting,
        transcript_status: 'validated',
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'failed',
          stage: 'analysis',
        }),
      }),
    );

    const transcript = container.querySelector(
      '[data-meeting-transcript-toggle]',
    );
    const placeholder = container.querySelector(
      '[data-meeting-analysis-placeholder]',
    );

    expect(transcript).not.toBeNull();
    expect(placeholder?.textContent).toContain(
      'They will appear here when analysis completes.',
    );
    expect(
      placeholder?.compareDocumentPosition(transcript as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-meeting-page]')
        ?.classList.contains('meeting-document--transcript-collapsed'),
    ).toBe(true);
  });

  it('does not reserve empty-page space after the transcript is opened', async () => {
    await act(async () => renderMeeting(analyzedMeeting, true));

    expect(
      container
        .querySelector('[data-meeting-page]')
        ?.classList.contains('meeting-document--transcript-collapsed'),
    ).toBe(false);
  });

  it('offers the approved notes templates', async () => {
    await act(async () => renderMeeting(analyzedMeeting));

    const template = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Notes template"]',
    );
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value',
    )?.set;

    await act(async () => {
      if (!template || !valueSetter) return;
      valueSetter.call(template, 'project_kickoff');
      template.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(template?.value).toBe('project_kickoff');
    expect(container.textContent).toContain('Notes template');
    expect(container.textContent).toContain('Export meeting');
    expect(container.textContent).toContain('Delete meeting');
    expect(
      Array.from(template?.options || []).map((option) => option.text),
    ).toEqual([
      'Auto',
      '1:1',
      'Team sync',
      'Customer call',
      'Interview',
      'Project kickoff',
    ]);
  });

  it('keeps existing notes visible and offers recovery when regeneration fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'GENERATE_ANALYSIS_V2') {
        return {
          analysis: {
            analysis_schema_version: 3,
            overview: 'Fallback analysis',
            topics: [],
            all_action_items: [],
            all_decisions: [],
            meeting_type: 'general',
            quality: {
              format_pass: false,
              retry_count: 1,
              fallback_used: true,
              issues: ['All per-topic analysis passes failed'],
            },
          },
          signals: {},
        };
      }
      return null;
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke },
    });

    await act(async () =>
      renderMeeting({
        ...analyzedMeeting,
        transcript_integrity_json: JSON.stringify({
          schemaVersion: 2,
          state: 'validated',
          causes: [],
          evidenceProvenance: { kind: 'stored_capture_activity_v1' },
          validationProof: {
            gateVersion: 'canonical_integrity_v1',
            validatedAt: analyzedMeeting.transcript_validated_at,
          },
        }),
        transcript_json: JSON.stringify({
          lifecycleStatus: 'validated',
          segments: [
            {
              speaker: 'Me',
              text: 'The transcript is ready for regeneration.',
              startTime: 0,
              endTime: 2,
            },
          ],
        }),
      }),
    );
    const regenerate = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Regenerate Enhanced Notes"]',
    );
    expect(regenerate).not.toBeNull();

    await act(async () => regenerate?.click());

    const notice = container.querySelector('[role="alert"]');
    expect(notice?.textContent).toContain("Notes weren't regenerated");
    expect(notice?.textContent).toContain('Your current notes are unchanged.');
    expect(notice?.textContent).toContain('Try again');
    expect(notice?.textContent).not.toContain('Verify LLM provider');
    expect(container.textContent).toContain('The analysis arrived in place.');

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Dismiss regeneration error"]',
        )
        ?.click(),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

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

vi.mock('../../src/components/features/V3AnalysisViewer', () => ({
  V3AnalysisViewer: ({ doc }: { doc: { overview: string } }) => (
    <div data-analysis-content>{doc.overview}</div>
  ),
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

  const renderMeeting = (meeting: Meeting) =>
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
        transcriptVisible={false}
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
    expect(container.textContent).not.toContain(
      'The transcript is ready first.',
    );

    await act(async () => renderMeeting(analyzedMeeting));

    expect(container.querySelector('[data-meeting-page]')).toBe(pageBefore);
    expect(
      container.querySelector('[data-meeting-skeleton="analysis"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-analysis-content]')?.textContent,
    ).toBe('The analysis arrived in place.');
  });

  it('uses Notes and Transcript as workspace tabs with Notes selected', async () => {
    await act(async () => renderMeeting(analyzedMeeting));

    const tabs = container.querySelector('[role="tablist"]');
    const notesTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][data-meeting-tab="notes"]',
    );
    const transcriptTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][data-meeting-tab="transcript"]',
    );

    expect(tabs).not.toBeNull();
    expect(notesTab?.getAttribute('aria-selected')).toBe('true');
    expect(transcriptTab?.getAttribute('aria-selected')).toBe('false');
    expect(container.querySelector('[data-analysis-content]')).not.toBeNull();
    expect(
      container.querySelector('[data-meeting-artifact="transcript"]'),
    ).toBeNull();
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
});

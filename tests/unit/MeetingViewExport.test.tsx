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

const mockMeeting: Meeting = {
  id: 'meeting-export-1',
  title: 'Export Feature Sync',
  meeting_type: 'Recording',
  created_at: '2026-09-03T18:00:00.000Z',
  started_at: '2026-09-03T18:00:00.000Z',
  duration_seconds: 1800,
  transcript_status: 'validated',
  finalization_status: 'finalized',
  transcript_json: JSON.stringify({
    lifecycleStatus: 'validated',
    segments: [
      {
        speaker: 'Sarah',
        text: 'Let us export meeting notes cleanly.',
        startTime: 0,
        endTime: 2,
      },
    ],
  }),
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview: 'Team finalized the Markdown export plan.',
    all_decisions: [{ text: 'Export as Markdown', decided_by: 'Sarah' }],
    all_action_items: [
      { text: 'Add unit tests', assignee: 'Dev', due: 'Today' },
    ],
    topics: [
      {
        title: 'Export Options',
        summary: 'Discussion on format choices.',
        key_points: [
          { text: 'Markdown is portable across editors.', speaker: 'Sarah' },
        ],
        decisions: [],
        open_questions: [],
      },
    ],
  }),
};

describe('MeetingView export action', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke: vi.fn(async () => null),
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('exposes "Export meeting notes" and downloads a sanitized .md file without raw transcript', async () => {
    await act(async () => {
      root.render(
        <MeetingView
          selectedMeeting={mockMeeting}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue="Export Feature Sync"
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

    const exportButton = container.querySelector(
      'button[aria-label="Export meeting notes"]',
    ) as HTMLButtonElement | null;

    expect(exportButton).not.toBeNull();
    expect(exportButton?.textContent).toContain('Export meeting notes');

    // Intercept URL creation and anchor click
    let capturedBlob: Blob | null = null;
    let clickedDownloadFilename = '';

    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((blob: Blob | MediaSource) => {
        capturedBlob = blob as Blob;
        return 'blob:mock-url';
      });
    const revokeObjectURLSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedDownloadFilename = this.download;
      });

    await act(async () => {
      exportButton?.click();
    });

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(clickedDownloadFilename).toBe('export-feature-sync-2026-09-03.md');
    expect(capturedBlob).not.toBeNull();
    expect(capturedBlob?.type).toBe('text/markdown;charset=utf-8');

    // Verify blob content
    const textContent = await capturedBlob?.text();
    expect(textContent).toContain('# Export Feature Sync');
    expect(textContent).toContain('## Decisions & next steps');
    expect(textContent).toContain(
      '- [ ] Export as Markdown (Decided by: Sarah)',
    );
    expect(textContent).toContain('## Overview');
    expect(textContent).toContain('Team finalized the Markdown export plan.');
    expect(textContent).not.toContain('"transcript_json"');
    expect(textContent).not.toContain('lifecycleStatus');
  });

  it('appends ## Transcript when exportIncludeTranscript is true', async () => {
    await act(async () => {
      root.render(
        <MeetingView
          selectedMeeting={mockMeeting}
          editingTitle={false}
          setEditingTitle={vi.fn()}
          titleValue="Export Feature Sync"
          setTitleValue={vi.fn()}
          fetchMeetings={vi.fn()}
          handleCopySummary={vi.fn()}
          copySuccess={false}
          handleDeleteMeeting={vi.fn()}
          highlightEntities={(text) => text}
          transcriptVisible={false}
          setTranscriptVisible={vi.fn()}
          exportIncludeTranscript={true}
        />,
      );
    });

    const exportButton = container.querySelector(
      'button[aria-label="Export meeting notes"]',
    ) as HTMLButtonElement | null;

    let capturedBlob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (blob: Blob | MediaSource) => {
        capturedBlob = blob as Blob;
        return 'blob:mock-url';
      },
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      exportButton?.click();
    });

    const textContent = await capturedBlob?.text();
    expect(textContent).toContain('## Transcript');
    expect(textContent).toContain('**Sarah** (0:00)');
    expect(textContent).toContain('Let us export meeting notes cleanly.');
  });
});

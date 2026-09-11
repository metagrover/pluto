import { describe, expect, it } from 'vitest';
import type { MeetingCalendarContext } from '../../electron/calendar/types';
import type { Meeting, TranscriptSegment } from '../../src/types';
import type { MeetingNotesDocumentModel } from '../../src/utils/meetingNotesDocument';
import {
  buildMeetingExportFilename,
  formatMeetingNotesAsMarkdown,
} from '../../src/utils/meetingNotesExport';

describe('meetingNotesExport', () => {
  describe('buildMeetingExportFilename', () => {
    it('generates a clean slugified filename with date', () => {
      const filename = buildMeetingExportFilename(
        'Product Architecture Review',
        '2026-09-03T18:30:00.000Z',
        42,
      );
      expect(filename).toBe('product-architecture-review-2026-09-03.md');
    });

    it('sanitizes illegal filesystem characters and extra spaces', () => {
      const filename = buildMeetingExportFilename(
        'Weekly Q&A: "Roadmap/Goals" *Draft*? <v1>',
        '2026-09-03T18:30:00.000Z',
        42,
      );
      expect(filename).toBe('weekly-q-a-roadmap-goals-draft-v1-2026-09-03.md');
    });

    it('falls back to pluto-session-id when title is blank or only special characters', () => {
      const filename = buildMeetingExportFilename(
        '   *** / \\ ???   ',
        '2026-09-03T18:30:00.000Z',
        99,
      );
      expect(filename).toBe('pluto-session-99-2026-09-03.md');
    });

    it('truncates excessively long titles to a safe length', () => {
      const longTitle =
        'This is an extremely long meeting title designed to test whether the filename generator truncates appropriately to avoid filesystem limits';
      const filename = buildMeetingExportFilename(
        longTitle,
        '2026-09-03T18:30:00.000Z',
        1,
      );
      expect(filename.endsWith('-2026-09-03.md')).toBe(true);
      expect(filename.length).toBeLessThanOrEqual(80);
    });
  });

  describe('formatMeetingNotesAsMarkdown', () => {
    const baseMeeting: Meeting = {
      id: 'meeting-123',
      title: 'Quarterly Planning Sync',
      created_at: '2026-09-03T18:30:00.000Z',
      duration_seconds: 2700, // 45 min
      transcript_json: JSON.stringify([
        { text: 'Hello team', speaker: 'Sarah' },
        { text: 'Ready to plan', speaker: 'David' },
      ]),
    };

    const mockCalendarContext: MeetingCalendarContext = {
      calendarTitle: 'Work',
      matchConfidence: 'exact',
      event: {
        occurrenceKey: 'occ-1',
        eventIdentifier: 'ev-1',
        calendarIdentifier: 'cal-1',
        title: 'Quarterly Planning Sync',
        start: '2026-09-03T18:30:00.000Z',
        end: '2026-09-03T19:15:00.000Z',
        isAllDay: false,
        isCancelled: false,
        availability: 'busy',
        organizer: { name: 'Sarah Connor', email: 'sarah@example.com' },
        attendees: [
          { name: 'Sarah Connor', email: 'sarah@example.com' },
          { name: 'David Miller', email: 'david@example.com' },
          { name: null, email: 'external@partner.com' },
        ],
        lastModified: null,
      },
    };

    const mockDocumentModel: MeetingNotesDocumentModel = {
      hasAnalysis: true,
      sections: [
        {
          id: 'outcomes',
          kind: 'outcomes',
          title: 'Decisions & next steps',
          blocks: [
            {
              id: 'd-1',
              text: 'Ship the export feature by Friday',
              originalText: 'Ship the export feature by Friday',
              authorship: 'ai',
              edited: false,
              speaker: 'Sarah Connor',
              completed: true,
              blockType: 'decision',
            },
            {
              id: 'a-1',
              text: 'Draft the user documentation',
              originalText: 'Draft the user documentation',
              authorship: 'ai',
              edited: true,
              assignee: 'David Miller',
              due: 'September 5',
              completed: false,
              blockType: 'action',
            },
          ],
        },
        {
          id: 'current-read',
          kind: 'current_read',
          title: 'Overview',
          blocks: [
            {
              id: 'ov-1',
              text: 'The team reviewed Q3 milestones and agreed on delivery priorities.',
              originalText: 'The team reviewed Q3 milestones.',
              authorship: 'ai',
              edited: true,
              blockType: 'paragraph',
            },
          ],
        },
        {
          id: 'topic-0',
          kind: 'discussion',
          title: 'Export Capabilities',
          blocks: [
            {
              id: 'top-summary',
              text: 'Discussed exporting notes as Markdown instead of raw text or heavy PDFs.',
              originalText: 'Discussed exporting notes.',
              authorship: 'ai',
              edited: false,
            },
            {
              id: 'top-point-1',
              text: 'Markdown format is widely portable across modern notes apps.',
              originalText: 'Markdown format is widely portable.',
              authorship: 'ai',
              speaker: 'David Miller',
              edited: false,
            },
          ],
        },
        {
          id: 'open-questions',
          kind: 'open_questions',
          title: 'Open questions',
          blocks: [
            {
              id: 'q-1',
              text: 'Should we support custom templates in a future update?',
              originalText: 'Should we support custom templates?',
              authorship: 'ai',
              edited: false,
            },
          ],
        },
        {
          id: 'scratchpad',
          kind: 'scratchpad',
          title: 'Your notes',
          blocks: [
            {
              id: 'sp-1',
              text: 'Private scratchpad text that was synthesized',
              originalText: 'Private scratchpad text',
              authorship: 'human',
              edited: false,
            },
          ],
        },
      ],
    };

    it('formats meeting notes with calendar metadata and structured sections', () => {
      const markdown = formatMeetingNotesAsMarkdown({
        meeting: baseMeeting,
        documentModel: mockDocumentModel,
        calendarContext: mockCalendarContext,
      });

      // Title & Metadata
      expect(markdown).toContain('# Quarterly Planning Sync');
      expect(markdown).toContain('**Duration:** 45 min');
      expect(markdown).toContain(
        '**Calendar Event:** Quarterly Planning Sync (Work)',
      );
      expect(markdown).toContain(
        '**Organizer:** Sarah Connor <sarah@example.com>',
      );
      expect(markdown).toContain(
        '**Attendees:** Sarah Connor, David Miller, external@partner.com',
      );

      // Outcomes
      expect(markdown).toContain('## Decisions & next steps');
      expect(markdown).toContain(
        '- [x] Ship the export feature by Friday (Decided by: Sarah Connor)',
      );
      expect(markdown).toContain(
        '- [ ] Draft the user documentation (Assignee: David Miller, Due: September 5)',
      );

      // Overview
      expect(markdown).toContain('## Overview');
      expect(markdown).toContain(
        'The team reviewed Q3 milestones and agreed on delivery priorities.',
      );

      // Discussion topic
      expect(markdown).toContain('## Export Capabilities');
      expect(markdown).toContain(
        'Discussed exporting notes as Markdown instead of raw text or heavy PDFs.',
      );
      expect(markdown).toContain(
        '- David Miller: Markdown format is widely portable across modern notes apps.',
      );

      // Open questions
      expect(markdown).toContain('## Open questions');
      expect(markdown).toContain(
        '- Should we support custom templates in a future update?',
      );

      // Standalone scratchpad should NOT be appended when hasAnalysis is true
      expect(markdown).not.toContain('## Your notes');
      expect(markdown).not.toContain(
        'Private scratchpad text that was synthesized',
      );

      // Raw transcript JSON must NOT be leaked
      expect(markdown).not.toContain('"transcript_json"');
      expect(markdown).not.toContain('Hello team');
    });

    it('falls back to detected transcript speakers when no calendar context exists', () => {
      const transcriptSegments: TranscriptSegment[] = [
        { text: 'First speaker comment', speaker: 'Alice' },
        { text: 'Second speaker comment', speaker: 'Bob' },
        { text: 'Third speaker comment', speaker: 'Alice' },
        { text: 'Unknown speaker comment', speaker: 'Unknown' },
      ];

      const markdown = formatMeetingNotesAsMarkdown({
        meeting: { ...baseMeeting, duration_seconds: 40 },
        documentModel: mockDocumentModel,
        transcriptSegments,
      });

      expect(markdown).toContain('**Duration:** < 1 min');
      expect(markdown).not.toContain('**Calendar Event:**');
      expect(markdown).toContain('**Participants:** Alice, Bob');
    });

    it('exports user notes directly when meeting has no enhanced analysis', () => {
      const unanalyzedModel: MeetingNotesDocumentModel = {
        hasAnalysis: false,
        sections: [
          {
            id: 'scratchpad',
            kind: 'scratchpad',
            title: 'Your notes',
            blocks: [
              {
                id: 'scratchpad-content',
                text: 'Meeting scratchpad notes before AI analysis ran.\n- Point 1\n- Point 2',
                originalText:
                  'Meeting scratchpad notes before AI analysis ran.',
                authorship: 'human',
                edited: false,
              },
            ],
          },
        ],
      };

      const markdown = formatMeetingNotesAsMarkdown({
        meeting: { ...baseMeeting, user_notes: 'Meeting scratchpad notes' },
        documentModel: unanalyzedModel,
      });

      expect(markdown).toContain('# Quarterly Planning Sync');
      expect(markdown).toContain(
        'Meeting scratchpad notes before AI analysis ran.',
      );
      expect(markdown).toContain('- Point 1');
      expect(markdown).not.toContain('## Decisions & next steps');
    });

    it('appends a formatted transcript section when includeTranscript is true', () => {
      const transcriptSegments: TranscriptSegment[] = [
        { text: 'Hello team, welcome.', speaker: 'Sarah Connor', startTime: 0 },
        { text: 'Let us begin.', speaker: 'Sarah Connor', startTime: 5 },
        { text: 'Ready to plan.', speaker: 'David Miller', startTime: 15 },
      ];

      const markdown = formatMeetingNotesAsMarkdown({
        meeting: baseMeeting,
        documentModel: mockDocumentModel,
        transcriptSegments,
        includeTranscript: true,
      });

      expect(markdown).toContain('## Transcript');
      expect(markdown).toContain('**Sarah Connor** (0:00)');
      expect(markdown).toContain('Hello team, welcome. Let us begin.');
      expect(markdown).toContain('**David Miller** (0:15)');
      expect(markdown).toContain('Ready to plan.');
    });

    it('does not append transcript section when includeTranscript is false or omitted', () => {
      const transcriptSegments: TranscriptSegment[] = [
        { text: 'Hello team, welcome.', speaker: 'Sarah Connor', startTime: 0 },
      ];

      const markdown = formatMeetingNotesAsMarkdown({
        meeting: baseMeeting,
        documentModel: mockDocumentModel,
        transcriptSegments,
        includeTranscript: false,
      });

      expect(markdown).not.toContain('## Transcript');
      expect(markdown).not.toContain('Hello team, welcome.');
    });

    it('does not append transcript section when includeTranscript is true but segments are empty', () => {
      const markdown = formatMeetingNotesAsMarkdown({
        meeting: baseMeeting,
        documentModel: mockDocumentModel,
        transcriptSegments: [],
        includeTranscript: true,
      });

      expect(markdown).not.toContain('## Transcript');
    });

    it('renders projected speaker display names in outcomes, discussion, and transcript', () => {
      const projectedDocumentModel: MeetingNotesDocumentModel = {
        hasAnalysis: true,
        sections: [
          {
            id: 'outcomes',
            kind: 'outcomes',
            title: 'Decisions & next steps',
            blocks: [
              {
                id: 'd-1',
                text: 'Ayush decided to adopt the new schema',
                originalText: 'Speaker 1 decided to adopt the new schema',
                authorship: 'ai',
                edited: false,
                speaker: 'Ayush',
                completed: false,
                blockType: 'decision',
              },
              {
                id: 'a-1',
                text: 'Ayush will complete documentation',
                originalText: 'Speaker 1 will complete documentation',
                authorship: 'ai',
                edited: false,
                assignee: 'Ayush',
                due: 'Monday',
                completed: false,
                blockType: 'action',
              },
            ],
          },
          {
            id: 'topic-0',
            kind: 'discussion',
            title: 'Architecture',
            blocks: [
              {
                id: 'p-1',
                text: 'Reviewed latency benchmarks.',
                originalText: 'Reviewed latency benchmarks.',
                authorship: 'ai',
                edited: false,
                speaker: 'Ayush',
              },
            ],
          },
        ],
      };

      const transcriptSegments: TranscriptSegment[] = [
        { text: 'I will finish the docs.', speaker: 'Ayush', startTime: 10 },
      ];

      const markdown = formatMeetingNotesAsMarkdown({
        meeting: baseMeeting,
        documentModel: projectedDocumentModel,
        transcriptSegments,
        includeTranscript: true,
      });

      expect(markdown).toContain(
        '- [ ] Ayush decided to adopt the new schema (Decided by: Ayush)',
      );
      expect(markdown).toContain(
        '- [ ] Ayush will complete documentation (Assignee: Ayush, Due: Monday)',
      );
      expect(markdown).toContain('- Ayush: Reviewed latency benchmarks.');
      expect(markdown).toContain('**Ayush** (0:10)');
    });
  });
});

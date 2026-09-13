import { describe, expect, it } from 'vitest';

import type { AnalysisDocument, AnalysisDocumentV3 } from '../../src/types';
import { buildMeetingNotesDocument } from '../../src/utils/meetingNotesDocument';

const quality = {
  format_pass: true,
  retry_count: 0,
  fallback_used: false,
  issues: [],
};

describe('buildMeetingNotesDocument', () => {
  it('normalizes v3 into an outcomes-first document without repeating rollups', () => {
    const v3: AnalysisDocumentV3 = {
      analysis_schema_version: 3,
      overview: 'The launch plan is ready for final review.',
      all_decisions: [
        {
          text: 'Ship the staged rollout',
          decided_by: 'Maya',
          evidence: 'Maya: We will ship the staged rollout.',
        },
      ],
      all_action_items: [
        {
          text: 'Publish the rollout checklist',
          assignee: 'Daniel',
          due: 'Friday',
          topic: 'Launch plan',
          evidence: 'Daniel: I will publish the checklist by Friday.',
        },
      ],
      topics: [
        {
          title: 'Launch plan',
          summary: 'The rollout will proceed in stages.',
          key_points: [{ text: 'The first cohort is internal users.' }],
          decisions: [{ text: 'Ship the staged rollout' }],
          action_items: [{ text: 'Publish the rollout checklist' }],
          open_questions: ['Which customers join the second cohort?'],
          transcript_range: [4, 9],
        },
      ],
      meeting_type: 'team_sync',
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2: null,
      v3,
      userNotes: '- Ask about the second cohort',
      editsMap: {},
    });

    expect(document.sections.map((section) => section.kind)).toEqual([
      'outcomes',
      'current_read',
      'discussion',
      'open_questions',
      'scratchpad',
    ]);
    expect(document.sections[0].blocks[0]).toMatchObject({
      path: 'all_decisions:0',
      text: 'Ship the staged rollout',
      evidence: 'Maya: We will ship the staged rollout.',
    });
    expect(document.sections.flatMap((section) => section.blocks)).toHaveLength(
      7,
    );
    expect(
      document.sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.text === 'Ship the staged rollout'),
    ).toHaveLength(1);
  });

  it('normalizes legacy v2 meetings into the same document shape', () => {
    const v2: AnalysisDocument = {
      analysis_schema_version: 2,
      summary: ['A legacy summary remains readable.'],
      key_points: ['The migration is staged.'],
      decisions: ['Keep the existing API.'],
      action_items: ['Write the migration guide.'],
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2,
      v3: null,
      userNotes: '',
      editsMap: {},
    });

    expect(document.sections.map((section) => section.kind)).toEqual([
      'outcomes',
      'current_read',
      'discussion',
      'scratchpad',
    ]);
    expect(document.sections[0].blocks[0].path).toBe('v2:decision:0');
    expect(
      document.sections.find((section) => section.kind === 'current_read')
        ?.title,
    ).toBe('What was discussed');
  });

  it('renders held prose as a source-review row instead of a settled note', () => {
    const v3: AnalysisDocumentV3 = {
      analysis_schema_version: 3,
      overview: 'The client persona pipeline was reviewed.',
      topics: [],
      all_action_items: [],
      all_decisions: [],
      meeting_type: 'general',
      quality: {
        ...quality,
        issues: ['deterministic_review_unclear_prose:p1'],
      },
      generation_metadata: {
        provider: 'ollama',
        model: 'gemma4:12b',
        generation_path: 'single_pass',
        prompt_version: 'notes-v32',
        generated_at: '2026-09-13T00:00:00.000Z',
        error_categories: ['notes_quality_warning'],
        prose_review: {
          schema_version: 1,
          items: [
            {
              id: 'p1',
              section_title: 'Action Items and Next Steps',
              original_text: 'I can kind of review it if if needed',
              evidence: 'I can kind of review it if if needed',
              reason: 'raw_transcript_like',
              signals: ['first_person', 'repeated_word', 'speech_filler'],
              sources: [{ segment: 1, start: 0, end: 37 }],
            },
          ],
        },
      },
    };

    const document = buildMeetingNotesDocument({
      v2: null,
      v3,
      userNotes: '',
      editsMap: {},
    });
    const review = document.sections.find(
      (section) => section.kind === 'review',
    );

    expect(review?.blocks[0]).toMatchObject({
      blockType: 'review',
      text: 'Review unclear wording from “Action Items and Next Steps”',
      evidence: 'I can kind of review it if if needed',
      path: undefined,
    });
    expect(
      document.sections.flatMap((section) =>
        section.blocks.map((block) => block.text),
      ),
    ).not.toContain('I can kind of review it if if needed');
  });

  it('applies saved edits to every generated block type', () => {
    const v3: AnalysisDocumentV3 = {
      analysis_schema_version: 3,
      overview: 'Original overview',
      topics: [],
      all_action_items: [],
      all_decisions: [],
      meeting_type: 'general',
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2: null,
      v3,
      userNotes: '',
      editsMap: {
        overview: {
          original: 'Original overview',
          edited: 'Edited current read',
          edited_at: '2026-08-19T10:00:00.000Z',
        },
      },
    });

    expect(
      document.sections.find((section) => section.kind === 'current_read')
        ?.blocks[0],
    ).toMatchObject({ text: 'Edited current read', edited: true });
  });

  it('merges repeated topic titles and removes duplicate points', () => {
    const v3: AnalysisDocumentV3 = {
      analysis_schema_version: 3,
      overview: 'The architecture was reviewed.',
      all_action_items: [],
      all_decisions: [],
      topics: [
        {
          title: 'API architecture',
          summary: 'The service boundaries were agreed.',
          key_points: [{ text: 'Keep the gateway thin.' }],
          decisions: [],
          action_items: [],
          open_questions: [],
          transcript_range: [1, 4],
        },
        {
          title: 'API Architecture ',
          summary: 'The service boundaries were agreed.',
          key_points: [
            { text: 'Keep the gateway thin.' },
            { text: 'Move validation into services.' },
          ],
          decisions: [],
          action_items: [],
          open_questions: [],
          transcript_range: [5, 8],
        },
      ],
      meeting_type: 'general',
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2: null,
      v3,
      userNotes: '',
      editsMap: {},
    });
    const discussion = document.sections.find(
      (section) => section.kind === 'discussion',
    );

    expect(discussion?.title).toBe('API architecture');
    expect(discussion?.blocks.map((block) => block.text)).toEqual([
      'The service boundaries were agreed.',
      'Keep the gateway thin.',
      'Move validation into services.',
    ]);
    expect(discussion?.blocks.at(-1)?.path).toBe('topic:1:point:1');
  });

  it('keeps legacy completion state on actions rather than decisions', () => {
    const v2: AnalysisDocument = {
      analysis_schema_version: 2,
      summary: [],
      key_points: [],
      decisions: ['Keep the current service.'],
      action_items: ['Publish the guide.'],
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2,
      v3: null,
      userNotes: '',
      editsMap: {
        'completion:v2:action:0': {
          original: 'false',
          edited: 'true',
          edited_at: '2026-08-19T10:00:00.000Z',
        },
      },
    });

    expect(document.sections[0].blocks[0].completed).toBe(false);
    expect(document.sections[0].blocks[1].completed).toBe(true);
  });

  it('restores persisted native continuation rows beside their parent block', () => {
    const v3: AnalysisDocumentV3 = {
      analysis_schema_version: 3,
      overview: 'Original overview',
      topics: [],
      all_action_items: [],
      all_decisions: [
        {
          text: 'Keep the existing API.',
          evidence: 'The team agreed to keep the existing API.',
        },
      ],
      meeting_type: 'general',
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2: null,
      v3,
      userNotes: '',
      editsMap: {
        'native_continuations:all_decisions:0': {
          original: '[]',
          edited: JSON.stringify([
            { id: 'follow-up', text: 'Document the compatibility guarantee.' },
          ]),
          edited_at: '2026-08-22T18:00:00.000Z',
        },
      },
    });

    expect(document.sections[0].blocks).toMatchObject([
      {
        path: 'all_decisions:0',
        blockType: 'decision',
      },
      {
        id: 'decision-0:continuation:follow-up',
        text: 'Document the compatibility guarantee.',
        blockType: 'decision',
        nativeContinuation: {
          parentPath: 'all_decisions:0',
          id: 'follow-up',
        },
      },
    ]);
  });

  it('projects speaker display names onto note blocks, assignees, and AI text', () => {
    const v3: AnalysisDocumentV3 = {
      analysis_schema_version: 3,
      overview: 'Speaker 1 reviewed the launch timeline with the team.',
      all_decisions: [
        {
          text: 'Speaker 1 decided to proceed with beta launch',
          decided_by: 'Speaker 1',
          evidence: 'Speaker 1: We are ready for beta launch.',
        },
      ],
      all_action_items: [
        {
          text: 'Speaker 1 will prepare the rollout checklist',
          assignee: 'Speaker 1',
          due: 'Friday',
          topic: 'Launch plan',
          evidence: 'Speaker 1: I will prepare the checklist by Friday.',
        },
      ],
      topics: [
        {
          title: 'Launch plan',
          summary: 'The beta rollout is scheduled.',
          key_points: [
            {
              text: 'Speaker 1 noted that latency is stable.',
              speaker: 'Speaker 1',
            },
            {
              text: 'Them proposed adding telemetry.',
              speaker: 'Them',
            },
          ],
          decisions: [],
          action_items: [],
          open_questions: [],
        },
      ],
      meeting_type: 'team_sync',
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2: null,
      v3,
      userNotes: '',
      editsMap: {},
      displayNames: {
        'Speaker 1': 'Ayush',
        Them: 'Rowan',
      },
    });

    const outcomesSection = document.sections.find(
      (s) => s.kind === 'outcomes',
    );
    expect(outcomesSection).toBeDefined();
    // Decision block
    expect(outcomesSection?.blocks[0]).toMatchObject({
      text: 'Ayush decided to proceed with beta launch',
      speaker: 'Ayush',
      evidence: 'Ayush: We are ready for beta launch.',
    });
    // Action block
    expect(outcomesSection?.blocks[1]).toMatchObject({
      text: 'Ayush will prepare the rollout checklist',
      assignee: 'Ayush',
      evidence: 'Ayush: I will prepare the checklist by Friday.',
    });

    // Overview section
    const currentReadSection = document.sections.find(
      (s) => s.kind === 'current_read',
    );
    expect(currentReadSection?.blocks[0].text).toBe(
      'Ayush reviewed the launch timeline with the team.',
    );

    // Discussion section
    const discussionSection = document.sections.find(
      (s) => s.kind === 'discussion',
    );
    expect(discussionSection?.blocks[1]).toMatchObject({
      text: 'Ayush noted that latency is stable.',
      speaker: 'Ayush',
    });
    expect(discussionSection?.blocks[2]).toMatchObject({
      text: 'Rowan proposed adding telemetry.',
      speaker: 'Rowan',
    });
  });

  it('projects a known self speaker in possessive and sentence-subject prose', () => {
    const v3: AnalysisDocumentV3 = {
      analysis_schema_version: 3,
      overview: "Me's project is ready. Me is preparing a demonstration.",
      all_decisions: [],
      all_action_items: [],
      topics: [],
      meeting_type: 'one_on_one',
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2: null,
      v3,
      userNotes: '',
      editsMap: {},
      displayNames: { Me: 'Alex' },
    });

    expect(
      document.sections.find((section) => section.kind === 'current_read')
        ?.blocks[0]?.text,
    ).toBe("Alex's project is ready. Alex is preparing a demonstration.");
  });

  it('preserves manual user edits when speaker display names are provided', () => {
    const v3: AnalysisDocumentV3 = {
      analysis_schema_version: 3,
      overview: 'Overview',
      all_decisions: [],
      all_action_items: [
        {
          text: 'Speaker 1 will draft specs',
          assignee: 'Speaker 1',
          due: 'Monday',
          topic: 'Specs',
          evidence: 'Speaker 1: I will draft specs.',
        },
      ],
      topics: [],
      meeting_type: 'team_sync',
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2: null,
      v3,
      userNotes: '',
      editsMap: {
        'all_action_items:0': {
          original: 'Speaker 1 will draft specs',
          edited: 'Custom user text keeping Speaker 1 unchanged',
          edited_at: '2026-08-22T18:00:00.000Z',
        },
      },
      displayNames: {
        'Speaker 1': 'Ayush',
      },
    });

    const outcomesSection = document.sections.find(
      (s) => s.kind === 'outcomes',
    );
    // Text was edited by user, so user edit is preserved verbatim:
    expect(outcomesSection?.blocks[0].text).toBe(
      'Custom user text keeping Speaker 1 unchanged',
    );
    // Assignee metadata is still projected for clarity:
    expect(outcomesSection?.blocks[0].assignee).toBe('Ayush');
  });

  it('matches Remote Speaker X to Speaker X displayNames', () => {
    const v3: AnalysisDocumentV3 = {
      analysis_schema_version: 3,
      overview: 'Overview',
      all_decisions: [],
      all_action_items: [
        {
          text: 'Prepare the deck',
          assignee: 'Speaker 2',
          topic: 'Deck',
          evidence: 'evidence',
        },
      ],
      topics: [],
      meeting_type: 'general',
      quality,
    };

    const document = buildMeetingNotesDocument({
      v2: null,
      v3,
      userNotes: '',
      editsMap: {},
      displayNames: {
        'Remote Speaker 2': 'Bianca',
      },
    });

    const outcomes = document.sections.find((s) => s.kind === 'outcomes');
    expect(outcomes?.blocks[0].assignee).toBe('Bianca');
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildMeetingNotesEvidenceDocument,
  resolveSavedMeetingEvidencePolicy,
} from '../../electron/intelligence/meetingNotesEvidence';

describe('saved meeting evidence policy', () => {
  it('keeps ordinary speaker questions on notes', () => {
    expect(
      resolveSavedMeetingEvidencePolicy(
        'What did Sam say about the launch?',
        true,
      ),
    ).toBe('notes_only');
  });

  it.each([
    'Quote what Sam said about the launch',
    'What exactly did Sam say?',
    'Give me the verbatim wording',
    'What were her exact words?',
    'Tell me word for word',
  ])('uses transcript evidence for explicit wording intent: %s', (query) => {
    expect(resolveSavedMeetingEvidencePolicy(query, true)).toBe(
      'transcript_exact',
    );
  });

  it('uses the transcript fallback only when notes are unavailable', () => {
    expect(resolveSavedMeetingEvidencePolicy('What happened?', false)).toBe(
      'transcript_fallback',
    );
  });
});

describe('buildMeetingNotesEvidenceDocument', () => {
  it('projects canonical speaker labels for saved-note consumers', () => {
    const document = buildMeetingNotesEvidenceDocument(
      {
        id: 'meeting-identity',
        title: 'Project review',
        analysis_json: JSON.stringify({
          analysis_schema_version: 3,
          overview: "Me's project is ready. Them: I will review it.",
          topics: [],
          all_decisions: [],
          all_action_items: [],
          meeting_type: 'one_on_one',
          quality: {
            format_pass: true,
            retry_count: 0,
            fallback_used: false,
            issues: [],
          },
        }),
      },
      { Me: 'Alex', Them: 'Jordan' },
    );

    expect(document.notesText).toContain("Alex's project is ready");
    expect(document.notesText).toContain('Jordan: I will review it');
  });

  it('projects user-edited note blocks without reading transcript text', () => {
    const document = buildMeetingNotesEvidenceDocument({
      id: 'meeting-1',
      title: 'Launch review',
      user_notes: 'Remember the customer follow-up.',
      enhanced_notes: 'Old launch wording.',
      analysis_json: JSON.stringify({
        analysis_schema_version: 3,
        overview: 'Old launch wording.',
        topics: [
          {
            title: 'Release timing',
            summary: 'The release date was reviewed.',
            key_points: [],
            decisions: [],
            action_items: [],
            open_questions: [],
          },
        ],
        all_decisions: [{ text: 'Ship on Thursday.' }],
        all_action_items: [
          { text: 'Send the customer update.', assignee: 'Sam' },
        ],
        meeting_type: 'team_sync',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
      }),
      user_edits_json: JSON.stringify({
        overview: {
          original: 'Old launch wording.',
          edited: 'Launch moved to Friday.',
          edited_at: '2026-08-31T00:00:00.000Z',
        },
        'all_decisions:0': {
          original: 'Ship on Thursday.',
          edited: 'Ship on Friday.',
          edited_at: '2026-08-31T00:00:00.000Z',
        },
        'native_continuations:all_decisions:0': {
          original: '[]',
          edited: JSON.stringify([
            { id: 'decision-user', text: 'Document the rollback decision.' },
          ]),
          edited_at: '2026-08-31T00:00:00.000Z',
        },
        'native_continuations:all_action_items:0': {
          original: '[]',
          edited: JSON.stringify([
            { id: 'action-user', text: 'Morgan will verify rollback.' },
          ]),
          edited_at: '2026-08-31T00:00:00.000Z',
        },
      }),
      mid_json: JSON.stringify({
        participants: [{ name: 'Sam' }],
        topics: [{ name: 'Release timing' }],
        decisions: [{ description: 'Ship on Thursday.' }],
        action_items: [{ description: 'Send the customer update.' }],
      }),
      transcript_json: JSON.stringify({
        segments: [{ text: 'Cobalt transcript-only phrase.' }],
      }),
    });

    expect(document).toMatchObject({
      meetingId: 'meeting-1',
      title: 'Launch review',
      hasUsableNotes: true,
      participantsText: 'Sam',
    });
    expect(document.notesText).toContain('Launch moved to Friday.');
    expect(document.notesText).toContain('Remember the customer follow-up.');
    expect(document.decisionsText).toContain('Ship on Friday.');
    expect(document.decisionsText).toContain('Document the rollback decision.');
    expect(document.actionItemsText).toContain('Morgan will verify rollback.');
    expect(JSON.stringify(document)).not.toContain('Cobalt');
    expect(JSON.stringify(document)).not.toContain('Ship on Thursday.');
  });

  it('treats structured meeting intelligence as usable notes', () => {
    const document = buildMeetingNotesEvidenceDocument({
      id: 'meeting-2',
      title: 'Architecture review',
      mid_json: JSON.stringify({
        topics: [{ name: 'Storage' }],
        decisions: [{ description: 'Use SQLite.' }],
        action_items: [],
        participants: [],
      }),
    });

    expect(document.hasUsableNotes).toBe(true);
    expect(document.decisionsText).toBe('Use SQLite.');
  });

  it('does not index held prose or its review label as settled evidence', () => {
    const heldText = 'I can kind of review it if if needed';
    const document = buildMeetingNotesEvidenceDocument({
      id: 'meeting-review',
      title: 'Pipeline review',
      analysis_json: JSON.stringify({
        analysis_schema_version: 3,
        overview: 'The pipeline was reviewed.',
        topics: [],
        all_decisions: [],
        all_action_items: [],
        meeting_type: 'general',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: ['deterministic_review_unclear_prose:p1'],
        },
        generation_metadata: {
          provider: 'ollama',
          model: 'gemma4:12b',
          generation_path: 'single_pass',
          prompt_version: 'notes-v33',
          generated_at: '2026-09-13T00:00:00.000Z',
          error_categories: ['notes_quality_warning'],
          prose_review: {
            schema_version: 1,
            items: [
              {
                id: 'p1',
                section_title: 'Next steps',
                original_text: heldText,
                evidence: heldText,
                reason: 'raw_transcript_like',
                signals: ['first_person', 'repeated_word', 'speech_filler'],
                sources: [{ segment: 0, start: 0, end: heldText.length }],
              },
            ],
          },
        },
      }),
    });

    expect(document.notesText).toBe('The pipeline was reviewed.');
    expect(JSON.stringify(document)).not.toContain(heldText);
    expect(JSON.stringify(document)).not.toContain('Review unclear wording');
  });

  it('ignores malformed structured note values instead of crashing retrieval', () => {
    const document = buildMeetingNotesEvidenceDocument({
      id: 'meeting-malformed',
      title: 'Imported notes',
      analysis_json: JSON.stringify({
        analysis_schema_version: 3,
        overview: 'A valid overview remains searchable.',
        topics: [
          {
            title: 'Follow-ups',
            summary: 'A valid topic summary.',
            key_points: [{ text: { unexpected: true } }],
            decisions: [],
            action_items: [],
            open_questions: [{ unexpected: true }],
          },
        ],
        all_decisions: [],
        all_action_items: [],
        meeting_type: 'general',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
      }),
    });

    expect(document.notesText).toContain(
      'A valid overview remains searchable.',
    );
    expect(document.notesText).toContain('A valid topic summary.');
    expect(document.notesText).not.toContain('[object Object]');
  });
});

import { describe, expect, it } from 'vitest';
import type { AnalysisDocumentV3 } from '../../src/types';
import {
  buildMeetingNotesSpeakerReferences,
  projectMeetingNotesSpeakerReferences,
} from '../../src/utils/meetingNotesSpeakerReferences';

const analysis = (
  overview: string,
  sources = [{ segment: 0, start: 0, end: 20 }],
): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview,
  topics: [],
  all_decisions: [],
  all_action_items: [],
  meeting_type: 'one_on_one',
  quality: { format_pass: true, retry_count: 0, fallback_used: false },
  generation_metadata: {
    provider: 'ollama',
    model: 'test',
    generation_path: 'single_pass',
    prompt_version: 'test',
    generated_at: '2026-09-13T00:00:00.000Z',
    error_categories: [],
    source_provenance: {
      schema_version: 1,
      source_revision: 'source',
      blocks: { overview: { id: 'overview', sources } },
    },
  },
});

describe('meeting notes speaker references', () => {
  it('records and reversibly projects a grounded speaker-name reference', () => {
    const generated = analysis(
      "Alex's project is ready. Alex is preparing a demonstration.",
    );
    generated.generation_metadata!.speaker_references =
      buildMeetingNotesSpeakerReferences({
        analysis: generated,
        transcriptJson: JSON.stringify({
          segments: [{ speaker: 'Me', text: 'My project is ready.' }],
        }),
        speakerDisplayNames: { Me: 'Alex' },
      });

    expect(
      projectMeetingNotesSpeakerReferences(generated, { Me: 'Casey' }).overview,
    ).toBe("Casey's project is ready. Casey is preparing a demonstration.");
    expect(projectMeetingNotesSpeakerReferences(generated, {}).overview).toBe(
      "Local speaker's project is ready. Local speaker is preparing a demonstration.",
    );
    expect(generated.overview).toContain('Alex');
  });

  it('does not tag an ordinary name mention or mixed-speaker evidence', () => {
    const ordinaryMention = analysis('The team discussed Alex.');
    expect(
      buildMeetingNotesSpeakerReferences({
        analysis: ordinaryMention,
        transcriptJson: JSON.stringify({
          segments: [{ speaker: 'Me', text: 'We discussed Alex.' }],
        }),
        speakerDisplayNames: { Me: 'Alex' },
      }),
    ).toBeUndefined();

    const mixed = analysis('Alex is preparing a demonstration.', [
      { segment: 0, start: 0, end: 10 },
      { segment: 1, start: 0, end: 10 },
    ]);
    expect(
      buildMeetingNotesSpeakerReferences({
        analysis: mixed,
        transcriptJson: JSON.stringify({
          segments: [
            { speaker: 'Me', text: 'I am preparing it.' },
            { speaker: 'Them', text: 'That sounds good.' },
          ],
        }),
        speakerDisplayNames: { Me: 'Alex', Them: 'Jordan' },
      }),
    ).toBeUndefined();
  });

  it('ignores malformed persisted ranges', () => {
    const generated = analysis('Alex is preparing a demonstration.');
    generated.generation_metadata!.speaker_references = {
      schema_version: 1,
      blocks: {
        overview: [{ speaker: 'Me', sourceName: 'Alex', start: 4, end: 10 }],
      },
    };
    expect(
      projectMeetingNotesSpeakerReferences(generated, { Me: 'Casey' }).overview,
    ).toBe(generated.overview);
  });

  it('projects a grounded structured assignee', () => {
    const generated = analysis('The launch plan was reviewed.');
    generated.all_action_items = [
      { text: 'Prepare the launch plan.', assignee: 'Jordan' },
    ];
    generated.generation_metadata!.source_provenance!.blocks[
      'all_action_items:0'
    ] = {
      id: 'action-0',
      sources: [{ segment: 0, start: 0, end: 20 }],
    };
    generated.generation_metadata!.speaker_references =
      buildMeetingNotesSpeakerReferences({
        analysis: generated,
        transcriptJson: JSON.stringify({
          segments: [{ speaker: 'Them', text: 'I will prepare the plan.' }],
        }),
        speakerDisplayNames: { Them: 'Jordan' },
      });

    expect(
      projectMeetingNotesSpeakerReferences(generated, { Them: 'Casey' })
        .all_action_items[0]?.assignee,
    ).toBe('Casey');
  });
});

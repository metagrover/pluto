import { describe, expect, it } from 'vitest';
import {
  acceptEditedNotes,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { triageNotesReplay } from '../../scripts/lib/notesReplayQuality';

function fixture(count = 3) {
  const source = createNotesSource(
    JSON.stringify({
      segments: Array.from({ length: count }, (_, index) => ({
        speaker: 'A',
        text: `The notebook number ${index} is blue.`,
      })),
    }),
  );
  const spans = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  const analysis = projectAuditedNotes(
    acceptEditedNotes({
      source,
      draft: {
        meetingType: 'general',
        overview: null,
        sections: [
          {
            id: 's',
            title: { id: 't', text: 'Notebooks', sources: [spans[0]] },
            items: source.segments.map((segment) => ({
              id: `p-${segment.index}`,
              text: segment.text,
              kind: 'point' as const,
              sources: [spans[segment.index]],
              owner: null,
              due: null,
            })),
          },
        ],
      },
    }),
  );
  return { source, analysis };
}
describe('model-neutral notes quality triage', () => {
  it('surfaces guarded fallback warnings even when visible spans are valid', () => {
    const { source, analysis } = fixture();
    analysis.quality.issues.push('notes_direct_audit_fallback:guardrail');
    expect(triageNotesReplay(analysis, source).flags).toContain(
      'pipeline_quality_warnings',
    );
  });
  it('never turns clean mechanical checks into quality approval', () => {
    const { source, analysis } = fixture();
    expect(triageNotesReplay(analysis, source)).toMatchObject({
      status: 'pending_review',
      qualityApproved: false,
      flags: [],
    });
  });
  it('catches text copied from a different segment despite valid span bounds and revision', () => {
    const { source, analysis } = fixture();
    analysis.topics[0].key_points[0].text = source.segments[2].text;
    expect(triageNotesReplay(analysis, source)).toMatchObject({
      invalidProvenance: [],
      literalCitationMismatches: ['topic:0:point:0'],
      qualityApproved: false,
    });
  });
  it('flags missing or stale visible provenance', () => {
    const { source, analysis } = fixture();
    analysis.generation_metadata!.source_provenance!.source_revision = 'stale';
    expect(triageNotesReplay(analysis, source).flags).toContain(
      'invalid_visible_provenance',
    );
  });
  it('flags a transcript dump while preserving its historical pipeline outcome', () => {
    const { source, analysis } = fixture(10);
    const before = JSON.stringify(analysis);
    expect(triageNotesReplay(analysis, source)).toMatchObject({
      pointCount: 10,
      verbatimPoints: 10,
      flags: ['transcript_dump_suspected'],
    });
    expect(JSON.stringify(analysis)).toBe(before);
  });
  it('does not declare a paraphrase unsupported from literal mismatch alone', () => {
    const { source, analysis } = fixture();
    analysis.topics[0].key_points[0].text = 'Notebook one has a blue cover.';
    expect(
      triageNotesReplay(analysis, source).literalCitationMismatches,
    ).toEqual([]);
  });
});

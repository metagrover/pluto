import { describe, expect, it } from 'vitest';
import {
  acceptEditedNotes,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { visibleBlocks } from '../../scripts/lib/notesReplayProjection';
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
  it.each([
    { segment: 99, start: 0, end: 1 },
    { segment: 0, start: -1, end: 1 },
    { segment: 0, start: 0.5, end: 1 },
    { segment: 0, start: 0, end: 0 },
    { segment: 0, start: 0, end: 9999 },
  ])('rejects invalid visible source offsets: %j', (span) => {
    const { source, analysis } = fixture();
    analysis.generation_metadata!.source_provenance!.blocks[
      'topic:0:point:0'
    ].sources = [span];
    expect(triageNotesReplay(analysis, source).invalidProvenance).toContain(
      'topic:0:point:0',
    );
  });
  it('rejects a visible block without provenance metadata', () => {
    const { source, analysis } = fixture();
    const provenance = analysis.generation_metadata!.source_provenance!;
    provenance.blocks = Object.fromEntries(
      Object.entries(provenance.blocks).filter(
        ([key]) => key !== 'topic:0:point:0',
      ),
    );
    expect(triageNotesReplay(analysis, source).invalidProvenance).toContain(
      'topic:0:point:0',
    );
  });
  it('checks inline evidence on actions and their aggregate projection', () => {
    const { source, analysis } = fixture();
    const action = {
      text: 'Check the notebook.',
      assignee: null,
      due: null,
      evidence: visibleBlocks(analysis, source).find(
        (block) => block.path === 'topic:0:point:0',
      )!.resolvedEvidence,
    };
    analysis.topics[0].action_items.push(action);
    analysis.all_action_items.push({ ...action, topic: 'Notebooks' });
    const blocks = analysis.generation_metadata!.source_provenance!.blocks;
    blocks['topic:0:action:0'] = { ...blocks['topic:0:point:0'] };
    blocks['all_action_items:0'] = { ...blocks['topic:0:point:0'] };
    const actions = () =>
      visibleBlocks(analysis, source).filter(
        (block) => block.kind === 'action' || block.kind === 'aggregate_action',
      );
    expect(actions().map((block) => block.provenanceValid)).toEqual([
      true,
      true,
    ]);
    analysis.all_action_items[0].evidence = 'Unrelated evidence.';
    expect(actions().map((block) => block.provenanceValid)).toEqual([
      true,
      false,
    ]);
    analysis.topics[0].action_items[0].evidence = null;
    expect(actions().map((block) => block.provenanceValid)).toEqual([
      false,
      false,
    ]);
  });
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

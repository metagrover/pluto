import { describe, expect, it } from 'vitest';

import {
  acceptEditedNotes,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesDraft,
  NotesSource,
  SourceSpan,
} from '../../electron/llm/meetingNotesTypes';
import type { LocalIntelligenceNotesCase } from '../manual/fixtures/localIntelligenceEvaluationCases';
import { scoreNotesGoldOutput } from '../manual/fixtures/localIntelligenceNotesScoring';

const span = (source: NotesSource, segment: number): SourceSpan => ({
  segment,
  start: 0,
  end: source.segments[segment]!.text.length,
});

const buildFixture = () => {
  const source = createNotesSource(
    JSON.stringify({
      segments: [
        { speaker: 'Lena', text: 'The rollout uses staged deployment.' },
        { speaker: 'Nia', text: 'The checklist includes database backups.' },
        { speaker: 'Luis', text: 'What is the rollback window?' },
        {
          speaker: 'Ravi',
          text: 'Ravi will send the migration plan by Tuesday.',
        },
        { speaker: 'Lena', text: 'We decided to use blue-green deployment.' },
        { speaker: 'Nia', text: 'The dashboard discussion is unrelated.' },
      ],
    }),
  );
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 'section-1',
        title: { id: 'title-1', text: 'Rollout', sources: [span(source, 0)] },
        items: [
          {
            id: 'point-1',
            kind: 'point',
            text: 'The rollout uses staged deployment.',
            sources: [span(source, 0)],
            owner: null,
            due: null,
          },
          {
            id: 'point-2',
            kind: 'point',
            text: 'The checklist includes database backups.',
            sources: [span(source, 1)],
            owner: null,
            due: null,
          },
          {
            id: 'question-1',
            kind: 'question',
            text: 'What is the rollback window?',
            sources: [span(source, 2)],
            owner: null,
            due: null,
          },
          {
            id: 'action-1',
            kind: 'action',
            text: 'Ravi will send the migration plan by Tuesday.',
            sources: [span(source, 3)],
            owner: 'Ravi',
            due: 'Tuesday',
          },
          {
            id: 'decision-1',
            kind: 'decision',
            text: 'We decided to use blue-green deployment.',
            sources: [span(source, 4)],
            owner: 'Lena',
            due: null,
          },
        ],
      },
    ],
  };
  const analysis = projectAuditedNotes(acceptEditedNotes({ source, draft }));
  const candidate: LocalIntelligenceNotesCase = {
    id: 'notes-scoring-fixture',
    lane: 'meeting_notes',
    partition: 'development',
    failureIds: [],
    durationClass: 'ordinary',
    syntheticProfile: 'short',
    coverageTags: ['beginning_evidence'],
    segments: source.segments.map((segment) => ({
      speaker: segment.speaker ?? 'Speaker',
      text: segment.text,
    })),
    gold: {
      expectedBehavior: 'supported_output',
      forbiddenClaims: [],
      requiredClaims: [
        {
          id: 'summary',
          critical: false,
          modality: 'fact',
          requiredTerms: ['staged deployment'],
          evidence: [{ sourceId: 'segment-0', excerpt: 'staged deployment' }],
          notesProjection: {
            kind: 'point',
            requiredTextTerms: ['staged deployment'],
            requiredEvidenceTerms: ['staged deployment'],
            owner: null,
            due: null,
          },
        },
        {
          id: 'later-point',
          critical: false,
          modality: 'fact',
          requiredTerms: ['database backups'],
          evidence: [{ sourceId: 'segment-1', excerpt: 'database backups' }],
          notesProjection: {
            kind: 'point',
            requiredTextTerms: ['database backups'],
            requiredEvidenceTerms: ['database backups'],
          },
        },
        {
          id: 'question',
          critical: false,
          modality: 'fact',
          requiredTerms: ['rollback window'],
          evidence: [{ sourceId: 'segment-2', excerpt: 'rollback window' }],
          notesProjection: {
            kind: 'question',
            requiredTextTerms: ['rollback window'],
            requiredEvidenceTerms: ['rollback window'],
          },
        },
        {
          id: 'action',
          critical: true,
          modality: 'committed',
          requiredTerms: ['migration plan'],
          evidence: [{ sourceId: 'segment-3', excerpt: 'migration plan' }],
          notesProjection: {
            kind: 'action',
            requiredTextTerms: ['migration plan'],
            requiredEvidenceTerms: ['migration plan'],
            owner: 'Ravi',
            due: 'Tuesday',
          },
        },
        {
          id: 'decision',
          critical: true,
          modality: 'fact',
          requiredTerms: ['blue-green'],
          evidence: [
            { sourceId: 'segment-4', excerpt: 'blue-green deployment' },
          ],
          notesProjection: {
            kind: 'decision',
            requiredTextTerms: ['blue-green deployment'],
            requiredEvidenceTerms: ['blue-green deployment'],
            owner: 'Lena',
          },
        },
      ],
    },
  };
  return { source, analysis, candidate };
};

describe('visible meeting-notes scoring', () => {
  it('scores summaries, later points, questions, actions, and decisions by canonical path', () => {
    const { source, analysis, candidate } = buildFixture();
    const result = scoreNotesGoldOutput(candidate, analysis, source);
    expect(result.passed).toBe(true);
    expect(result.claimResults.map((claim) => claim.matchedBlockPath)).toEqual([
      'topic:0:summary',
      'topic:0:point:0',
      'topic:0:question:0',
      'topic:0:action:0',
      'topic:0:decision:0',
    ]);
  });

  it('rejects correct text attached to unrelated decision evidence', () => {
    const { source, analysis, candidate } = buildFixture();
    const changed = structuredClone(analysis);
    const action = changed.topics[0]!.action_items[0]!;
    action.evidence = source.segments[4]!.text;
    changed.generation_metadata!.source_provenance!.blocks['topic:0:action:0'] =
      {
        id: 'action-1',
        sources: [span(source, 4)],
      };
    const result = scoreNotesGoldOutput(candidate, changed, source);
    expect(
      result.claimResults.find((claim) => claim.id === 'action'),
    ).toMatchObject({
      projectionMatched: true,
      evidenceMatched: false,
      passed: false,
    });
  });

  it('rejects action and decision blocks without their inline evidence', () => {
    const { source, analysis, candidate } = buildFixture();
    const changed = structuredClone(analysis);
    changed.topics[0]!.action_items[0]!.evidence = undefined;
    changed.topics[0]!.decisions[0]!.evidence = undefined;
    const result = scoreNotesGoldOutput(candidate, changed, source);
    expect(result.provenanceFailures).toEqual(
      expect.arrayContaining(['topic:0:action:0', 'topic:0:decision:0']),
    );
    expect(result.passed).toBe(false);
  });

  it('rejects stale provenance, invalid spans, split owner/date, and guessed owners', () => {
    const { source, analysis, candidate } = buildFixture();
    const stale = structuredClone(analysis);
    stale.generation_metadata!.source_provenance!.source_revision = 'stale';
    expect(scoreNotesGoldOutput(candidate, stale, source).passed).toBe(false);

    const invalid = structuredClone(analysis);
    invalid.generation_metadata!.source_provenance!.blocks[
      'topic:0:summary'
    ]!.sources = [
      { segment: 0, start: 0, end: source.segments[0]!.text.length + 1 },
    ];
    expect(scoreNotesGoldOutput(candidate, invalid, source).passed).toBe(false);

    const split = structuredClone(analysis);
    split.topics[0]!.action_items[0]!.assignee = 'Nia';
    expect(
      scoreNotesGoldOutput(candidate, split, source).claimResults[3],
    ).toMatchObject({
      ownerMatched: false,
      passed: false,
    });

    const absentOwner = structuredClone(candidate);
    absentOwner.gold.requiredClaims[3]!.notesProjection!.owner = null;
    expect(
      scoreNotesGoldOutput(absentOwner, analysis, source).claimResults[3],
    ).toMatchObject({ ownerMatched: false, passed: false });
  });

  it('does not satisfy action gold with a decision or conflicting extra action', () => {
    const { source, analysis, candidate } = buildFixture();
    const wrongKind = structuredClone(analysis);
    wrongKind.topics[0]!.action_items = [];
    wrongKind.all_action_items = [];
    expect(
      scoreNotesGoldOutput(candidate, wrongKind, source).claimResults[3],
    ).toMatchObject({
      matchedBlockPath: null,
      projectionMatched: false,
      passed: false,
    });

    const extra = structuredClone(analysis);
    const conflictingCandidate = structuredClone(candidate);
    conflictingCandidate.gold.forbiddenClaims = [
      'Nia owns an unrelated dashboard action',
    ];
    extra.topics[0]!.action_items.push({
      text: 'Nia owns an unrelated dashboard action.',
      assignee: 'Nia',
      evidence: source.segments[5]!.text,
    });
    extra.generation_metadata!.source_provenance!.blocks['topic:0:action:1'] = {
      id: 'action-extra',
      sources: [span(source, 5)],
    };
    const scored = scoreNotesGoldOutput(conflictingCandidate, extra, source);
    expect(
      scored.unmatchedVisibleBlocks.filter((block) => block.kind === 'action'),
    ).toHaveLength(1);
    expect(scored).toMatchObject({
      forbiddenMatches: ['Nia owns an unrelated dashboard action'],
      passed: false,
    });
  });

  it('rejects a positive modality replacing a required condition', () => {
    const { source, analysis, candidate } = buildFixture();
    const conditional = structuredClone(candidate);
    conditional.gold.requiredClaims = [
      {
        id: 'conditional-action',
        critical: true,
        modality: 'conditional',
        requiredTerms: ['migration plan'],
        evidence: [{ sourceId: 'segment-3', excerpt: 'migration plan' }],
        notesProjection: {
          kind: 'action',
          requiredTextTerms: ['migration plan', 'if approved|conditional'],
          requiredEvidenceTerms: ['migration plan'],
          owner: 'Ravi',
          due: 'Tuesday',
        },
      },
    ];
    expect(
      scoreNotesGoldOutput(conditional, analysis, source).claimResults[0],
    ).toMatchObject({
      projectionMatched: false,
      passed: false,
    });
  });

  it('counts aggregate duplicates as separate unmatched visible blocks', () => {
    const { source, analysis, candidate } = buildFixture();
    const duplicate = structuredClone(analysis);
    duplicate.all_action_items.push({
      ...duplicate.all_action_items[0]!,
    });
    duplicate.generation_metadata!.source_provenance!.blocks[
      'all_action_items:1'
    ] =
      duplicate.generation_metadata!.source_provenance!.blocks[
        'all_action_items:0'
      ]!;
    const result = scoreNotesGoldOutput(candidate, duplicate, source);
    expect(
      result.unmatchedVisibleBlocks.filter(
        (block) => block.kind === 'aggregate_action',
      ),
    ).toHaveLength(2);
  });
});

import type { RawDreamingProposal } from '../../../electron/dreaming/types';
import type { AnalysisDocumentV3 } from '../../../electron/llm/analysisTypes';
import { createNotesSource } from '../../../electron/llm/meetingNotesSource';
import { visibleBlocks } from './localIntelligenceNotesScoring';

// Development fixtures only. These assertions are exact fixture contracts, not
// a general-purpose semantic judge or a substitute for blinded human review.
export const phiDownstreamCases = [
  {
    id: 'correction',
    earlier: 'Mira agreed to deliver the Atlas checklist on Tuesday.',
    current:
      'Correction: Theo agreed to deliver the Atlas checklist on Friday. Mira is no longer assigned.',
    expectedTask: 'Theo agreed to deliver the Atlas checklist on Friday.',
    forbiddenTask: 'Mira agreed to deliver the Atlas checklist on Tuesday.',
  },
  {
    id: 'withdrawal',
    earlier: 'Mira agreed to publish the Atlas launch announcement.',
    current:
      'The Atlas launch announcement was withdrawn. Mira has no action item.',
    expectedTask: null,
    forbiddenTask: 'Mira agreed to publish the Atlas launch announcement.',
  },
  {
    id: 'conditional',
    earlier: 'Theo proposed the Atlas archive import.',
    current:
      'If compliance approves, Theo must perform the Atlas archive import. Approval has not arrived; no action item is assigned.',
    expectedTask: null,
    forbiddenTask: 'Theo must perform the Atlas archive import.',
  },
  {
    id: 'same_name',
    earlier: 'Atlas hardware is awaiting a design review.',
    current: 'Mira agreed to deliver the Atlas hardware review on Friday.',
    expectedTask: 'Mira agreed to deliver the Atlas hardware review on Friday.',
    forbiddenTask:
      'Theo agreed to deliver the Atlas software review on Tuesday.',
  },
  {
    id: 'no_change',
    earlier: 'Atlas remains in planning with no assigned tasks.',
    current:
      'Atlas still remains in planning. No new action item was assigned.',
    expectedTask: null,
    forbiddenTask: 'Mira agreed to publish the Atlas launch announcement.',
  },
  {
    id: 'new_proposal',
    earlier: 'Atlas needs a release checklist.',
    current: 'Theo agreed to prepare the Atlas release checklist on Friday.',
    expectedTask:
      'Theo agreed to prepare the Atlas release checklist on Friday.',
    forbiddenTask:
      'Mira agreed to prepare the Atlas release checklist on Tuesday.',
  },
] as const;

export type DownstreamSource = {
  transcript: string;
  analysis: AnalysisDocumentV3;
};

export const scoreDownstreamFixture = (
  proposals: readonly RawDreamingProposal[],
  expectedTask: string | null,
  sources: ReadonlyMap<string, DownstreamSource>,
) => {
  const errors: string[] = [];
  const expectedCount = expectedTask === null ? 0 : 1;
  if (proposals.length !== expectedCount)
    errors.push('proposal_count_mismatch');
  for (const proposal of proposals) {
    if (
      proposal.kind !== 'project_commitment' ||
      proposal.payload.task !== expectedTask
    )
      errors.push('current_commitment_mismatch');
    if (proposal.evidence.length === 0) errors.push('missing_evidence');
    for (const evidence of proposal.evidence) {
      if (!evidence.excerpt.trim()) {
        errors.push('missing_evidence');
        continue;
      }
      const original = sources.get(evidence.meetingId);
      if (!original) {
        errors.push('unrelated_meeting');
        continue;
      }
      const source = createNotesSource(original.transcript);
      const matches = visibleBlocks(original.analysis, source).filter((block) =>
        block.text.includes(evidence.excerpt),
      );
      if (
        !matches.some(
          (block) =>
            block.provenanceValid &&
            block.resolvedEvidence?.includes(evidence.excerpt),
        )
      )
        errors.push('original_source_unresolved');
    }
  }
  return { passed: errors.length === 0, errors };
};

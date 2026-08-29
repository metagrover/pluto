import { describe, expect, it } from 'vitest';
import {
  assessProjectProposal,
  isProjectScopeReviewPending,
  readProjectQualification,
  readProjectScopeReviewReason,
  shouldAutomaticallyReviewProjectScope,
} from '../../src/utils/projectQualification';
const transcript =
  'Deliver a searchable archive. Index the historical records. Build the search interface.';
const proposal = {
  kind: 'initiative',
  outcome: 'Searchable archive',
  outcomeEvidenceQuote: 'Deliver a searchable archive.',
  workItems: [
    {
      description: 'Index records',
      evidenceQuote: 'Index the historical records.',
    },
    {
      description: 'Build search',
      evidenceQuote: 'Build the search interface.',
    },
  ],
};
const options = {
  source: 'extraction' as const,
  sourceMeetingId: 'm1',
  assessedAt: '2026-08-28T12:00:00Z',
};
describe('project qualification', () => {
  it('requires grounded outcome and distinct work', () => {
    expect(assessProjectProposal(proposal, transcript, options).state).toBe(
      'qualified',
    );
  });
  it.each([
    undefined,
    {},
    { ...proposal, workItems: [] },
    { ...proposal, workItems: [proposal.workItems[0], proposal.workItems[0]] },
    { ...proposal, outcomeEvidenceQuote: 'Invented outcome quote' },
  ])('leaves insufficient evidence unassessed', (input) => {
    expect(assessProjectProposal(input, transcript, options).state).toBe(
      'unassessed',
    );
  });
  it('accepts whitespace differences but not invented evidence', () => {
    expect(
      assessProjectProposal(
        proposal,
        transcript.replaceAll(' ', '\n '),
        options,
      ).state,
    ).toBe('qualified');
  });
  it('drops an unsupported optional work item when two grounded items remain', () => {
    const result = assessProjectProposal(
      {
        ...proposal,
        workItems: [
          proposal.workItems[0],
          {
            description: 'Invented extra work',
            evidenceQuote: 'This quotation does not exist in the source.',
          },
          proposal.workItems[1],
        ],
      },
      transcript,
      options,
    );
    expect(result).toMatchObject({ state: 'qualified' });
    expect(result.workItems).toEqual(proposal.workItems);
  });
  it('grounds subordinate decisions and drops unverified parents', () => {
    const result = assessProjectProposal(
      {
        ...proposal,
        kind: 'task',
        parentProjectId: 'unknown',
        parentEvidenceQuote: transcript,
      },
      transcript,
      options,
    );
    expect(result.state).toBe('subordinate');
    expect(result.parentProjectId).toBeUndefined();
    expect(
      assessProjectProposal({ kind: 'task' }, transcript, options).state,
    ).toBe('unassessed');
  });
  it('does not treat overlapping quotations as independent evidence', () => {
    expect(
      assessProjectProposal(
        {
          ...proposal,
          workItems: [
            { description: 'One', evidenceQuote: transcript },
            proposal.workItems[0],
          ],
        },
        transcript,
        options,
      ).state,
    ).toBe('unassessed');
  });
  it('safely reads metadata and rejects malformed qualifications', () => {
    const result = assessProjectProposal(proposal, transcript, options);
    expect(
      readProjectQualification(
        JSON.stringify({ projectQualification: result }),
      ),
    ).toEqual(result);
    for (const bad of [
      null,
      '{',
      [],
      { projectQualification: { ...result, version: 2 } },
      { projectQualification: { ...result, workItems: [null] } },
    ])
      expect(readProjectQualification(bad)).toBeNull();
  });
});

it('keeps missing-source reviews readable', () => {
  const result = assessProjectProposal(undefined, '', {
    source: 'review',
    sourceMeetingId: '',
  });
  expect(result.sourceMeetingId).toBeUndefined();
  expect(readProjectQualification({ projectQualification: result })).toEqual(
    result,
  );
});

it('rejects partially overlapping source spans', () => {
  expect(
    assessProjectProposal(
      {
        kind: 'initiative',
        outcome: 'Archive',
        outcomeEvidenceQuote: 'Deliver a searchable archive.',
        workItems: [
          {
            description: 'Index records',
            evidenceQuote: 'We will index the historical records',
          },
          {
            description: 'Complete indexing',
            evidenceQuote: 'index the historical records before Friday.',
          },
        ],
      },
      'Deliver a searchable archive. We will index the historical records before Friday.',
      options,
    ).state,
  ).toBe('unassessed');
});

it('retains the model uncertainty reason without treating it as a grounded rejection', () => {
  expect(
    assessProjectProposal(
      {
        kind: 'uncertain',
        reason: 'The discussion refers to an earlier plan.',
      },
      transcript,
      options,
    ),
  ).toMatchObject({
    state: 'unassessed',
    issue: 'model_uncertain',
    reason: 'The discussion refers to an earlier plan.',
  });
});

it('distinguishes missing sources from invalid outcome quotes and overlapping work', () => {
  expect(assessProjectProposal(undefined, '', options)).toMatchObject({
    issue: 'source_unavailable',
  });
  expect(
    assessProjectProposal(
      { ...proposal, outcomeEvidenceQuote: 'A fabricated outcome quote' },
      transcript,
      options,
    ),
  ).toMatchObject({ issue: 'outcome_not_grounded' });
  expect(
    assessProjectProposal(
      {
        ...proposal,
        workItems: [proposal.workItems[0], proposal.workItems[0]],
      },
      transcript,
      options,
    ),
  ).toMatchObject({ issue: 'work_not_distinct' });
});

it('uses durable failed attempts to prevent automatic reload loops while remaining retryable', () => {
  const metadata = {
    projectScopeReviewAttempt: {
      version: 2,
      status: 'failed',
      reason: 'The model response was incomplete.',
      attemptedAt: '2026-08-28T12:00:00Z',
    },
  };
  expect(isProjectScopeReviewPending(metadata)).toBe(true);
  expect(shouldAutomaticallyReviewProjectScope(metadata)).toBe(false);
  expect(readProjectScopeReviewReason(metadata)).toBe(
    'The model response was incomplete.',
  );
});

import { describe, expect, it } from 'vitest';

import {
  ensureAskPlutoAttributionAnswer,
  removeRepeatedAskPlutoClaims,
} from '../../electron/intelligence/askPlutoAnswerText';
import type { CitationChain } from '../../electron/intelligence/intelligenceTypes';

const citation = (claim: string, meetingId = 'meeting-1'): CitationChain => ({
  claim,
  meeting_id: meetingId,
  meeting_title: 'UI and Layout Refinements',
  evidence_span: claim,
  evidence_valid: true,
  trust_status: 'grounded',
});

describe('Ask Pluto answer repetition', () => {
  it('removes the replayed paragraph at the answer boundary and keeps distinct citations', () => {
    const first = 'The team decided to hide the button or label.';
    const second = 'The team decided to move the back home button a little.';
    const answer = `${first} ${second} ${first.replace('.', ' .')} ${second.replace('.', ' .')}`;
    const result = removeRepeatedAskPlutoClaims(answer, [
      citation(first),
      citation(second),
      citation(first),
      citation(second),
    ]);

    expect(result.answer).toBe(`${first} ${second}`);
    expect(result.citations.map((item) => item.claim)).toEqual([first, second]);
  });

  it('drops prior answer claims while retaining new supported claims and sources', () => {
    const previous =
      'Granola can recognize who a meeting is with via calendar data.';
    const earlier = 'The team decided to hide the button or label.';
    const newClaim = 'The capability to add multiple calendars has been added.';
    const result = removeRepeatedAskPlutoClaims(
      `${earlier} ${previous} ${newClaim}`,
      [
        citation(earlier),
        citation(previous),
        citation(newClaim),
        citation(newClaim, 'meeting-2'),
      ],
      `${earlier}\n${previous}`,
    );

    expect(result.answer).toBe(newClaim);
    expect(result.citations.map((item) => item.meeting_id)).toEqual([
      'meeting-1',
      'meeting-2',
    ]);
  });
});

describe('Ask Pluto attribution answers', () => {
  it('does not convert an unattributed requirement into an assignment', () => {
    expect(
      ensureAskPlutoAttributionAnswer(
        'Who said I should present this to Beta Reviewer?',
        'You were tasked with ensuring the application was deployed before showing it to Beta Reviewer.',
      ),
    ).toBe(
      'I can’t confirm who said it from the synthesized context returned for this question. The note records the requirement, but it does not identify the speaker or assigner.',
    );
  });

  it('removes a contradictory assignment claim even when the answer admits the speaker is unknown', () => {
    expect(
      ensureAskPlutoAttributionAnswer(
        'Who said I should present this to Beta Reviewer?',
        'The meeting notes specifically assign you the task. The notes do not identify a specific person who made that request.',
      ),
    ).toBe(
      'I can’t confirm who said it from the synthesized context returned for this question. The note records the requirement, but it does not identify the speaker or assigner.',
    );
  });

  it('keeps the factual portion of a mixed question while removing unsupported ownership', () => {
    expect(
      ensureAskPlutoAttributionAnswer(
        'What is needed for Beta Reviewer, and who said it?',
        'The application needs to be deployed. You were tasked with presenting it to Beta Reviewer. The note does not identify who made that request.',
      ),
    ).toBe(
      'The application needs to be deployed. The note does not identify who made that request.',
    );
  });

  it('preserves a direct attribution when the answer supplies one', () => {
    const answer =
      'Alpha Contact requested that you send the revised profiles.';
    expect(
      ensureAskPlutoAttributionAnswer(
        'Who requested the revised profiles?',
        answer,
      ),
    ).toBe(answer);
  });

  it('leaves answers to non-attribution questions unchanged', () => {
    const answer = 'The application should be in the cloud before the review.';
    expect(
      ensureAskPlutoAttributionAnswer(
        'What is needed for Beta Reviewer?',
        answer,
      ),
    ).toBe(answer);
  });
});

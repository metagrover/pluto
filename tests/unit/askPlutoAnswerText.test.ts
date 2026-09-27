import { describe, expect, it } from 'vitest';

import { removeRepeatedAskPlutoClaims } from '../../electron/intelligence/askPlutoAnswerText';
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

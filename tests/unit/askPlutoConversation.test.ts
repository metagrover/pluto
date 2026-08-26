import { describe, expect, it } from 'vitest';

import {
  describePreviousConversationFailure,
  inheritConversationScope,
  isDiagnosticConversationFollowUp,
  queryReferencesPriorConversation,
} from '../../electron/intelligence/askPlutoConversation';
import type { AskPlutoConversationTurn } from '../../src/types/askPlutoQuery';

const priorTurns: AskPlutoConversationTurn[] = [
  { role: 'user', content: "Summarize today's meetings" },
  {
    role: 'assistant',
    content: "I couldn't find information about that in your meetings.",
    outcome: 'no_evidence',
    resolvedScope: {
      kind: 'temporal',
      meetingIds: [],
      temporalRange: {
        fromInclusive: '2026-08-25T07:00:00.000Z',
        toExclusive: '2026-08-26T07:00:00.000Z',
        label: 'today',
        timeZone: 'America/Los_Angeles',
      },
      resolvedAt: '2026-08-26T00:36:00.000Z',
      source: 'explicit',
    },
    retrievalSummary: {
      matchedMeetingCount: 20,
      includedMeetingCount: 20,
      preparedEvidenceCount: 2,
      transcriptOnlyCount: 18,
      omittedMeetingCount: 0,
    },
  },
];

describe('Ask Pluto conversation scope', () => {
  it('recognizes diagnostic and referential follow-ups', () => {
    expect(isDiagnosticConversationFollowUp('What went wrong here?')).toBe(
      true,
    );
    expect(queryReferencesPriorConversation('Analyze them more deeply')).toBe(
      true,
    );
  });

  it('inherits structured scope even when the prior answer had no citations', () => {
    expect(
      inheritConversationScope('What went wrong here?', priorTurns),
    ).toMatchObject({
      kind: 'temporal',
      source: 'inherited',
      temporalRange: { label: 'today' },
    });
  });

  it('does not inherit scope for an unrelated explicit question', () => {
    expect(
      inheritConversationScope('Who owns pricing approval?', priorTurns),
    ).toBeUndefined();
  });

  it('explains a prior no-evidence result without searching globally', () => {
    expect(describePreviousConversationFailure(priorTurns[1])).toContain(
      '20 meetings from today',
    );
  });
});

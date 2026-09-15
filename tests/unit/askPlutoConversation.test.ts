import { describe, expect, it } from 'vitest';

import {
  describePreviousConversationFailure,
  inheritConversationScope,
  isDiagnosticConversationFollowUp,
  queryReferencesPriorConversation,
  resolveConversationQuery,
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

  it('reports the headings and transcript passages from the prior retrieval', () => {
    const prior = {
      ...priorTurns[1],
      retrievalTrace: {
        level: 'transcript' as const,
        searchedMeetingCount: 18,
        sections: [
          {
            meetingId: 'meeting-1',
            meetingTitle: 'Launch review',
            sectionId: 'topic:release',
            heading: 'Release timing',
            kind: 'discussion',
            sourceRevision: 'revision-1',
          },
        ],
        transcriptPassages: [
          {
            meetingId: 'meeting-1',
            meetingTitle: 'Launch review',
            quote: 'The release moves Friday.',
            speaker: 'Sam',
            startMs: 42000,
          },
        ],
        commitmentCount: 0,
        omittedResultCount: 0,
      },
    } satisfies AskPlutoConversationTurn;

    const explanation = describePreviousConversationFailure(prior);
    expect(explanation).toContain('18 meetings');
    expect(explanation).toContain('Release timing');
    expect(explanation).toContain('1 transcript passage');
  });

  it('carries the assignee into a request for more results', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: "What's assigned to Ayush?" },
      {
        role: 'assistant',
        content: 'A partial list of assignments.',
        outcome: 'partial',
      },
    ];

    expect(resolveConversationQuery('there should be more?', turns)).toBe(
      'What else is assigned to Ayush? Search all meeting notes and distinguish explicit assignments from possible follow-ups.',
    );
    expect(resolveConversationQuery('What did Priya decide?', turns)).toBe(
      'What did Priya decide?',
    );
  });
});

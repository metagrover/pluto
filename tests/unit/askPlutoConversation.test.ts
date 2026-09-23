import { describe, expect, it } from 'vitest';

import {
  describePreviousConversationFailure,
  inheritConversationScope,
  isDiagnosticConversationFollowUp,
  queryReferencesPriorConversation,
  resolveAskPlutoConversation,
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
    expect(
      queryReferencesPriorConversation('And draft a follow-up email.'),
    ).toBe(true);
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
    expect(resolveConversationQuery('tell me more?', turns)).toBe(
      'What else is assigned to Ayush? Search all meeting notes and distinguish explicit assignments from possible follow-ups.',
    );
    expect(resolveAskPlutoConversation('tell me more?', turns)).toMatchObject({
      relation: 'expansion',
      task: 'analysis',
      answerQuery:
        'Tell me more about what is assigned to Ayush. Add supported context about why it matters, current status, constraints, and related decisions instead of repeating the same list.',
    });
    expect(resolveConversationQuery('What did Priya decide?', turns)).toBe(
      'What did Priya decide?',
    );
    expect(
      resolveConversationQuery("Summarize this week's meetings", turns),
    ).toBe("Summarize this week's meetings");
  });

  it('separates a referential drafting request from its retrieval query', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'What is Jordan working on?' },
      {
        role: 'assistant',
        content: 'Jordan is updating holdings and plan information.',
        outcome: 'answered',
      },
    ];

    const resolved = resolveAskPlutoConversation(
      'Draft a follow-up email about that.',
      turns,
    );

    expect(resolved).toMatchObject({
      relation: 'follow_up',
      task: 'draft',
      answerQuery: 'Draft a follow-up email about that.',
      priorQuestion: 'What is Jordan working on?',
    });
    expect(resolved.retrievalQuery).toBe(
      'What is Jordan working on?\nDraft a follow-up email about that.',
    );
    expect(resolved.retrievalQuery).not.toContain(
      'updating holdings and plan information',
    );
  });

  it('treats an underspecified follow-up draft as part of the active conversation', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'What is Jordan working on?' },
      {
        role: 'assistant',
        content: 'Jordan is preparing the launch review.',
        outcome: 'answered',
      },
    ];

    expect(
      resolveAskPlutoConversation('Draft a follow-up email.', turns),
    ).toMatchObject({
      relation: 'follow_up',
      task: 'draft',
      priorQuestion: 'What is Jordan working on?',
    });
  });

  it('keeps short status and blocker questions anchored to the latest topic', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'Tell me about the launch review.' },
      {
        role: 'assistant',
        content: 'The team is preparing the customer rollout.',
        outcome: 'answered',
      },
    ];

    expect(
      resolveAskPlutoConversation("What's the status?", turns),
    ).toMatchObject({
      relation: 'follow_up',
      priorQuestion: 'Tell me about the launch review.',
    });
    expect(resolveAskPlutoConversation('Any blockers?', turns)).toMatchObject({
      relation: 'follow_up',
      priorQuestion: 'Tell me about the launch review.',
    });
  });

  it('does not revive an older assignee after the conversation changes topic', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: "What's assigned to Jordan?" },
      { role: 'assistant', content: 'Jordan owns the launch update.' },
      { role: 'user', content: 'What changed in the pricing review?' },
      { role: 'assistant', content: 'The team changed the packaging model.' },
    ];

    const resolved = resolveAskPlutoConversation('Tell me more.', turns);
    expect(resolved).toMatchObject({
      relation: 'expansion',
      priorQuestion: 'What changed in the pricing review?',
    });
    expect(resolved.retrievalQuery).not.toContain('assigned to Jordan');
  });

  it('grounds an analytical continuation in the prior question', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'Review my last five one-on-ones.' },
      {
        role: 'assistant',
        content: 'You consistently left little time for employee questions.',
        outcome: 'answered',
      },
    ];

    expect(
      resolveAskPlutoConversation('How could I improve that?', turns),
    ).toMatchObject({
      relation: 'follow_up',
      task: 'analysis',
      priorQuestion: 'Review my last five one-on-ones.',
      retrievalQuery:
        'Review my last five one-on-ones.\nHow could I improve that?',
    });
  });

  it('classifies comparison and standalone drafting work', () => {
    expect(
      resolveAskPlutoConversation(
        'How has the launch plan changed over time?',
        [],
      ),
    ).toMatchObject({ relation: 'new_topic', task: 'comparison' });
    expect(
      resolveAskPlutoConversation('Write a follow-up email to Jordan.', []),
    ).toMatchObject({ relation: 'new_topic', task: 'draft' });
  });

  it('keeps a named person topic conversational while focusing retrieval on the new question', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: "What's assigned to Jordan?" },
      {
        role: 'assistant',
        content: 'Jordan is updating holdings and plan information.',
        outcome: 'answered',
      },
    ];

    expect(
      resolveAskPlutoConversation(
        'what is jordan most concerned about?',
        turns,
      ),
    ).toMatchObject({
      relation: 'follow_up',
      task: 'analysis',
      retrievalQuery: 'what is jordan most concerned about?',
      answerQuery: 'what is jordan most concerned about?',
      priorQuestion: "What's assigned to Jordan?",
    });
  });
});

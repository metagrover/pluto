import { describe, expect, it } from 'vitest';

import {
  asksForExplicitAttribution,
  asksToVerifyProjectAssociation,
  buildAskPlutoAcknowledgment,
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

describe('conversational acknowledgments', () => {
  const turns: AskPlutoConversationTurn[] = [
    { role: 'user', content: 'What is the main strategic takeaway?' },
    {
      role: 'assistant',
      content:
        'Treat the pilot as both a delivery milestone and a learning loop.',
      conversationAnchor: 'What is the main strategic takeaway?',
    },
  ];

  it('responds socially instead of launching another retrieval', () => {
    expect(
      resolveAskPlutoConversation("That's a great insight.", turns),
    ).toMatchObject({
      relation: 'acknowledgment',
      task: 'lookup',
      retrievalQuery: 'What is the main strategic takeaway?',
    });
    expect(buildAskPlutoAcknowledgment("That's a great insight.")).toBe(
      "I'm glad it helped.",
    );
  });

  it('does not pretend an earlier social turn contained an insight', () => {
    expect(
      buildAskPlutoAcknowledgment(
        "That's a great insight.",
        "Hi! I'm Pluto, your AI meeting assistant. Ask me anything about your meeting history.",
        'social',
      ),
    ).toBe(
      "Ha — I'll take the compliment, but we haven't gotten to an insight yet. What do you want to dig into?",
    );
  });

  it('does not swallow a compliment that also asks a question', () => {
    expect(
      resolveAskPlutoConversation(
        "That's a great insight, but can you explain why?",
        turns,
      ).relation,
    ).not.toBe('acknowledgment');
  });
});

describe('Ask Pluto conversation scope', () => {
  it('treats a tentative project link as a relationship question', () => {
    expect(
      asksToVerifyProjectAssociation(
        'What is needed for Beta Reviewer? Is it for the Project Atlas project?',
      ),
    ).toBe(true);
    expect(
      asksToVerifyProjectAssociation('Give me the Project Atlas status.'),
    ).toBe(false);
    expect(
      asksForExplicitAttribution('Who said that we need to present this?'),
    ).toBe(true);
  });

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
      { role: 'user', content: "What's assigned to Gamma?" },
      {
        role: 'assistant',
        content: 'A partial list of assignments.',
        outcome: 'partial',
      },
    ];

    expect(resolveConversationQuery('there should be more?', turns)).toBe(
      'What else is assigned to Gamma? Search all meeting notes and distinguish explicit assignments from possible follow-ups.',
    );
    expect(resolveConversationQuery('tell me more?', turns)).toBe(
      'What else is assigned to Gamma? Search all meeting notes and distinguish explicit assignments from possible follow-ups.',
    );
    expect(resolveAskPlutoConversation('tell me more?', turns)).toMatchObject({
      relation: 'expansion',
      task: 'analysis',
      answerQuery:
        'Tell me more about what is assigned to Gamma. Add supported context about why it matters, current status, constraints, and related decisions instead of repeating the same list.',
    });
    expect(resolveConversationQuery('What did Priya decide?', turns)).toBe(
      'What did Priya decide?',
    );
    expect(
      resolveConversationQuery("Summarize this week's meetings", turns),
    ).toBe("Summarize this week's meetings");
  });

  it('keeps two consecutive tell-me-more turns on the same cited meeting', () => {
    const question =
      'What were the key takeaways from UI and Layout Refinements?';
    const firstTurns: AskPlutoConversationTurn[] = [
      { role: 'user', content: question },
      {
        role: 'assistant',
        content: 'The team decided to hide the button or label.',
        meetingIds: ['ui-layout-meeting'],
        conversationAnchor: question,
      },
    ];
    const first = resolveAskPlutoConversation('tell me more', firstTurns);
    expect(first).toMatchObject({
      relation: 'expansion',
      task: 'analysis',
      retrievalQuery: question,
    });

    const second = resolveAskPlutoConversation('tell me more', [
      ...firstTurns,
      { role: 'user', content: 'tell me more' },
      {
        role: 'assistant',
        content: 'The capability to add multiple calendars has been added.',
        meetingIds: ['ui-layout-meeting'],
        conversationAnchor: first.retrievalQuery,
      },
    ]);
    expect(second).toMatchObject({
      relation: 'expansion',
      task: 'analysis',
      retrievalQuery: question,
    });
    expect(second.answerQuery).not.toContain('tell me more: tell me more');
  });

  it('revisits the original question for an omitted-detail follow-up', () => {
    const turns: AskPlutoConversationTurn[] = [
      {
        role: 'user',
        content: 'Summarize Punit Grover’s recent contributions',
      },
      {
        role: 'assistant',
        content: 'Punit asked about the kitchen table.',
        outcome: 'partial',
        unsupportedClaimCount: 4,
        omissionRef: 'opaque-ref',
      },
    ];

    expect(
      resolveAskPlutoConversation('Can you list the left out details?', turns),
    ).toMatchObject({
      relation: 'omission_follow_up',
      task: 'analysis',
      retrievalQuery: 'Summarize Punit Grover’s recent contributions',
    });
    expect(
      resolveAskPlutoConversation('What did Punit decide next?', turns)
        .relation,
    ).toBe('follow_up');
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

  it('treats underspecified coaching as analysis of the active conversation', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'What should I focus on immediately?' },
      {
        role: 'assistant',
        content:
          'Focus first on pipeline reliability, then the Project Atlas release.',
        outcome: 'answered',
        conversationAnchor: 'What should I focus on immediately?',
      },
      { role: 'user', content: 'Tell me more, but in detail.' },
      {
        role: 'assistant',
        content: 'Pipeline reliability is blocking production readiness.',
        outcome: 'answered',
        conversationAnchor: 'What should I focus on immediately?',
      },
    ];

    expect(
      resolveAskPlutoConversation('Do you have any feedback for me?', turns),
    ).toMatchObject({
      relation: 'follow_up',
      task: 'analysis',
      priorQuestion: 'What should I focus on immediately?',
      retrievalQuery:
        'What should I focus on immediately?\nDo you have any feedback for me?',
    });
  });

  it('keeps analytical questions with a named subject independent', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'What should I focus on?' },
      { role: 'assistant', content: 'Focus on release readiness.' },
    ];

    expect(
      resolveAskPlutoConversation('Do you have feedback for Jordan?', turns),
    ).toMatchObject({
      relation: 'new_topic',
      task: 'analysis',
      retrievalQuery: 'Do you have feedback for Jordan?',
    });

    expect(
      resolveAskPlutoConversation(
        'What do you think will satisfy Alpha Contact in terms of their expectations?',
        [
          {
            role: 'user',
            content: 'What should I focus on?',
          },
          {
            role: 'assistant',
            content:
              'The deployment needs to be ready for Beta Reviewer to review.',
            conversationContext: {
              anchor: 'What should I focus on?',
              meetingIds: ['advisor-platform'],
              topic: { kind: 'workspace', label: 'Workspace priorities' },
            },
          },
        ],
      ),
    ).toMatchObject({
      relation: 'new_topic',
      task: 'analysis',
      retrievalQuery:
        'What do you think will satisfy Alpha Contact in terms of their expectations?',
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

  it('keeps a comparative follow-up attached to the active conversation', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'What is the launch risk for Project Atlas?' },
      { role: 'assistant', content: 'The launch risk is an untested handoff.' },
    ];

    expect(
      resolveAskPlutoConversation(
        'Compare this with our other projects.',
        turns,
      ),
    ).toMatchObject({
      relation: 'follow_up',
      task: 'comparison',
      retrievalPolicy: 'reuse',
    });
    expect(
      resolveAskPlutoConversation(
        'Create a summary of this discussion.',
        turns,
      ),
    ).toMatchObject({ relation: 'follow_up', task: 'draft' });
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

  it('keeps a pronoun coaching question with the active person', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'Tell me about Gamma.' },
      {
        role: 'assistant',
        content: 'Gamma is working on the deployment checklist.',
        outcome: 'answered',
        conversationContext: {
          topic: { kind: 'person', id: 'person-c', label: 'Gamma' },
          meetingIds: [],
        },
      },
    ];

    expect(
      resolveAskPlutoConversation('How should I coach him?', turns),
    ).toMatchObject({
      relation: 'follow_up',
      task: 'analysis',
      priorQuestion: 'Tell me about Gamma.',
    });
  });

  it('keeps an elliptical recommendation within the prior project', () => {
    const turns: AskPlutoConversationTurn[] = [
      {
        role: 'user',
        content: 'What is the current state of Project Atlas?',
      },
      {
        role: 'assistant',
        content:
          'The last recorded update is dated, so current status needs checking.',
        outcome: 'answered',
        conversationAnchor: 'What is the current state of Project Atlas?',
        conversationContext: {
          topic: { kind: 'project', id: 'atlas', label: 'Project Atlas' },
          meetingIds: [],
        },
      },
      { role: 'user', content: 'Tell me more about the pipeline.' },
      {
        role: 'assistant',
        content:
          'The last note describes pipeline work, but not its current state.',
        outcome: 'answered',
        conversationAnchor: 'What is the current state of Project Atlas?',
        conversationContext: {
          topic: { kind: 'project', id: 'atlas', label: 'Project Atlas' },
          meetingIds: [],
        },
      },
    ];

    expect(
      resolveAskPlutoConversation('What would you do first?', turns),
    ).toMatchObject({
      relation: 'follow_up',
      task: 'analysis',
      retrievalQuery:
        'What is the current state of Project Atlas?\nWhat would you do first?',
    });
  });

  it('isolates the real user question when disputing an attributed entity', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'Generate my quarterly accomplishments' },
      {
        role: 'assistant',
        content: '• Gamma worked on a pipeline to generate client emails.',
        outcome: 'answered',
      },
    ];

    expect(
      resolveAskPlutoConversation(
        'why are you giving me answers for Gamma? give me my accomplishments',
        turns,
      ),
    ).toMatchObject({
      relation: 'follow_up',
      retrievalQuery: 'give me my accomplishments',
      answerQuery:
        'why are you giving me answers for Gamma? give me my accomplishments',
      priorQuestion: 'Generate my quarterly accomplishments',
    });
  });

  it('resolves a topic-specific expansion referencing the prior assistant answer', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'what should i focus on?' },
      {
        role: 'assistant',
        content:
          'Immediate Priorities:\n• Follow up with Alpha Contact to confirm the proposed approach.\n• Meeting with Alpha Contact scheduled for Monday regarding database optimization.',
        meetingIds: ['person-a-monday-meeting'],
        outcome: 'answered',
      },
    ];

    const resolved = resolveAskPlutoConversation(
      'tell me more? monday meeting especially',
      turns,
    );

    expect(resolved.relation).toBe('expansion');
    expect(resolved.task).toBe('analysis');
    expect(resolved.retrievalQuery).toContain('monday');
    expect(resolved.retrievalQuery).toContain('Alpha Contact');
    expect(resolved.retrievalQuery).toContain('database optimization');
    expect(resolved.retrievalQuery).not.toContain('what should i focus on');
  });

  it('treats a natural request to dive into a named priority as a deep expansion', () => {
    const turns: AskPlutoConversationTurn[] = [
      { role: 'user', content: 'What should I focus on?' },
      {
        role: 'assistant',
        content:
          'Focus now\n\nProject Atlas — Production Release\n\nPipeline & Infrastructure — Resolve the deployment issue.',
        outcome: 'answered',
        conversationAnchor: 'What should I focus on?',
      },
    ];

    const resolved = resolveAskPlutoConversation(
      'Can we dive in more details about Project Atlas and the pipeline there?',
      turns,
    );

    expect(resolved).toMatchObject({
      relation: 'expansion',
      task: 'analysis',
      priorQuestion: 'What should I focus on?',
      answerQuery:
        'Can we dive in more details about Project Atlas and the pipeline there?',
    });
    expect(resolved.retrievalQuery).toContain('Project Atlas');
    expect(resolved.retrievalQuery).toContain('Production Release');
  });
});

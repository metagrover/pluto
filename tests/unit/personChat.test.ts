import { describe, expect, it } from 'vitest';
import type { PersistedMeeting, PersonBriefingDetail } from '../../electron/db';
import {
  buildPersonChatContext,
  buildPersonChatPrompt,
  getPersonChatQuickReply,
  resolvePersonChatRecallQuery,
  routePersonChatIntent,
} from '../../electron/intelligence/personChat';

it('keeps short contact follow-ups on the new topic and preserves the scope question', () => {
  const previous = 'Who can help with design in the Weekly sync meeting?';
  const recall = resolvePersonChatRecallQuery('What about architecture?', [
    { role: 'user', content: previous },
    { role: 'assistant', content: 'Avery can help with design.' },
  ]);
  expect(recall.scopeQuery).toBe(previous);
  const context = buildPersonChatContext({
    detail,
    query: recall.query,
    getMeeting: (id) => ({
      id,
      enhanced_notes:
        'Consult Morgan for architectural review.\n\nAvery can help with design.',
    }),
  });
  expect(context.intent).toBe('personal_recall');
  expect(context.evidence).toContain('Consult Morgan');
  expect(context.evidence).not.toContain('Avery');
});

it('retains contact intent across short follow-ups but resets it on a new request', () => {
  const contact = {
    role: 'user' as const,
    content: 'Who can help with design?',
  };
  const followup = {
    role: 'user' as const,
    content: 'What about architecture?',
  };
  expect(
    resolvePersonChatRecallQuery('And feedback?', [contact, followup]).query,
  ).toBe('Who can help with feedback?');
  for (const query of [
    'How about drafting a message?',
    'Prepare my next meeting',
    'What do I owe?',
  ])
    expect(resolvePersonChatRecallQuery(query, [contact]).query).toBe(query);
  expect(
    resolvePersonChatRecallQuery('What about architecture?', [
      contact,
      { role: 'user', content: 'Help me handle a difficult situation.' },
    ]).query,
  ).toBe('What about architecture?');
  expect(
    resolvePersonChatRecallQuery('What about architecture?', []).query,
  ).toBe('What about architecture?');
});

it('does not lose a meeting boundary when short follow-ups outlive the prompt history window', () => {
  const scope = 'Who can help with design in the Weekly sync meeting?';
  const messages = [
    { role: 'user' as const, content: scope },
    ...Array.from({ length: 12 }, () => ({
      role: 'user' as const,
      content: 'What about architecture?',
    })),
  ];
  expect(resolvePersonChatRecallQuery('And feedback?', messages)).toEqual({
    query: 'Who can help with feedback?',
    scopeQuery: scope,
  });
});

const detail = {
  person: { id: 'maya', name: 'Maya' },
  meetings: [
    {
      id: 'confirmed',
      title: 'Weekly sync',
      started_at: '2026-09-10T10:00:00Z',
      created_at: '2026-09-10T10:00:00Z',
      duration_seconds: 1200,
      context: null,
      evidence: 'confirmed',
    },
    {
      id: 'mentioned',
      title: 'Planning',
      started_at: '2026-09-09T10:00:00Z',
      created_at: '2026-09-09T10:00:00Z',
      duration_seconds: 1200,
      context: 'Maya was mentioned as a possible reviewer.',
      evidence: 'mentioned',
    },
  ],
  commitments: { open: [], delivered: [], candidates: [] },
  isSelf: false,
  knowledgeDoc: null,
  workingMemorySnapshot: null,
  mergedPeople: [],
} as unknown as PersonBriefingDetail;

describe('person chat intelligence', () => {
  it('uses the sourced comprehensive profile and labels shared commitments conservatively', () => {
    const quote = 'Maya requested a short written recommendation.';
    const context = buildPersonChatContext({
      detail: {
        ...detail,
        knowledgeDoc: {
          structured_json: JSON.stringify({
            person_profile: [
              {
                section: 'collaboration',
                summary:
                  'Maya requested a written recommendation before the review.',
                citations: [{ meeting_id: 'confirmed', quote }],
              },
            ],
            evidence_index: [{ meeting_id: 'confirmed', quote }],
          }),
        } as PersonBriefingDetail['knowledgeDoc'],
        sharedCommitments: {
          open: [
            {
              id: 'self-action',
              text: 'Send the review',
              sourceMeetingId: 'confirmed',
            } as PersonBriefingDetail['commitments']['open'][number],
          ],
          delivered: [],
        },
      },
      query: 'How should I prepare a recommendation?',
      getMeeting: (id) =>
        id === 'confirmed' ? { id, enhanced_notes: quote } : undefined,
    });
    expect(context.evidence).toContain(
      'Maya requested a written recommendation before the review.',
    );
    expect(context.evidence).toContain('not necessarily owed to this person');
    expect(context.citations.map((item) => item.meetingId)).toContain(
      'confirmed',
    );
  });
  it('keeps the relevant passage beyond the start of long notes ahead of a large legacy brief', () => {
    const context = buildPersonChatContext({
      detail: {
        ...detail,
        knowledgeDoc: {
          rendered_content: 'Old unrelated profile. '.repeat(1000),
        } as PersonBriefingDetail['knowledgeDoc'],
      },
      query: 'What did Maya say about the SDK?',
      getMeeting: (id) =>
        id === 'confirmed'
          ? {
              id,
              enhanced_notes: `${'Historical launch discussion.\n'.repeat(120)}Maya said the SDK should handle validation, while infrastructure stays with the platform team.\nThe hosting decision remains unresolved.`,
            }
          : undefined,
    });
    expect(context.evidence).toContain('SDK should handle validation');
    expect(context.evidence).toContain('hosting decision remains unresolved');
    expect(context.evidence).not.toContain('Old unrelated profile');
    expect(context.evidence.length).toBeLessThanOrEqual(9000);
    expect(context.citations).toHaveLength(1);
    expect(context.citations[0].excerpt).toContain('SDK');
  });

  it('does not use cached profile claims when the cited notes are missing or private', () => {
    const quote = 'Maya owns the confidential SDK launch.';
    const knowledgeDoc = {
      structured_json: JSON.stringify({
        person_profile: [
          {
            section: 'responsibilities',
            summary: 'Maya owns the SDK launch.',
            citations: [{ meeting_id: 'confirmed', quote }],
          },
        ],
        evidence_index: [{ meeting_id: 'confirmed', quote }],
      }),
    } as PersonBriefingDetail['knowledgeDoc'];
    for (const notes of ['', quote]) {
      const context = buildPersonChatContext({
        detail: {
          ...detail,
          knowledgeDoc,
          meetings: detail.meetings.map((meeting) =>
            meeting.id === 'confirmed'
              ? { ...meeting, title: 'SDK review' }
              : meeting,
          ),
        },
        query: 'What did Maya say about the SDK?',
        getMeeting: (id) => ({ id, enhanced_notes: notes }),
      });
      expect(context.evidence).not.toContain('Maya owns');
      expect(context.citations).toHaveLength(0);
      if (!notes)
        expect(context.evidence).toContain(
          'Saved meeting notes are unavailable',
        );
    }
  });

  it('routes common conversational intents without a model call', () => {
    expect(routePersonChatIntent('Draft a warmer note')).toBe('draft');
    expect(routePersonChatIntent('Role-play how they might respond')).toBe(
      'role_play',
    );
    expect(routePersonChatIntent('What do I owe them?')).toBe('commitments');
  });

  it('answers brief polite closures without retrieving evidence or calling a model', () => {
    expect(getPersonChatQuickReply('nice, thank you')).toBe("You're welcome.");
    expect(getPersonChatQuickReply('Thanks, Pluto!')).toBe("You're welcome.");
    expect(getPersonChatQuickReply('Thank you, what should I send next?')).toBe(
      null,
    );
  });

  it('responds to praise using the prior answer rather than starting a search', () => {
    expect(
      getPersonChatQuickReply(
        'That is a great insight.',
        'The useful move is to make the next request concrete.',
      ),
    ).toContain('make the next request concrete');
  });

  it('only includes synthesized meeting notes, not raw transcript segments', () => {
    // Person chat uses only enhanced_notes/user_notes — raw transcript_json is never read.
    const meetings: Record<string, PersistedMeeting> = {
      confirmed: {
        id: 'confirmed',
        title: 'Weekly sync',
        enhanced_notes:
          'The team reviewed the launch. Maya will send the draft tomorrow.',
        transcript_json: JSON.stringify({
          segments: [
            { speaker: 'Maya Voice', text: 'I will send the draft tomorrow.' },
            {
              speaker: 'Someone Else',
              text: 'Maya definitely dislikes this project.',
            },
          ],
        }),
      },
    };
    const context = buildPersonChatContext({
      detail,
      query: 'What did Maya say about the draft?',
      getMeeting: (id) => meetings[id],
    });

    // Should surface synthesized notes, not raw transcript speaker lines
    expect(context.evidence).toContain('Maya will send the draft tomorrow.');
    // Should NOT surface raw transcript speaker quotes
    expect(context.evidence).not.toContain(
      'I will send the draft tomorrow.\nSomeone Else',
    );
    // An unrelated mention must not fill a specific recall answer.
    expect(context.evidence).not.toContain('Mention only');
  });

  it('keeps person evidence, general guidance, and history separated', () => {
    const context = buildPersonChatContext({
      detail,
      query: 'Help me prepare',
      getMeeting: () => undefined,
    });
    const prompt = buildPersonChatPrompt({
      query: 'Help me prepare',
      context,
      messages: [],
    });
    expect(prompt).toContain('PERSON EVIDENCE');
    expect(prompt).toContain('GENERAL GUIDANCE');
    expect(prompt).toContain('CONVERSATION HISTORY');
    expect(prompt).toContain('never establish facts about Maya');
  });

  it('keeps one useful clarification before returning a copy-ready draft', () => {
    const context = buildPersonChatContext({
      detail,
      query: 'Draft a message to Maya',
      getMeeting: () => undefined,
    });
    const prompt = buildPersonChatPrompt({
      query: 'Draft a message to Maya',
      context,
      messages: [],
    });

    expect(prompt).toContain('ask one concise clarifying question');
    expect(prompt).toContain('one copy-ready version first');
    expect(prompt).toContain('Keep it under 90 words');
    expect(prompt).toContain('never add one by habit');
    expect(prompt).not.toContain('Prefer 2-4 short paragraphs');
  });
});

it('retrieves the design contact for ordinary wording rather than generic project mentions', () => {
  const longOverview =
    'The project covers interface design and deployment planning. '.repeat(20);
  const context = buildPersonChatContext({
    detail,
    query: 'Who can help with design on the project?',
    getMeeting: (id) =>
      id === 'confirmed'
        ? {
            id,
            enhanced_notes: `${longOverview}\nConsult Avery for design support.\nMorgan handles infrastructure.`,
          }
        : undefined,
  });
  expect(context.evidence).toContain('Consult Avery for design support');
});

it('does not substitute unrelated notes for an unknown topic', () => {
  const context = buildPersonChatContext({
    detail,
    query: 'What did Maya say about quasars?',
    getMeeting: (id) => ({
      id,
      enhanced_notes: 'Maya discussed release planning.',
    }),
  });
  expect(context.citations).toHaveLength(0);
  expect(context.evidence).not.toContain('release planning');
});

it('matches ordinary nouns to their adjective forms in saved notes', () => {
  const context = buildPersonChatContext({
    detail,
    query: 'Who can help with architecture?',
    getMeeting: (id) =>
      id === 'confirmed'
        ? {
            id,
            enhanced_notes:
              'Consult Avery for architectural considerations and penetration testing.',
          }
        : undefined,
  });
  expect(context.citations.map((c) => c.meetingId)).toEqual(['confirmed']);
  expect(context.evidence).toContain('Consult Avery');
});

it('does not invite general coaching or adjacent claims into factual recall', () => {
  const context = buildPersonChatContext({
    detail,
    query: 'Who can help with architecture?',
    getMeeting: (id) => ({
      id,
      enhanced_notes: 'Consult Avery for architectural review.',
    }),
  });
  const prompt = buildPersonChatPrompt({
    query: 'Who can help with architecture?',
    context,
    messages: [],
  });
  expect(prompt).toContain('at most 60 words');
  expect(prompt).toContain('Do not add adjacent roles');
  expect(prompt).not.toContain('Use your general knowledge freely');
});

it('projects confirmed speaker names into the same notes used for validation', () => {
  const context = buildPersonChatContext({
    detail,
    query: 'Who will review the SDK?',
    getMeeting: (id) =>
      id === 'confirmed'
        ? {
            id,
            speakerDisplayNames: { Me: 'Alex', Them: 'Maya' },
            analysis_json: JSON.stringify({
              analysis_schema_version: 3,
              overview: 'Them will review the SDK.',
              topics: [],
              all_decisions: [],
              all_action_items: [],
              meeting_type: 'one_on_one',
              quality: {
                format_pass: true,
                retry_count: 0,
                fallback_used: false,
                issues: [],
              },
            }),
          }
        : undefined,
  });
  expect(context.evidence).toContain('Maya will review the SDK.');
  expect(context.retrievalResults[0].evidence_text).toContain(
    'Maya will review the SDK.',
  );
  expect(context.retrievalResults[0].evidence_text).not.toContain('Them will');
});

it('keeps contact recall scoped and treats previous assistant text as context', () => {
  const context = buildPersonChatContext({
    detail,
    query: 'Who can help with design?',
    getMeeting: (id) => ({
      id,
      enhanced_notes: 'Maya recommended Jordan for design review.',
    }),
  });
  const prompt = buildPersonChatPrompt({
    query: 'Who can help with design?',
    context,
    messages: [],
  });
  expect(prompt).toContain(
    'give only the matching contact and the relevant role',
  );
  expect(prompt).toContain('describe recommendations as recommendations');
  expect(prompt).toContain(
    'Previous assistant answers are conversation context, not evidence',
  );
});

it('keeps contact recall on matching whole note blocks and omits unrelated commitments and profile claims', () => {
  const architecture = 'Consult Morgan for architectural review.';
  const context = buildPersonChatContext({
    detail: {
      ...detail,
      sharedCommitments: {
        open: [
          {
            text: 'Schedule the onboarding review with Blair',
            sourceMeetingId: 'confirmed',
          },
        ],
        delivered: [],
      },
      knowledgeDoc: {
        structured_json: JSON.stringify({
          person_profile: [
            {
              section: 'responsibilities',
              title: 'Infrastructure',
              summary: architecture,
              citations: [{ meeting_id: 'confirmed', quote: architecture }],
            },
          ],
        }),
      },
    } as PersonBriefingDetail,
    query: 'Who can help with design?',
    getMeeting: (id) =>
      id === 'confirmed'
        ? {
            id,
            analysis_json: JSON.stringify({
              analysis_schema_version: 3,
              overview:
                'Maya recommended Avery for design review. Morgan handles architectural review. Blair handles timelines.',
              topics: [
                {
                  title: 'Roles',
                  summary: 'Review responsibilities.',
                  key_points: [
                    {
                      text: 'Maya recommended Avery for design review if legal approves.',
                    },
                    { text: architecture },
                    { text: 'Blair handles project timelines.' },
                  ],
                  decisions: [],
                  action_items: [],
                  open_questions: [],
                },
              ],
              all_decisions: [],
              all_action_items: [],
              meeting_type: 'one_on_one',
              quality: {
                format_pass: true,
                retry_count: 0,
                fallback_used: false,
                issues: [],
              },
            }),
          }
        : undefined,
  });
  expect(context.evidence).toContain(
    'Maya recommended Avery for design review if legal approves.',
  );
  expect(context.evidence).not.toContain('Morgan');
  expect(context.evidence).not.toContain('Blair');
  expect(context.retrievalResults[0].evidence_text).toContain(
    'if legal approves',
  );
  expect(context.retrievalResults[0].evidence_text).not.toContain(
    'architectural',
  );
});

it('routes ordinary contact questions to factual recall before coaching cues', () => {
  expect(routePersonChatIntent('Who can handle the design feedback?')).toBe(
    'personal_recall',
  );
  expect(routePersonChatIntent('Who should I ask for feedback?')).toBe(
    'personal_recall',
  );
  expect(routePersonChatIntent('Draft a message asking who can help.')).toBe(
    'draft',
  );
  expect(routePersonChatIntent('How should I handle difficult feedback?')).toBe(
    'advice',
  );
});

it('supplies canonical closed work for both people independently of query phrasing', () => {
  const canonical = {
    open: [],
    delivered: [],
    candidates: [],
    excluded: [
      {
        text: 'Send the equipment inventory',
        status: 'completed' as const,
        sourceMeetingId: 'confirmed',
        ownershipVerified: true,
      },
    ],
  };
  const context = buildPersonChatContext({
    detail,
    query: 'What happened with the inventory?',
    canonicalSelfCommitments: canonical,
    canonicalPersonCommitments: {
      ...canonical,
      excluded: [
        {
          ...canonical.excluded[0],
          text: 'Replace the equipment inventory',
          status: 'rejected',
        },
      ],
    },
    getMeeting: (id) => ({
      id,
      enhanced_notes: 'Maya discussed the equipment inventory.',
    }),
  });
  expect(context.evidence).toContain('"owner":"You","state":"completed"');
  expect(context.evidence).toContain('"owner":"Maya","state":"rejected"');
  expect(context.retrievalResults[0].evidence_text).toContain(
    '"state":"completed"',
  );
  expect(context.retrievalResults[0].canonical_commitments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        owner: 'You',
        state: 'completed',
        meetingId: 'confirmed',
      }),
    ]),
  );
  expect(
    buildPersonChatPrompt({
      query: 'What happened with the inventory?',
      context,
      messages: [],
    }),
  ).toContain('Canonical commitment state overrides historical note wording');
  expect(
    buildPersonChatPrompt({
      query: 'Who handled the inventory?',
      context,
      messages: [],
    }),
  ).toContain('Whenever mentioning a canonical task');
  expect(
    buildPersonChatPrompt({
      query: 'Is this finished?',
      context,
      messages: [],
    }),
  ).toContain(
    'quote the task text exactly and preserve its owner, state, and conditions',
  );
});
it('retains canonical task evidence when notes are unavailable without inventing conversation facts', () => {
  const context = buildPersonChatContext({
    detail,
    query: 'What happened with the inventory?',
    canonicalSelfCommitments: {
      open: [],
      delivered: [],
      candidates: [],
      excluded: [
        {
          text: 'Send the inventory',
          status: 'completed',
          sourceMeetingId: 'confirmed',
          ownershipVerified: true,
        },
      ],
    },
    getMeeting: (id) => ({ id, enhanced_notes: '' }),
  });
  expect(context.retrievalResults[0].evidence_kind).toBe('commitment');
  expect(context.evidence).toContain('Saved meeting notes are unavailable');
  expect(context.evidence).toContain('"state":"completed"');
});

import { describe, expect, it, vi } from 'vitest';
import {
  LIVE_MEETING_CHAT_SCHEMA,
  buildLiveMeetingChatPrompt,
  buildLiveMeetingChatSchema,
  completeLiveMeetingChatAnswer,
} from '../../electron/intelligence/liveMeetingChatAnswer';
import {
  liveActionHasCommitment,
  liveClaimSupportIssue,
} from '../../electron/intelligence/liveMeetingGrounding';
import { buildLiveMeetingAskPlutoContext } from '../../electron/intelligence/meetingAskPluto';
const context = buildLiveMeetingAskPlutoContext({
  meetingId: 'fictional',
  title: 'Review',
  notes: 'The release is approved.',
  participants: ['Alex'],
  transcript: [
    {
      id: '1',
      speaker: 'Me',
      timestampMs: 1,
      confirmed: true,
      text: 'The release is not approved. Testing must finish first.',
    },
    {
      id: '2',
      speaker: 'Call audio',
      timestampMs: 2,
      confirmed: true,
      text: 'Morgan will prepare the checklist. We have not set a deadline.',
    },
  ],
});
describe('composed live answers', () => {
  it.each([
    ['We have decided not to renew the catering contract.', 'answered'],
    ['We have decided not to renew the venue contract.', 'unavailable'],
  ])(
    'changes group voice only for the complete supported decision: %s',
    async (text, status) => {
      const source = buildLiveMeetingAskPlutoContext({
        notes: '',
        participants: [],
        transcript: [
          {
            id: 'a',
            speaker: 'Me',
            timestampMs: 0,
            confirmed: true,
            text: 'We will not renew the catering contract. The venue contract is separate.',
          },
        ],
      });
      const raw = JSON.stringify({
        points: [
          {
            text,
            support: 'We will not renew the catering contract.',
            passages: [1],
          },
        ],
      });
      const response = await completeLiveMeetingChatAnswer({
        raw,
        context: source,
        query: 'What was decided?',
        route: { mode: 'recall', recallKind: 'decision' },
        generate: async () => raw,
      });
      expect(response.status).toBe(status);
      if (status === 'answered')
        expect(response.answer).toBe(
          'Participants have decided not to renew the catering contract.',
        );
    },
  );
  it('does not treat a weekday in nearby task context as an inferred recipient', () => {
    expect(
      liveClaimSupportIssue(
        'Check room availability for Friday.',
        'The event could move to Friday. I will check room availability tomorrow.',
        false,
        'I will check room availability tomorrow.',
      ),
    ).toBeNull();
  });

  it.each([
    [
      'Clients can upload a receipt or enter the receipt details manually.',
      true,
    ],
    ['Clients must pay 50 dollars first.', false],
    ['{"points": [{"text": "Unexpected structured output"}]}', false],
  ])(
    'edits general factual answers without accepting changed facts: %s',
    async (edited, accepted) => {
      const source = buildLiveMeetingAskPlutoContext({
        notes: '',
        participants: [],
        transcript: [
          {
            id: 'receipt',
            speaker: 'Me',
            timestampMs: 0,
            confirmed: true,
            text: 'For the initial submission, the client can upload a receipt or enter the details manually.',
          },
        ],
      });
      const draft =
        'For the initial submission, clients can upload a receipt or enter themselves.';
      const generate = vi.fn(async () => edited as string);
      const result = await completeLiveMeetingChatAnswer({
        raw: JSON.stringify({
          points: [
            {
              text: draft,
              support: 'upload a receipt or enter',
              passages: [1],
            },
          ],
        }),
        context: source,
        query: 'How can a client provide receipt information?',
        route: { mode: 'general' },
        generate,
      });
      expect(generate).toHaveBeenCalledWith(
        expect.stringContaining('Grounded draft:'),
        { plainText: true },
      );
      expect(result.answer).toBe(accepted ? edited : draft);
      expect(result.citations[0].evidence_span).toContain(
        'enter the details manually',
      );
    },
  );

  it.each([
    [
      { mode: 'recall', recallKind: 'decision' },
      'The release is not approved.',
    ],
    [
      { mode: 'recall', recallKind: 'catch_up' },
      'Testing must finish before release approval.',
    ],
    [{ mode: 'general' }, 'The release needs testing before approval.'],
  ] as const)(
    'returns a validated answer without a second model call: %s',
    async (route, text) => {
      const generate = vi.fn();
      const answer = await completeLiveMeetingChatAnswer({
        raw: JSON.stringify({ points: [{ text, passages: [1] }] }),
        query: 'What is the current status?',
        context,
        route,
        generate,
      });
      expect(answer.answer).toBe(text);
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it('retains action review to recover timing omitted by a grounded draft', async () => {
    const context = buildLiveMeetingAskPlutoContext({
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'a',
          text: 'I will check room availability and share the answer tomorrow.',
          speaker: 'Me',
          timestampMs: 0,
          confirmed: true,
        },
      ],
    });
    const point = {
      text: 'Check room availability.',
      support: 'I will check room availability',
      passages: [1],
      timing: null,
    };
    const generate = vi.fn(async () =>
      JSON.stringify({ points: [{ ...point, timing: 'tomorrow' }] }),
    );
    const answer = await completeLiveMeetingChatAnswer({
      raw: JSON.stringify({ points: [point] }),
      query: 'What action items have been agreed?',
      context,
      route: { mode: 'recall', recallKind: 'action' },
      generate,
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(answer.answer).toContain('tomorrow');
  });

  it('shows a repeated generated point only once without requiring copied excerpts', async () => {
    const raw = JSON.stringify({
      points: [
        { text: 'The release is not approved.', passages: [1] },
        { text: 'The release is not approved.', passages: [1] },
      ],
    });
    const answer = await completeLiveMeetingChatAnswer({
      raw,
      context,
      query: 'Is the release approved?',
      route: { mode: 'recall', recallKind: 'fact' },
      generate: async () => raw,
    });
    expect(answer.answer).toBe('The release is not approved.');
    expect(answer.claims).toHaveLength(1);
  });

  it('keeps catch-up and whole-meeting recap instructions distinct', () => {
    const route = { mode: 'recall', recallKind: 'catch_up' } as const;
    const recent = buildLiveMeetingChatPrompt({
      query: 'What did I miss?',
      context,
      assistanceRoute: route,
    });
    const recap = buildLiveMeetingChatPrompt({
      query: 'Summarize this meeting so far.',
      context,
      assistanceRoute: route,
    });
    expect(recent).toContain('supplied recent discussion');
    expect(recent).toContain('Do not revisit older topics');
    expect(recap).toContain('important earlier discussion');
    expect(recap).not.toContain('Do not revisit older topics');
    expect(recent).toContain('Omit unclear details rather than guessing');
  });
  it('asks for clarification rather than adding premises to next-question suggestions', () => {
    const prompt = buildLiveMeetingChatPrompt({
      query: 'What should I ask next?',
      context,
      assistanceRoute: { mode: 'advice' },
    });
    expect(prompt).toContain(
      'ask for clarification rather than assuming its meaning',
    );
    expect(prompt).toContain('Do not introduce unstated specifics or premises');
  });
  it('keeps the newest recap separate from a lengthy earlier topic', () => {
    const source = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `old-${i}`,
          timestampMs: i * 60000,
          speaker: 'Me',
          confirmed: true,
          text: `The cafeteria menu has several options. ${'Discussion of lunch choices. '.repeat(15)}`,
        })),
        {
          id: 'current',
          timestampMs: 60 * 60000,
          speaker: 'Me',
          confirmed: true,
          text: 'The workshop venue is unavailable. We need to choose a new location.',
        },
      ],
    });
    const prompt = buildLiveMeetingChatPrompt({
      query: 'What did I miss?',
      context: source,
      assistanceRoute: { mode: 'recall', recallKind: 'catch_up' },
    });
    expect(prompt).toContain('workshop venue');
    expect(prompt).not.toContain('cafeteria menu');
    expect(
      buildLiveMeetingChatSchema(source, {
        mode: 'recall',
        recallKind: 'catch_up',
      }),
    ).toMatchObject({ properties: { points: { maxItems: 1 } } });
  });
  it('allows complete sentences while bounding the requested point count', () => {
    const schema = buildLiveMeetingChatSchema(context, {
      mode: 'recall',
      recallKind: 'action',
    }) as any;
    expect(schema.properties.points.maxItems).toBe(4);
    expect(schema.properties.points.items.properties.text).toEqual({
      type: 'string',
    });
    expect(
      buildLiveMeetingChatSchema(context, { mode: 'advice' }),
    ).toMatchObject({ properties: { points: { maxItems: 1 } } });
  });
  const composed = (text: string, passages = [1], kind = 'discussion') =>
    JSON.stringify({ points: [{ text, passages, kind }] });
  it.each(['Unknown', 'Speaker 2', 'Call audio'])(
    'reconstructs a raw %s recipient label instead of presenting it as a person',
    async (label) => {
      const source = buildLiveMeetingAskPlutoContext({
        meetingId: 'fictional',
        notes: '',
        participants: [],
        transcript: [
          {
            id: 'promise',
            speaker: label,
            timestampMs: 0,
            confirmed: true,
            text: 'I will send you the project files tomorrow.',
          },
        ],
      });
      const response = await completeLiveMeetingChatAnswer({
        raw: composed(
          `A participant will send the project files to ${label} tomorrow.`,
        ),
        query: 'What was promised?',
        context: source,
        route: { mode: 'recall', recallKind: 'action' },
        generate: async () =>
          composed(
            'A participant promised to share the project files tomorrow.',
          ),
      });
      expect(response.answer).toBe(
        'A participant promised to share the project files tomorrow.',
      );
      expect(response.answer).not.toContain(label);
      expect(response.citations).toHaveLength(1);
    },
  );
  it.each([
    [
      'No decision yet.',
      'No decision has been made on using the west entrance.',
      true,
    ],
    [
      'not decided on',
      'No decision has been made on using the west entrance.',
      false,
    ],
  ])(
    'checks short evidence as a complete cited sentence: %s',
    async (support, text, accepted) => {
      const source = buildLiveMeetingAskPlutoContext({
        notes: '',
        participants: [],
        transcript: [
          {
            id: 'decision',
            speaker: 'Me',
            timestampMs: 0,
            confirmed: true,
            text: 'We have not decided on using the west entrance. No decision yet.',
          },
        ],
      });
      const packet = JSON.stringify({
        points: [{ text, support, passages: [1] }],
      });
      const response = await completeLiveMeetingChatAnswer({
        raw: packet,
        context: source,
        query: 'Have we decided to use the west entrance?',
        route: { mode: 'recall', recallKind: 'decision' },
        generate: async () => packet,
      });
      expect(response.status).toBe(accepted ? 'answered' : 'unavailable');
      if (accepted) expect(response.answer).toBe(text);
    },
  );
  it('does not treat an unrelated no as evidence against requiring approval', async () => {
    const source = buildLiveMeetingAskPlutoContext({
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'review',
          speaker: 'Me',
          timestampMs: 0,
          confirmed: true,
          text: 'The report is on the agenda. Nobody raised objections.',
        },
      ],
    });
    const packet = JSON.stringify({
      points: [
        {
          text: 'No objections were raised. The report was approved.',
          support: 'The report is on the agenda.',
          passages: [1],
        },
      ],
    });
    const response = await completeLiveMeetingChatAnswer({
      raw: packet,
      context: source,
      query: 'Was the report approved?',
      route: { mode: 'recall', recallKind: 'decision' },
      generate: async () => packet,
    });
    expect(response.status).toBe('unavailable');
  });
  it.each([
    ['tomorrow', true],
    ['next Tuesday', false],
  ])(
    'only displays action timing supported by the cited source: %s',
    async (timing, accepted) => {
      const source = buildLiveMeetingAskPlutoContext({
        notes: '',
        participants: [],
        transcript: [
          {
            id: 'promise',
            speaker: 'Me',
            timestampMs: 0,
            confirmed: true,
            text: 'I will share the report tomorrow.',
          },
        ],
      });
      const packet = JSON.stringify({
        points: [
          {
            text: 'A participant will share the report.',
            support: 'I will share the report tomorrow.',
            timing,
            passages: [1],
          },
        ],
      });
      const response = await completeLiveMeetingChatAnswer({
        raw: packet,
        context: source,
        query: 'What actions were promised?',
        route: { mode: 'recall', recallKind: 'action' },
        generate: async () => packet,
      });
      expect(response.status).toBe('answered');
      if (!accepted) expect(response.answer).not.toContain(timing);
      if (accepted)
        expect(response.answer).toBe(
          'A participant will share the report. Timing: tomorrow.',
        );
    },
  );
  it('keeps the object, speaker and adjacent correction in focused action evidence', () => {
    const source = buildLiveMeetingAskPlutoContext({
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'noise',
          speaker: 'Call audio',
          timestampMs: 0,
          confirmed: true,
          text: 'We discussed the cafeteria menu.',
        },
        {
          id: 'promise',
          speaker: 'Me',
          timestampMs: 120000,
          confirmed: true,
          text: 'The archive is incomplete. I will send it on Monday.',
        },
        {
          id: 'correction',
          speaker: 'Me',
          timestampMs: 166000,
          confirmed: true,
          text: 'Correction: Thursday, not Monday.',
        },
      ],
    });
    const prompt = buildLiveMeetingChatPrompt({
      query: 'What was promised?',
      context: source,
      assistanceRoute: { mode: 'recall', recallKind: 'action' },
    });
    expect(prompt).toContain('The archive is incomplete.');
    expect(prompt).toContain('(Me) I will send it on Monday.');
    expect(prompt).toContain('Correction: Thursday, not Monday.');
    expect(prompt).not.toContain('cafeteria');
  });
  it('rejects a timing value explicitly ruled out in the cited source', async () => {
    const source = buildLiveMeetingAskPlutoContext({
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'promise',
          speaker: 'Me',
          timestampMs: 0,
          confirmed: true,
          text: 'I will share the report on Thursday, not Tuesday.',
        },
      ],
    });
    const packet = JSON.stringify({
      points: [
        {
          text: 'A participant will share the report.',
          support: 'I will share the report on Thursday',
          timing: 'Tuesday',
          passages: [1],
        },
      ],
    });
    const response = await completeLiveMeetingChatAnswer({
      raw: packet,
      context: source,
      query: 'What was promised?',
      route: { mode: 'recall', recallKind: 'action' },
      generate: async () => packet,
    });
    expect(response.status).toBe('answered');
    expect(response.answer).not.toContain('Tuesday');
  });
  it.each([
    [
      'The guide needs to be sent tomorrow.',
      'I will send the guide tomorrow.',
      true,
    ],
    [
      'The guide will be sent tomorrow.',
      'I will send the guide tomorrow.',
      true,
    ],
    ['The guide was sent tomorrow.', 'I will send the guide tomorrow.', false],
    ['The guide still needs to be sent.', 'I already sent the guide.', false],
    ['Send the guide.', 'I already sent the guide.', false],
    ['Share the notes.', 'I already shared the notes.', false],
  ])(
    'distinguishes pending passive work from completed work: %s',
    (claim, source, expected) => {
      expect(liveActionHasCommitment(claim, source)).toBe(expected);
    },
  );
  it.each([
    [
      'A participant will email Morgan and possibly arrange a call.',
      'I already emailed Morgan. We will arrange a call.',
      false,
    ],
    [
      'A participant will email Morgan.',
      'I already emailed Morgan. I will email Morgan again tomorrow.',
      true,
    ],
    [
      'A participant will email the contract.',
      'I already emailed the invoice. I will email the contract tomorrow.',
      true,
    ],
  ])(
    'does not convert completed work into a future promise: %s',
    (claim, source, expected) => {
      expect(liveActionHasCommitment(claim, source)).toBe(expected);
    },
  );
  it.each([false, true])(
    'requires an action recipient in the supporting sentence (%s)',
    async (explicit) => {
      const source = buildLiveMeetingAskPlutoContext({
        notes: '',
        participants: [],
        transcript: [
          {
            id: 'promise',
            speaker: 'Me',
            timestampMs: 0,
            confirmed: true,
            text: `Morgan can join later. I will send ${explicit ? 'Morgan' : 'you'} the contract tomorrow.`,
          },
        ],
      });
      const packet = JSON.stringify({
        points: [
          {
            text: 'A participant will send Morgan the contract tomorrow.',
            support: `I will send ${explicit ? 'Morgan' : 'you'} the contract tomorrow.`,
            passages: [1],
          },
        ],
      });
      const response = await completeLiveMeetingChatAnswer({
        raw: packet,
        context: source,
        query: 'What was promised?',
        route: { mode: 'recall', recallKind: 'action' },
        generate: async (prompt) => {
          if (!explicit)
            expect(prompt).toContain('Omit unstated owners and recipients');
          return packet;
        },
      });
      expect(response.status).toBe(explicit ? 'answered' : 'unavailable');
    },
  );
  it('uses nearby context for a project name without assigning a person to the work', async () => {
    const source = buildLiveMeetingAskPlutoContext({
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'topic',
          speaker: 'Me',
          timestampMs: 0,
          confirmed: true,
          text: 'The project is called Atlas. I will send the project tomorrow.',
        },
      ],
    });
    const raw = JSON.stringify({
      points: [
        {
          text: 'A participant will send the Atlas project tomorrow.',
          support: 'I will send the project tomorrow.',
          passages: [1],
        },
      ],
    });
    const response = await completeLiveMeetingChatAnswer({
      raw,
      context: source,
      query: 'What was promised?',
      route: { mode: 'recall', recallKind: 'action' },
      generate: async () => raw,
    });
    expect(response.answer).toContain('Atlas project');
  });
  it('maps a copied source anchor when the model supplies the wrong passage number', async () => {
    const onDiagnostic = vi.fn();
    const response = await completeLiveMeetingChatAnswer({
      raw: JSON.stringify({
        points: [
          {
            text: 'Morgan will prepare the checklist.',
            support: 'Morgan will prepare the checklist.',
            passages: [99],
            kind: 'discussion',
          },
        ],
      }),
      query: 'Who will prepare the checklist?',
      context,
      route: { mode: 'recall', recallKind: 'fact' },
      generate: async () => composed('Morgan will prepare the checklist.'),
      onDiagnostic,
    });
    expect(response.answer).toBe('Morgan will prepare the checklist.');
    expect(onDiagnostic).toHaveBeenCalledWith({
      stage: 'draft',
      point: 0,
      reason: 'source_mapped',
    });
    expect(response.citations[0].evidence_span).toContain(
      'Morgan will prepare the checklist.',
    );
  });
  it('reports a fabricated support excerpt without exposing its text in diagnostics', async () => {
    const onDiagnostic = vi.fn();
    const generate = vi.fn(async () => JSON.stringify({ points: [] }));
    const response = await completeLiveMeetingChatAnswer({
      raw: JSON.stringify({
        points: [
          {
            text: 'Morgan will prepare the checklist.',
            support: 'Jordan approved the budget yesterday.',
            passages: [1],
            kind: 'discussion',
          },
        ],
      }),
      query: 'Who will prepare the checklist?',
      context,
      route: { mode: 'recall', recallKind: 'fact' },
      generate,
      onDiagnostic,
    });
    expect(response.status).toBe('unavailable');
    expect(generate).toHaveBeenCalledOnce();
    expect(onDiagnostic).toHaveBeenCalledWith({
      stage: 'draft',
      point: 0,
      reason: 'missing_source',
    });
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('Jordan');
  });
  it('shows a polished paraphrase while preserving verbatim evidence in citations', async () => {
    const generate = vi.fn(async () =>
      composed('Release approval is pending until testing finishes.'),
    );
    const response = await completeLiveMeetingChatAnswer({
      raw: composed(
        'Release approval is pending until testing finishes (passage 1).',
      ),
      query: 'What is the release status?',
      context,
      route: { mode: 'recall', recallKind: 'fact' },
      generate,
    });
    expect(response.answer).toBe(
      'Release approval is pending until testing finishes.',
    );
    expect(response.answer).not.toContain('The release is not approved.');
    expect(response.citations[0].evidence_span).toContain(
      'The release is not approved.',
    );
    expect(generate).not.toHaveBeenCalled();
  });
  it('removes citation markers without removing invented factual quantities', async () => {
    const response = await completeLiveMeetingChatAnswer({
      raw: composed('Morgan will prepare 9 checklists [1].'),
      query: 'What is the checklist status?',
      context,
      route: { mode: 'recall', recallKind: 'fact' },
      generate: async () => JSON.stringify({ points: [] }),
    });
    expect(response.citations).toEqual([]);
  });
  it('rejects a proposed task even when semantic review incorrectly promotes it', async () => {
    const proposed = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'p',
          speaker: 'Me',
          timestampMs: 1,
          text: 'I was thinking about creating a simple form for client goals.',
          confirmed: true,
        },
      ],
    });
    const response = await completeLiveMeetingChatAnswer({
      raw: composed('Create a simple form for client goals.', [1], 'action'),
      query: 'List agreed actions',
      context: proposed,
      route: { mode: 'recall', recallKind: 'action' },
      generate: async () =>
        composed('Create a simple form for client goals.', [1], 'action'),
    });
    expect(response.citations).toEqual([]);
  });
  it('keeps a direct commitment with its stated owner as a composed action', async () => {
    const response = await completeLiveMeetingChatAnswer({
      raw: composed(
        'Morgan will prepare the checklist; no deadline was set.',
        [1],
        'action',
      ),
      query: 'List agreed actions',
      context,
      route: { mode: 'recall', recallKind: 'action' },
      generate: async () =>
        composed(
          'Morgan will prepare the checklist; no deadline was set.',
          [1],
          'action',
        ),
    });
    expect(response.answer).toContain('Morgan will prepare the checklist');
    expect(response.citations.length).toBeGreaterThan(0);
  });
  it('requires composed points and keeps passage references out of prose', async () => {
    const prompt = buildLiveMeetingChatPrompt({
      query: 'Catch me up',
      context,
      assistanceRoute: { mode: 'recall', recallKind: 'catch_up' },
    });
    expect(prompt).toContain('Write polished, concise responses');
    expect(prompt).toContain('Do not include source numbers in text');
    expect(LIVE_MEETING_CHAT_SCHEMA.required).toEqual(['points']);
    await expect(
      completeLiveMeetingChatAnswer({
        raw: JSON.stringify({ sources: [1] }),
        query: 'Catch me up',
        context,
        route: { mode: 'recall', recallKind: 'catch_up' },
        generate: vi.fn(),
      }),
    ).rejects.toThrow('live_chat_missing_points');
  });
  it('rewrites a long copied sentence before returning a factual answer', async () => {
    const quote =
      'Morgan will prepare the complete release checklist and share the final testing results with the team.';
    const source = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'c',
          speaker: 'Me',
          timestampMs: 1,
          confirmed: true,
          text: quote,
        },
      ],
    });
    const generate = vi.fn(async (prompt: string) => {
      expect(prompt).toContain(
        'Do not copy transcript sentences into the answer',
      );
      return 'Morgan will share testing results and prepare the release checklist.';
    });
    const response = await completeLiveMeetingChatAnswer({
      raw: composed(quote),
      query: 'What will Morgan do?',
      context: source,
      route: { mode: 'recall', recallKind: 'fact' },
      generate,
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(response.answer).toBe(
      'Morgan will share testing results and prepare the release checklist.',
    );
    expect(response.citations[0].evidence_span).toBe(quote);
  });
  it('uses readable capture labels without changing the source wording by substitution', async () => {
    const source = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 's',
          speaker: 'Remote Speaker 1',
          timestampMs: 1,
          confirmed: true,
          text: 'I suggested entering themselves as an option in the form.',
        },
      ],
    });
    const response = await completeLiveMeetingChatAnswer({
      raw: composed(
        'Remote Speaker 1 suggested entering themselves as an option.',
      ),
      query: 'What option was suggested?',
      context: source,
      route: { mode: 'recall', recallKind: 'fact' },
      generate: async () =>
        composed('A participant suggested entering themselves as an option.'),
    });
    expect(response.answer).toBe(
      'A participant suggested entering themselves as an option.',
    );
    expect(response.citations[0].evidence_span).toBe(
      'I suggested entering themselves as an option in the form.',
    );
  });
  it('does not choose an alternative from an ambiguous acknowledgement', async () => {
    const ambiguous = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'q',
          speaker: 'Me',
          timestampMs: 1,
          confirmed: true,
          text: 'Should we have daily meetings or asynchronous follow-up?',
        },
        {
          id: 'a',
          speaker: 'Call audio',
          timestampMs: 2,
          confirmed: true,
          text: 'Is fine.',
        },
      ],
    });
    const response = await completeLiveMeetingChatAnswer({
      raw: composed('Agreed to have daily meetings.', [1], 'decision'),
      query: 'What was agreed?',
      context: ambiguous,
      route: { mode: 'recall', recallKind: 'decision' },
      generate: async () =>
        composed('Agreed to have daily meetings.', [1], 'decision'),
    });
    expect(response.citations).toEqual([]);
  });
  it('preserves an explicit decision and reports an unavailable recap honestly', async () => {
    const confirmed = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'd',
          speaker: 'Me',
          timestampMs: 1,
          confirmed: true,
          text: 'We agreed to keep release approval pending until testing finishes.',
        },
      ],
    });
    const response = await completeLiveMeetingChatAnswer({
      raw: composed(
        'Release approval remains pending until testing finishes.',
        [1],
        'decision',
      ),
      query: 'What is the release decision?',
      context: confirmed,
      route: { mode: 'recall', recallKind: 'decision' },
      generate: async () =>
        composed(
          'Release approval remains pending until testing finishes.',
          [1],
          'decision',
        ),
    });
    expect(response.status).toBe('answered');
    const unavailable = await completeLiveMeetingChatAnswer({
      raw: JSON.stringify({ points: [] }),
      query: 'What did I miss?',
      context: confirmed,
      route: { mode: 'recall', recallKind: 'catch_up' },
      generate: async () => JSON.stringify({ points: [] }),
    });
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.answer).toContain("couldn't produce a reliable recap");
  });
  it('uses the reviewed correction instead of displaying the draft approval', async () => {
    const response = await completeLiveMeetingChatAnswer({
      raw: composed('The release is approved.'),
      query: 'Is the release approved?',
      context,
      route: { mode: 'recall', recallKind: 'decision' },
      generate: async () =>
        composed('The release is not approved. Testing must finish first.'),
    });
    expect(response.answer).toContain('not approved');
    expect(response.answer).not.toContain('The release is approved.');
    expect(response.citations[0].evidence_span).toContain(
      'Testing must finish first.',
    );
  });
  it('rejects invented people, dates, numbers and approval even when passage IDs exist', async () => {
    for (const text of [
      'Jordan will prepare the checklist.',
      'Morgan will prepare the checklist Friday.',
      'Morgan will prepare 9 checklists.',
      'The release is approved.',
    ]) {
      const response = await completeLiveMeetingChatAnswer({
        raw: composed(text),
        query: 'List agreed actions',
        context,
        route: { mode: 'recall', recallKind: 'action' },
        generate: async () => composed(text),
      });
      expect(response.citations).toEqual([]);
      expect(response.answer).not.toContain(text);
    }
  });
  it('keeps canonical fragments as source spans for a composed exchange', async () => {
    const response = await completeLiveMeetingChatAnswer({
      raw: composed(
        'Morgan will prepare the checklist. We have not set a deadline.',
      ),
      query: 'List agreed actions',
      context,
      route: { mode: 'recall', recallKind: 'action' },
      generate: async () =>
        composed(
          'Morgan will prepare the checklist. We have not set a deadline.',
        ),
    });
    expect(response.claims[0].text).toContain('Morgan will prepare');
    expect(response.citations[0].evidence_span.split('\n')).toEqual(
      context.evidenceItems
        .filter((item) => item.kind === 'transcript')
        .map((item) => item.quote),
    );
  });
  it('lets semantic review discard an acknowledged proposal without turning it into an agreement', async () => {
    const response = await completeLiveMeetingChatAnswer({
      raw: composed('We agreed to approve the release.'),
      query: 'What did we agree?',
      context,
      route: { mode: 'recall', recallKind: 'decision' },
      generate: async () => JSON.stringify({ points: [] }),
    });
    expect(response.citations).toEqual([]);
    expect(response.answer).toContain("couldn't verify");
  });
  it('does not classify model suggestions as recalled facts', async () => {
    const response = await completeLiveMeetingChatAnswer({
      raw: composed(
        'You should ask Morgan to prepare the checklist.',
        [1],
        'suggestion',
      ),
      query: 'What did we agree?',
      context,
      route: { mode: 'recall', recallKind: 'decision' },
      generate: async () =>
        composed(
          'You should ask Morgan to prepare the checklist.',
          [1],
          'suggestion',
        ),
    });
    expect(response.citations).toEqual([]);
  });
  it('rejects unknown passage IDs and propagates review cancellation', async () => {
    const response = await completeLiveMeetingChatAnswer({
      raw: composed('Morgan will prepare the checklist.', [99]),
      query: 'What did we agree?',
      context,
      route: { mode: 'recall', recallKind: 'decision' },
      generate: async () =>
        composed('Morgan will prepare the checklist.', [99]),
    });
    expect(response.citations).toEqual([]);
    const cancelled = new DOMException('Cancelled', 'AbortError');
    await expect(
      completeLiveMeetingChatAnswer({
        raw: composed('Morgan will prepare the checklist.'),
        query: 'What did we agree?',
        context,
        route: { mode: 'recall', recallKind: 'decision' },
        generate: async () => {
          throw cancelled;
        },
      }),
    ).rejects.toBe(cancelled);
  });
});

describe('general live evidence boundaries', () => {
  it('does not let an unrelated negative clause hide an unsupported approval', () => {
    expect(
      liveClaimSupportIssue(
        'The report is approved, but the date is not confirmed.',
        'The report is not approved. The date is not confirmed.',
      ),
    ).toBe('polarity_changed');
    expect(
      liveClaimSupportIssue(
        'The report is not approved, but the date is confirmed.',
        'The report is not approved. The date is confirmed.',
      ),
    ).toBeNull();
  });
  it('accepts the generic participant label without treating it as an invented identity', () => {
    expect(
      liveClaimSupportIssue(
        'A participant will share the schedule.',
        'I will share the schedule.',
      ),
    ).toBeNull();
    expect(
      liveClaimSupportIssue(
        'Participant will share the schedule.',
        'I will share the schedule.',
      ),
    ).toBeNull();
    expect(
      liveClaimSupportIssue(
        'Jordan will share the schedule.',
        'I will share the schedule.',
      ),
    ).toBe('invented_name');
  });
  it.each([
    [
      'The review will finish in thirty minutes.',
      "I'll complete the review.",
      'invented_number',
    ],
    ['The appointment is at 1 pm.', 'The appointment is at one pm.', null],
    [
      'The survey has 24 responses.',
      'The survey has twenty-four responses.',
      null,
    ],
    [
      'Atlas’s rollout remains tentative.',
      'Atlas rollout could happen next week.',
      null,
    ],
    [
      'The rollout will happen next week.',
      'The rollout might happen next week.',
      'certainty_changed',
    ],
  ])('checks quantities and uncertainty: %s', (claim, evidence, expected) => {
    expect(liveClaimSupportIssue(claim, evidence)).toBe(expected);
  });
  it.each([
    ['Share the lab report.', 'We’ll share the lab report.', true],
    [
      'Prepare the school checklist.',
      'I’ll\nprepare the school checklist.',
      true,
    ],
    [
      'There will be several booking options.',
      'We’ll likely have several booking options.',
      false,
    ],
    ['An invitation has been sent.', 'I just sent an invitation.', true],
    [
      'A participant will send an invitation.',
      'I just sent an invitation.',
      false,
    ],
    [
      'Flight details have been shared.',
      'Let me share my flight details.',
      false,
    ],
    [
      'Complete the review in thirty minutes.',
      "I'll complete the review.",
      false,
    ],
    ['Prepare the lab report.', 'Maybe I will prepare the lab report.', false],
  ])(
    'requires the undertaking and its state: %s',
    (claim, evidence, expected) => {
      expect(liveActionHasCommitment(claim, evidence)).toBe(expected);
    },
  );
});

describe('bounded recap polish', () => {
  it('rejects advice in a short recent recap as well as a long recap', async () => {
    const source = buildLiveMeetingAskPlutoContext({
      meetingId: 'recent-recap',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'samples',
          timestampMs: 0,
          speaker: 'Me',
          confirmed: true,
          text: 'We discussed collecting samples from several locations before choosing a laboratory.',
        },
      ],
    });
    const onDiagnostic = vi.fn();
    const result = await completeLiveMeetingChatAnswer({
      raw: JSON.stringify({
        points: [
          {
            text: 'Consider collecting samples from several locations before choosing a laboratory.',
            support: 'collecting samples from several locations',
          },
        ],
      }),
      query: '/catch-me-up',
      context: source,
      route: { mode: 'recall', recallKind: 'catch_up' },
      generate: async () => JSON.stringify({ points: [] }),
      onDiagnostic,
    });
    expect(result.status).toBe('unavailable');
    expect(result.answer).not.toContain('Consider');
    expect(onDiagnostic.mock.calls.map(([d]) => d.reason)).toContain(
      'wrong_mode',
    );
  });
  it('does not display transcript copies or instructions from recaps', async () => {
    const text =
      'The research group discussed collecting samples from several locations before deciding which laboratory would process them.';
    const context = buildLiveMeetingAskPlutoContext({
      meetingId: 'neutral-recap',
      notes: '',
      participants: [],
      transcript: Array.from({ length: 24 }, (_, i) => ({
        id: String(i),
        speaker: 'Call audio',
        timestampMs: i * 60000,
        confirmed: true,
        text,
      })),
    });
    const raw = JSON.stringify({
      points: [
        {
          text,
          support: 'The research group discussed collecting samples',
          passages: [24],
          kind: 'discussion',
        },
      ],
    });
    const onDiagnostic = vi.fn();
    const response = await completeLiveMeetingChatAnswer({
      raw,
      context,
      query: 'What did I miss?',
      route: { mode: 'recall', recallKind: 'catch_up' },
      onDiagnostic,
      generate: async () =>
        JSON.stringify({
          points: [
            {
              text: 'Consider collecting samples from several locations before deciding which laboratory to use.',
              support: 'The research group discussed collecting samples',
              passages: [1],
              kind: 'discussion',
            },
          ],
        }),
    });
    expect(response.status).toBe('unavailable');
    expect(response.answer).not.toContain(text);
    expect(response.answer).not.toContain('Consider');
    expect(onDiagnostic.mock.calls.map(([d]) => d.reason)).toContain(
      'copied_sentence',
    );
    expect(onDiagnostic.mock.calls.map(([d]) => d.reason)).toContain(
      'wrong_mode',
    );
  });
});

it('does not turn a participant undertaking into a promise from Pluto', async () => {
  const response = await completeLiveMeetingChatAnswer({
    raw: JSON.stringify({
      points: [
        {
          text: 'I will prepare the checklist.',
          support: 'Morgan will prepare the checklist.',
          passages: [1],
          kind: 'action',
        },
      ],
    }),
    query: 'What work was agreed?',
    context,
    route: { mode: 'recall', recallKind: 'action' },
    generate: async () =>
      JSON.stringify({
        points: [
          {
            text: 'I will prepare the checklist.',
            support: 'Morgan will prepare the checklist.',
            passages: [1],
            kind: 'action',
          },
        ],
      }),
  });
  expect(response.status).toBe('unavailable');
  expect(response.answer).not.toContain('I will');
});

it('retains a valid short source anchor that includes an article', async () => {
  const context = buildLiveMeetingAskPlutoContext({
    meetingId: 'neutral-upload',
    notes: '',
    participants: [],
    transcript: [
      {
        id: 'source',
        text: 'You can upload a booking confirmation or type the details into the form.',
        speaker: 'Call audio',
        timestampMs: 1,
        confirmed: true,
      },
    ],
  });
  const response = await completeLiveMeetingChatAnswer({
    raw: JSON.stringify({
      points: [
        {
          text: 'The booking confirmation can be uploaded.',
          support: 'upload a booking confirmation',
          passages: [1],
          kind: 'discussion',
        },
      ],
    }),
    query: 'How can I provide the booking confirmation?',
    context,
    route: { mode: 'recall', recallKind: 'fact' },
    generate: async () =>
      JSON.stringify({
        points: [
          {
            text: 'The booking confirmation can be uploaded.',
            support: 'upload a booking confirmation',
            passages: [1],
          },
        ],
      }),
  });
  expect(response.status).toBe('answered');
  expect(response.answer).toContain('uploaded');
});

describe('independent evidence reconstruction', () => {
  it('retains a passage containing completed and future work', () => {
    const mixed = buildLiveMeetingAskPlutoContext({
      meetingId: 'mixed',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'mixed',
          text: 'I will share the report tomorrow. I already sent the invite.',
          speaker: 'Me',
          timestampMs: 1,
          confirmed: true,
        },
        {
          id: 'other',
          text: 'I will prepare the checklist.',
          speaker: 'Call audio',
          timestampMs: 90000,
          confirmed: true,
        },
      ],
    });
    const prompt = buildLiveMeetingChatPrompt({
      query: 'What actions were agreed?',
      context: mixed,
      assistanceRoute: { mode: 'recall', recallKind: 'action' },
    });
    expect(prompt).toContain(
      'Undertaking candidate: (Me) I will share the report tomorrow.',
    );
    expect(prompt).toContain('I already sent the invite.');
    expect(prompt).toContain('I will prepare the checklist.');
  });
  it('reconstructs from sources without anchoring on the rejected draft', async () => {
    const generate = vi.fn(async (prompt: string) => {
      expect(prompt).not.toContain(
        'The release is approved and ready for everyone.',
      );
      expect(prompt).toContain('The release is not approved.');
      return JSON.stringify({ points: [] });
    });
    await completeLiveMeetingChatAnswer({
      raw: JSON.stringify({
        points: [
          {
            text: 'The release is approved and ready for everyone.',
            passages: [1],
            kind: 'decision',
          },
        ],
      }),
      query: 'What was agreed?',
      context,
      route: { mode: 'recall', recallKind: 'decision' },
      generate,
    });
    expect(generate).toHaveBeenCalledOnce();
  });
  it('allows a reconstructed synonym-based paraphrase with a verified source', async () => {
    const source = buildLiveMeetingAskPlutoContext({
      meetingId: 'paraphrase',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'a',
          text: 'We might schedule the visit.',
          speaker: 'Me',
          timestampMs: 1,
          confirmed: true,
        },
      ],
    });
    const raw = JSON.stringify({
      points: [
        {
          text: 'The appointment remains tentative.',
          support: 'We might schedule the visit.',
          passages: [1],
          kind: 'discussion',
        },
      ],
    });
    const generate = vi.fn(async () => raw);
    const answer = await completeLiveMeetingChatAnswer({
      raw,
      query: 'What is the visit status?',
      context: source,
      route: { mode: 'recall', recallKind: 'fact' },
      generate,
    });
    expect(answer.answer).toBe('The appointment remains tentative.');
    expect(answer.citations[0].evidence_span).toBe(
      'We might schedule the visit.',
    );
    expect(generate).toHaveBeenCalledOnce();
  });
  it('still rejects a changed condition when the vocabulary overlap is low', () => {
    expect(
      liveClaimSupportIssue(
        'The appointment will proceed.',
        'We might schedule the visit.',
      ),
    ).toBe('certainty_changed');
  });
});

it('does not treat a model classification tag as evidence of a decision', async () => {
  const answer = await completeLiveMeetingChatAnswer({
    raw: JSON.stringify({
      points: [
        {
          text: 'Morgan will prepare the checklist.',
          support: 'Morgan will prepare the checklist.',
          passages: [1],
          kind: 'decision',
        },
      ],
    }),
    query: 'Who will prepare the checklist?',
    context,
    route: { mode: 'recall', recallKind: 'fact' },
    generate: async () =>
      JSON.stringify({
        points: [
          {
            text: 'Morgan will prepare the checklist.',
            support: 'Morgan will prepare the checklist.',
            passages: [1],
            kind: 'decision',
          },
        ],
      }),
  });
  expect(answer.answer).toBe('Morgan will prepare the checklist.');
});

it('reconstructs a factual answer once when its draft source excerpt is invalid', async () => {
  const generate = vi.fn(async () =>
    JSON.stringify({
      points: [
        {
          text: 'Morgan will prepare the checklist.',
          support: 'Morgan will prepare the checklist.',
          passages: [1],
        },
      ],
    }),
  );
  const answer = await completeLiveMeetingChatAnswer({
    raw: JSON.stringify({
      points: [
        {
          text: 'Jordan will prepare the checklist.',
          support: 'Jordan offered to help.',
          passages: [1],
        },
      ],
    }),
    query: 'Who will prepare the checklist?',
    context,
    route: { mode: 'recall', recallKind: 'fact' },
    generate,
  });
  expect(answer.answer).toBe('Morgan will prepare the checklist.');
  expect(generate).toHaveBeenCalledOnce();
});

it('does not retry an intentional factual abstention', async () => {
  const generate = vi.fn();
  const answer = await completeLiveMeetingChatAnswer({
    raw: JSON.stringify({ points: [] }),
    query: 'What is the budget?',
    context,
    route: { mode: 'recall', recallKind: 'fact' },
    generate,
  });
  expect(answer.status).toBe('unavailable');
  expect(generate).not.toHaveBeenCalled();
});

it.each([true, false])(
  'reports only a directly supported group decision in third person (%s)',
  async (confirmed) => {
    const source = confirmed
      ? 'We agreed to keep the workshop online.'
      : 'We could keep the workshop online.';
    const context = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'a',
          timestampMs: 1,
          speaker: 'Me',
          confirmed: true,
          text: source,
        },
      ],
    });
    const raw = JSON.stringify({
      points: [
        {
          text: 'We agreed to keep the workshop online.',
          support: source,
          passages: [1],
        },
      ],
    });
    const answer = await completeLiveMeetingChatAnswer({
      raw,
      context,
      query: 'What was agreed?',
      route: { mode: 'recall', recallKind: 'decision' },
      generate: async () => raw,
    });
    expect(answer.status).toBe(confirmed ? 'answered' : 'unavailable');
    if (confirmed)
      expect(answer.answer).toBe(
        'Participants agreed to keep the workshop online.',
      );
  },
);

it.each([false, true])(
  'preserves a grounded action after invalid or empty reconstruction (%s)',
  async (abstain) => {
    const answer = await completeLiveMeetingChatAnswer({
      raw: JSON.stringify({
        points: [
          {
            text: 'Jordan will prepare nine checklists.',
            support: 'Morgan will prepare the checklist.',
            passages: [1],
          },
          {
            text: 'Morgan will prepare the checklist.',
            support: 'Morgan will prepare the checklist.',
            passages: [1],
          },
        ],
      }),
      query: 'What are the action items?',
      context,
      route: { mode: 'recall', recallKind: 'action' },
      generate: async () =>
        JSON.stringify({
          points: abstain
            ? []
            : [
                {
                  text: 'Jordan will prepare nine checklists on Friday.',
                  support: 'Morgan will prepare the checklist.',
                  passages: [1],
                },
              ],
        }),
    });
    expect(answer.status).toBe('answered');
    expect(answer.answer).not.toContain('Jordan');
    expect(answer.answer).toBe('Morgan will prepare the checklist.');
  },
);

it('answers a decision question with a clearly tentative proposal when that is all the source establishes', async () => {
  const context = buildLiveMeetingAskPlutoContext({
    meetingId: 'fictional',
    notes: '',
    participants: [],
    transcript: [
      {
        id: 'proposal',
        timestampMs: 1,
        speaker: 'Me',
        confirmed: true,
        text: 'We could move the workshop to Friday. The room is not confirmed.',
      },
    ],
  });
  const raw = JSON.stringify({
    points: [
      {
        support: 'We could move the workshop to Friday.',
        passages: [1],
        text: 'Moving the workshop to Friday is tentative; the room is not confirmed.',
      },
    ],
  });
  const answer = await completeLiveMeetingChatAnswer({
    raw,
    context,
    query: 'What was decided about the workshop?',
    route: { mode: 'recall', recallKind: 'decision' },
    generate: async () => raw,
  });
  expect(answer.answer).toContain('tentative');
  expect(answer.status).toBe('answered');
});

it.each([
  [
    'The library extension is unlikely this year.',
    'The library extension will not happen this year.',
    'unavailable',
  ],
  [
    'We will not renew the catering contract.',
    'Participants will not renew the catering contract.',
    'answered',
  ],
] as const)(
  'requires confirmation for negative decisions: %s',
  async (source, claim, status) => {
    const context = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'decision',
          timestampMs: 1,
          speaker: 'Me',
          confirmed: true,
          text: source,
        },
      ],
    });
    const raw = JSON.stringify({
      points: [{ text: claim, support: source, passages: [1] }],
    });
    const diagnostics: string[] = [];
    const answer = await completeLiveMeetingChatAnswer({
      raw,
      context,
      query: '/decisions',
      route: { mode: 'recall', recallKind: 'decision' },
      generate: async () => raw,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.reason),
    });
    expect(answer.status).toBe(status);
    if (status === 'unavailable')
      expect(diagnostics).toContain('unconfirmed_decision');
    else expect(answer.answer).toContain('will not renew');
  },
);

it.each(['I will', 'I’ll', 'We will'])(
  'keeps a directly stated first-person undertaking as a neutral action (%s)',
  async (voice) => {
    const source = `${voice} send the orientation guide tomorrow.`;
    const context = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'promise',
          timestampMs: 1,
          speaker: 'Me',
          confirmed: true,
          text: source,
        },
      ],
    });
    const raw = JSON.stringify({
      points: [
        { text: source, support: source, passages: [1], timing: 'tomorrow' },
      ],
    });
    const response = await completeLiveMeetingChatAnswer({
      raw,
      context,
      query: '/actions',
      route: { mode: 'recall', recallKind: 'action' },
      generate: async () => raw,
    });
    expect(response.answer).toBe('Send the orientation guide tomorrow.');
    expect(response.status).toBe('answered');
  },
);

it('keeps commitment-specific review instructions out of decision questions', async () => {
  const generate = vi.fn(async (prompt: string) => {
    expect(prompt).not.toContain('Include every relevant explicit undertaking');
    expect(prompt).toContain('do not substitute commitments for decisions');
    return JSON.stringify({ points: [] });
  });
  const response = await completeLiveMeetingChatAnswer({
    raw: JSON.stringify({ points: [] }),
    context,
    query: '/decisions',
    route: { mode: 'recall', recallKind: 'decision' },
    generate,
  });
  expect(generate).toHaveBeenCalledOnce();
  expect(response.status).toBe('unavailable');
});

it.each(['catch_up', 'decision', 'action', 'fact'] as const)(
  'omits transcript clock labels from %s prompts while preserving actual scheduling facts',
  (recallKind) => {
    const source = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'time',
          timestampMs: 9 * 60_000,
          speaker: 'Me',
          confirmed: true,
          text: 'I will send the report at 1 pm tomorrow.',
        },
      ],
    });
    const prompt = buildLiveMeetingChatPrompt({
      query: 'What have we discussed?',
      context: source,
      assistanceRoute: { mode: 'recall', recallKind },
    });
    expect(prompt).not.toMatch(/\[\d+\]\s+\d+(?:\.\d+)? min/);
    expect(prompt).toContain('I will send the report at 1 pm tomorrow.');
    expect(prompt).toContain(
      'Do not mention transcript positions or timestamps',
    );
  },
);

it.each([true, false])(
  'maps an exact supporting excerpt without model-selected source numbers (%s)',
  async (valid) => {
    const source = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'work',
          timestampMs: 1,
          speaker: 'Me',
          confirmed: true,
          text: 'I will send the orientation guide tomorrow.',
        },
      ],
    });
    const raw = JSON.stringify({
      points: [
        {
          text: 'Send the orientation guide tomorrow.',
          support: valid
            ? 'I will send the orientation guide tomorrow.'
            : 'I will send a completely different invented guide.',
          timing: 'tomorrow',
        },
      ],
    });
    const answer = await completeLiveMeetingChatAnswer({
      raw,
      context: source,
      query: '/actions',
      route: { mode: 'recall', recallKind: 'action' },
      generate: async () => raw,
    });
    expect(answer.status).toBe(valid ? 'answered' : 'unavailable');
    if (valid) {
      expect(answer.answer).toBe('Send the orientation guide tomorrow.');
      expect(answer.citations).toHaveLength(1);
    } else expect(answer.citations).toHaveLength(0);
  },
);

it('repairs raw capture labels inside a recap sentence', async () => {
  const source = buildLiveMeetingAskPlutoContext({
    meetingId: 'fictional',
    notes: '',
    participants: [],
    transcript: [
      {
        id: 'invite',
        timestampMs: 1,
        speaker: 'Me',
        confirmed: true,
        text: 'I sent the invitation for 1 pm tomorrow.',
      },
    ],
  });
  const packet = (text: string) =>
    JSON.stringify({
      points: [{ text, support: 'I sent the invitation for 1 pm tomorrow.' }],
    });
  const generate = vi.fn(async (prompt: string) => {
    expect(prompt).toContain(
      'never Unknown, Me, Speaker numbers or Call audio as people',
    );
    return packet('The invitation was sent for 1 pm tomorrow.');
  });
  const answer = await completeLiveMeetingChatAnswer({
    raw: packet(
      'The latest discussion covered invitations, with Me confirming the invitation for 1 pm tomorrow.',
    ),
    context: source,
    query: '/catch-me-up',
    route: { mode: 'recall', recallKind: 'catch_up' },
    generate,
  });
  expect(answer.answer).toBe('The invitation was sent for 1 pm tomorrow.');
  expect(generate).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'preserves verified commitments omitted by an %s review',
  async (partial) => {
    const source = buildLiveMeetingAskPlutoContext({
      meetingId: 'fictional',
      notes: '',
      participants: [],
      transcript: [
        {
          id: 'guide',
          timestampMs: 1,
          speaker: 'Me',
          confirmed: true,
          text: 'Morgan will send the orientation guide tomorrow.',
        },
        {
          id: 'room',
          timestampMs: 300_000,
          speaker: 'Call audio',
          confirmed: true,
          text: 'Avery will check room availability on Thursday.',
        },
      ],
    });
    const point = (text: string, support: string, timing: string) => ({
      text,
      support,
      timing,
    });
    const initial = [
      point(
        'Send the orientation guide tomorrow.',
        'Morgan will send the orientation guide tomorrow.',
        'tomorrow',
      ),
      point(
        'Check room availability on Thursday.',
        'Avery will check room availability on Thursday.',
        'Thursday',
      ),
    ];
    const generate = vi.fn(async () =>
      JSON.stringify({ points: partial ? [initial[1]] : [] }),
    );
    const response = await completeLiveMeetingChatAnswer({
      raw: JSON.stringify({ points: initial }),
      context: source,
      query: '/actions',
      route: { mode: 'recall', recallKind: 'action' },
      generate,
    });
    expect(response.answer).toContain('Send the orientation guide tomorrow.');
    expect(response.answer).toContain('Check room availability on Thursday.');
    expect(response.claims).toHaveLength(2);
    expect(generate).toHaveBeenCalledOnce();
  },
);

it('still respects explicit retraction during a factual review', async () => {
  const answer = await completeLiveMeetingChatAnswer({
    raw: JSON.stringify({
      points: [
        {
          text: 'Jordan will prepare nine checklists.',
          support: 'Morgan will prepare the checklist.',
          passages: [1],
        },
        {
          text: 'Morgan will prepare the checklist.',
          support: 'Morgan will prepare the checklist.',
          passages: [1],
        },
      ],
    }),
    context,
    query: 'What work was mentioned?',
    route: { mode: 'recall', recallKind: 'fact' },
    generate: async () => JSON.stringify({ points: [] }),
  });
  expect(answer.status).toBe('unavailable');
  expect(answer.answer).not.toContain('Jordan');
});

it('maps a complete short status excerpt without supplied source numbers', async () => {
  const source = buildLiveMeetingAskPlutoContext({
    meetingId: 'fictional',
    notes: '',
    participants: [],
    transcript: [
      {
        id: 'status',
        timestampMs: 1,
        speaker: 'Me',
        confirmed: true,
        text: 'No decision yet.',
      },
    ],
  });
  const raw = JSON.stringify({
    points: [
      { text: 'No decision has been made yet.', support: 'No decision yet.' },
    ],
  });
  const answer = await completeLiveMeetingChatAnswer({
    raw,
    context: source,
    query: 'Have we decided?',
    route: { mode: 'recall', recallKind: 'decision' },
    generate: async () => raw,
  });
  expect(answer.status).toBe('answered');
  expect(answer.citations).toHaveLength(1);
});

it('does not publish an unsupported deadline already present in the answer', async () => {
  const source = buildLiveMeetingAskPlutoContext({
    meetingId: 'fictional',
    notes: '',
    participants: [],
    transcript: [
      {
        id: 'time',
        timestampMs: 1,
        speaker: 'Me',
        confirmed: true,
        text: 'I am free for twenty minutes. I will share the report later.',
      },
    ],
  });
  const raw = JSON.stringify({
    points: [
      {
        text: 'Share the report twenty minutes from now.',
        support: 'I will share the report later.',
        timing: 'twenty minutes from now',
      },
    ],
  });
  const answer = await completeLiveMeetingChatAnswer({
    raw,
    context: source,
    query: '/actions',
    route: { mode: 'recall', recallKind: 'action' },
    generate: async () => raw,
  });
  expect(answer.status).toBe('unavailable');
  expect(answer.answer).not.toContain('twenty minutes from now');
});

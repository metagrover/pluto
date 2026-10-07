import { describe, expect, it } from 'vitest';

import { routeMeetingAskPlutoAssistance } from '../../electron/intelligence/meetingAskPlutoAssistance';
import { resolveMeetingAskPlutoConversation } from '../../electron/intelligence/meetingAskPlutoConversation';

import type { PersistedMeeting } from '../../electron/db';
import {
  buildAmbiguousMeetingAskPlutoResponse,
  buildLiveMeetingAskPlutoContext,
  buildLiveMeetingFallbackResponse,
  buildMeetingAskPlutoContext,
  buildMeetingAskPlutoPrompt,
  buildMeetingAskPlutoProviderUnavailableResponse,
  buildMeetingAskPlutoResponseFromAnswer,
  buildPreparedMeetingAskPlutoResponse,
  buildUnavailableMeetingAskPlutoResponse,
  normalizeMeetingAskPlutoTurns,
} from '../../electron/intelligence/meetingAskPluto';

const makeMeeting = (
  overrides: Partial<PersistedMeeting> = {},
): PersistedMeeting => ({
  id: 'meeting-1',
  title: 'Architecture Review',
  started_at: '2026-08-18T10:00:00.000Z',
  ended_at: null,
  duration_seconds: 1800,
  audio_path: null,
  transcript_json: JSON.stringify({
    segments: [
      {
        speaker: 'Avery',
        start: 12,
        end: 16,
        text: 'We decided to use GraphQL for the new API layer.',
      },
      {
        speaker: 'Sam',
        start: 30,
        end: 36,
        text: 'Riley will follow up with the migration checklist tomorrow.',
      },
    ],
  }),
  enhanced_notes: 'Decision: use GraphQL for the new API layer.',
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview: 'The team chose GraphQL and assigned migration follow-up.',
    topics: [
      {
        title: 'API migration',
        summary: 'GraphQL was selected for the new API layer.',
        key_points: [{ text: 'GraphQL is the preferred API direction.' }],
        decisions: [{ text: 'Use GraphQL for the new API layer.' }],
        action_items: [
          {
            text: 'Riley will follow up with the migration checklist.',
            assignee: 'Riley',
          },
        ],
        open_questions: [],
      },
    ],
    all_action_items: [
      {
        text: 'Riley will follow up with the migration checklist.',
        assignee: 'Riley',
      },
    ],
    all_decisions: [{ text: 'Use GraphQL for the new API layer.' }],
    meeting_type: 'team_sync',
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
  }),
  mid_json: JSON.stringify({
    mid_version: 1,
    meeting_id: 'meeting-1',
    title: 'Architecture Review',
    occurred_at: '2026-08-18T10:00:00.000Z',
    duration_seconds: 1800,
    participants: [{ entity_id: 'person-avery', name: 'Avery' }],
    projects: [{ entity_id: 'project-api', name: 'API migration' }],
    topics: [
      { entity_id: 'topic-api', name: 'API migration', importance: 'high' },
    ],
    action_items: [
      {
        entity_id: 'action-riley',
        description: 'Riley will follow up with the migration checklist.',
        assignee: 'Riley',
        status: 'active',
      },
    ],
    decisions: [
      {
        entity_id: 'decision-graphql',
        description: 'Use GraphQL for the new API layer.',
      },
    ],
    signals: {
      continuity: [],
      accountability_risks: [],
      decision_impacts: [],
    },
    evidence_spans: [
      {
        span_id: 'span-graphql',
        claim_type: 'decision',
        transcript_range: [0, 0],
        quote: 'We decided to use GraphQL for the new API layer.',
      },
    ],
  }),
  transcript_status: 'validated',
  transcript_integrity_json: null,
  system_audio_path: null,
  mixed_audio_path: null,
  transcript_validated_at: '2026-08-18T10:31:00.000Z',
  finalization_status: 'finalized',
  ...overrides,
});

describe('meeting-scoped Ask Pluto context', () => {
  it('builds a completed meeting context packet from only the selected meeting', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What did we decide about the API?',
      entities: [
        {
          id: 'project-api',
          type: 'project',
          name: 'API migration',
          mention_count: 3,
          context: 'Discussed as the main migration stream.',
        },
      ],
      attentionItems: [
        {
          id: 'attention-1',
          kind: 'follow_up',
          status: 'active',
          reason: 'Riley owns the migration checklist follow-up.',
        },
      ],
    });

    expect(context.status).toBe('ready');
    expect(context.scope).toEqual({
      type: 'meeting',
      meetingId: 'meeting-1',
      title: 'Architecture Review',
    });
    expect(context.trustStatus).toBe('grounded');
    expect(context.boundary).toContain('Only use evidence from this meeting');
    expect(context.evidenceItems.map((item) => item.meetingId)).toEqual(
      expect.arrayContaining(['meeting-1']),
    );
    expect(context.evidenceItems.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['decision', 'action_item', 'entity']),
    );
    expect(
      context.evidenceItems.some((item) => item.kind === 'transcript'),
    ).toBe(false);
  });

  it('supports active meetings with partial-evidence trust instead of pretending they are complete', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting({
        transcript_status: 'provisional',
        transcript_validated_at: null,
        enhanced_notes: null,
        analysis_json: null,
        mid_json: null,
      }),
      query: 'What happened?',
      entities: [],
      attentionItems: [],
    });

    expect(context.status).toBe('ready');
    expect(context.trustStatus).toBe('weak_evidence');
    expect(context.statusNote).toContain('notes are unavailable');
    expect(context.evidenceItems[0]).toMatchObject({
      kind: 'transcript',
      meetingId: 'meeting-1',
    });
  });

  it('keeps derived decisions, actions, and notes without saved transcript context', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting({
        transcript_json: JSON.stringify({
          segments: Array.from({ length: 30 }, (_, index) => ({
            speaker: 'Avery',
            start: index,
            end: index + 1,
            text: `Transcript segment ${index + 1}`,
          })),
        }),
      }),
      query: 'What were the next steps?',
      entities: [],
      attentionItems: [],
    });

    expect(context.evidenceItems.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['decision', 'action_item', 'note']),
    );
    expect(
      context.evidenceItems.some((item) => item.kind === 'transcript'),
    ).toBe(false);
  });

  it('adds only bounded recent transcript evidence for explicit quotation', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting({
        transcript_json: JSON.stringify({
          segments: Array.from({ length: 30 }, (_, index) => ({
            speaker: 'Avery',
            start: index,
            end: index + 1,
            text: `Transcript segment ${index + 1}`,
          })),
        }),
      }),
      query: 'Quote exactly what Avery said at the end.',
      entities: [],
      attentionItems: [],
    });

    const transcriptItems = context.evidenceItems.filter(
      (item) => item.kind === 'transcript',
    );
    expect(transcriptItems).toHaveLength(5);
    expect(transcriptItems.at(-1)?.text).toContain('Transcript segment 30');
    expect(
      transcriptItems.some((item) => item.text.includes('segment 1')),
    ).toBe(false);
    expect(context.statusNote).toContain('exact-wording request');
  });

  it.each([
    'Why did we decide to use GraphQL?',
    'What did we decide about authentication?',
    'Summarize only the migration risks',
    'Which action items are blocked?',
    'Draft a message about our decisions',
  ])('does not replace a specific request with a generic list: %s', (query) => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query,
    });
    expect(buildPreparedMeetingAskPlutoResponse(query, context)).toBeNull();
  });

  it('asks for the focal point when a multi-point answer has an ambiguous follow-up', () => {
    const conversation = resolveMeetingAskPlutoConversation({
      query: 'Explain that',
      turns: [
        { role: 'user', content: 'What are the risks?' },
        {
          role: 'assistant',
          content: '- Migration timing\n- Authentication gaps',
        },
      ],
    });
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'Explain that',
    });
    expect(
      buildAmbiguousMeetingAskPlutoResponse(conversation, context),
    ).toMatchObject({
      answer: 'Which point would you like me to focus on?',
      claims: [],
      citations: [],
    });
    expect(
      buildAmbiguousMeetingAskPlutoResponse(
        { ...conversation, relation: 'follow_up' },
        context,
      ),
    ).toBeNull();
  });

  it.each([
    'Why did we decide that?',
    'What should we do next?',
    'Draft a follow-up about that',
  ])('does not constrain %s to a factual one-liner', (query) => {
    const context = buildLiveMeetingAskPlutoContext({
      meetingId: 'meeting-1',
      title: 'Review',
      participants: [],
      notes: '',
      transcript: [
        {
          id: 'reason',
          text: 'We delayed because testing is incomplete.',
          speaker: 'Me',
          timestampMs: 0,
          confirmed: true,
        },
      ],
    });
    const prompt = buildMeetingAskPlutoPrompt({
      query,
      context,
      assistanceRoute: routeMeetingAskPlutoAssistance(query),
    });
    expect(prompt).not.toContain('normally one sentence');
    expect(prompt).toContain('We delayed because testing is incomplete.');
    expect(prompt).toContain('Return JSON only');
  });

  it('retains valid grouped citations, ignores out-of-range references, and cleans the prose', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What happened?',
    });
    const response = buildMeetingAskPlutoResponseFromAnswer({
      answerRaw: 'GraphQL was selected [Evidence 1, 2, 999].',
      context,
    });
    expect(response.citations).toHaveLength(2);
    expect(
      response.citations.every((citation) => !citation.evidence_valid),
    ).toBe(true);
    expect(response.answer).toBe('GraphQL was selected.');
  });

  it('returns structured decisions directly with valid evidence', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What did we decide?',
      entities: [],
      attentionItems: [],
    });

    const response = buildPreparedMeetingAskPlutoResponse(
      'What did we decide?',
      context,
    );

    expect(response).toMatchObject({
      status: 'answered',
      answer: 'Use GraphQL for the new API layer.',
      trustStatus: 'grounded',
      citations: [
        expect.objectContaining({
          evidence_valid: true,
          trust_status: 'grounded',
        }),
      ],
    });
  });

  it('returns every bounded structured decision instead of silently taking four', () => {
    const analysis = JSON.parse(makeMeeting().analysis_json || '{}');
    analysis.topics = [];
    analysis.all_decisions = Array.from({ length: 5 }, (_, index) => ({
      text: `Decision ${index + 1}.`,
    }));
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting({ analysis_json: JSON.stringify(analysis) }),
      query: 'What did we decide?',
    });

    const response = buildPreparedMeetingAskPlutoResponse(
      'What did we decide?',
      context,
    );

    expect(response?.answer.split('\n')).toEqual([
      'Decision 1.',
      'Decision 2.',
      'Decision 3.',
      'Decision 4.',
      'Decision 5.',
    ]);
    expect(response?.citations).toHaveLength(5);
  });

  it('does not return an authoritative prepared answer when evidence is bounded', () => {
    const analysis = JSON.parse(makeMeeting().analysis_json || '{}');
    analysis.topics = [];
    analysis.all_decisions = Array.from({ length: 20 }, (_, index) => ({
      text: `Decision ${index + 1}.`,
    }));
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting({ analysis_json: JSON.stringify(analysis) }),
      query: 'What did we decide?',
    });

    expect(context.truncatedEvidenceKinds).toContain('decision');
    expect(
      buildPreparedMeetingAskPlutoResponse('What did we decide?', context),
    ).toBeNull();
  });

  it('returns an honest unavailable packet when the meeting has no usable evidence', () => {
    const response = buildUnavailableMeetingAskPlutoResponse(
      makeMeeting({
        transcript_json: null,
        enhanced_notes: null,
        analysis_json: null,
        mid_json: null,
        transcript_status: 'needs_attention',
      }),
      'What happened?',
    );

    expect(response.status).toBe('unavailable');
    expect(response.trustStatus).toBe('needs_review');
    expect(response.answer).toContain('can’t answer this meeting yet');
    expect(response.citations).toEqual([]);
    expect(response.scope.meetingId).toBe('meeting-1');
  });

  it('returns an honest unavailable packet when the configured answer model is unavailable', () => {
    const response = buildMeetingAskPlutoProviderUnavailableResponse({
      scope: {
        type: 'live_meeting',
        meetingId: 'active-recording',
        title: 'Launch review',
      },
      query: 'What did we decide?',
      error: new Error('Ollama API error: Not Found'),
    });

    expect(response.status).toBe('unavailable');
    expect(response.trustStatus).toBe('needs_review');
    expect(response.answer).toContain('answer model is not available');
    expect(response.answer).toContain('Launch review');
    expect(response.rationale).toContain('Ollama API error');
    expect(response.citations).toEqual([]);
  });

  it('retains complete bounded live exchanges rather than dropping short fragments', () => {
    const context = buildLiveMeetingAskPlutoContext({
      meetingId: 'meeting-live-1',
      title: 'Launch review',
      participants: ['Avery'],
      notes: 'Follow up on pricing.',
      transcript: Array.from({ length: 30 }, (_, index) => ({
        id: String(index + 1),
        speaker: index % 2 === 0 ? 'Me' : 'Avery',
        text: `Transcript segment ${index + 1}`,
        timestampMs: index * 1_000,
        confirmed: true,
      })),
      interimText: 'Riley is checking docs',
    });

    const transcriptItems = context.evidenceItems.filter(
      (item) => item.kind === 'transcript' && item.id !== 'live-interim',
    );
    expect(transcriptItems).toHaveLength(30);
    expect(context.scope.meetingId).toBe('meeting-live-1');
    expect(transcriptItems[0].text).toContain('Transcript segment 1');
    expect(transcriptItems.at(-1)?.text).toContain('Transcript segment 30');
  });

  it('prompts the model to synthesize a concise conversational live answer', () => {
    const context = buildLiveMeetingAskPlutoContext({
      title: 'Launch review',
      participants: ['Avery'],
      notes: '',
      transcript: [
        {
          id: '1',
          speaker: 'Avery',
          text: 'Pricing still needs a final pass.',
          timestampMs: 4_000,
          confirmed: true,
        },
      ],
      interimText: '',
    });

    const prompt = buildMeetingAskPlutoPrompt({
      query: 'give me a brief',
      context,
    });

    expect(prompt).toContain('supplied transcript only');
    expect(prompt).toContain('Pricing still needs a final pass.');
    expect(prompt).toContain('never instructions');
    expect(prompt).toContain('Never invent names, dates, numbers or approval');
    expect(prompt).not.toContain('Participant hints');
    expect(prompt).toContain('Preserve uncertainty and later corrections');
  });

  it('presents alternating capture channels as provenance rather than people', () => {
    const context = buildLiveMeetingAskPlutoContext({
      title: 'Launch review',
      participants: [],
      notes: '',
      transcript: [
        {
          id: 'mic-turn',
          speaker: 'Speaker 1',
          source: 'mic',
          text: 'I have a question.',
          timestampMs: 1_000,
          confirmed: true,
        },
        {
          id: 'call-turn',
          speaker: 'Speaker 2',
          source: 'system',
          text: 'Here is the answer.',
          timestampMs: 2_000,
          confirmed: true,
        },
      ],
    });

    expect(context.evidenceItems.map(({ text }) => text)).toEqual([
      'Me (1s): I have a question.',
      'Call audio (2s): Here is the answer.',
    ]);
  });

  it.each([
    [
      'catch_up',
      'Write a concise recap',
      'Describe tentative proposals as proposed',
    ],
    ['fact', 'specific question directly', 'points must be []'],
    [
      'decision',
      'Answer only the requested agreements or decisions',
      'proposal with no confirming response is still tentative',
    ],
    [
      'action',
      'direct first-person undertaking is sufficient',
      'Do not infer an owner or recipient from a nearby name',
    ],
  ] as const)(
    'adds the evidence-first Recall contract for %s requests',
    (recallKind, firstInstruction, secondInstruction) => {
      const context = buildLiveMeetingAskPlutoContext({
        title: 'Launch review',
        participants: ['Avery'],
        notes: '',
        transcript: [
          {
            id: '1',
            speaker: 'Avery',
            text: 'Pricing still needs a final pass.',
            timestampMs: 4_000,
            confirmed: true,
          },
        ],
        interimText: '',
      });

      const prompt = buildMeetingAskPlutoPrompt({
        query: 'What happened?',
        context,
        assistanceRoute: { mode: 'recall', recallKind },
      });

      expect(prompt).toContain('Return JSON only');
      expect(prompt).toContain(firstInstruction);
      expect(prompt).toContain(secondInstruction);
      expect(prompt).toContain('Preserve uncertainty and later corrections');
    },
  );

  it.each([
    ['coaching', 'Do not infer personality or intentions'],
    ['clarification', 'Do not infer another person’s understanding'],
  ] as const)('adds the evidence boundary for %s', (mode, instruction) => {
    const context = buildLiveMeetingAskPlutoContext({
      title: 'Launch review',
      participants: ['Avery'],
      notes: '',
      transcript: [
        {
          id: '1',
          speaker: 'Avery',
          text: 'Can you explain the pricing assumption again?',
          timestampMs: 4_000,
          confirmed: true,
        },
      ],
    });

    const prompt = buildMeetingAskPlutoPrompt({
      query: 'How did that exchange go?',
      context,
      assistanceRoute: { mode },
    });
    expect(prompt).toContain(instruction);
  });

  it('returns a labeled deduplicated transcript fallback when model-backed answering fails', () => {
    const context = buildLiveMeetingAskPlutoContext({
      title: 'Launch review',
      participants: [],
      notes: '',
      transcript: [
        {
          id: '1',
          speaker: 'Avery',
          text: 'Pricing is still under discussion.',
          timestampMs: 4_000,
          confirmed: true,
        },
        {
          id: '2',
          speaker: 'Avery',
          text: 'Pricing is still under discussion.',
          timestampMs: 5_000,
          confirmed: true,
        },
        {
          id: '3',
          speaker: 'Avery',
          text: 'Pricing is still under discussion. Avery will confirm Friday.',
          timestampMs: 6_000,
          confirmed: true,
        },
      ],
      interimText: '',
    });

    const response = buildLiveMeetingFallbackResponse({ context });

    expect(response?.status).toBe('answered');
    expect(response?.answer).toContain(
      "I couldn't summarize that reliably yet",
    );
    expect(
      response?.answer.match(/Pricing is still under discussion/g),
    ).toHaveLength(1);
    expect(response?.answer).not.toContain('current live snapshot');
    expect(response?.rationale).toContain('fallback');
  });

  it('uses the labeled live fallback when model generation returns no answer', () => {
    const context = buildLiveMeetingAskPlutoContext({
      title: 'Launch review',
      participants: [],
      notes: '',
      transcript: [
        {
          id: '1',
          speaker: 'Avery',
          text: 'Pricing is still under discussion.',
          timestampMs: 4_000,
          confirmed: true,
        },
      ],
      interimText: '',
    });

    const response = buildMeetingAskPlutoResponseFromAnswer({
      answerRaw: '   ',
      context,
    });

    expect(response.answer).toContain("I couldn't summarize that reliably yet");
    expect(response.answer).toContain('Pricing is still under discussion');
  });

  it('does not fabricate a citation when the model omits evidence references', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What did we decide?',
      entities: [],
      attentionItems: [],
    });

    const response = buildMeetingAskPlutoResponseFromAnswer({
      answerRaw: 'The team chose GraphQL.',
      context,
    });

    expect(response.citations).toEqual([]);
    expect(response.trustStatus).toBe('needs_review');
    expect(response.claims).toEqual([
      {
        text: 'The team chose GraphQL.',
        trustStatus: 'needs_review',
        citationIds: [],
      },
    ]);
  });

  it.each([
    'Morgan created the plan.',
    'Morgan created the plan. [Evidence 999]',
  ])('withholds an unsupported factual answer: %s', (answerRaw) => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'Who created this plan?',
    });
    const response = buildMeetingAskPlutoResponseFromAnswer({
      answerRaw,
      context,
      assistanceRoute: { mode: 'recall', recallKind: 'fact' },
    });
    expect(response.answer).toBe(
      "I couldn't verify that from the meeting evidence.",
    );
    expect(response.citations).toEqual([]);
    expect(response.claims).toEqual([]);
  });

  it('keeps a cited factual answer reviewable without claiming semantic validation', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'Who created this plan?',
    });
    const response = buildMeetingAskPlutoResponseFromAnswer({
      answerRaw: 'Morgan created the plan. [Evidence 1]',
      context,
      assistanceRoute: { mode: 'recall', recallKind: 'fact' },
    });
    expect(response.answer).toBe('Morgan created the plan.');
    expect(response.citations).toHaveLength(1);
    expect(response.citations[0].evidence_valid).toBe(false);
  });

  it('uses a compact fact prompt and independently rechecks a disputed attribution', () => {
    const context = buildLiveMeetingAskPlutoContext({
      title: 'Launch review',
      participants: [],
      notes: '',
      transcript: [
        {
          id: 'intro',
          speaker: 'Me',
          text: 'Alex is joining us to discuss the plan.',
          timestampMs: 1_000,
          confirmed: true,
        },
        {
          id: 'author',
          speaker: 'Call audio',
          text: 'Morgan actually built the five phase plan.',
          timestampMs: 2_000,
          confirmed: true,
        },
      ],
    });
    const prompt = buildMeetingAskPlutoPrompt({
      query: "No, that's incorrect.",
      context,
      assistanceRoute: { mode: 'recall', recallKind: 'fact' },
      turns: [
        { role: 'user', content: 'Who created this plan?' },
        { role: 'assistant', content: 'Alex created the plan.' },
      ],
      conversation: {
        relation: 'follow_up',
        turnMode: 'challenge',
        retrievalPolicy: 'fresh',
        retrievalQuery: 'Who created this plan?',
        routingQuery: 'Who created this plan?',
        priorQuestion: 'Who created this plan?',
        priorEvidenceHintCount: 0,
      },
    });
    expect(prompt.length).toBeLessThan(3_500);
    expect(prompt).toContain('Morgan actually built');
    expect(prompt).toContain('Previous answer disputed');
    expect(prompt).toContain('Question: Who created this plan?');
    expect(prompt).not.toContain('Alex created the plan.');
    expect(prompt).toContain('Never invent names, dates, numbers or approval');
  });

  it('removes evidence-policy narration from the completed answer', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What did we decide?',
      entities: [],
      attentionItems: [],
    });

    const response = buildMeetingAskPlutoResponseFromAnswer({
      answerRaw:
        'Based on the meeting evidence provided, the team chose GraphQL. [Evidence 1]',
      context,
    });

    expect(response.answer).toBe('The team chose GraphQL.');
    expect(response.claims[0]?.text).toBe('The team chose GraphQL.');
    expect(response.citations).toHaveLength(1);
  });

  it('rejects out-of-range evidence references instead of citing the first item', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What did we decide?',
      entities: [],
      attentionItems: [],
    });

    const response = buildMeetingAskPlutoResponseFromAnswer({
      answerRaw: 'The team chose GraphQL. [Evidence 999]',
      context,
    });

    expect(response.answer).toBe('The team chose GraphQL.');
    expect(response.citations).toEqual([]);
    expect(response.trustStatus).toBe('needs_review');
    expect(response.claims[0]?.trustStatus).toBe('needs_review');
  });

  it('does not treat a syntactically valid evidence marker as semantic validation', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What did we decide?',
      entities: [],
      attentionItems: [],
    });

    const response = buildMeetingAskPlutoResponseFromAnswer({
      answerRaw: 'The wire transfer was approved. [Evidence 1]',
      context,
    });

    expect(response.citations).toHaveLength(1);
    expect(response.citations[0]).toMatchObject({
      evidence_valid: false,
      trust_status: 'needs_review',
    });
    expect(response.trustStatus).toBe('needs_review');
    expect(response.claims[0]?.trustStatus).toBe('needs_review');
  });

  it('bounds follow-up turns and prompt context to the meeting scope', () => {
    const turns = normalizeMeetingAskPlutoTurns(
      Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `turn-${index} ${'x'.repeat(1500)}`,
      })),
    );

    expect(turns).toHaveLength(6);
    expect(turns[0].content.startsWith('turn-2')).toBe(true);
    expect(turns.every((turn) => turn.content.length <= 1200)).toBe(true);

    const prompt = buildMeetingAskPlutoPrompt({
      query: 'Why did you say that?',
      context: buildMeetingAskPlutoContext({
        meeting: makeMeeting(),
        query: 'Why did you say that?',
        entities: [],
        attentionItems: [],
      }),
      turns,
    });

    expect(prompt).toContain('Meeting scope: Architecture Review');
    expect(prompt).toContain('Do not use any other meeting');
    expect(prompt).toContain('[Evidence 1]');
    expect(prompt).toContain('Recent turns');
  });

  it('marks a resolved follow-up while keeping prior answers non-authoritative', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What should I do about the timeline risk?',
      entities: [],
      attentionItems: [],
    });
    const prompt = buildMeetingAskPlutoPrompt({
      query: 'What should I do about that?',
      context,
      turns: [
        { role: 'user', content: 'What is the main risk?' },
        {
          role: 'assistant',
          content: 'The timeline is not confirmed.',
        },
      ],
      conversation: {
        relation: 'follow_up',
        retrievalQuery: 'What should I do about the timeline risk?',
        routingQuery: 'What is the main risk?\nWhat should I do about that?',
        priorQuestion: 'What is the main risk?',
        priorEvidenceHintCount: 1,
      },
    });

    expect(prompt).toContain('Conversation relationship: Follow-up');
    expect(prompt).toContain(
      'verify every factual claim against Meeting evidence',
    );
    expect(prompt).toContain('Question:\nWhat should I do about that?');
  });

  it('supports startTime and endTime segment properties and includes timestamps in text', () => {
    const meeting = makeMeeting({
      enhanced_notes: null,
      analysis_json: null,
      mid_json: null,
      transcript_json: JSON.stringify({
        segments: [
          {
            speaker: 'Avery',
            startTime: 58.2,
            endTime: 64.5,
            text: 'We discussed client feedback and decided to proceed.',
          },
        ],
      }),
    });

    const context = buildMeetingAskPlutoContext({
      meeting,
      query: 'What was discussed?',
    });

    const transcriptItem = context.evidenceItems.find(
      (item) => item.kind === 'transcript',
    );
    expect(transcriptItem).toBeDefined();
    expect(transcriptItem?.text).toContain('(58s-65s)');
    expect(transcriptItem?.text).toContain(
      'We discussed client feedback and decided to proceed.',
    );
  });

  it('retrieves relevant segments across the entire meeting in transcript fallback mode', () => {
    const meeting = makeMeeting({
      enhanced_notes: null,
      analysis_json: null,
      mid_json: null,
      transcript_json: JSON.stringify({
        segments: [
          {
            speaker: 'Sarah',
            startTime: 10,
            endTime: 20,
            text: 'Opening remarks and welcome.',
          },
          {
            speaker: 'Rachel',
            startTime: 120,
            endTime: 140,
            text: 'Rachel expressed concern about the client data discrepancies.',
          },
          {
            speaker: 'Alex',
            startTime: 500,
            endTime: 520,
            text: 'Midway review of infrastructure.',
          },
          {
            speaker: 'Sam',
            startTime: 900,
            endTime: 910,
            text: 'Closing remarks and meeting wrap up.',
          },
        ],
      }),
    });

    const context = buildMeetingAskPlutoContext({
      meeting,
      query: 'What was Rachel concerned about?',
    });

    const transcriptItems = context.evidenceItems.filter(
      (item) => item.kind === 'transcript',
    );
    expect(transcriptItems.length).toBeGreaterThan(0);
    // Should retrieve Rachel's concern from the middle of the transcript, not just the tail
    expect(
      transcriptItems.some((item) =>
        item.text.includes('Rachel expressed concern'),
      ),
    ).toBe(true);
  });

  it('includes universal coreference, broad intent, and anti-timestamp rules in the prompt', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What is she concerned about?',
    });
    const prompt = buildMeetingAskPlutoPrompt({
      query: 'What is she concerned about?',
      context,
    });

    expect(prompt).toContain('Reference and pronoun resolution:');
    expect(prompt).toContain(
      'Interpreting inquiries (concerns, objections, risks, intent):',
    );
    expect(prompt).toContain('Never narrate timestamps or elapsed seconds:');
    expect(prompt).toContain('do not write "at 110 seconds"');
  });

  it('strips timestamp narration clauses in buildMeetingAskPlutoResponseFromAnswer', () => {
    const context = buildMeetingAskPlutoContext({
      meeting: makeMeeting(),
      query: 'What was discussed?',
    });
    const response = buildMeetingAskPlutoResponseFromAnswer({
      answerRaw:
        'A decision to continue writing despite issues, as mentioned by the speaker at 58 seconds. Also an IPO is planned, asked at 860 seconds.',
      context,
    });

    expect(response.answer).not.toContain('at 58 seconds');
    expect(response.answer).not.toContain('at 860 seconds');
    expect(response.answer).toContain(
      'A decision to continue writing despite issues.',
    );
    expect(response.answer).toContain('Also an IPO is planned.');
  });
});

import { describe, expect, it } from 'vitest';

import type { PersistedMeeting } from '../../electron/db';
import {
  buildLiveMeetingAskPlutoContext,
  buildLiveMeetingFallbackResponse,
  buildMeetingAskPlutoContext,
  buildMeetingAskPlutoPrompt,
  buildMeetingAskPlutoProviderUnavailableResponse,
  buildMeetingAskPlutoResponseFromAnswer,
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
      expect.arrayContaining([
        'transcript',
        'decision',
        'action_item',
        'entity',
      ]),
    );
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
      entities: [],
      attentionItems: [],
    });

    expect(context.status).toBe('ready');
    expect(context.trustStatus).toBe('weak_evidence');
    expect(context.statusNote).toContain('live or provisional');
    expect(context.evidenceItems[0]).toMatchObject({
      kind: 'transcript',
      meetingId: 'meeting-1',
    });
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

  it('retains the latest 24 live transcript segments for model synthesis', () => {
    const context = buildLiveMeetingAskPlutoContext({
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
    expect(transcriptItems).toHaveLength(24);
    expect(transcriptItems[0].text).toContain('Transcript segment 7');
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

    expect(prompt).toContain('Synthesize across the relevant evidence');
    expect(prompt).toContain('Answer conversationally and directly');
    expect(prompt).toContain('Do not merely repeat transcript lines');
    expect(prompt).toContain('give me a brief');
  });

  it.each([
    [
      'catch_up',
      'Prioritize the latest relevant evidence',
      'one to three points',
    ],
    [
      'fact',
      'Answer the requested fact first',
      'Do not present a paraphrase as an exact quote',
    ],
    [
      'decision',
      'Report an explicit agreement as a decision',
      'discussion or proposal',
    ],
    [
      'action',
      'Report an owner or deadline only when the evidence supports it',
      'unassigned or undated',
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

      expect(prompt).toContain('Assistance mode: Recall');
      expect(prompt).toContain(firstInstruction);
      expect(prompt).toContain(secondInstruction);
      expect(prompt).toContain(
        'Say when live evidence is incomplete, provisional, or too noisy',
      );
    },
  );

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
});

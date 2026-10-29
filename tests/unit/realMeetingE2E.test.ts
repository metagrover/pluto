import { describe, expect, it } from 'vitest';
import {
  type Observations,
  parseRealMeetingCase,
  scoreRealMeeting,
} from '../../scripts/lib/realMeetingE2E';

const quote = 'Sam will send the launch report after security approval.';
const candidate = () => ({
  version: 1,
  meeting: {
    title: 'Launch review',
    started_at: '2026-10-01T12:00:00Z',
    duration_seconds: 60,
    transcript_json: JSON.stringify({ segments: [{ text: quote }] }),
    transcript_status: 'validated',
    finalization_status: 'finalized',
  },
  model: 'local-model',
  fastModel: 'local-model',
  questions: [
    { id: 'status', query: 'What happens next?' },
    { id: 'followup', query: 'Who owns it?' },
  ],
  checks: [
    ...(['notes', 'commitments', 'people', 'projects'] as const).map(
      (surface) => ({
        id: surface,
        surface,
        match: { $: 'security approval' },
        sourceQuotes: [quote],
      }),
    ),
    ...['status', 'followup'].map((id) => ({
      id,
      surface: 'chat',
      match: { questionId: `^${id}$`, answer: 'security approval' },
      sourceQuotes: [quote],
    })),
  ],
});

describe('real meeting regression expectations', () => {
  it('requires source quotes, every product surface, and every chat turn', () => {
    expect(parseRealMeetingCase(candidate()).checks).toHaveLength(6);
    const missingSurface = candidate();
    missingSurface.checks = missingSurface.checks.filter(
      (c) => c.surface !== 'people',
    );
    expect(() => parseRealMeetingCase(missingSurface)).toThrow(
      'expectations_missing_people',
    );
    const unsupported = candidate();
    unsupported.checks[0].sourceQuotes = [
      'A made up unsupported source quote.',
    ];
    expect(() => parseRealMeetingCase(unsupported)).toThrow(
      'quote_missing_notes',
    );
    const missingTurn = candidate();
    missingTurn.checks = missingTurn.checks.filter((c) => c.id !== 'followup');
    expect(() => parseRealMeetingCase(missingTurn)).toThrow(
      'chat_expectation_missing_followup',
    );
  });

  it('requires owner, condition, and state in the same persisted record', () => {
    const fixture = parseRealMeetingCase(candidate());
    fixture.checks[1].match = {
      name: 'report',
      'metadata.owner': '^Sam$',
      status: '^active$',
    };
    fixture.checks[1].absent = { name: 'unconditionally' };
    const observations: Observations = {
      notes: [],
      commitments: [
        { name: 'report', metadata: '{"owner":"Alex"}', status: 'active' },
        { name: 'unrelated', metadata: '{"owner":"Sam"}', status: 'active' },
      ],
      people: [],
      projects: [],
      chat: [],
    };
    const passed = () => scoreRealMeeting(fixture, observations)[1].passed;
    expect(passed()).toBe(false);
    observations.commitments.push({
      name: 'report after approval',
      metadata: '{"owner":"Sam"}',
      status: 'completed',
    });
    expect(passed()).toBe(false);
    observations.commitments.push({
      name: 'report unconditionally',
      metadata: '{"owner":"Sam"}',
      status: 'active',
    });
    expect(passed()).toBe(false);
    observations.commitments.push({
      name: 'report after approval',
      metadata: '{"owner":"Sam"}',
      status: 'active',
    });
    expect(passed()).toBe(true);
  });

  it('fails empty output, missing fields, and the wrong chat turn', () => {
    const fixture = parseRealMeetingCase(candidate());
    const observations: Observations = {
      notes: [],
      commitments: [],
      people: [],
      projects: [],
      chat: [{ questionId: 'different', answer: quote }],
    };
    expect(
      scoreRealMeeting(fixture, observations).every((c) => !c.passed),
    ).toBe(true);
  });

  it('rejects malformed patterns and generated seed fields without exposing input', () => {
    const invalid = candidate();
    invalid.checks[0].match = { $: '[' };
    expect(() => parseRealMeetingCase(invalid)).toThrow(
      'pattern_invalid_notes',
    );
    expect(() =>
      parseRealMeetingCase({
        ...candidate(),
        meeting: {
          ...candidate().meeting,
          enhanced_notes: 'private text',
        },
      }),
    ).toThrow(/^real_meeting_case_invalid$/);
    const badTranscript = candidate();
    badTranscript.meeting.transcript_json = 'private malformed transcript';
    expect(() => parseRealMeetingCase(badTranscript)).toThrow(
      /^real_meeting_transcript_invalid$/,
    );
  });
});

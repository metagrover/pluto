import { createHash } from 'node:crypto';
import { z } from 'zod';

const patterns = z
  .record(z.string(), z.string().min(1))
  .refine((value) => Object.keys(value).length > 0);
const surfaces = [
  'notes',
  'commitments',
  'projects',
  'people',
  'chat',
] as const;
const checkSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    surface: z.enum(surfaces),
    match: patterns,
    absent: z.record(z.string(), z.string().min(1)).default({}),
    sourceQuotes: z.array(z.string().min(12)).min(1),
  })
  .strict();

const caseSchema = z
  .object({
    version: z.literal(1),
    meeting: z
      .object({
        title: z.string().min(1),
        started_at: z.string().datetime(),
        duration_seconds: z.number().positive(),
        transcript_json: z.string().min(1),
        transcript_status: z.literal('validated'),
        finalization_status: z.literal('finalized'),
      })
      .strict(),
    model: z.string().min(1),
    fastModel: z.string().min(1),
    questions: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/),
            query: z.string().min(1),
          })
          .strict(),
      )
      .min(2),
    checks: z.array(checkSchema).min(5),
  })
  .strict();

export type RealMeetingCase = z.infer<typeof caseSchema>;
export type Surface = (typeof surfaces)[number];
export type Observations = Record<Surface, unknown[]>;

export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function parseRealMeetingCase(input: unknown): RealMeetingCase {
  const parsed = caseSchema.safeParse(input);
  // Never include the private input or Zod's received values in console output.
  if (!parsed.success) throw new Error('real_meeting_case_invalid');
  const fixture = parsed.data;
  let text: string;
  try {
    const transcript = z
      .object({
        segments: z
          .array(
            z.object({
              text: z.string().min(1),
            }),
          )
          .min(1),
      })
      .parse(JSON.parse(fixture.meeting.transcript_json));
    text = transcript.segments.map((segment) => segment.text).join('\n');
  } catch {
    throw new Error('real_meeting_transcript_invalid');
  }
  for (const surface of surfaces) {
    if (!fixture.checks.some((check) => check.surface === surface))
      throw new Error(`real_meeting_expectations_missing_${surface}`);
  }
  const ids = [...fixture.checks.map((check) => check.id)];
  if (
    new Set(ids).size !== ids.length ||
    new Set(fixture.questions.map((q) => q.id)).size !==
      fixture.questions.length
  )
    throw new Error('real_meeting_duplicate_id');
  for (const check of fixture.checks) {
    if (check.sourceQuotes.some((quote) => !text.includes(quote)))
      throw new Error(`real_meeting_quote_missing_${check.id}`);
    try {
      for (const pattern of [
        ...Object.values(check.match),
        ...Object.values(check.absent),
      ])
        new RegExp(pattern, 'i');
    } catch {
      throw new Error(`real_meeting_pattern_invalid_${check.id}`);
    }
  }
  for (const question of fixture.questions) {
    if (
      !fixture.checks.some(
        (check) =>
          check.surface === 'chat' &&
          check.match.questionId === `^${question.id}$` &&
          check.match.answer,
      )
    )
      throw new Error(`real_meeting_chat_expectation_missing_${question.id}`);
  }
  return fixture;
}

function valueAt(record: unknown, field: string): unknown {
  if (field === '$') return record;
  return field.split('.').reduce<unknown>((previous, key) => {
    let value = previous;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return undefined;
      }
    }
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)[key]
      : undefined;
  }, record);
}

export function scoreRealMeeting(
  fixture: RealMeetingCase,
  observations: Observations,
) {
  const matches = (record: unknown, field: string, pattern: string) => {
    const value = valueAt(record, field);
    return (
      value !== undefined &&
      value !== null &&
      new RegExp(pattern, 'i').test(
        typeof value === 'string' ? value : JSON.stringify(value),
      )
    );
  };
  return fixture.checks.map((check) => ({
    id: check.id,
    surface: check.surface,
    evaluated: observations[check.surface].length > 0,
    passed: observations[check.surface].some(
      (record) =>
        Object.entries(check.match).every(([field, pattern]) =>
          matches(record, field, pattern),
        ) &&
        Object.entries(check.absent).every(
          ([field, pattern]) => !matches(record, field, pattern),
        ),
    ),
  }));
}

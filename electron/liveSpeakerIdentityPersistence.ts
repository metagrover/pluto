import type { IdentityBinding } from '../src/types/identity';
import { isIdentifiableSpeakerKey } from '../src/utils/speakerReview';
import { parseTranscriptSegments } from '../src/utils/transcript';
import { getMeetingIdentityContext } from './commitmentIdentity';
import * as dbModule from './db';

export const LIVE_VOICE_CONFIRMED_ASSIGNMENT =
  'live_voice_confirmed_v1' as const;

type ConfirmationRow = {
  suggestion_id: string;
  meeting_id: string;
  person_id: string;
  generation: number;
  hint_revision: number;
  ranges_json: string;
  state: 'pending' | 'bound' | 'needs_review';
};

export const persistLiveSpeakerIdentityConfirmation = (input: {
  meetingId: string;
  suggestionId: string;
  personId: string;
  generation: number;
  revision: number;
  ranges: Array<{ startMs: number; endMs: number }>;
}): void => {
  dbModule.db
    .prepare(
      `INSERT INTO live_speaker_identity_confirmations (
        suggestion_id, meeting_id, person_id, generation, hint_revision,
        ranges_json, state, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
      ON CONFLICT(suggestion_id) DO UPDATE SET
        person_id = excluded.person_id,
        hint_revision = excluded.hint_revision,
        ranges_json = excluded.ranges_json,
        state = 'pending',
        updated_at = CURRENT_TIMESTAMP`,
    )
    .run(
      input.suggestionId,
      input.meetingId,
      input.personId,
      input.generation,
      input.revision,
      JSON.stringify(input.ranges),
    );
};

export const removeLiveSpeakerIdentityConfirmation = (
  meetingId: string,
  suggestionId: string,
): void => {
  dbModule.db
    .prepare(
      'DELETE FROM live_speaker_identity_confirmations WHERE meeting_id = ? AND suggestion_id = ?',
    )
    .run(meetingId, suggestionId);
};

const timedSegment = (segment: {
  speaker?: unknown;
  start?: unknown;
  end?: unknown;
  startTime?: unknown;
  endTime?: unknown;
}) => {
  const start =
    typeof segment.startTime === 'number' ? segment.startTime : segment.start;
  const end =
    typeof segment.endTime === 'number' ? segment.endTime : segment.end;
  const speaker =
    typeof segment.speaker === 'string' ? segment.speaker.trim() : '';
  return typeof start === 'number' &&
    Number.isFinite(start) &&
    typeof end === 'number' &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start &&
    isIdentifiableSpeakerKey(speaker)
    ? { speaker, start, end }
    : null;
};

export const reconcileLiveSpeakerIdentityConfirmations = (
  meetingId: string,
): { bound: IdentityBinding[]; needsReview: number } => {
  const sqlite = dbModule.db;
  const rows = sqlite
    .prepare(
      "SELECT * FROM live_speaker_identity_confirmations WHERE meeting_id = ? AND state = 'pending' ORDER BY created_at",
    )
    .all(meetingId) as ConfirmationRow[];
  if (rows.length === 0) return { bound: [], needsReview: 0 };
  const meeting = dbModule.getMeeting(meetingId) as
    | dbModule.PersistedMeeting
    | undefined;
  const segments = parseTranscriptSegments(meeting?.transcript_json ?? null)
    .map(timedSegment)
    .filter(
      (segment): segment is NonNullable<typeof segment> => segment !== null,
    );
  const context = getMeetingIdentityContext(meetingId);
  const bindings = [...context.bindings];
  const bound: IdentityBinding[] = [];
  let needsReview = 0;

  for (const row of rows) {
    const personId = dbModule.resolvePersonIdentityId(row.person_id);
    let ranges: Array<{ startMs: number; endMs: number }> = [];
    try {
      const parsed = JSON.parse(row.ranges_json) as unknown;
      if (Array.isArray(parsed)) {
        ranges = parsed.filter(
          (range): range is { startMs: number; endMs: number } =>
            range &&
            typeof range === 'object' &&
            Number.isFinite(range.startMs) &&
            Number.isFinite(range.endMs) &&
            range.startMs >= 0 &&
            range.endMs > range.startMs,
        );
      }
    } catch {
      ranges = [];
    }
    const overlapBySpeaker = new Map<string, number>();
    let coveredDuration = 0;
    for (const range of ranges) {
      const start = range.startMs / 1_000;
      const end = range.endMs / 1_000;
      coveredDuration += end - start;
      for (const segment of segments) {
        const overlap = Math.max(
          0,
          Math.min(end, segment.end) - Math.max(start, segment.start),
        );
        if (overlap > 0) {
          overlapBySpeaker.set(
            segment.speaker,
            (overlapBySpeaker.get(segment.speaker) ?? 0) + overlap,
          );
        }
      }
    }
    const ranked = [...overlapBySpeaker].sort((a, b) => b[1] - a[1]);
    const winner = ranked[0];
    const runnerUp = ranked[1]?.[1] ?? 0;
    const unambiguous =
      winner &&
      coveredDuration >= 1 &&
      winner[1] / coveredDuration >= 0.8 &&
      runnerUp / coveredDuration < 0.2;
    const collision = winner
      ? bindings.some(
          (binding) =>
            binding.personId === personId && binding.speaker !== winner[0],
        )
      : false;
    const existing = winner
      ? bindings.find((binding) => binding.speaker === winner[0])
      : undefined;
    if (
      !unambiguous ||
      collision ||
      (existing?.personId && existing.personId !== row.person_id)
    ) {
      sqlite
        .prepare(
          "UPDATE live_speaker_identity_confirmations SET state = 'needs_review', updated_at = CURRENT_TIMESTAMP WHERE suggestion_id = ?",
        )
        .run(row.suggestion_id);
      needsReview += 1;
      continue;
    }
    const binding: IdentityBinding = {
      speaker: winner[0],
      personId,
      individual: true,
      source: 'user',
      sourceRevision: context.sourceRevision,
      evidence: [],
      assignment: { kind: LIVE_VOICE_CONFIRMED_ASSIGNMENT },
    };
    sqlite.transaction(() => {
      dbModule.identityStore.setBinding(meetingId, binding);
      sqlite
        .prepare(
          "UPDATE live_speaker_identity_confirmations SET state = 'bound', updated_at = CURRENT_TIMESTAMP WHERE suggestion_id = ?",
        )
        .run(row.suggestion_id);
    })();
    bindings.push(binding);
    bound.push(binding);
  }
  return { bound, needsReview };
};

import type { TranscriptSegment } from '../../types';
import { getAnonymousSpeakerDisplayLabel } from '../../utils/speakerReview';

export type MeetingTranscriptTurn<T extends TranscriptSegment> = {
  id: string;
  speaker: TranscriptSegment['speaker'];
  startSeconds: number;
  segments: T[];
};

const MAX_TURN_CHARACTERS = 420;
const MAX_TURN_DURATION_SECONDS = 45;

const segmentStartSeconds = (segment: TranscriptSegment): number | null => {
  const value = segment.startTime ?? segment.start;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const startSeconds = (segment: TranscriptSegment): number =>
  segmentStartSeconds(segment) ?? 0;

export const extractSpeakerDisplayNames = (
  identity:
    | {
        people?: Array<{ id: string; name: string }>;
        bindings?: Array<{ speaker: string; personId?: string | null }>;
        profile?: { preferredName?: string | null } | null;
        selfPersonId?: string | null;
      }
    | null
    | undefined,
): Record<string, string> => {
  if (
    !identity ||
    !Array.isArray(identity.people) ||
    !Array.isArray(identity.bindings)
  ) {
    return {};
  }
  const peopleById = new Map(
    identity.people.map((person) => [person.id, person.name]),
  );
  const names: Record<string, string> = Object.fromEntries(
    identity.bindings.flatMap((binding) => {
      const name = binding.personId
        ? peopleById.get(binding.personId)?.trim()
        : '';
      return name ? [[binding.speaker, name]] : [];
    }),
  );
  // If no explicit binding resolved a name for 'Me', fall back to the user's
  // profile preferredName, then to the name of the workspace self person.
  if (!names.Me) {
    const preferredName = identity.profile?.preferredName?.trim();
    if (preferredName) {
      names.Me = preferredName;
    } else if (identity.selfPersonId) {
      const selfName = peopleById.get(identity.selfPersonId)?.trim();
      if (selfName) {
        names.Me = selfName;
      }
    }
  }
  return names;
};

export const applyMeetingSpeakerDisplayNames = <T extends TranscriptSegment>(
  segments: T[],
  displayNames: Readonly<Record<string, string>>,
): T[] =>
  segments.map((segment) => {
    const speaker = String(segment.speaker ?? '');
    const rawDisplayName = displayNames[speaker]?.trim();
    const displayName =
      speaker === 'Me' && rawDisplayName
        ? rawDisplayName.endsWith(' (You)')
          ? rawDisplayName
          : `${rawDisplayName} (You)`
        : rawDisplayName;
    const projectedSpeaker =
      displayName || getAnonymousSpeakerDisplayLabel(speaker);
    return projectedSpeaker !== speaker
      ? ({ ...segment, speaker: projectedSpeaker } as T)
      : segment;
  });

const turnCharacterCount = <T extends TranscriptSegment>(
  turn: MeetingTranscriptTurn<T>,
): number =>
  turn.segments.reduce(
    (total, segment, index) =>
      total + segment.text.length + (index === 0 ? 0 : 1),
    0,
  );

export const buildMeetingTranscriptTurns = <T extends TranscriptSegment>(
  segments: T[],
): MeetingTranscriptTurn<T>[] => {
  const turns: MeetingTranscriptTurn<T>[] = [];

  const ordered = segments
    .map((segment, index) => ({
      segment,
      index,
      startSeconds: segmentStartSeconds(segment),
    }))
    .sort((left, right) => {
      if (left.startSeconds === null && right.startSeconds === null) {
        return left.index - right.index;
      }
      if (left.startSeconds === null) return 1;
      if (right.startSeconds === null) return -1;
      return left.startSeconds - right.startSeconds || left.index - right.index;
    });

  for (const { segment } of ordered) {
    const current = turns.at(-1);
    const segmentStart = startSeconds(segment);
    const canContinue =
      current &&
      String(current.speaker ?? '') === String(segment.speaker ?? '') &&
      segmentStart - current.startSeconds <= MAX_TURN_DURATION_SECONDS &&
      turnCharacterCount(current) + segment.text.length + 1 <=
        MAX_TURN_CHARACTERS;

    if (canContinue) {
      current.segments.push(segment);
      continue;
    }

    turns.push({
      id: `${String(segment.speaker ?? 'unknown')}-${segmentStart}-${turns.length}`,
      speaker: segment.speaker,
      startSeconds: segmentStart,
      segments: [segment],
    });
  }

  return turns;
};

export const formatMeetingTranscriptForClipboard = <
  T extends TranscriptSegment,
>(
  turns: MeetingTranscriptTurn<T>[],
): string =>
  turns
    .map((turn) => {
      const minutes = Math.floor(turn.startSeconds / 60);
      const seconds = Math.floor(turn.startSeconds % 60)
        .toString()
        .padStart(2, '0');
      const text = turn.segments
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(' ');
      if (!text) return '';
      return `${String(turn.speaker || 'Unknown speaker')} (${minutes}:${seconds})\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');

/** Transcription completion and remote voice separation are distinct outcomes. */
export const getMeetingRemoteSpeakerStatus = (meeting: {
  transcript_status?: string;
  transcript_json?: string;
}): {
  state: 'separated' | 'unresolved' | 'no_remote_speech';
  title: string;
  detail: string;
} | null => {
  if (meeting.transcript_status !== 'validated') return null;
  try {
    const transcript = JSON.parse(meeting.transcript_json || 'null');
    const remote = transcript?.speakerAttribution?.remoteDiarization;
    if (
      !Array.isArray(transcript?.segments) ||
      !transcript.segments.some(
        (segment: { text?: unknown } | null) =>
          typeof segment?.text === 'string' && segment.text.trim(),
      ) ||
      remote?.attempted !== true ||
      remote.input !== 'system_audio'
    )
      return null;

    if (remote.applied === true && remote.labeledSegmentCount > 0) {
      return {
        state: 'separated',
        title: 'Transcript ready · Remote speaker labels applied',
        detail:
          'Labels identify distinct remote voices where supported. Uncertain speech keeps a general label.',
      };
    }
    if (remote.fallbackReason === 'no_system_speech') {
      return {
        state: 'no_remote_speech',
        title: 'Transcript ready · No remote speech detected',
        detail:
          'No participant speech was detected in the System recording, so there are no remote speaker labels.',
      };
    }
    return {
      state: 'unresolved',
      title: 'Transcript ready · Remote speakers not separated',
      detail:
        remote.fallbackReason === 'low_coverage'
          ? 'Remote speech could not be matched confidently to individual speakers. It keeps a general label.'
          : 'Remote speech keeps a general label because distinct voices could not be confirmed.',
    };
  } catch {
    return null;
  }
};

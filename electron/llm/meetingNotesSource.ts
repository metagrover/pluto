import { createHash } from 'node:crypto';
import {
  MeetingNotesError,
  type NotesSource,
  type SourceSegment,
  type SourceSpan,
} from './meetingNotesTypes';

type RawSegment = {
  speaker?: unknown;
  text?: unknown;
};

const isSurrogateBoundary = (text: string, offset: number): boolean => {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return (
    before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
  );
};

const parseCanonicalSegments = (raw: string): RawSegment[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MeetingNotesError('invalid_notes_source');
  }

  const segments = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed as { segments?: unknown }).segments
      : undefined;
  if (!Array.isArray(segments)) {
    throw new MeetingNotesError('invalid_notes_source');
  }
  return segments as RawSegment[];
};

export const createNotesSource = (raw: string): NotesSource => {
  const sourceSegments = parseCanonicalSegments(raw);
  const segments: SourceSegment[] = sourceSegments.map((segment, index) => {
    if (
      !segment ||
      typeof segment !== 'object' ||
      typeof segment.text !== 'string'
    ) {
      throw new MeetingNotesError('invalid_notes_source');
    }
    if (
      segment.speaker !== undefined &&
      segment.speaker !== null &&
      typeof segment.speaker !== 'string' &&
      typeof segment.speaker !== 'number'
    ) {
      throw new MeetingNotesError('invalid_notes_source');
    }
    return Object.freeze({
      index,
      speaker:
        typeof segment.speaker === 'string' ||
        typeof segment.speaker === 'number'
          ? String(segment.speaker)
          : null,
      text: segment.text,
    });
  });

  if (!segments.some((segment) => segment.text.trim().length > 0)) {
    throw new MeetingNotesError('invalid_notes_source');
  }

  const canonical = JSON.stringify(
    segments.map(({ index, speaker, text }) => ({ index, speaker, text })),
  );
  return {
    revision: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    segments: Object.freeze(segments),
  };
};

/** Compatibility for callers with immutable rendered text, never for saved
 * meetings which must retain their canonical segment indexes. */
export const createNotesSourceFromText = (text: string): NotesSource =>
  createNotesSource(
    JSON.stringify(
      text.split('\n').map((line) => {
        const turn = /^([^:\n]{1,100}):\s?(.*)$/.exec(line);
        return turn
          ? { speaker: turn[1], text: turn[2] }
          : { speaker: null, text: line };
      }),
    ),
  );

export const resolveSourceSpan = (
  source: NotesSource,
  span: SourceSpan,
): string => {
  const segment = source.segments.find((entry) => entry.index === span.segment);
  if (
    !segment ||
    !Number.isInteger(span.segment) ||
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > segment.text.length ||
    isSurrogateBoundary(segment.text, span.start) ||
    isSurrogateBoundary(segment.text, span.end)
  ) {
    throw new MeetingNotesError('invalid_source_span');
  }
  const text = segment.text.slice(span.start, span.end);
  if (!text.trim()) throw new MeetingNotesError('invalid_source_span');
  return text;
};

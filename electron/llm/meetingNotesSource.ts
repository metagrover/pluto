import { createHash } from 'node:crypto';
import {
  type CitedSpeakerAlias,
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

export const createNotesSource = (
  raw: string,
  speakerDisplayNames: Readonly<Record<string, string>> = {},
): NotesSource => {
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
    const canonicalSpeaker =
      typeof segment.speaker === 'string' || typeof segment.speaker === 'number'
        ? String(segment.speaker)
        : null;
    const projectedSpeaker = canonicalSpeaker
      ? speakerDisplayNames[canonicalSpeaker]?.trim() || canonicalSpeaker
      : null;
    return Object.freeze({
      index,
      speaker: projectedSpeaker,
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
    protectedSpeakerLabels: Object.freeze(
      Object.values(speakerDisplayNames)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
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
  const indexed = source.segments[span.segment];
  const segment =
    indexed?.index === span.segment
      ? indexed
      : source.segments.find((entry) => entry.index === span.segment);
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

// Group exact contiguous excerpts from one identified recording speaker; gaps remain separate.
/** Review complete cited turns and intervening speech, including omitted negation. */
export const completeCitedSourceWindow = (
  source: NotesSource,
  spans: SourceSpan[],
): SourceSpan[] => {
  if (!spans.length) return [];
  const first = Math.min(...spans.map((span) => span.segment));
  const last = Math.max(...spans.map((span) => span.segment));
  return source.segments
    .filter(
      (segment) =>
        segment.index >= first &&
        segment.index <= last &&
        segment.text.trim().length > 0,
    )
    .map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
};

export const hasBareNotesReferent = (text: string): boolean =>
  /\b(?:either|neither|both|those|that)\s+(?:(?:of\s+)?the\s+)?(?:tasks?|conditions?)\b/i.test(
    text,
  );

// Context selection is deliberately broader than unresolved-output detection.
// Demonstratives can refer to any subject; extra context never resolves them.
const needsPriorSourceContext = (text: string): boolean =>
  hasBareNotesReferent(text) ||
  /\b(?:this|that|these|those|such)\b/i.test(text);

/** Exact backward-reference context, bounded to three prior turns. */
export const sourceBoundReviewWindow = (
  source: NotesSource,
  spans: SourceSpan[],
): SourceSpan[] => {
  const referents = spans.filter((span) =>
    needsPriorSourceContext(resolveSourceSpan(source, span)),
  );
  if (!referents.length) return completeCitedSourceWindow(source, spans);
  // Anchor to the latest reference so earlier contextual references cannot
  // extend the window again when a reviewed result is replayed.
  const first = Math.max(...referents.map((span) => span.segment));
  const previous = source.segments
    .filter(
      (segment) => segment.index < first && segment.text.trim().length > 0,
    )
    .map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
  const priorPassages = groupCitedSourcePassages(source, previous).slice(-3);
  return completeCitedSourceWindow(source, [
    ...priorPassages.flatMap(({ spans }) => spans),
    ...spans,
  ]);
};

export const groupCitedSourcePassages = (
  source: NotesSource,
  spans: SourceSpan[],
) => {
  const passages: Array<{
    speaker: string | null;
    text: string;
    spans: SourceSpan[];
  }> = [];
  const ordered = [
    ...new Map(
      spans.map(
        (span) => [`${span.segment}:${span.start}:${span.end}`, span] as const,
      ),
    ).values(),
  ].sort(
    (left, right) => left.segment - right.segment || left.start - right.start,
  );
  for (const span of ordered) {
    const segment = source.segments.find(
      (entry) => entry.index === span.segment,
    )!;
    const text = resolveSourceSpan(source, span);
    const prior = passages.at(-1);
    const previous = prior?.spans.at(-1);
    const previousSegment =
      previous &&
      source.segments.find((entry) => entry.index === previous.segment)!;
    const adjacent =
      previous &&
      (previous.segment === span.segment
        ? previous.end === span.start
        : previous.segment + 1 === span.segment &&
          previous.end === previousSegment!.text.length &&
          span.start === 0);
    const sameSegment = previous?.segment === span.segment;
    const identifiedSpeaker =
      segment.speaker &&
      !['them', 'unknown', 'speaker'].includes(
        segment.speaker.toLocaleLowerCase(),
      );
    if (
      prior &&
      adjacent &&
      prior.speaker === segment.speaker &&
      (sameSegment || identifiedSpeaker)
    ) {
      prior.text += `${sameSegment ? '' : ' '}${text}`;
      prior.spans.push(span);
    } else passages.push({ speaker: segment.speaker, text, spans: [span] });
  }
  return passages;
};

/** Render exact attributed speech without inferring scope or identity. */
export const quoteCitedSourcePassages = (
  source: NotesSource,
  spans: SourceSpan[],
): string =>
  groupCitedSourcePassages(source, spans)
    .map(({ speaker, text }) => `${speaker ?? 'Speaker'}: “${text}”`)
    .join('\n');

const identityKey = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase('en-US').trim();

/** Deliberately literal: unsupported introductions retain the recorded label.
 * Never joins fragments, resolves reported speech, or creates a person/voice binding. */
// shortcut: Capitalized name/role ambiguity still needs semantic review; this never enrolls an identity.
const explicitIntroduction = (text: string): string | null => {
  const match =
    /^(?:(?:hi|hey|hello)[,!]?\s+)?(?:I am|I['’]m|it['’]s|my name is)\s+([\p{Lu}][\p{L}\p{M}'’.-]*(?:[ -][\p{Lu}][\p{L}\p{M}'’.-]*){0,2})[.!]?$/iu.exec(
      text.trim(),
    );
  if (!match) return null;
  const name = match[1]!.replace(/[.!]$/, '');
  if (
    /^(?:group|team|the team|everyone|unknown|me|them|speaker|we|i|you)$/iu.test(
      name,
    )
  )
    return null;
  // The case-insensitive phrase match must not turn ordinary predicates into names.
  if (!name.split(/[ -]/u).every((part) => /^\p{Lu}/u.test(part))) return null;
  return name;
};

/** Exact own-citation alias evidence, with conflicts checked across the WHOLE source. */
export const buildCitedSpeakerAliasProof = (
  source: NotesSource,
  sources: readonly SourceSpan[],
): readonly CitedSpeakerAlias[] => {
  const introductions = source.segments.flatMap((segment) => {
    const name = explicitIntroduction(segment.text);
    return segment.speaker && name ? [{ segment, name }] : [];
  });
  const protectedLabels = new Set([
    'me',
    ...(source.protectedSpeakerLabels ?? []).map(identityKey),
  ]);
  const fullyCited = (segment: SourceSegment) =>
    sources.some(
      (span) =>
        span.segment === segment.index &&
        span.start === 0 &&
        span.end === segment.text.length,
    );
  const proof: CitedSpeakerAlias[] = [];
  for (const { segment, name } of introductions) {
    const speaker = segment.speaker!;
    if (
      protectedLabels.has(identityKey(speaker)) ||
      /^(?:them|unknown|speaker|group|team|we|everyone)$/iu.test(speaker) ||
      !fullyCited(segment)
    )
      continue;
    // Named/confirmed speaker labels already have authority; never silently rename them.
    if (
      !/^(?:remote\s*speaker\s*\d+|speaker[ _-]*\d+|unconfirmed\s*speaker(?:[ _-]*\d+)?|unknown[ _-]*speaker[ _-]*\d+)$/iu.test(
        speaker,
      )
    )
      continue;
    if (
      introductions.some(
        (other) =>
          (other.segment.speaker === speaker &&
            identityKey(other.name) !== identityKey(name)) ||
          (other.segment.speaker !== speaker &&
            identityKey(other.name) === identityKey(name)),
      )
    )
      continue;
    if (
      !source.segments.some(
        (task) =>
          task.speaker === speaker &&
          task.index !== segment.index &&
          fullyCited(task) &&
          /^\s*I(?: will\b|['’]ll\b| can\b| am going to\b|['’]m going to\b| commit to\b| promise(?:d)? to\b|(?: am|['’]m)\s+(?:(?:currently|still)\s+)?[\p{L}]+ing\b)/iu.test(
            task.text,
          ),
      )
    )
      continue;
    if (proof.some((entry) => entry.speaker === speaker)) continue;
    proof.push(
      Object.freeze({
        speaker,
        name,
        introductionSources: Object.freeze(
          introductions
            .filter(
              (entry) =>
                entry.segment.speaker === speaker &&
                identityKey(entry.name) === identityKey(name) &&
                fullyCited(entry.segment),
            )
            .map(({ segment: intro }) =>
              Object.freeze({
                segment: intro.index,
                start: 0,
                end: intro.text.length,
              }),
            ),
        ),
      }),
    );
  }
  return Object.freeze(proof);
};

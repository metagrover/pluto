import {
  type NotesTokenStats,
  estimateNotesTokens,
  estimateNotesTokensFromStats,
  measureNotesText,
  notesSegmentAt,
} from './meetingNotesBudget';
import { NOTES_EXPERIMENTS_ENABLED } from './meetingNotesExperiments';
import {
  MeetingNotesError,
  type NotesSource,
  type SourceSpan,
} from './meetingNotesTypes';
import { createNotesWireRequest } from './meetingNotesWire';

const PACKET_START = 'BEGIN SOURCE DATA\n';
const DESCRIPTOR_PATTERN = /\{"segment":\d+,"start":\d+,"end":\d+\}/g;
const ILLUSTRATIVE_DESCRIPTOR = '{"segment":0,"start":0,"end":1}';
const NEWLINE: NotesTokenStats = {
  bytes: 1,
  nonWhitespace: 0,
  asciiLetters: 0,
  longRun: false,
};

const spanKey = (span: SourceSpan) =>
  `${span.segment}:${span.start}:${span.end}`;

/** One source row exactly as the notes pipeline serializes it into a prompt. */
export const serializeNotesSourceRow = (
  source: NotesSource,
  span: SourceSpan,
): string => {
  const segment = notesSegmentAt(source, span.segment);
  if (!segment) throw new MeetingNotesError('invalid_source_span');
  return JSON.stringify({
    descriptor: span,
    speaker: segment.speaker,
    text: segment.text.slice(span.start, span.end),
  });
};

const addStats = (total: NotesTokenStats, next: NotesTokenStats) => {
  total.bytes += next.bytes;
  total.nonWhitespace += next.nonWhitespace;
  total.asciiLetters += next.asciiLetters;
  total.longRun ||= next.longRun;
};

type Envelope = {
  before: NotesTokenStats;
  after: NotesTokenStats;
  illustrative: boolean;
};

/**
 * Returns the same token estimate as building the full prompt for `spans`,
 * without rebuilding it. The fixed text around the source packet is measured
 * once and each source row once, so leaf planning grows linearly with the
 * transcript. Prompts whose shape cannot be proven additive use the full build.
 */
export const createNotesSourcePromptEstimator = ({
  source,
  buildPrompt,
  wire,
}: {
  source: NotesSource;
  buildPrompt: (sourceText: string) => string;
  /** Present when the provider receives the labelled wire encoding. */
  wire?: { compactSourceSpeakers?: boolean; sourceParagraphs?: boolean };
}): ((spans: SourceSpan[]) => number) => {
  const rawRows = new Map<string, string>();
  const rawRow = (span: SourceSpan) => {
    const key = spanKey(span);
    let row = rawRows.get(key);
    if (row === undefined) {
      row = serializeNotesSourceRow(source, span);
      rawRows.set(key, row);
    }
    return row;
  };
  const finalPrompt = (spans: SourceSpan[]) => {
    const prompt = buildPrompt(spans.map(rawRow).join('\n'));
    return wire
      ? createNotesWireRequest(
          prompt,
          spans,
          wire.compactSourceSpeakers,
          wire.sourceParagraphs,
        ).prompt
      : prompt;
  };
  const exact = (spans: SourceSpan[]) =>
    estimateNotesTokens(finalPrompt(spans));

  const encodedRow = (span: SourceSpan, index: number) => {
    if (!wire) return rawRow(span);
    const parsed = JSON.parse(rawRow(span)) as {
      speaker: unknown;
      text: string;
    };
    return JSON.stringify([`R${index}`, parsed.speaker, parsed.text]);
  };
  const rowStats = new Map<string, NotesTokenStats>();
  const statsForRow = (span: SourceSpan, index: number) => {
    const key = wire ? `${index}|${spanKey(span)}` : spanKey(span);
    let stats = rowStats.get(key);
    if (!stats) {
      stats = measureNotesText(encodedRow(span, index));
      rowStats.set(key, stats);
    }
    return stats;
  };

  const deriveEnvelope = (): Envelope | null => {
    if (
      wire &&
      NOTES_EXPERIMENTS_ENABLED &&
      (wire.compactSourceSpeakers || wire.sourceParagraphs)
    )
      return null;
    const samples = source.segments
      .filter((segment) => segment.text.trim())
      .slice(0, 2)
      .map((segment) => ({
        segment: segment.index,
        start: 0,
        end: segment.text.length,
      }));
    const first = samples[0];
    if (!first) return null;
    const rawPrompt = buildPrompt(rawRow(first));
    if (rawPrompt.split('BEGIN SOURCE DATA').length !== 2) return null;
    // Other descriptors would be relabelled per candidate by the wire encoder.
    const descriptors =
      rawPrompt.replace(rawRow(first), '').match(DESCRIPTOR_PATTERN) ?? [];
    if (descriptors.some((match) => match !== ILLUSTRATIVE_DESCRIPTOR))
      return null;
    const prompt = finalPrompt([first]);
    const packet = `${PACKET_START}${encodedRow(first, 0)}\nEND SOURCE DATA`;
    const at = prompt.indexOf(packet);
    if (at < 0 || prompt.lastIndexOf(packet) !== at) return null;
    const beforeText = prompt.slice(0, at + PACKET_START.length);
    const afterText = prompt.slice(
      at + PACKET_START.length + encodedRow(first, 0).length,
    );
    // Rows join on newlines, so no estimate input can span a boundary.
    if (!beforeText.endsWith('\n') || !afterText.startsWith('\n')) return null;
    const compose = (spans: SourceSpan[]) =>
      `${beforeText}${spans.map(encodedRow).join('\n')}${afterText}`;
    if (compose(samples) !== finalPrompt(samples)) return null;
    return {
      before: measureNotesText(beforeText),
      after: measureNotesText(afterText),
      illustrative: wire !== undefined && descriptors.length > 0,
    };
  };

  let envelope: Envelope | null | undefined;
  return (spans) => {
    if (envelope === undefined) envelope = deriveEnvelope();
    if (
      !envelope ||
      spans.length === 0 ||
      // The illustrative descriptor takes this span's label when it is cited.
      (envelope.illustrative &&
        spans.some((span, index) => index > 0 && spanKey(span) === '0:0:1'))
    )
      return exact(spans);
    const total = { ...envelope.before };
    addStats(total, envelope.after);
    const seen = new Set<string>();
    for (const [index, span] of spans.entries()) {
      // The wire encoder gives repeated spans one shared label.
      const key = spanKey(span);
      if (seen.has(key)) return exact(spans);
      seen.add(key);
      if (index > 0) addStats(total, NEWLINE);
      addStats(total, statsForRow(span, index));
    }
    return estimateNotesTokensFromStats(total);
  };
};

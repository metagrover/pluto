import {
  MeetingNotesError,
  type NotesSource,
  type SourceSpan,
} from './meetingNotesTypes';

export type NotesCapacityInput = {
  contextTokens: number;
  writerInputTokens: number;
  auditBaseInputTokens: number;
  writerOutputTokens: number;
  auditOutputTokens: number;
  safetyTokens: number;
};

export type NotesSourceWindow = {
  primarySpans: SourceSpan[];
  overlapSpans: SourceSpan[];
  primaryText: string;
  sourceText: string;
};

const isTokenDense = (text: string): boolean => {
  const nonWhitespace = text.replaceAll(/\s/g, '');
  if (!nonWhitespace) return false;
  const asciiLetters = (nonWhitespace.match(/[A-Za-z]/g) ?? []).length;
  return (
    asciiLetters < nonWhitespace.length / 2 ||
    nonWhitespace.split(/\s+/).some((token) => token.length > 64)
  );
};

export const estimateNotesTokens = (text: string): number => {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (isTokenDense(text)) return bytes;
  return Math.ceil(Math.ceil(bytes / 3) * 1.25);
};

export const planNotesCapacity = (input: NotesCapacityInput) => {
  const writerFits =
    input.writerInputTokens + input.writerOutputTokens + input.safetyTokens <=
    input.contextTokens;
  const auditFits =
    input.auditBaseInputTokens +
      input.writerOutputTokens +
      input.auditOutputTokens +
      input.safetyTokens <=
    input.contextTokens;
  return { mode: writerFits && auditFits ? 'direct' : 'hierarchical' } as const;
};

export const calculateNotesRequestBudget = ({
  prompt,
  contextTokens,
  outputTokens,
}: {
  prompt: string;
  contextTokens: number;
  outputTokens: number;
}): { num_ctx: number; num_predict: number } => {
  const safetyTokens = 512;
  if (
    !Number.isSafeInteger(contextTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    contextTokens <= 0 ||
    outputTokens <= 0 ||
    estimateNotesTokens(prompt) + outputTokens + safetyTokens > contextTokens
  ) {
    throw new MeetingNotesError('notes_context_exhausted');
  }
  return { num_ctx: contextTokens, num_predict: outputTokens };
};

const isSurrogateBoundary = (text: string, offset: number): boolean => {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return (
    before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
  );
};

const primaryTextFor = (source: NotesSource, spans: SourceSpan[]): string =>
  spans
    .map((span) => {
      const segment = source.segments.find(
        (entry) => entry.index === span.segment,
      );
      return segment?.text.slice(span.start, span.end) ?? '';
    })
    .join('\n');

const splitSegment = (
  source: NotesSource,
  segment: NotesSource['segments'][number],
  fitsPrompt: (packet: string) => boolean,
): SourceSpan[] => {
  const spans: SourceSpan[] = [];
  let start = 0;
  while (start < segment.text.length) {
    let chosenEnd = -1;
    for (let end = start + 1; end <= segment.text.length; end += 1) {
      if (isSurrogateBoundary(segment.text, end)) continue;
      const span = { segment: segment.index, start, end };
      if (!fitsPrompt(primaryTextFor(source, [span]))) break;
      chosenEnd = end;
    }

    if (chosenEnd <= start)
      throw new MeetingNotesError('notes_context_exhausted');

    const lastWhitespace = segment.text.lastIndexOf(' ', chosenEnd - 1);
    if (lastWhitespace >= start && lastWhitespace + 1 > start) {
      const whitespaceEnd = lastWhitespace + 1;
      const whitespaceSpan = {
        segment: segment.index,
        start,
        end: whitespaceEnd,
      };
      if (fitsPrompt(primaryTextFor(source, [whitespaceSpan]))) {
        chosenEnd = whitespaceEnd;
      }
    }
    spans.push({ segment: segment.index, start, end: chosenEnd });
    start = chosenEnd;
  }
  return spans;
};

export const partitionNotesSource = (
  source: NotesSource,
  fitsPrompt: (packet: string) => boolean,
): NotesSourceWindow[] => {
  if (!fitsPrompt('')) throw new MeetingNotesError('notes_context_exhausted');

  const primarySpans = source.segments
    .filter((segment) => segment.text.trim())
    .flatMap((segment) => {
      const full = {
        segment: segment.index,
        start: 0,
        end: segment.text.length,
      };
      return fitsPrompt(primaryTextFor(source, [full]))
        ? [full]
        : splitSegment(source, segment, fitsPrompt);
    });

  const windows: NotesSourceWindow[] = [];
  let current: SourceSpan[] = [];
  for (const span of primarySpans) {
    const candidate = [...current, span];
    if (current.length > 0 && !fitsPrompt(primaryTextFor(source, candidate))) {
      const primaryText = primaryTextFor(source, current);
      windows.push({
        primarySpans: current,
        overlapSpans: [],
        primaryText,
        sourceText: primaryText,
      });
      current = [span];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    const primaryText = primaryTextFor(source, current);
    windows.push({
      primarySpans: current,
      overlapSpans: [],
      primaryText,
      sourceText: primaryText,
    });
  }
  if (!windows.length) throw new MeetingNotesError('notes_context_exhausted');
  return windows;
};

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
    asciiLetters < nonWhitespace.length / 2 || /[\p{L}\p{N}_$]{65,}/u.test(text)
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

export const bisectNotesSourceSpans = (
  source: NotesSource,
  spans: SourceSpan[],
): [SourceSpan[], SourceSpan[]] | null => {
  if (spans.length > 1) {
    const total = spans.reduce((sum, span) => sum + span.end - span.start, 0);
    let consumed = 0;
    let splitAt = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 1; index < spans.length; index++) {
      const prior = spans[index - 1]!;
      consumed += prior.end - prior.start;
      const distance = Math.abs(total / 2 - consumed);
      if (distance < bestDistance) {
        bestDistance = distance;
        splitAt = index;
      }
    }
    return [spans.slice(0, splitAt), spans.slice(splitAt)];
  }
  const span = spans[0];
  if (!span || span.end - span.start < 2) return null;
  const segment = source.segments.find((entry) => entry.index === span.segment);
  if (!segment) throw new MeetingNotesError('invalid_source_span');
  let offset = span.start + Math.floor((span.end - span.start) / 2);
  const priorWhitespace = segment.text.lastIndexOf(' ', offset - 1);
  const nextWhitespace = segment.text.indexOf(' ', offset);
  const whitespaceOffsets = [priorWhitespace, nextWhitespace]
    .filter((candidate) => candidate >= span.start && candidate < span.end - 1)
    .map((candidate) => candidate + 1)
    .sort(
      (left, right) =>
        Math.abs(left - offset) - Math.abs(right - offset) || left - right,
    );
  offset = whitespaceOffsets[0] ?? offset;
  if (isSurrogateBoundary(segment.text, offset)) offset -= 1;
  if (offset <= span.start || offset >= span.end) return null;
  return [[{ ...span, end: offset }], [{ ...span, start: offset }]];
};

const splitSegment = (
  source: NotesSource,
  segment: NotesSource['segments'][number],
  fitsPrompt: (packet: string, spans?: SourceSpan[]) => boolean,
): SourceSpan[] => {
  const spans: SourceSpan[] = [];
  let start = 0;
  while (start < segment.text.length) {
    let chosenEnd = -1;
    let low = start + 1;
    let high = segment.text.length;
    while (low <= high) {
      const midpoint = Math.floor((low + high) / 2);
      let end = midpoint;
      if (isSurrogateBoundary(segment.text, end)) end -= 1;
      if (end <= start) {
        low = midpoint + 1;
        continue;
      }
      const span = { segment: segment.index, start, end };
      if (fitsPrompt(primaryTextFor(source, [span]), [span])) {
        chosenEnd = end;
        // Advance past the search midpoint even if the safe boundary moved back.
        low = midpoint + 1;
      } else {
        high = end - 1;
      }
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
      if (
        fitsPrompt(primaryTextFor(source, [whitespaceSpan]), [whitespaceSpan])
      ) {
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
  fitsPrompt: (packet: string, spans?: SourceSpan[]) => boolean,
): NotesSourceWindow[] => {
  if (!fitsPrompt('', []))
    throw new MeetingNotesError('notes_context_exhausted');

  const primarySpans = source.segments
    .filter((segment) => segment.text.trim())
    .flatMap((segment) => {
      const full = {
        segment: segment.index,
        start: 0,
        end: segment.text.length,
      };
      return fitsPrompt(primaryTextFor(source, [full]), [full])
        ? [full]
        : splitSegment(source, segment, fitsPrompt);
    });

  const windows: NotesSourceWindow[] = [];
  let current: SourceSpan[] = [];
  for (const span of primarySpans) {
    const candidate = [...current, span];
    if (
      current.length > 0 &&
      !fitsPrompt(primaryTextFor(source, candidate), candidate)
    ) {
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
  return windows.map((window, index) => {
    if (index === 0) return window;
    const prior = windows[index - 1];
    const priorSpan = prior?.primarySpans.at(-1);
    if (!priorSpan) return window;
    const overlapText = primaryTextFor(source, [priorSpan]);
    const sourceText = `${overlapText}\n${window.primaryText}`;
    return fitsPrompt(sourceText, [priorSpan, ...window.primarySpans])
      ? { ...window, overlapSpans: [priorSpan], sourceText }
      : window;
  });
};

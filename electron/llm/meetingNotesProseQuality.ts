export type NotesProseSignal =
  | 'first_person'
  | 'repeated_word'
  | 'speech_filler'
  | 'long_unpunctuated_fragment';

export type SuspectNotesProse = {
  reason: 'raw_transcript_like';
  signals: NotesProseSignal[];
};

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

/**
 * Precision-first publication check for prose that is still effectively a raw
 * transcript fragment. Exact cited-source copying is required, along with an
 * obvious repeated word and at least two other independent speech artifacts.
 */
export const classifySuspectNotesProse = ({
  text,
  evidence,
}: {
  text: string;
  evidence: string;
}): SuspectNotesProse | null => {
  const normalizedText = normalizeWhitespace(text);
  const normalizedEvidence = normalizeWhitespace(evidence);
  const words = normalizedText.match(/[a-z0-9']+/g) ?? [];
  if (
    words.length < 12 ||
    !normalizedText ||
    !normalizedEvidence.includes(normalizedText)
  ) {
    return null;
  }

  const signals: NotesProseSignal[] = [];
  if (
    /\b(?:i|i'm|i'll|i'd|i've|me|my|mine|we|we're|we'll|we'd|we've|us|our|ours)\b/i.test(
      text,
    )
  ) {
    signals.push('first_person');
  }
  if (/\b([a-z][a-z']+)\s+\1\b/i.test(text)) {
    signals.push('repeated_word');
  }
  if (/\b(?:kind of|sort of|you know|i mean)\b/i.test(text)) {
    signals.push('speech_filler');
  }
  if (words.length >= 18 && !/[.!?;:]/.test(text)) {
    signals.push('long_unpunctuated_fragment');
  }

  return signals.includes('repeated_word') && signals.length >= 3
    ? { reason: 'raw_transcript_like', signals }
    : null;
};

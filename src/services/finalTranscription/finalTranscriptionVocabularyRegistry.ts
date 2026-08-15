const MAX_ENTRIES = 16;
const registry = new Map<string, string[]>();

export const registerFinalTranscriptionVocabulary = (
  meetingId: string,
  terms: string[],
): void => {
  registry.delete(meetingId);
  registry.set(meetingId, terms.slice(0, 12));
  while (registry.size > MAX_ENTRIES) {
    const oldest = registry.keys().next().value;
    if (typeof oldest !== 'string') break;
    registry.delete(oldest);
  }
};

export const readFinalTranscriptionVocabulary = (
  meetingId: string,
): string[] | null => {
  const terms = registry.get(meetingId);
  return terms ? [...terms] : null;
};

export const clearFinalTranscriptionVocabulary = (meetingId: string): void => {
  registry.delete(meetingId);
};

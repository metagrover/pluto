/** Presentation normalization only: keep words, qualifiers and their order. */
export const normalizeEvidenceText = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

export const containsPersonReference = (
  quote: string,
  name: string,
): boolean => {
  const forms = [...new Set([name, name.trim().split(/\s+/)[0]])].filter(
    Boolean,
  );
  const normalized = normalizeEvidenceText(quote);
  return forms.some((form) => {
    const escaped = normalizeEvidenceText(form).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
    return new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
      'u',
    ).test(normalized);
  });
};

/** Limited inflection normalization, never a semantic entailment verdict. */
const evidenceWord = (word: string): string => {
  const forms: Record<string, string> = {
    delivered: 'deliver',
    delivering: 'deliver',
    delivers: 'deliver',
    prepared: 'prepare',
    preparing: 'prepare',
    prepares: 'prepare',
    raised: 'raise',
    raising: 'raise',
    raises: 'raise',
    shipped: 'ship',
    shipping: 'ship',
    ships: 'ship',
    updated: 'update',
    updating: 'update',
    updates: 'update',
    scheduled: 'schedule',
    scheduling: 'schedule',
    schedules: 'schedule',
    sent: 'send',
    sending: 'send',
    sends: 'send',
    reviewed: 'review',
    reviewing: 'review',
    reviews: 'review',
  };
  return forms[word] ?? word;
};

export const evidencePhrase = (text: string): string =>
  (normalizeEvidenceText(text).match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => !['a', 'an', 'the'].includes(word))
    .map(evidenceWord)
    .join(' ');

export const containsEvidencePhrase = (
  source: string,
  claim: string,
): boolean => {
  const phrase = evidencePhrase(claim);
  return !!phrase && ` ${evidencePhrase(source)} `.includes(` ${phrase} `);
};

type Scope = 'chat' | 'preparation';
type Preferences = Partial<Record<Scope, number>>;
type Store = {
  getSetting: (key: string) => unknown;
  setSetting: (key: string, value: string) => unknown;
};
const key = 'response_length_preferences_v1';
const validLimit = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 30 &&
  value <= 500;

export const readResponsePreferences = (
  store: Pick<Store, 'getSetting'>,
): Preferences => {
  try {
    const value = store.getSetting(key);
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return {
      ...(validLimit(parsed.chat) ? { chat: parsed.chat } : {}),
      ...(validLimit(parsed.preparation)
        ? { preparation: parsed.preparation }
        : {}),
    };
  } catch {
    return {};
  }
};

/** Only explicit formatting commands are durable; meeting facts never go here. */
export const updateResponsePreference = (
  query: string,
  store: Store,
): string | null => {
  const match = query
    .trim()
    .match(
      /^(?:(?:please\s+)?(?:remember(?:\s+to)?\s+)?keep\s+|always\s+keep\s+|(?:please\s+)?(forget|reset)\s+)(?:my\s+|your\s+)?(preparation briefs?|meeting briefs?|prep briefs?|briefs?|answers?|responses?)(?:\s+(?:length\s+)?preferences?)?(?:\s+(?:under|below|to|at most)\s+(\d+)\s+words?|\s+(short|concise))?[.!]?$/i,
    );
  if (!match) return null;
  const scope: Scope = /brief/i.test(match[2]) ? 'preparation' : 'chat';
  if (!match[1] && !match[3] && !match[4]) return null;
  const preferences = readResponsePreferences(store);
  if (match[1]) {
    delete preferences[scope];
    store.setSetting(key, JSON.stringify(preferences));
    return `I've forgotten your ${scope === 'chat' ? 'answer' : 'preparation brief'} length preference.`;
  }
  const limit = match[3] ? Number(match[3]) : 80;
  if (!validLimit(limit)) return 'Choose a length between 30 and 500 words.';
  preferences[scope] = limit;
  store.setSetting(key, JSON.stringify(preferences));
  return `I'll aim to keep ${scope === 'chat' ? 'answers' : 'preparation briefs'} under ${limit} words. You can change this request or say “forget my ${scope === 'chat' ? 'answer' : 'preparation brief'} length preference”.`;
};

export const responseLengthGuidance = (limit?: number): string =>
  validLimit(limit)
    ? `The user's explicit length preference is fewer than ${limit} words. Keep the response within that limit while preserving uncertainty, attribution, and conditions. This preference changes presentation only; it is not factual evidence.`
    : '';

type Source = { id: string; text: string; fullText?: string };

const EXCERPT_BREAK = '\n[excerpt break]\n';
const MAX_SERIALIZED_EVIDENCE_CHARS = 12000;
const MAX_SOURCES = 4;
const STOP_WORDS = new Set(
  'a an and at by for from in into of on or the to with work project projects task tasks existing'.split(
    ' ',
  ),
);

// Normalization is only for retrieval; returned evidence is never rewritten.
function words(text: string): Array<{ word: string; index: number }> {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), (match) => ({
    word: match[0]
      .toLowerCase()
      .replace(/(?:ization|isation|izing|ising|ized|ised)$/, '')
      .replace(/s$/, ''),
    index: match.index,
  }));
}

function rangeAt(center: number, width: number, length: number) {
  const start = Math.max(
    0,
    Math.min(length - width, center - Math.floor(width / 3)),
  );
  return { start, end: Math.min(length, start + width) };
}

function rankedContexts(text: string, query: string[]) {
  const tokens = words(text);
  const querySet = new Set(query);
  const centers: number[] = [];
  for (const token of tokens) {
    if (
      querySet.has(token.word) &&
      (!centers.length || token.index - centers[centers.length - 1] >= 300)
    )
      centers.push(token.index);
  }
  return centers
    .map((center) => {
      const range = rangeAt(center, 1800, text.length);
      const contextWords = words(text.slice(range.start, range.end)).map(
        (token) => token.word,
      );
      const unique = new Set(contextWords);
      const matches = query.filter((word) => unique.has(word)).length;
      const phrase = query.some(
        (word, index) =>
          index > 0 &&
          contextWords.some(
            (value, offset) =>
              value === query[index - 1] && contextWords[offset + 1] === word,
          ),
      );
      // Rank actual context breadth, not how often the title was repeated. This
      // retrieves richer older discussions without guessing their qualification.
      const richness = Math.min(16, unique.size / 4);
      return { center, score: matches * 8 + Number(phrase) * 4 + richness };
    })
    .sort((a, b) => b.score - a.score || a.center - b.center);
}

function excerpt(
  text: string,
  contexts: Array<{ center: number }>,
  budget: number,
): string {
  if (text.length <= budget) return text;
  const width = Math.floor((budget - EXCERPT_BREAK.length * 2) / 3);
  const candidates = contexts.length
    ? contexts
    : [
        { center: 0 },
        { center: Math.floor(text.length / 2) },
        { center: text.length },
      ];
  const selected: Array<{ start: number; end: number; center: number }> = [];
  for (const context of candidates) {
    const range = rangeAt(context.center, width, text.length);
    if (
      selected.some(
        (other) => range.start < other.end && range.end > other.start,
      )
    )
      continue;
    selected.push({ ...range, center: context.center });
    if (selected.length === 3) break;
  }
  const expandedWidth = Math.floor(
    (budget - EXCERPT_BREAK.length * (selected.length - 1)) / selected.length,
  );
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of selected
    .map((item) => rangeAt(item.center, expandedWidth, text.length))
    .sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else merged.push(range);
  }
  return merged
    .map((range) => text.slice(range.start, range.end))
    .join(EXCERPT_BREAK);
}

/** Select prompt evidence across all linked history; fullText stays local for validation. */
export function selectProjectReviewSources(
  sources: Source[],
  name: string,
  limits: { maxSources?: number; maxChars?: number } = {},
): Source[] {
  const maxSources = limits.maxSources ?? MAX_SOURCES;
  const maxChars = limits.maxChars ?? MAX_SERIALIZED_EVIDENCE_CHARS;
  const query = [
    ...new Set(
      words(name)
        .map((token) => token.word)
        .filter((word) => word.length > 1 && !STOP_WORDS.has(word)),
    ),
  ];
  const ranked = sources
    .map((source, index) => {
      const fullText = source.fullText ?? source.text;
      const contexts = rankedContexts(fullText, query);
      return {
        source,
        index,
        fullText,
        contexts,
        score: contexts[0]?.score ?? 0,
      };
    })
    .filter((item) => item.fullText.trim())
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxSources);
  let budget = Math.floor(maxChars / Math.max(1, ranked.length));
  const render = () =>
    ranked.map(({ source, fullText, contexts }) => ({
      ...source,
      fullText,
      text: excerpt(fullText, contexts, budget),
    }));
  let selected = render();
  for (let attempt = 0; attempt < 8; attempt++) {
    const serializedLength = JSON.stringify(
      selected.map(({ id, text }) => ({ id, text })),
    ).length;
    if (serializedLength <= maxChars) break;
    budget = Math.max(256, Math.floor((budget * maxChars) / serializedLength));
    selected = render();
  }
  return selected;
}

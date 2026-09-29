const FORBIDDEN_PREFIXES = [
  'observation:',
  'why it matters:',
  'supporting detail:',
  'evidence:',
  'pluto use:',
  'inference:',
];

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const stripForbiddenPrefixes = (value: string): string => {
  let clean = value.trim();
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (clean.toLowerCase().startsWith(prefix)) {
      clean = clean.slice(prefix.length).trim();
    }
  }
  return clean;
};

export const cleanAnalysisText = (value: string): string =>
  stripForbiddenPrefixes(normalizeWhitespace(value));

export const extractSection = (markdown: string, title: string): string => {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `(?:^|\\n)##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    'i',
  );
  const match = markdown.match(regex);
  return match?.[1]?.trim() || '';
};

const flushCurrentItem = (items: string[], chunks: string[]): void => {
  if (chunks.length === 0) return;
  const text = cleanAnalysisText(chunks.join(' '));
  if (text) items.push(text);
  chunks.length = 0;
};

export const parseBullets = (sectionBody: string): string[] => {
  const lines = sectionBody
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const items: string[] = [];
  const current: string[] = [];

  for (const line of lines) {
    const isBullet =
      /^[-*]\s+/.test(line) || /^[-*]\s*\[\s*[xX]?\s*\]\s+/.test(line);
    if (isBullet) {
      flushCurrentItem(items, current);
      const cleaned = line
        .replace(/^[-*]\s*\[\s*[xX]?\s*\]\s+/, '')
        .replace(/^[-*]\s+/, '')
        .trim();
      current.push(cleaned);
      continue;
    }
    current.push(line);
  }

  flushCurrentItem(items, current);
  return items;
};

export const parseSummary = (sectionBody: string): string[] =>
  sectionBody
    .split(/\n\s*\n/g)
    .map(cleanAnalysisText)
    .filter(Boolean);

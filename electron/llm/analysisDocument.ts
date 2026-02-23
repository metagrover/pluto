import { AnalysisDocument, AnalysisQuality } from './provider';

const SCHEMA_VERSION = 2;
const SECTION_HEADERS = [
  'Summary',
  'Key Points',
  'Action Items',
  'Decisions',
] as const;
const FORBIDDEN_PREFIXES = [
  'observation:',
  'why it matters:',
  'supporting detail:',
  'evidence:',
  'pluto use:',
  'inference:',
];

interface ParsedSections {
  summary: string;
  keyPoints: string;
  actionItems: string;
  decisions: string;
}

export interface AnalysisParseResult {
  document: AnalysisDocument;
  issues: string[];
}

const normalizeWhitespace = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim();
};

const stripForbiddenPrefixes = (value: string): string => {
  let clean = value.trim();
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (clean.toLowerCase().startsWith(prefix)) {
      clean = clean.slice(prefix.length).trim();
    }
  }
  return clean;
};

const extractSection = (markdown: string, title: string): string => {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `(?:^|\\n)##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    'i',
  );
  const match = markdown.match(regex);
  return match?.[1]?.trim() || '';
};

const parseSections = (markdown: string): ParsedSections => {
  return {
    summary: extractSection(markdown, 'Summary'),
    keyPoints: extractSection(markdown, 'Key Points'),
    actionItems: extractSection(markdown, 'Action Items'),
    decisions: extractSection(markdown, 'Decisions'),
  };
};

const flushCurrentItem = (items: string[], chunks: string[]): void => {
  if (chunks.length === 0) return;
  const text = stripForbiddenPrefixes(normalizeWhitespace(chunks.join(' ')));
  if (text) {
    items.push(text);
  }
  chunks.length = 0;
};

const parseBullets = (sectionBody: string): string[] => {
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

const parseSummary = (sectionBody: string): string[] => {
  return sectionBody
    .split(/\n\s*\n/g)
    .map((part) => stripForbiddenPrefixes(normalizeWhitespace(part)))
    .filter(Boolean);
};

const buildQuality = (
  issues: string[],
  retryCount: number,
  fallbackUsed: boolean,
): AnalysisQuality => ({
  format_pass: issues.length === 0 && !fallbackUsed,
  retry_count: retryCount,
  fallback_used: fallbackUsed,
  issues,
});

const buildDocument = (
  summary: string[],
  keyPoints: string[],
  actionItems: string[],
  decisions: string[],
  quality: AnalysisQuality,
): AnalysisDocument => {
  return {
    analysis_schema_version: SCHEMA_VERSION,
    summary,
    key_points: keyPoints,
    action_items: actionItems,
    decisions,
    quality,
  };
};

export const fallbackAnalysisDocument = (
  retryCount = 1,
  issues: string[] = [],
): AnalysisDocument => {
  const quality = buildQuality(
    issues.length > 0
      ? issues
      : ['Formatting validation failed; using fallback analysis structure.'],
    retryCount,
    true,
  );
  return buildDocument(
    ['Conversation captured. Key themes and follow-ups are summarized below.'],
    ['Review transcript details for nuance where precise phrasing matters.'],
    [],
    [],
    quality,
  );
};

export const parseAnalysisMarkdown = (
  markdown: string,
  retryCount = 0,
): AnalysisParseResult => {
  const sections = parseSections(markdown);
  const issues: string[] = [];

  for (const header of SECTION_HEADERS) {
    if (!extractSection(markdown, header)) {
      issues.push(`Missing section: ${header}`);
    }
  }

  const summary = parseSummary(sections.summary);
  const keyPoints = parseBullets(sections.keyPoints);
  const actionItems = parseBullets(sections.actionItems);
  const decisions = parseBullets(sections.decisions);

  if (summary.length === 0) {
    issues.push('Summary has no usable content');
  }
  if (keyPoints.length === 0) {
    issues.push('Key Points has no usable bullets');
  }

  const quality = buildQuality(issues, retryCount, false);
  return {
    document: buildDocument(
      summary,
      keyPoints,
      actionItems,
      decisions,
      quality,
    ),
    issues,
  };
};

export const analysisDocumentToMarkdown = (doc: AnalysisDocument): string => {
  const summaryBody =
    doc.summary.length > 0
      ? doc.summary.join('\n\n')
      : 'No summary content available.';
  const keyPointsBody =
    doc.key_points.length > 0
      ? doc.key_points.map((item) => `- ${item}`).join('\n')
      : '- No key points captured.';
  const actionItemsBody =
    doc.action_items.length > 0
      ? doc.action_items.map((item) => `- [ ] ${item}`).join('\n')
      : '- No concrete action items were explicitly committed.';
  const decisionsBody =
    doc.decisions.length > 0
      ? doc.decisions.map((item) => `- ${item}`).join('\n')
      : '- No explicit decisions were made.';

  return [
    '## Summary',
    summaryBody,
    '',
    '## Key Points',
    keyPointsBody,
    '',
    '## Action Items',
    actionItemsBody,
    '',
    '## Decisions',
    decisionsBody,
  ].join('\n');
};

import type {
  AnalysisDocument,
  AnalysisDocumentV3,
  Meeting,
  UserEditsMap,
} from '../types';

const FORBIDDEN_PREFIXES = [
  'observation:',
  'why it matters:',
  'supporting detail:',
  'evidence:',
  'pluto use:',
  'inference:',
];

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
    .filter((line) => line.length > 0);

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

const hasStringArray = (value: unknown): value is string[] => {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
};

const normalizeSummary = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return parseSummary(value);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => stripForbiddenPrefixes(normalizeWhitespace(item)))
    .filter(Boolean);
};

const normalizeBullets = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return parseBullets(value);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => stripForbiddenPrefixes(normalizeWhitespace(item)))
    .filter(Boolean);
};

const normalizeAnalysisDocument = (value: unknown): AnalysisDocument | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const summary = normalizeSummary(record.summary);
  const keyPoints = normalizeBullets(record.key_points);
  const actionItems = normalizeBullets(record.action_items);
  const decisions = normalizeBullets(record.decisions);
  const qualityRecord =
    record.quality && typeof record.quality === 'object'
      ? (record.quality as Record<string, unknown>)
      : {};

  return {
    analysis_schema_version: 2,
    summary,
    key_points: keyPoints,
    action_items: actionItems,
    decisions,
    quality: {
      format_pass: Boolean(qualityRecord.format_pass),
      retry_count:
        typeof qualityRecord.retry_count === 'number'
          ? qualityRecord.retry_count
          : 0,
      fallback_used: Boolean(qualityRecord.fallback_used),
      issues: hasStringArray(qualityRecord.issues) ? qualityRecord.issues : [],
    },
  };
};

export const parseAnalysisDocumentJson = (
  raw?: string | null,
): AnalysisDocument | null => {
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeAnalysisDocument(parsed);
  } catch {
    return null;
  }
};

export const parseAnalysisMarkdown = (
  markdown?: string | null,
): AnalysisDocument | null => {
  if (!markdown || !markdown.trim()) {
    return null;
  }

  const summary = parseSummary(extractSection(markdown, 'Summary'));
  const keyPoints = parseBullets(extractSection(markdown, 'Key Points'));
  const actionItems = parseBullets(extractSection(markdown, 'Action Items'));
  const decisions = parseBullets(extractSection(markdown, 'Decisions'));

  if (
    summary.length === 0 &&
    keyPoints.length === 0 &&
    actionItems.length === 0 &&
    decisions.length === 0
  ) {
    return null;
  }

  return {
    analysis_schema_version: 2,
    summary,
    key_points: keyPoints,
    action_items: actionItems,
    decisions,
    quality: {
      format_pass: false,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
  };
};

export const resolveMeetingAnalysisDocument = (
  meeting?: Meeting,
): AnalysisDocument | null => {
  if (!meeting) {
    return null;
  }
  return (
    parseAnalysisDocumentJson(meeting.analysis_json) ||
    parseAnalysisMarkdown(meeting.enhanced_notes)
  );
};

export const analysisDocumentToMarkdown = (doc: AnalysisDocument): string => {
  const summaryBody =
    doc.summary.length > 0
      ? doc.summary.join('\n\n')
      : 'No summary was generated for this meeting.';
  const keyPointsBody =
    doc.key_points.length > 0
      ? doc.key_points.map((item) => `- ${item}`).join('\n')
      : '- No key points were captured.';
  const actionItemsBody =
    doc.action_items.length > 0
      ? doc.action_items.map((item) => `- [ ] ${item}`).join('\n')
      : '- [ ] No concrete action items were explicitly committed.';
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

// =============================================
// v3 Analysis Utilities
// =============================================

/**
 * Parse analysis_json as a v3 document. Returns null if not v3 or invalid.
 */
export const parseAnalysisDocumentV3Json = (
  raw?: string | null,
): AnalysisDocumentV3 | null => {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.analysis_schema_version !== 3) return null;
    if (typeof parsed.overview !== 'string' || !parsed.overview.trim())
      return null;
    // Return as-is (backend already validated)
    return parsed as unknown as AnalysisDocumentV3;
  } catch {
    return null;
  }
};

/**
 * Parse user_edits_json into a UserEditsMap.
 */
export const parseUserEditsJson = (raw?: string | null): UserEditsMap => {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw) as UserEditsMap;
  } catch {
    return {};
  }
};

/**
 * Apply a user edit overlay to original text.
 */
export const applyUserEdit = (
  original: string,
  path: string,
  editsMap: UserEditsMap,
): string => {
  const edit = editsMap[path];
  if (!edit) return original;
  return edit.edited;
};

/**
 * Resolve a meeting's analysis to either v2 or v3, returning which version it is.
 */
export const resolveMeetingAnalysis = (
  meeting?: {
    analysis_json?: string;
    analysis_schema_version?: number;
    enhanced_notes?: string;
    user_notes?: string;
  } | null,
): {
  version: 2 | 3;
  v2: AnalysisDocument | null;
  v3: AnalysisDocumentV3 | null;
} => {
  if (!meeting) return { version: 2, v2: null, v3: null };

  const v3 = parseAnalysisDocumentV3Json(meeting.analysis_json);
  if (v3) return { version: 3, v2: null, v3 };

  const v2 = resolveMeetingAnalysisDocument(meeting as Meeting);
  return { version: 2, v2, v3: null };
};

/**
 * Render a v3 analysis document as readable markdown for copy/export.
 */
export const analysisDocumentV3ToMarkdown = (
  doc: AnalysisDocumentV3,
): string => {
  const lines: string[] = [];

  lines.push(doc.overview);
  lines.push('');

  for (const topic of doc.topics) {
    lines.push('─────────────────────────────────────────────────');
    lines.push('');
    lines.push(`## ${topic.title}`);
    lines.push('');
    if (topic.summary) {
      lines.push(topic.summary);
      lines.push('');
    }

    for (const point of topic.key_points) {
      const prefix = point.from_user_notes ? '• 📝 ' : '• ';
      const speaker = point.speaker ? `${point.speaker}: ` : '';
      lines.push(`${prefix}${speaker}${point.text}`);
    }

    for (const decision of topic.decisions) {
      const by = decision.decided_by ? ` (${decision.decided_by})` : '';
      lines.push(`• Decision${by}: ${decision.text}`);
    }

    for (const question of topic.open_questions) {
      lines.push(`• ? ${question}`);
    }

    lines.push('');
  }

  if (doc.all_action_items.length > 0) {
    lines.push('─────────────────────────────────────────────────');
    lines.push('');
    lines.push('## Action Items');
    lines.push('');
    for (const item of doc.all_action_items) {
      const assignee = item.assignee ? `${item.assignee}: ` : '';
      const due = item.due ? ` (${item.due})` : '';
      lines.push(`- [ ] ${assignee}${item.text}${due}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};

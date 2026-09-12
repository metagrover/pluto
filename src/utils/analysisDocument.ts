import type {
  AnalysisDocument,
  AnalysisDocumentV3,
  Meeting,
  UserEditsMap,
} from '../types';
import {
  type EditBlock,
  type PreservedEditConflict,
  isNoOpMeetingNotesEdit,
} from './meetingNotesEditRebase';

export const isNoOpUserEdit = isNoOpMeetingNotesEdit;

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
    // Older saved notes omit empty topic arrays. Normalize only the read
    // projection so rendering and editing retain all persisted content/paths.
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.map((topic) => ({
          ...topic,
          key_points: topic.key_points ?? [],
          decisions: topic.decisions ?? [],
          action_items: topic.action_items ?? [],
          open_questions: (topic.open_questions ?? []).map(
            (question: string | { text: string }) =>
              typeof question === 'string' ? question : question.text,
          ),
        }))
      : [];
    return { ...parsed, topics } as unknown as AnalysisDocumentV3;
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
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([path, value]) => {
        if (
          !value ||
          typeof value !== 'object' ||
          typeof (value as UserEditsMap[string]).original !== 'string' ||
          typeof (value as UserEditsMap[string]).edited !== 'string' ||
          typeof (value as UserEditsMap[string]).edited_at !== 'string'
        ) {
          return [];
        }
        const edit = value as UserEditsMap[string];
        return isNoOpUserEdit(edit.original, edit.edited)
          ? []
          : [[path, { ...edit }]];
      }),
    );
  } catch {
    return {};
  }
};

export const parseAnalysisEditConflictsJson = (
  raw?: string | null,
): PreservedEditConflict[] => {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof (value as PreservedEditConflict).path !== 'string' ||
        typeof (value as PreservedEditConflict).original !== 'string' ||
        typeof (value as PreservedEditConflict).edited !== 'string' ||
        typeof (value as PreservedEditConflict).edited_at !== 'string' ||
        !(
          (value as PreservedEditConflict).previousSourceKey === null ||
          typeof (value as PreservedEditConflict).previousSourceKey === 'string'
        )
      ) {
        return [];
      }
      return [{ ...(value as PreservedEditConflict) }];
    });
  } catch {
    return [];
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
  if (!edit || isNoOpUserEdit(edit.original, edit.edited)) return original;
  return edit.edited;
};

const editBlockSourceKey = (
  doc: AnalysisDocumentV3,
  path: string,
): string | null => {
  const revision = doc.generation_metadata?.source_provenance?.source_revision;
  const entry = doc.generation_metadata?.source_provenance?.blocks[path];
  if (
    typeof revision !== 'string' ||
    !revision ||
    !entry ||
    typeof entry.id !== 'string' ||
    !entry.id ||
    !Array.isArray(entry.sources) ||
    entry.sources.length === 0 ||
    entry.sources.some(
      (source) =>
        !Number.isInteger(source.segment) ||
        !Number.isInteger(source.start) ||
        !Number.isInteger(source.end),
    )
  ) {
    return null;
  }
  // Draft IDs are retained for provenance inspection, but source spans and the
  // source revision are the stable identity across reordered generated blocks.
  const spans = [...entry.sources]
    .sort(
      (left, right) =>
        left.segment - right.segment ||
        left.start - right.start ||
        left.end - right.end,
    )
    .map((source) => `${source.segment}:${source.start}:${source.end}`)
    .join(',');
  return `${revision}|${spans}`;
};

const rendererEditPaths = (doc: AnalysisDocumentV3): string[] => [
  'overview',
  ...doc.all_decisions.map((_, index) => `all_decisions:${index}`),
  ...doc.all_action_items.map((_, index) => `all_action_items:${index}`),
  ...doc.topics.flatMap((topic, topicIndex) => [
    `topic:${topicIndex}:title`,
    ...(topic.summary ? [`topic:${topicIndex}:summary`] : []),
    ...topic.key_points.map(
      (_, pointIndex) => `topic:${topicIndex}:point:${pointIndex}`,
    ),
    ...topic.open_questions.map(
      (_, questionIndex) => `topic:${topicIndex}:question:${questionIndex}`,
    ),
  ]),
];

const isSourceGrounded = (doc: AnalysisDocumentV3): boolean =>
  doc.generation_metadata?.pipeline_version === 'writer-editor-v1' ||
  doc.generation_metadata?.pipeline_version === 'writer-editor-bounded-v1' ||
  doc.generation_metadata?.prompt_version === 'notes-v11' ||
  doc.generation_metadata?.pipeline_version === 'writer-audit-v1' ||
  doc.generation_metadata?.prompt_version === 'notes-v10';

const appendEditableBlock = (
  blocks: EditBlock[],
  {
    path,
    text,
    sourceKey,
    supportsCompletion = false,
    supportsNativeContinuation = true,
  }: {
    path: string;
    text: string;
    sourceKey: string | null;
    supportsCompletion?: boolean;
    supportsNativeContinuation?: boolean;
  },
): void => {
  blocks.push({ path, text, sourceKey });
  if (supportsCompletion) {
    blocks.push({ path: `completion:${path}`, text: 'false', sourceKey });
  }
  if (supportsNativeContinuation) {
    blocks.push({
      path: `native_continuations:${path}`,
      text: '[]',
      sourceKey,
    });
  }
};

const isAnalysisDocumentV3 = (
  doc: AnalysisDocument | AnalysisDocumentV3,
): doc is AnalysisDocumentV3 =>
  doc.analysis_schema_version === 3 &&
  'overview' in doc &&
  'topics' in doc &&
  'all_action_items' in doc &&
  'all_decisions' in doc;

/**
 * Extract the generated fields the notes renderer can edit without applying
 * overlays. Provenance is accepted only when it names the same renderer path;
 * draft-only IDs are deliberately not inferred from array position.
 */
export const getAnalysisEditBlocks = (
  doc: AnalysisDocument | AnalysisDocumentV3 | null,
): EditBlock[] => {
  if (!doc) return [];
  const blocks: EditBlock[] = [];
  if (!isAnalysisDocumentV3(doc)) {
    doc.decisions.forEach((text, index) =>
      appendEditableBlock(blocks, {
        path: `v2:decision:${index}`,
        text,
        sourceKey: null,
        supportsCompletion: true,
      }),
    );
    doc.action_items.forEach((text, index) =>
      appendEditableBlock(blocks, {
        path: `v2:action:${index}`,
        text,
        sourceKey: null,
        supportsCompletion: true,
      }),
    );
    doc.summary.forEach((text, index) =>
      appendEditableBlock(blocks, {
        path: `v2:summary:${index}`,
        text,
        sourceKey: null,
      }),
    );
    doc.key_points.forEach((text, index) =>
      appendEditableBlock(blocks, {
        path: `v2:point:${index}`,
        text,
        sourceKey: null,
      }),
    );
    return blocks;
  }

  if (
    isSourceGrounded(doc) &&
    rendererEditPaths(doc).some((path) => !editBlockSourceKey(doc, path))
  ) {
    // A source-grounded projection must carry complete renderer-path provenance.
    // Returning no blocks forces preservation into recoverable conflicts rather
    // than treating corrupt provenance as a legacy text-only document.
    return [];
  }

  appendEditableBlock(blocks, {
    path: 'overview',
    text: doc.overview,
    sourceKey: editBlockSourceKey(doc, 'overview'),
    supportsNativeContinuation: false,
  });
  doc.all_decisions.forEach((decision, index) =>
    appendEditableBlock(blocks, {
      path: `all_decisions:${index}`,
      text: decision.text,
      sourceKey: editBlockSourceKey(doc, `all_decisions:${index}`),
      supportsCompletion: true,
    }),
  );
  doc.all_action_items.forEach((item, index) =>
    appendEditableBlock(blocks, {
      path: `all_action_items:${index}`,
      text: item.text,
      sourceKey: editBlockSourceKey(doc, `all_action_items:${index}`),
      supportsCompletion: true,
    }),
  );
  doc.topics.forEach((topic, topicIndex) => {
    appendEditableBlock(blocks, {
      path: `topic:${topicIndex}:title`,
      text: topic.title,
      sourceKey: editBlockSourceKey(doc, `topic:${topicIndex}:title`),
      supportsNativeContinuation: false,
    });
    if (topic.summary) {
      appendEditableBlock(blocks, {
        path: `topic:${topicIndex}:summary`,
        text: topic.summary,
        sourceKey: editBlockSourceKey(doc, `topic:${topicIndex}:summary`),
      });
    }
    topic.key_points.forEach((point, pointIndex) =>
      appendEditableBlock(blocks, {
        path: `topic:${topicIndex}:point:${pointIndex}`,
        text: point.text,
        sourceKey: editBlockSourceKey(
          doc,
          `topic:${topicIndex}:point:${pointIndex}`,
        ),
      }),
    );
    topic.open_questions.forEach((question, questionIndex) =>
      appendEditableBlock(blocks, {
        path: `topic:${topicIndex}:question:${questionIndex}`,
        text: question,
        sourceKey: editBlockSourceKey(
          doc,
          `topic:${topicIndex}:question:${questionIndex}`,
        ),
      }),
    );
  });
  return blocks;
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

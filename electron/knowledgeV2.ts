export const KNOWLEDGE_V2_SCHEMA_VERSION = 2;
export const KNOWLEDGE_V2_SYNTHESIS_VERSION = 4;

export type KnowledgeV2Scope = {
  type: string;
  title: string;
};

export type KnowledgeV2Domain =
  | 'work'
  | 'personal'
  | 'travel'
  | 'research'
  | 'routine'
  | 'unknown';

export type KnowledgeV2ItemKind =
  | 'decision'
  | 'follow_up'
  | 'risk'
  | 'blocker'
  | 'dependency'
  | 'open_question'
  | 'pattern'
  | 'reference_context'
  | 'stale_context'
  | 'low_confidence';

export type KnowledgeV2Severity = 'needs_attention' | 'watch' | 'steady';
export type KnowledgeV2EvidenceMode = 'direct' | 'inferred';
export type KnowledgeV2Freshness = 'fresh' | 'aging' | 'stale' | 'unknown';

export interface KnowledgeV2Citation {
  meeting_id: string;
  quote: string;
}

export interface KnowledgeV2EvidenceQuality {
  mode: KnowledgeV2EvidenceMode;
  confidence: number;
  cited_meeting_count: number;
  source_count: number;
  last_reinforced_at: string | null;
  freshness: KnowledgeV2Freshness;
}

export interface KnowledgeV2Item {
  id: string;
  title: string;
  summary: string;
  kind: KnowledgeV2ItemKind;
  severity: KnowledgeV2Severity;
  why_now: string;
  stream_ids: string[];
  citations: KnowledgeV2Citation[];
  evidence_quality: KnowledgeV2EvidenceQuality;
}

export interface KnowledgeV2Stream {
  id: string;
  title: string;
  domain: KnowledgeV2Domain;
  status: string;
  current_read: string;
  last_touched_at: string | null;
  source_count: number;
  open_follow_up_count: number;
  decision_count: number;
  unresolved_question_count: number;
  pinned: boolean;
  evidence_quality: KnowledgeV2EvidenceQuality;
}

export interface KnowledgeV2EvidenceEntry {
  id: string;
  meeting_id: string;
  meeting_title: string;
  captured_at: string | null;
  quote: string;
  stream_ids: string[];
  item_ids: string[];
  mode: KnowledgeV2EvidenceMode;
  confidence: number;
}

export interface KnowledgeV2SourceQualityRecord {
  meeting_id: string;
  title: string;
  usable: boolean;
  domain: KnowledgeV2Domain;
  score: number;
  reasons: string[];
}

export interface KnowledgeV2SourceQualitySummary {
  included_count: number;
  excluded_count: number;
  weak_count: number;
  records: KnowledgeV2SourceQualityRecord[];
}

export interface KnowledgeV2ChangeSummary {
  generated_at: string;
  added_count: number;
  removed_count: number;
  updated_count: number;
  notable_changes: string[];
}

export interface KnowledgeV2Document {
  schema_version: 2;
  scope: KnowledgeV2Scope;
  current_read: {
    headline: string;
    supporting_bullets: string[];
    freshness: KnowledgeV2Freshness;
    source_count: number;
    cited_item_count: number;
    cited_meeting_count: number;
    trust_message: string;
    evidence_quality: KnowledgeV2EvidenceQuality;
  };
  active_streams: KnowledgeV2Stream[];
  needs_attention: KnowledgeV2Item[];
  patterns: KnowledgeV2Item[];
  risks_and_unknowns: KnowledgeV2Item[];
  evidence_index: KnowledgeV2EvidenceEntry[];
  source_quality_summary: KnowledgeV2SourceQualitySummary;
  change_summary: KnowledgeV2ChangeSummary;
}

export interface KnowledgeV2SourceMeeting {
  id: string;
  title: string;
  occurred_at: string | null;
  evidence: string;
  duration_seconds?: number | null;
  analysis_format_pass?: boolean | number | null;
  enhanced_notes?: string | null;
  user_notes?: string | null;
  entity_names?: string[];
}

export interface KnowledgeV2Correction {
  target_kind: 'source' | 'stream' | 'item';
  target_id: string;
  action:
    | 'exclude_source'
    | 'rename_stream'
    | 'merge_stream'
    | 'split_stream'
    | 'pin_stream'
    | 'promote_item'
    | 'demote_item'
    | 'correct_classification';
  payload_json: string | null;
  created_at: string;
}

const normalizeText = (value: unknown): string =>
  value == null ? '' : String(value).toLowerCase().replace(/\s+/g, ' ').trim();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isEvidenceQuality = (
  value: unknown,
): value is KnowledgeV2EvidenceQuality =>
  isRecord(value) &&
  typeof value.mode === 'string' &&
  typeof value.confidence === 'number' &&
  typeof value.cited_meeting_count === 'number' &&
  typeof value.source_count === 'number' &&
  (typeof value.last_reinforced_at === 'string' ||
    value.last_reinforced_at === null) &&
  typeof value.freshness === 'string';

const isCitation = (value: unknown): value is KnowledgeV2Citation =>
  isRecord(value) &&
  typeof value.meeting_id === 'string' &&
  typeof value.quote === 'string';

const isStream = (value: unknown): value is KnowledgeV2Stream =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.title === 'string' &&
  typeof value.domain === 'string' &&
  typeof value.status === 'string' &&
  typeof value.current_read === 'string' &&
  (typeof value.last_touched_at === 'string' ||
    value.last_touched_at === null) &&
  typeof value.source_count === 'number' &&
  typeof value.open_follow_up_count === 'number' &&
  typeof value.decision_count === 'number' &&
  typeof value.unresolved_question_count === 'number' &&
  typeof value.pinned === 'boolean' &&
  isEvidenceQuality(value.evidence_quality);

const isItem = (value: unknown): value is KnowledgeV2Item =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.title === 'string' &&
  typeof value.summary === 'string' &&
  typeof value.kind === 'string' &&
  typeof value.severity === 'string' &&
  typeof value.why_now === 'string' &&
  Array.isArray(value.stream_ids) &&
  value.stream_ids.every((streamId) => typeof streamId === 'string') &&
  Array.isArray(value.citations) &&
  value.citations.every(isCitation) &&
  isEvidenceQuality(value.evidence_quality);

const isEvidenceEntry = (value: unknown): value is KnowledgeV2EvidenceEntry =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.meeting_id === 'string' &&
  typeof value.meeting_title === 'string' &&
  (typeof value.captured_at === 'string' || value.captured_at === null) &&
  typeof value.quote === 'string' &&
  Array.isArray(value.stream_ids) &&
  value.stream_ids.every((streamId) => typeof streamId === 'string') &&
  Array.isArray(value.item_ids) &&
  value.item_ids.every((itemId) => typeof itemId === 'string') &&
  typeof value.mode === 'string' &&
  typeof value.confidence === 'number';

const isSourceQualityRecord = (
  value: unknown,
): value is KnowledgeV2SourceQualityRecord =>
  isRecord(value) &&
  typeof value.meeting_id === 'string' &&
  typeof value.title === 'string' &&
  typeof value.usable === 'boolean' &&
  typeof value.domain === 'string' &&
  typeof value.score === 'number' &&
  Array.isArray(value.reasons) &&
  value.reasons.every((reason) => typeof reason === 'string');

const filterArray = <T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
): T[] => (Array.isArray(value) ? value.filter(predicate) : []);

const sanitizeKnowledgeCollections = (doc: KnowledgeV2Document) => ({
  activeStreams: filterArray(doc.active_streams, isStream),
  attention: filterArray(doc.needs_attention, isItem),
  patterns: filterArray(doc.patterns, isItem),
  risks: filterArray(doc.risks_and_unknowns, isItem),
  evidence: filterArray(doc.evidence_index, isEvidenceEntry),
  records: filterArray(
    doc.source_quality_summary?.records,
    isSourceQualityRecord,
  ),
});

const normalizeId = (value: string): string =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const clipText = (value: string, maxLength: number): string => {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
};

const extractEvidenceItems = (evidence: string, label: string): string[] => {
  const pattern = new RegExp(
    `${label}:\\s*([\\s\\S]*?)(?=\\n(?:Summary|Key points|Action items|Decisions|Continuity signals|Accountability risks|Decision impacts|Signal tags|Entity hints|Entity mention contexts|Transcript highlights|Context snippet|Transcript excerpt|User notes):|$)`,
    'i',
  );
  const match = evidence.match(pattern);
  if (!match?.[1]) return [];
  return match[1]
    .split(/\s+\|\s+|\n+/)
    .map((item) =>
      item
        .trim()
        .replace(/^[-*]\s+/, '')
        .replace(/^\[[ x]\]\s+/i, '')
        .replace(/^Implemented choice:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((item) => item.length >= 12);
};

export const inferKnowledgeV2Domain = (
  title: string,
  evidence = '',
): KnowledgeV2Domain => {
  const text = normalizeText(`${title} ${evidence}`);
  if (/\b(berlin|trip|travel|itinerary|flight|hotel|bike route)\b/.test(text)) {
    return 'travel';
  }
  if (
    /\b(youtube|lecture|paper|research|study|podcast|reading|rag)\b/.test(text)
  ) {
    return 'research';
  }
  if (
    /\b(family|therapy|health|doctor|personal|friend|relationship)\b/.test(text)
  ) {
    return 'personal';
  }
  if (/\b(grocery|errand|routine|chores|appointment)\b/.test(text)) {
    return 'routine';
  }
  if (
    /\b(project|api|deployment|dashboard|team|product|review|meeting|strategy|launch)\b/.test(
      text,
    )
  ) {
    return 'work';
  }
  return 'unknown';
};

export const scoreKnowledgeV2Source = (
  source: KnowledgeV2SourceMeeting,
): KnowledgeV2SourceQualityRecord => {
  const title = source.title.trim() || 'Untitled Session';
  const normalizedTitle = normalizeText(title);
  const evidenceLength = source.evidence.trim().length;
  const notesLength =
    (source.enhanced_notes || '').trim().length +
    (source.user_notes || '').trim().length;
  const duration = Math.max(0, Number(source.duration_seconds || 0));
  const reasons: string[] = [];
  let score = 0;
  const hasMeaningfulNotes = notesLength >= 80;
  const hasMeaningfulEvidence = evidenceLength >= 140;
  const defaultTitles = ['new meeting', 'meeting', 'meeting (mic only)'];
  const throwawayTitles = [
    'test',
    'testing',
    'test meeting',
    'audio test',
    'mic test',
    'microphone test',
    'transcription test',
    'recording test',
  ];

  if (throwawayTitles.includes(normalizedTitle)) {
    reasons.push('throwaway_title');
    score -= 5;
  }
  if (defaultTitles.includes(normalizedTitle)) {
    if (hasMeaningfulNotes || hasMeaningfulEvidence) {
      reasons.push('default_title_with_notes');
      score -= 1;
    } else {
      reasons.push('throwaway_title');
      score -= 5;
    }
  }

  if (duration >= 120) score += 2;
  else if (duration > 0) {
    reasons.push('short_duration');
    score -= 1;
  }

  if (source.analysis_format_pass) score += 2;
  if (hasMeaningfulEvidence) score += 4;
  else if (evidenceLength > 0) score += 1;
  if (hasMeaningfulNotes) score += 4;
  if ((source.entity_names || []).length >= 2) score += 1;

  const usable = score >= 2 && !reasons.includes('throwaway_title');
  if (!usable && reasons.length === 0) reasons.push('thin_source');

  return {
    meeting_id: source.id,
    title,
    usable,
    domain: inferKnowledgeV2Domain(title, source.evidence),
    score,
    reasons,
  };
};

export const classifyKnowledgeV2Item = (text: string): KnowledgeV2ItemKind => {
  const normalized = normalizeText(text);
  if (/\bpending\b.*\bapproval\b|\bapproval\b.*\bpending\b/.test(normalized)) {
    return 'blocker';
  }
  if (
    /\b(blocks?|blocked|blocker|blocking|cannot proceed|prevents)\b/.test(
      normalized,
    )
  ) {
    return 'blocker';
  }
  if (
    /\b(risk|missing owner|unclear owner|failure|delay|coordination risk)\b/.test(
      normalized,
    )
  ) {
    return 'risk';
  }
  if (
    /\b(depends on|dependency|pending approval|approval is still pending)\b/.test(
      normalized,
    )
  ) {
    return 'dependency';
  }
  if (
    /\?$|\b(open question|unclear|unknown|needs clarification)\b/.test(
      normalized,
    )
  ) {
    return 'open_question';
  }
  if (
    /^(confirm|review|research|prepare|send|schedule|follow up|create|update|resolve|check|clarify)\b/.test(
      normalized,
    )
  ) {
    return 'follow_up';
  }
  if (/\b(decided|decision|use |adopt|ship|prioritize)\b/.test(normalized)) {
    return 'decision';
  }
  if (
    /\b(repeated|multiple|keeps returning|pattern|trend)\b/.test(normalized)
  ) {
    return 'pattern';
  }
  return 'reference_context';
};

const severityForKind = (kind: KnowledgeV2ItemKind): KnowledgeV2Severity => {
  if (kind === 'blocker' || kind === 'risk') return 'needs_attention';
  if (
    kind === 'follow_up' ||
    kind === 'dependency' ||
    kind === 'open_question' ||
    kind === 'stale_context'
  ) {
    return 'watch';
  }
  return 'steady';
};

const ATTENTION_ITEM_KINDS = new Set<KnowledgeV2ItemKind>([
  'follow_up',
  'dependency',
  'open_question',
  'risk',
  'blocker',
]);

const validKnowledgeV2Kinds = new Set<KnowledgeV2ItemKind>([
  'decision',
  'follow_up',
  'risk',
  'blocker',
  'dependency',
  'open_question',
  'pattern',
  'reference_context',
  'stale_context',
  'low_confidence',
]);

const freshnessForDate = (date: string | null): KnowledgeV2Freshness => {
  if (!date) return 'unknown';
  const timestamp = new Date(date).getTime();
  if (Number.isNaN(timestamp)) return 'unknown';
  const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  if (ageDays <= 14) return 'fresh';
  if (ageDays <= 45) return 'aging';
  return 'stale';
};

const evidenceQuality = (params: {
  mode?: KnowledgeV2EvidenceMode;
  confidence?: number;
  citedMeetingIds: string[];
  sourceCount: number;
  lastReinforcedAt: string | null;
}): KnowledgeV2EvidenceQuality => ({
  mode: params.mode || 'direct',
  confidence:
    params.confidence ??
    Math.min(0.95, 0.55 + params.citedMeetingIds.length * 0.12),
  cited_meeting_count: new Set(params.citedMeetingIds).size,
  source_count: params.sourceCount,
  last_reinforced_at: params.lastReinforcedAt,
  freshness: freshnessForDate(params.lastReinforcedAt),
});

const streamTitleForSource = (source: KnowledgeV2SourceMeeting): string => {
  const entity = (source.entity_names || []).find(
    (name) => name.trim().length > 2,
  );
  if (entity) return entity.trim();
  return (
    source.title
      .replace(/\b(review|meeting|notes|planning|sync)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || source.title
  );
};

const makeItem = (params: {
  source: KnowledgeV2SourceMeeting;
  streamId: string;
  text: string;
  fallbackKind?: KnowledgeV2ItemKind;
  index: number;
  sourceCount: number;
}): KnowledgeV2Item => {
  const inferredKind = classifyKnowledgeV2Item(params.text);
  const kind =
    inferredKind === 'reference_context' && params.fallbackKind
      ? params.fallbackKind
      : inferredKind;
  const title = clipText(params.text.replace(/\.$/, ''), 140);
  return {
    id: `${params.streamId}-${kind}-${params.index}`,
    title,
    summary: title.endsWith('.') ? title : `${title}.`,
    kind,
    severity: severityForKind(kind),
    why_now:
      kind === 'follow_up'
        ? 'This is an unresolved follow-up captured from source material.'
        : kind === 'blocker' || kind === 'risk'
          ? 'This may affect an active stream and has cited evidence.'
          : 'This is grounded context Pluto can trace back to source material.',
    stream_ids: [params.streamId],
    citations: [
      { meeting_id: params.source.id, quote: clipText(params.text, 220) },
    ],
    evidence_quality: evidenceQuality({
      citedMeetingIds: [params.source.id],
      sourceCount: params.sourceCount,
      lastReinforcedAt: params.source.occurred_at,
    }),
  };
};

type SummaryObservation = {
  text: string;
  source: KnowledgeV2SourceMeeting;
  streamId: string;
};

const normalizedTheme = (value: string): string =>
  normalizeText(value)
    .replace(
      /^(the team discussed|the user is planning|discussion about)\s+/,
      '',
    )
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const newestDate = (
  left: string | null,
  right: string | null,
): string | null => {
  if (!left) return right;
  if (!right) return left;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return rightTime > leftTime ? right : left;
};

const buildRepeatedPatterns = (
  observations: SummaryObservation[],
  startIndex: number,
  sourceCountByStream: Map<string, number>,
): KnowledgeV2Item[] => {
  const grouped = new Map<string, SummaryObservation[]>();
  for (const observation of observations) {
    const key = normalizedTheme(observation.text);
    if (key.length < 16) continue;
    grouped.set(key, [...(grouped.get(key) || []), observation]);
  }

  const patterns: KnowledgeV2Item[] = [];
  let index = startIndex;
  for (const group of grouped.values()) {
    const sourceIds = Array.from(new Set(group.map((item) => item.source.id)));
    if (sourceIds.length < 2) continue;
    const streamIds = Array.from(new Set(group.map((item) => item.streamId)));
    const lastReinforcedAt = group.reduce<string | null>(
      (latest, item) => newestDate(latest, item.source.occurred_at),
      null,
    );
    const title = clipText(group[0].text.replace(/\.$/, ''), 140);
    patterns.push({
      id: `${streamIds[0] || 'global'}-pattern-${index++}`,
      title,
      summary: `${title} appears across ${sourceIds.length} sources.`,
      kind: 'pattern',
      severity: 'steady',
      why_now:
        'This theme appears across multiple source captures, so Pluto is treating it as a pattern rather than a one-off note.',
      stream_ids: streamIds,
      citations: group.slice(0, 4).map((item) => ({
        meeting_id: item.source.id,
        quote: clipText(item.text, 220),
      })),
      evidence_quality: evidenceQuality({
        mode: 'inferred',
        citedMeetingIds: sourceIds,
        sourceCount: streamIds.reduce(
          (sum, streamId) => sum + (sourceCountByStream.get(streamId) || 0),
          0,
        ),
        lastReinforcedAt,
      }),
    });
  }

  return patterns.sort(
    (a, b) =>
      b.evidence_quality.cited_meeting_count -
      a.evidence_quality.cited_meeting_count,
  );
};

const headlineForDocument = (
  streams: KnowledgeV2Stream[],
  attention: KnowledgeV2Item[],
  patterns: KnowledgeV2Item[],
): string => {
  const topAttentionByStream = new Map<string, KnowledgeV2Item>();
  for (const item of attention) {
    const streamId = item.stream_ids[0];
    if (!streamId || topAttentionByStream.has(streamId)) continue;
    topAttentionByStream.set(streamId, item);
  }

  const streamReads = streams.slice(0, 3).map((stream) => {
    const attentionItem = topAttentionByStream.get(stream.id);
    const read = attentionItem?.title || stream.current_read;
    return `${stream.title}: ${read}`;
  });

  if (streamReads.length >= 2) {
    return `${streamReads[0]}; ${streamReads[1]}.`;
  }
  if (patterns[0]) {
    return patterns[0].title;
  }
  return (
    streamReads[0] ||
    'Pluto has source material, but no trustworthy current read yet.'
  );
};

const parseCorrectionPayload = (
  payloadJson: string | null,
): Record<string, unknown> | null => {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

type KnowledgeV2OverlayItemState = {
  item: KnowledgeV2Item;
  originalIndex: number;
  forceAttention: boolean | null;
};

export const applyKnowledgeCorrectionsToDocument = (
  doc: KnowledgeV2Document,
  corrections: KnowledgeV2Correction[],
): KnowledgeV2Document => {
  if (corrections.length === 0) return doc;

  const activeStreams = doc.active_streams.map((stream) => ({ ...stream }));
  const patternItems = doc.patterns.map((item, index) => ({
    item: { ...item },
    originalIndex: index,
    forceAttention: null,
  }));
  const riskItems = doc.risks_and_unknowns.map((item, index) => ({
    item: { ...item },
    originalIndex: doc.patterns.length + index,
    forceAttention: null,
  }));
  const attentionItems = doc.needs_attention.map((item, index) => ({
    item: { ...item },
    originalIndex: doc.patterns.length + doc.risks_and_unknowns.length + index,
    forceAttention: null,
  }));

  const itemStates = new Map<string, KnowledgeV2OverlayItemState>();
  for (const state of [...patternItems, ...riskItems, ...attentionItems]) {
    const existing = itemStates.get(state.item.id);
    if (existing) {
      existing.forceAttention ??= state.forceAttention;
      continue;
    }
    itemStates.set(state.item.id, state);
  }

  const orderedCorrections = [...corrections].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );

  for (const correction of orderedCorrections) {
    if (correction.target_kind === 'stream') {
      const stream = activeStreams.find(
        (item) => item.id === correction.target_id,
      );
      if (!stream) continue;

      if (correction.action === 'rename_stream') {
        const payload = parseCorrectionPayload(correction.payload_json);
        const candidate = [
          payload?.title,
          payload?.new_title,
          payload?.name,
          payload?.rename_to,
        ].find((value) => typeof value === 'string' && value.trim().length > 0);
        if (typeof candidate === 'string') {
          stream.title = clipText(candidate, 90);
        }
      }

      if (correction.action === 'pin_stream') {
        stream.pinned = true;
      }
      continue;
    }

    if (correction.target_kind !== 'item') continue;
    const state = itemStates.get(correction.target_id);
    if (!state) continue;

    if (correction.action === 'promote_item') {
      state.forceAttention = true;
      continue;
    }

    if (correction.action === 'demote_item') {
      state.forceAttention = false;
      continue;
    }

    if (correction.action === 'correct_classification') {
      const payload = parseCorrectionPayload(correction.payload_json);
      const candidate = payload?.kind;
      if (
        typeof candidate === 'string' &&
        validKnowledgeV2Kinds.has(candidate as KnowledgeV2ItemKind)
      ) {
        const kind = candidate as KnowledgeV2ItemKind;
        state.item.kind = kind;
        state.item.severity = severityForKind(kind);
      }
    }
  }

  const overlayItems = Array.from(itemStates.values());
  const promotedAttention = overlayItems
    .filter((state) => state.forceAttention === true)
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map((state) => state.item);
  const defaultAttention = overlayItems
    .filter(
      (state) =>
        state.forceAttention !== false &&
        state.forceAttention !== true &&
        ATTENTION_ITEM_KINDS.has(state.item.kind),
    )
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map((state) => state.item);

  const activeStreamsSorted = [...activeStreams].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (right.source_count !== left.source_count) {
      return right.source_count - left.source_count;
    }
    return (right.last_touched_at || '').localeCompare(
      left.last_touched_at || '',
    );
  });

  return {
    ...doc,
    current_read: {
      ...doc.current_read,
      supporting_bullets: activeStreamsSorted
        .slice(0, 3)
        .map((stream) => `${stream.title}: ${stream.current_read}`),
    },
    active_streams: activeStreamsSorted,
    needs_attention: dedupeBy(
      [...promotedAttention, ...defaultAttention],
      (item) => item.id,
    ).slice(0, 12),
    patterns: overlayItems
      .filter((state) => state.item.kind === 'pattern')
      .sort((left, right) => left.originalIndex - right.originalIndex)
      .map((state) => state.item)
      .slice(0, 12),
    risks_and_unknowns: overlayItems
      .filter(
        (state) => state.item.kind === 'risk' || state.item.kind === 'blocker',
      )
      .sort((left, right) => left.originalIndex - right.originalIndex)
      .map((state) => state.item)
      .slice(0, 12),
  };
};

const WEAK_HEADLINE_PATTERN =
  /^(the team discusses|the team discussed|the meeting opened|the conversation revolves|conversation captured|the user is planning)\b/i;

const WEAK_STREAM_TITLE_PATTERN =
  /^(you|me|i|them|they|we|someone|language|conversation|topic|unknown|none specified|not specified|aldo|adam)$/i;

const WEAK_STREAM_READ_PATTERN =
  /^(conversation captured|key themes and follow-ups are summarized|the conversation revolves|the team discusses|discussion about)\b/i;

const titleFromRead = (value: string): string | null => {
  const cleaned = value
    .replace(/\.$/, '')
    .replace(/^current read:\s*/i, '')
    .trim();
  if (cleaned.length < 8 || cleaned.length > 90) return null;
  if (WEAK_STREAM_READ_PATTERN.test(cleaned)) return null;
  if (!/[A-Z]/.test(cleaned)) return null;
  return cleaned;
};

const repairStream = (stream: KnowledgeV2Stream): KnowledgeV2Stream | null => {
  if (WEAK_STREAM_READ_PATTERN.test(stream.current_read.trim())) return null;
  const replacement = WEAK_STREAM_TITLE_PATTERN.test(stream.title.trim())
    ? titleFromRead(stream.current_read)
    : null;
  if (replacement) {
    return {
      ...stream,
      id: normalizeId(replacement) || stream.id,
      title: replacement,
    };
  }
  if (WEAK_STREAM_TITLE_PATTERN.test(stream.title.trim())) return null;
  return stream;
};

export const repairKnowledgeV2Document = (
  doc: KnowledgeV2Document,
  fallback?: KnowledgeV2Document | null,
): KnowledgeV2Document => {
  const rawChangeSummary = isRecord(
    (doc as unknown as Record<string, unknown>).change_summary,
  )
    ? ((doc as unknown as Record<string, unknown>).change_summary as Record<
        string,
        unknown
      >)
    : {};
  const normalizedCount = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : 0;
  const changeSummary: KnowledgeV2ChangeSummary = {
    generated_at:
      typeof rawChangeSummary.generated_at === 'string'
        ? rawChangeSummary.generated_at
        : new Date().toISOString(),
    added_count: normalizedCount(rawChangeSummary.added_count),
    removed_count: normalizedCount(rawChangeSummary.removed_count),
    updated_count: normalizedCount(rawChangeSummary.updated_count),
    notable_changes: Array.isArray(rawChangeSummary.notable_changes)
      ? rawChangeSummary.notable_changes.filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
  };
  const sanitized = sanitizeKnowledgeCollections(doc);
  const repairedStreams = sanitized.activeStreams
    .map(repairStream)
    .filter((stream): stream is KnowledgeV2Stream => Boolean(stream));
  const activeStreams =
    repairedStreams.length > 0
      ? repairedStreams
      : fallback?.active_streams || [];
  const patterns = sanitized.patterns.filter(
    (pattern) =>
      pattern.evidence_quality.cited_meeting_count >= 2 ||
      /\b(repeated|multiple|recurring|again|across)\b/i.test(
        `${pattern.title} ${pattern.why_now}`,
      ),
  );
  const headlineIsWeak =
    WEAK_HEADLINE_PATTERN.test(doc.current_read.headline.trim()) ||
    doc.current_read.headline.length > 170;
  const headline = headlineIsWeak
    ? headlineForDocument(
        activeStreams,
        sanitized.attention.length > 0
          ? sanitized.attention
          : fallback?.needs_attention || [],
        patterns.length > 0 ? patterns : fallback?.patterns || [],
      )
    : doc.current_read.headline;

  return {
    ...doc,
    current_read: {
      ...doc.current_read,
      headline,
      supporting_bullets:
        activeStreams.length > 0
          ? activeStreams
              .slice(0, 3)
              .map((stream) => `${stream.title}: ${stream.current_read}`)
          : doc.current_read.supporting_bullets,
    },
    active_streams: activeStreams,
    needs_attention: sanitized.attention,
    patterns,
    risks_and_unknowns: sanitized.risks,
    evidence_index: sanitized.evidence,
    source_quality_summary: {
      ...doc.source_quality_summary,
      records: sanitized.records,
    },
    change_summary: changeSummary,
  };
};

const getStreamUrgencyCounts = (
  attentionItems: KnowledgeV2Item[],
): Map<
  string,
  { blockerRisk: number; dependency: number; openQuestion: number }
> => {
  const counts = new Map<
    string,
    { blockerRisk: number; dependency: number; openQuestion: number }
  >();

  for (const item of attentionItems) {
    for (const streamId of item.stream_ids) {
      const existing = counts.get(streamId) || {
        blockerRisk: 0,
        dependency: 0,
        openQuestion: 0,
      };
      if (item.kind === 'blocker' || item.kind === 'risk') {
        existing.blockerRisk += 1;
      } else if (item.kind === 'dependency') {
        existing.dependency += 1;
      } else if (item.kind === 'open_question') {
        existing.openQuestion += 1;
      }
      counts.set(streamId, existing);
    }
  }

  return counts;
};

const scoreActiveStreamPriority = (
  stream: KnowledgeV2Stream,
  counts: { blockerRisk: number; dependency: number; openQuestion: number },
): number =>
  counts.blockerRisk * 10 +
  stream.open_follow_up_count * 6 +
  counts.dependency * 4 +
  counts.openQuestion * 2 +
  stream.decision_count * 2 +
  stream.source_count;

const compareActiveStreams = (
  a: KnowledgeV2Stream,
  b: KnowledgeV2Stream,
  urgencyByStream: Map<
    string,
    { blockerRisk: number; dependency: number; openQuestion: number }
  >,
): number => {
  const aScore = scoreActiveStreamPriority(
    a,
    urgencyByStream.get(a.id) || {
      blockerRisk: 0,
      dependency: 0,
      openQuestion: 0,
    },
  );
  const bScore = scoreActiveStreamPriority(
    b,
    urgencyByStream.get(b.id) || {
      blockerRisk: 0,
      dependency: 0,
      openQuestion: 0,
    },
  );

  if (bScore !== aScore) return bScore - aScore;
  if (b.source_count !== a.source_count) return b.source_count - a.source_count;
  if ((b.last_touched_at || '') !== (a.last_touched_at || '')) {
    return (b.last_touched_at || '').localeCompare(a.last_touched_at || '');
  }
  return a.title.localeCompare(b.title);
};

export const buildDeterministicKnowledgeV2Document = (
  scope: KnowledgeV2Scope,
  sources: KnowledgeV2SourceMeeting[],
): KnowledgeV2Document => {
  const sourceRecords = sources.map(scoreKnowledgeV2Source);
  const usableSources = sources.filter(
    (source) =>
      sourceRecords.find((record) => record.meeting_id === source.id)?.usable,
  );
  const streams = new Map<string, KnowledgeV2Stream>();
  const streamSourceIds = new Map<string, Set<string>>();
  const summaryObservations: SummaryObservation[] = [];
  const attention: KnowledgeV2Item[] = [];
  const risks: KnowledgeV2Item[] = [];
  const evidenceIndex: KnowledgeV2EvidenceEntry[] = [];
  let itemIndex = 0;

  for (const source of usableSources) {
    const streamTitle = streamTitleForSource(source);
    const streamId = normalizeId(streamTitle || source.id) || source.id;
    const record = sourceRecords.find((item) => item.meeting_id === source.id);
    const existing = streams.get(streamId);
    const sourceIds = streamSourceIds.get(streamId) || new Set<string>();
    sourceIds.add(source.id);
    streamSourceIds.set(streamId, sourceIds);
    const sourceCount = sourceIds.size;
    const decisions = extractEvidenceItems(source.evidence, 'Decisions').filter(
      (decision) => !/\bno explicit decisions?\b|\bnone\b/i.test(decision),
    );
    const actions = extractEvidenceItems(source.evidence, 'Action items');
    const accountability = extractEvidenceItems(
      source.evidence,
      'Accountability risks',
    );
    const summaries = [
      ...extractEvidenceItems(source.evidence, 'Summary'),
      ...extractEvidenceItems(source.evidence, 'Key points'),
      ...extractEvidenceItems(source.evidence, 'Continuity signals'),
    ];

    const currentRead =
      summaries[0] || actions[0] || decisions[0] || source.title;
    streams.set(streamId, {
      id: streamId,
      title: streamTitle,
      domain: record?.domain || 'unknown',
      status: actions.length || accountability.length ? 'active' : 'steady',
      current_read: clipText(currentRead, 220),
      last_touched_at: newestDate(
        existing?.last_touched_at || null,
        source.occurred_at,
      ),
      source_count: sourceCount,
      open_follow_up_count:
        (existing?.open_follow_up_count || 0) + actions.length,
      decision_count: (existing?.decision_count || 0) + decisions.length,
      unresolved_question_count: existing?.unresolved_question_count || 0,
      pinned: false,
      evidence_quality: evidenceQuality({
        citedMeetingIds: Array.from(sourceIds),
        sourceCount,
        lastReinforcedAt: newestDate(
          existing?.last_touched_at || null,
          source.occurred_at,
        ),
      }),
    });

    for (const text of [...actions, ...accountability, ...decisions]) {
      const item = makeItem({
        source,
        streamId,
        text,
        fallbackKind: decisions.includes(text) ? 'decision' : undefined,
        index: itemIndex++,
        sourceCount,
      });
      if (item.kind === 'risk' || item.kind === 'blocker') risks.push(item);
      if (
        item.kind === 'follow_up' ||
        item.kind === 'dependency' ||
        item.kind === 'open_question' ||
        item.kind === 'risk' ||
        item.kind === 'blocker'
      ) {
        attention.push(item);
      }
    }

    for (const text of summaries) {
      summaryObservations.push({ text, source, streamId });
    }

    const evidenceText =
      summaries[0] || decisions[0] || actions[0] || source.evidence;
    if (evidenceText) {
      evidenceIndex.push({
        id: `evidence-${source.id}`,
        meeting_id: source.id,
        meeting_title: source.title,
        captured_at: source.occurred_at,
        quote: clipText(evidenceText, 260),
        stream_ids: [streamId],
        item_ids: [...attention, ...risks]
          .filter((item) => item.stream_ids.includes(streamId))
          .map((item) => item.id),
        mode: 'direct',
        confidence: 0.78,
      });
    }
  }

  const urgencyByStream = getStreamUrgencyCounts(attention);
  const activeStreams = Array.from(streams.values()).sort((a, b) =>
    compareActiveStreams(a, b, urgencyByStream),
  );
  const citedMeetingIds = new Set(
    evidenceIndex.map((entry) => entry.meeting_id),
  );
  const sourceCountByStream = new Map(
    activeStreams.map((stream) => [stream.id, stream.source_count]),
  );
  const patterns = buildRepeatedPatterns(
    summaryObservations,
    itemIndex,
    sourceCountByStream,
  );
  itemIndex += patterns.length;
  const headline = headlineForDocument(activeStreams, attention, patterns);

  return {
    schema_version: KNOWLEDGE_V2_SCHEMA_VERSION,
    scope,
    current_read: {
      headline,
      supporting_bullets: activeStreams
        .slice(0, 3)
        .map((stream) => `${stream.title}: ${stream.current_read}`),
      freshness: evidenceQuality({
        citedMeetingIds: Array.from(citedMeetingIds),
        sourceCount: usableSources.length,
        lastReinforcedAt: usableSources[0]?.occurred_at || null,
      }).freshness,
      source_count: usableSources.length,
      cited_item_count: attention.length + patterns.length + risks.length,
      cited_meeting_count: citedMeetingIds.size,
      trust_message:
        usableSources.length >= 2
          ? 'This brief is grounded in multiple usable sources.'
          : 'Evidence is thin; Pluto is showing the best cited context available.',
      evidence_quality: evidenceQuality({
        mode: citedMeetingIds.size > 1 ? 'inferred' : 'direct',
        citedMeetingIds: Array.from(citedMeetingIds),
        sourceCount: usableSources.length,
        lastReinforcedAt: usableSources[0]?.occurred_at || null,
      }),
    },
    active_streams: activeStreams,
    needs_attention: attention
      .sort((a, b) => a.severity.localeCompare(b.severity))
      .slice(0, 12),
    patterns: patterns.slice(0, 12),
    risks_and_unknowns: risks.slice(0, 12),
    evidence_index: evidenceIndex,
    source_quality_summary: {
      included_count: sourceRecords.filter((record) => record.usable).length,
      excluded_count: sourceRecords.filter((record) => !record.usable).length,
      weak_count: sourceRecords.filter(
        (record) => record.score > 0 && record.score < 4,
      ).length,
      records: sourceRecords,
    },
    change_summary: {
      generated_at: new Date().toISOString(),
      added_count: attention.length + patterns.length + activeStreams.length,
      removed_count: 0,
      updated_count: 0,
      notable_changes: activeStreams.slice(0, 3).map((stream) => stream.title),
    },
  };
};

const dedupeBy = <T>(items: T[], getKey: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
};

export const mergeKnowledgeV2Documents = (
  scope: KnowledgeV2Scope,
  documents: KnowledgeV2Document[],
): KnowledgeV2Document => {
  const sanitizedDocuments = documents.map(sanitizeKnowledgeCollections);
  const streams = dedupeBy(
    sanitizedDocuments.flatMap((doc) => doc.activeStreams),
    (stream) => stream.id,
  );
  const attention = dedupeBy(
    sanitizedDocuments.flatMap((doc) => doc.attention),
    (item) => normalizeText(item.title),
  );
  const patterns = dedupeBy(
    sanitizedDocuments.flatMap((doc) => doc.patterns),
    (item) => normalizeText(item.title),
  );
  const risks = dedupeBy(
    sanitizedDocuments.flatMap((doc) => doc.risks),
    (item) => normalizeText(item.title),
  );
  const evidence = dedupeBy(
    sanitizedDocuments.flatMap((doc) => doc.evidence),
    (entry) => {
      const meetingId = normalizeText(entry.meeting_id);
      const quote = normalizeText(entry.quote);
      return meetingId && quote ? `${meetingId}|${quote}` : '';
    },
  );
  const records = dedupeBy(
    sanitizedDocuments.flatMap((doc) => doc.records),
    (record) => record.meeting_id,
  );
  const citedMeetingIds = new Set(evidence.map((entry) => entry.meeting_id));
  const urgencyByStream = getStreamUrgencyCounts(attention);
  const rankedStreams = [...streams].sort((a, b) =>
    compareActiveStreams(a, b, urgencyByStream),
  );

  return {
    schema_version: KNOWLEDGE_V2_SCHEMA_VERSION,
    scope,
    current_read: {
      headline:
        patterns[0]?.title ||
        attention[0]?.title ||
        rankedStreams[0]?.current_read ||
        'Pluto has source material, but no trustworthy current read yet.',
      supporting_bullets: rankedStreams
        .slice(0, 4)
        .map((stream) => `${stream.title}: ${stream.current_read}`),
      freshness: rankedStreams[0]?.evidence_quality.freshness || 'unknown',
      source_count: records.filter((record) => record.usable).length,
      cited_item_count: attention.length + patterns.length + risks.length,
      cited_meeting_count: citedMeetingIds.size,
      trust_message:
        citedMeetingIds.size >= 2
          ? 'This brief is grounded in multiple cited sources.'
          : 'Evidence is thin; Pluto is showing the best cited context available.',
      evidence_quality: evidenceQuality({
        mode: citedMeetingIds.size > 1 ? 'inferred' : 'direct',
        citedMeetingIds: Array.from(citedMeetingIds),
        sourceCount: records.filter((record) => record.usable).length,
        lastReinforcedAt: rankedStreams[0]?.last_touched_at || null,
      }),
    },
    active_streams: rankedStreams,
    needs_attention: attention,
    patterns,
    risks_and_unknowns: risks,
    evidence_index: evidence,
    source_quality_summary: {
      included_count: records.filter((record) => record.usable).length,
      excluded_count: records.filter((record) => !record.usable).length,
      weak_count: records.filter(
        (record) => record.score > 0 && record.score < 4,
      ).length,
      records,
    },
    change_summary: {
      generated_at: new Date().toISOString(),
      added_count: attention.length + patterns.length + rankedStreams.length,
      removed_count: 0,
      updated_count: 0,
      notable_changes: rankedStreams.slice(0, 3).map((stream) => stream.title),
    },
  };
};

export const isKnowledgeV2Document = (
  value: unknown,
): value is KnowledgeV2Document => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const currentRead = record.current_read;
  return (
    record.schema_version === KNOWLEDGE_V2_SCHEMA_VERSION &&
    isRecord(currentRead) &&
    typeof currentRead.headline === 'string' &&
    Array.isArray(currentRead.supporting_bullets) &&
    Array.isArray(record.active_streams) &&
    Array.isArray(record.needs_attention) &&
    Array.isArray(record.patterns) &&
    Array.isArray(record.risks_and_unknowns) &&
    Array.isArray(record.evidence_index) &&
    isRecord(record.source_quality_summary) &&
    Array.isArray(record.source_quality_summary.records)
  );
};

export const parseKnowledgeV2Document = (
  raw: string | null | undefined,
): KnowledgeV2Document | null => {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isKnowledgeV2Document(parsed)) return parsed;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.schema_version !== KNOWLEDGE_V2_SCHEMA_VERSION ||
      !record.current_read ||
      typeof record.current_read !== 'object'
    ) {
      return null;
    }
    const currentRead = record.current_read as Record<string, unknown>;
    return {
      schema_version: KNOWLEDGE_V2_SCHEMA_VERSION,
      scope:
        record.scope && typeof record.scope === 'object'
          ? (record.scope as KnowledgeV2Scope)
          : { type: 'global', title: 'Knowledge' },
      current_read: {
        headline:
          typeof currentRead.headline === 'string'
            ? currentRead.headline
            : 'No reliable compiled brief yet.',
        supporting_bullets: Array.isArray(currentRead.supporting_bullets)
          ? currentRead.supporting_bullets.filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
        freshness:
          typeof currentRead.freshness === 'string'
            ? (currentRead.freshness as KnowledgeV2Freshness)
            : 'unknown',
        source_count:
          typeof currentRead.source_count === 'number'
            ? currentRead.source_count
            : 0,
        cited_item_count:
          typeof currentRead.cited_item_count === 'number'
            ? currentRead.cited_item_count
            : 0,
        cited_meeting_count:
          typeof currentRead.cited_meeting_count === 'number'
            ? currentRead.cited_meeting_count
            : 0,
        trust_message:
          typeof currentRead.trust_message === 'string'
            ? currentRead.trust_message
            : 'Evidence quality is not available yet.',
        evidence_quality: evidenceQuality({
          citedMeetingIds: [],
          sourceCount: 0,
          lastReinforcedAt: null,
        }),
      },
      active_streams: [],
      needs_attention: [],
      patterns: [],
      risks_and_unknowns: [],
      evidence_index: [],
      source_quality_summary: {
        included_count: 0,
        excluded_count: 0,
        weak_count: 0,
        records: [],
      },
      change_summary: {
        generated_at: new Date().toISOString(),
        added_count: 0,
        removed_count: 0,
        updated_count: 0,
        notable_changes: [],
      },
    };
  } catch {
    return null;
  }
};

export const shouldHardResetKnowledgeDoc = (doc: {
  structured_json: string | null;
  config: string | null;
}): boolean => {
  if (!parseKnowledgeV2Document(doc.structured_json)) return true;
  if (!doc.config) return true;
  try {
    const parsed = JSON.parse(doc.config) as { synthesis_version?: number };
    return parsed.synthesis_version !== KNOWLEDGE_V2_SYNTHESIS_VERSION;
  } catch {
    return true;
  }
};

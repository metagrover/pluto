import type {
  AttentionItemKind,
  AttentionItemSeverity,
  AttentionItemStatus,
  AttentionScoreBreakdown,
  AttentionScoreInput,
  AttentionScoreResult,
} from './intelligenceTypes';

const DAY_MS = 24 * 60 * 60 * 1000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number): number => Math.round(value * 1000) / 1000;

const KIND_WEIGHT: Record<AttentionItemKind, number> = {
  blocker: 0.3,
  risk: 0.24,
  dependency: 0.2,
  follow_up: 0.12,
  open_question: 0.07,
  stale_context: 0.05,
  repeated_pattern: 0.12,
  decision_conflict: 0.24,
  duplicate_commitment: 0.16,
  reference_context: 0.04,
  source_quality: 0.08,
};

const parseTime = (value?: string | null): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const inferFreshness = (
  updatedAt?: string | null,
): AttentionScoreInput['freshness'] => {
  const updated = parseTime(updatedAt);
  if (updated === null) return 'unknown';
  const ageDays = (Date.now() - updated) / DAY_MS;
  if (ageDays <= 7) return 'fresh';
  if (ageDays <= 21) return 'aging';
  return 'stale';
};

const urgencyScore = (dueAt?: string | null, now?: string): number => {
  const due = parseTime(dueAt);
  if (due === null) return 0;
  const reference = parseTime(now) ?? Date.now();
  const daysUntilDue = (due - reference) / DAY_MS;
  if (daysUntilDue <= 0) return 0.34;
  if (daysUntilDue <= 2) return 0.24;
  if (daysUntilDue <= 7) return 0.14;
  if (daysUntilDue <= 14) return 0.06;
  return 0;
};

const recencyScore = (
  freshness: AttentionScoreInput['freshness'],
  lastReinforcedAt?: string | null,
  updatedAt?: string | null,
  now?: string,
): number => {
  if (freshness === 'fresh') return 0.08;
  if (freshness === 'aging') return 0.04;
  if (freshness === 'stale') return 0;

  const reference = parseTime(now) ?? Date.now();
  const lastTouched = parseTime(lastReinforcedAt) ?? parseTime(updatedAt);
  if (lastTouched === null) return 0.02;

  const ageDays = (reference - lastTouched) / DAY_MS;
  if (ageDays <= 7) return 0.08;
  if (ageDays <= 21) return 0.04;
  return 0;
};

const repetitionScore = (
  citedMeetingCount: number,
  sourceCount: number,
): number =>
  clamp(
    Math.max(0, citedMeetingCount - 1) * 0.05 +
      Math.max(0, sourceCount - 1) * 0.04,
    0,
    0.18,
  );

const commitmentScore = (
  kind: AttentionItemKind,
  isExplicitCommitment: boolean,
): number => {
  if (isExplicitCommitment) return 0.14;
  if (kind === 'follow_up' || kind === 'duplicate_commitment') return 0.06;
  return 0;
};

const projectRelevanceScore = (relatedStreamCount: number): number =>
  clamp(relatedStreamCount * 0.04, 0, 0.08);

const evidenceScore = (
  confidence: number,
  evidenceMode: AttentionScoreInput['evidence_mode'],
  sourceCount: number,
): number => {
  const modeBase =
    evidenceMode === 'direct' ? 0.08 : evidenceMode === 'inferred' ? 0.04 : 0.02;
  return clamp(
    modeBase + clamp(confidence, 0, 1) * 0.14 + Math.max(0, sourceCount - 1) * 0.02,
    0,
    0.24,
  );
};

const feedbackScore = (status: AttentionItemStatus): number => {
  if (status === 'pinned') return 0.18;
  if (status === 'dismissed') return -0.35;
  if (status === 'resolved' || status === 'superseded') return -0.28;
  if (status === 'snoozed') return -0.08;
  return 0;
};

const stalePenalty = (freshness: AttentionScoreInput['freshness']): number => {
  if (freshness === 'stale') return 0.18;
  if (freshness === 'unknown') return 0.04;
  return 0;
};

const weakEvidencePenalty = (confidence: number): number => {
  if (confidence < 0.45) return 0.24;
  if (confidence < 0.6) return 0.08;
  return 0;
};

const severityFromScore = (
  score: number,
  confidence: number,
  freshness: AttentionScoreInput['freshness'],
  status: AttentionItemStatus,
): AttentionItemSeverity => {
  if (
    status === 'dismissed' ||
    status === 'resolved' ||
    status === 'superseded'
  ) {
    return 'steady';
  }

  let severity: AttentionItemSeverity =
    score >= 0.78 ? 'critical' : score >= 0.48 ? 'watch' : 'steady';

  if (freshness === 'stale' && severity === 'critical') severity = 'watch';
  if (confidence < 0.55 && severity !== 'steady') severity = 'steady';

  return severity;
};

export const scoreAttentionItem = (
  input: AttentionScoreInput,
): AttentionScoreResult => {
  const status = input.status ?? 'active';
  const freshness = input.freshness ?? inferFreshness(input.updated_at);
  const confidence = clamp(input.confidence ?? 0.7, 0, 1);
  const citedMeetingCount = Math.max(1, input.cited_meeting_count ?? 1);
  const sourceCount = Math.max(1, input.source_count ?? citedMeetingCount);
  const relatedStreamCount = Math.max(0, input.related_stream_count ?? 0);

  const breakdown: AttentionScoreBreakdown = {
    urgency: round(urgencyScore(input.due_at, input.now)),
    recency: round(
      recencyScore(
        freshness,
        input.last_reinforced_at,
        input.updated_at,
        input.now,
      ),
    ),
    repetition: round(repetitionScore(citedMeetingCount, sourceCount)),
    commitment: round(
      commitmentScore(input.kind, input.is_explicit_commitment ?? false),
    ),
    blocker: round(KIND_WEIGHT[input.kind]),
    project_relevance: round(projectRelevanceScore(relatedStreamCount)),
    evidence: round(
      evidenceScore(confidence, input.evidence_mode ?? 'unknown', sourceCount),
    ),
    feedback: round(feedbackScore(status)),
    stale_penalty: round(stalePenalty(freshness)),
    weak_evidence_penalty: round(weakEvidencePenalty(confidence)),
    total: 0,
  };

  const total = clamp(
    breakdown.urgency +
      breakdown.recency +
      breakdown.repetition +
      breakdown.commitment +
      breakdown.blocker +
      breakdown.project_relevance +
      breakdown.evidence +
      breakdown.feedback -
      breakdown.stale_penalty -
      breakdown.weak_evidence_penalty,
    0.05,
    0.99,
  );

  breakdown.total = round(total);

  return {
    score: breakdown.total,
    severity: severityFromScore(
      breakdown.total,
      confidence,
      freshness,
      status,
    ),
    score_breakdown: breakdown,
  };
};

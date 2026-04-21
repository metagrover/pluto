/**
 * MID Generator
 *
 * Produces a MidFrontmatter JSON object from existing analysis artifacts,
 * entity graph data, and internal signals. Deterministic: same inputs → same output.
 */

import type { Entity } from '../db';
import type { AnalysisDocumentV3 } from '../llm/analysisTypes';
import type { AnalysisDocument, InternalSignalDocument } from '../llm/provider';
import type {
  MidActionItem,
  MidDecision,
  MidEvidenceSpan,
  MidFrontmatter,
  MidParticipant,
  MidProject,
  MidSignals,
  MidTopic,
} from './intelligenceTypes';

// =============================================
// Input types for the generator
// =============================================

export interface MidGeneratorInput {
  meeting_id: string;
  title: string;
  occurred_at: string | null;
  duration_seconds: number;
  analysis: AnalysisDocument | AnalysisDocumentV3;
  signals: InternalSignalDocument;
  /** Entities associated with this meeting (from getMeetingEntities) */
  meeting_entities: Array<
    Entity & { mention_count: number; context: string | null }
  >;
  /** Raw transcript segments for evidence span extraction */
  transcript_segments?: Array<{ text: string; speaker?: string }>;
}

// =============================================
// Helpers
// =============================================

const parseMetadataJson = (raw: string | null): Record<string, unknown> => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const extractImportance = (
  metadata: Record<string, unknown>,
): 'high' | 'medium' | 'low' => {
  const value = metadata.importance;
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
};

const clampIndex = (index: number, max: number): number =>
  Math.max(0, Math.min(index, max));

/**
 * Attempt to find the transcript segment range that best matches a claim text.
 * Returns [startIndex, endIndex] or null if no match with sufficient confidence.
 */
const findEvidenceSpan = (
  claim: string,
  segments: Array<{ text: string }>,
): [number, number] | null => {
  if (segments.length === 0 || !claim) return null;

  const claimLower = claim.toLowerCase();
  // Extract meaningful tokens (3+ chars) for matching
  const claimTokens = claimLower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (claimTokens.length === 0) return null;

  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < segments.length; i++) {
    const segLower = segments[i].text.toLowerCase();
    let score = 0;
    for (const token of claimTokens) {
      if (segLower.includes(token)) score++;
    }
    const normalized = score / claimTokens.length;
    if (normalized > bestScore && normalized >= 0.4) {
      bestScore = normalized;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) return null;

  // Expand to surrounding segments for context window
  const start = clampIndex(bestIndex - 1, segments.length - 1);
  const end = clampIndex(bestIndex + 1, segments.length - 1);
  return [start, end];
};

// =============================================
// Analysis normalization for v2/v3 compatibility
// =============================================

interface NormalizedAnalysis {
  summary: string[];
  key_points: string[];
  action_items: string[];
  decisions: string[];
}

const normalizeAnalysisForEvidence = (
  analysis: AnalysisDocument | AnalysisDocumentV3,
): NormalizedAnalysis => {
  if ('overview' in analysis && analysis.analysis_schema_version === 3) {
    const v3 = analysis as AnalysisDocumentV3;
    return {
      summary: [v3.overview],
      key_points: v3.topics.flatMap((t) => t.key_points.map((p) => p.text)),
      action_items: v3.all_action_items.map((a) => a.text),
      decisions: v3.all_decisions.map((d) => d.text),
    };
  }
  const v2 = analysis as AnalysisDocument;
  return {
    summary: v2.summary,
    key_points: v2.key_points,
    action_items: v2.action_items,
    decisions: v2.decisions,
  };
};

// =============================================
// Core generator
// =============================================

/**
 * Generate a MidFrontmatter from analysis artifacts and entity data.
 * Deterministic: same inputs produce identical output.
 */
export function generateMid(input: MidGeneratorInput): MidFrontmatter {
  const {
    meeting_id,
    title,
    occurred_at,
    duration_seconds,
    analysis,
    signals,
    meeting_entities,
    transcript_segments,
  } = input;

  const segments = transcript_segments ?? [];

  // --- Participants ---
  // Primary: person entities from the knowledge graph
  let participants: MidParticipant[] = meeting_entities
    .filter((e) => e.type === 'person')
    .sort((a, b) => b.mention_count - a.mention_count)
    .map((e) => {
      const meta = parseMetadataJson(e.metadata);
      const participant: MidParticipant = {
        entity_id: e.id,
        name: e.name,
      };
      if (typeof meta.role === 'string' && meta.role.trim()) {
        participant.role = meta.role.trim();
      }
      return participant;
    });

  // Fallback: derive from transcript speaker labels when entity graph has no person entities.
  // Produces a deterministic synthetic entity_id from the speaker label.
  if (participants.length === 0 && segments.length > 0) {
    const speakerCounts = new Map<string, number>();
    for (const seg of segments) {
      const spk = seg.speaker?.trim();
      if (spk) speakerCounts.set(spk, (speakerCounts.get(spk) ?? 0) + 1);
    }
    participants = [...speakerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([speaker]) => ({
        entity_id: `speaker:${speaker.toLowerCase().replace(/\s+/g, '-')}`,
        name: speaker,
      }));
  }

  // --- Projects ---
  const projects: MidProject[] = meeting_entities
    .filter((e) => e.type === 'project')
    .sort((a, b) => b.mention_count - a.mention_count)
    .map((e) => ({
      entity_id: e.id,
      name: e.name,
    }));

  // --- Topics ---
  const topics: MidTopic[] = meeting_entities
    .filter((e) => e.type === 'topic')
    .sort((a, b) => b.mention_count - a.mention_count)
    .map((e) => {
      const meta = parseMetadataJson(e.metadata);
      return {
        entity_id: e.id,
        name: e.name,
        importance: extractImportance(meta),
      };
    });

  // --- Action Items ---
  const actionItems: MidActionItem[] = meeting_entities
    .filter((e) => e.type === 'action_item')
    .map((e) => {
      const meta = parseMetadataJson(e.metadata);
      const item: MidActionItem = {
        entity_id: e.id,
        description:
          typeof meta.full_description === 'string'
            ? meta.full_description
            : e.name,
        status: e.status === 'completed' ? 'completed' : 'active',
      };
      if (typeof meta.assignee_name === 'string' && meta.assignee_name.trim()) {
        item.assignee = meta.assignee_name.trim();
      }
      if (e.due_date) {
        item.due_date = e.due_date;
      }
      return item;
    });

  // --- Decisions ---
  const decisions: MidDecision[] = meeting_entities
    .filter((e) => e.type === 'decision')
    .map((e) => {
      const meta = parseMetadataJson(e.metadata);
      const decision: MidDecision = {
        entity_id: e.id,
        description:
          typeof meta.full_description === 'string'
            ? meta.full_description
            : e.name,
      };
      if (typeof meta.rationale === 'string' && meta.rationale.trim()) {
        decision.rationale = meta.rationale.trim();
      }
      return decision;
    });

  // --- Signals ---
  const midSignals: MidSignals = {
    continuity: [...signals.continuity],
    accountability_risks: [...signals.accountability_risks],
    decision_impacts: [...signals.decision_impacts],
  };

  // --- Evidence Spans ---
  const evidenceSpans: MidEvidenceSpan[] = [];
  let spanCounter = 0;

  // Normalize analysis for v2/v3 compatibility
  const normalized = normalizeAnalysisForEvidence(analysis);

  // Map summary paragraphs to transcript
  for (const paragraph of normalized.summary) {
    const range = findEvidenceSpan(paragraph, segments);
    if (range) {
      spanCounter++;
      evidenceSpans.push({
        span_id: `summary-${spanCounter}`,
        claim_type: 'summary',
        transcript_range: range,
        quote: segments
          .slice(range[0], range[1] + 1)
          .map((s) => s.text)
          .join(' ')
          .slice(0, 300),
      });
    }
  }

  // Map decisions to transcript
  for (const decisionText of normalized.decisions) {
    const range = findEvidenceSpan(decisionText, segments);
    if (range) {
      spanCounter++;
      evidenceSpans.push({
        span_id: `decision-${spanCounter}`,
        claim_type: 'decision',
        transcript_range: range,
        quote: segments
          .slice(range[0], range[1] + 1)
          .map((s) => s.text)
          .join(' ')
          .slice(0, 300),
      });
    }
  }

  // Map key points to transcript
  for (const point of normalized.key_points) {
    const range = findEvidenceSpan(point, segments);
    if (range) {
      spanCounter++;
      evidenceSpans.push({
        span_id: `key-point-${spanCounter}`,
        claim_type: 'key_point',
        transcript_range: range,
        quote: segments
          .slice(range[0], range[1] + 1)
          .map((s) => s.text)
          .join(' ')
          .slice(0, 300),
      });
    }
  }

  return {
    mid_version: 1,
    meeting_id,
    title,
    occurred_at,
    duration_seconds,
    participants,
    projects,
    topics,
    action_items: actionItems,
    decisions,
    signals: midSignals,
    evidence_spans: evidenceSpans,
  };
}

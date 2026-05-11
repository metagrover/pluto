import type { KnowledgeDocStatus } from '../api/knowledgeDocs';
import type { KnowledgeV2EvidenceQuality } from '../components/KnowledgeGraph/knowledgeDocument';

export type TrustStatus =
  | 'grounded'
  | 'inferred'
  | 'weak_evidence'
  | 'stale'
  | 'synthesis_failed'
  | 'needs_review';

export interface TrustStatusMeta {
  label: string;
  tone: 'success' | 'accent' | 'warning' | 'danger' | 'muted';
  description: string;
}

const TRUST_STATUS_META: Record<TrustStatus, TrustStatusMeta> = {
  grounded: {
    label: 'Grounded',
    tone: 'success',
    description: 'Backed by direct evidence from cited source material.',
  },
  inferred: {
    label: 'Inferred',
    tone: 'accent',
    description: 'Supported by evidence, but synthesized across sources.',
  },
  weak_evidence: {
    label: 'Weak evidence',
    tone: 'warning',
    description: 'Too little supporting evidence is attached to trust this yet.',
  },
  stale: {
    label: 'Stale',
    tone: 'warning',
    description: 'The evidence has aged and should be refreshed before relying on it.',
  },
  synthesis_failed: {
    label: 'Synthesis failed',
    tone: 'danger',
    description: 'Pluto could not complete synthesis for this surface.',
  },
  needs_review: {
    label: 'Needs review',
    tone: 'danger',
    description: 'The citation or evidence path needs manual review.',
  },
};

export const getTrustStatusMeta = (status: TrustStatus): TrustStatusMeta =>
  TRUST_STATUS_META[status];

export const deriveKnowledgeTrustStatus = ({
  docStatus,
  evidenceQuality,
}: {
  docStatus: KnowledgeDocStatus;
  evidenceQuality: KnowledgeV2EvidenceQuality | null | undefined;
}): TrustStatus => {
  if (docStatus === 'failed') return 'synthesis_failed';
  if (docStatus === 'stale') return 'stale';

  if (!evidenceQuality) return 'weak_evidence';
  if (evidenceQuality.freshness === 'stale') return 'stale';
  if (
    evidenceQuality.source_count <= 0 ||
    evidenceQuality.cited_meeting_count <= 0 ||
    evidenceQuality.confidence < 0.55
  ) {
    return 'weak_evidence';
  }

  return evidenceQuality.mode === 'inferred' ? 'inferred' : 'grounded';
};

export const deriveCitationTrustStatus = ({
  evidenceValid,
}: {
  evidenceValid: boolean;
}): TrustStatus => (evidenceValid ? 'grounded' : 'needs_review');

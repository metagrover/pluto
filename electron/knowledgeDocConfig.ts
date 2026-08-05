import { KNOWLEDGE_V2_SYNTHESIS_VERSION } from './knowledgeV2';

export const KNOWLEDGE_SYNTHESIS_VERSION = KNOWLEDGE_V2_SYNTHESIS_VERSION;

export interface KnowledgeDocConfigShape {
  member_entity_ids?: string[];
  synthesis_version?: number;
  synthesis_input_hash?: string;
}

export const parseKnowledgeDocConfig = (
  raw: string | null | undefined,
): KnowledgeDocConfigShape => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as KnowledgeDocConfigShape;
  } catch {
    return {};
  }
};

export const withCurrentKnowledgeSynthesisConfig = (
  raw: string | null | undefined,
  synthesisInputHash?: string,
): KnowledgeDocConfigShape => ({
  ...parseKnowledgeDocConfig(raw),
  synthesis_version: KNOWLEDGE_SYNTHESIS_VERSION,
  ...(synthesisInputHash ? { synthesis_input_hash: synthesisInputHash } : {}),
});

export const getKnowledgeSynthesisInputConfig = (
  raw: string | null | undefined,
): KnowledgeDocConfigShape => {
  const { synthesis_input_hash: _storedHash, ...inputConfig } =
    withCurrentKnowledgeSynthesisConfig(raw);
  return inputConfig;
};

export const knowledgeDocNeedsSynthesis = (doc: {
  status: string;
  config: string | null;
}): boolean => {
  if (doc.status !== 'up_to_date') return true;
  return (
    parseKnowledgeDocConfig(doc.config).synthesis_version !==
    KNOWLEDGE_SYNTHESIS_VERSION
  );
};

export const knowledgeDocSatisfiesMeetingRefresh = (
  doc: { status: string; config: string | null },
  coverage: {
    meetingIsCandidate: boolean;
    meetingIsPersistedSource: boolean;
    currentSynthesisInputHash: string | null;
  },
): boolean =>
  !knowledgeDocNeedsSynthesis(doc) &&
  (!coverage.meetingIsCandidate ||
    (coverage.meetingIsPersistedSource &&
      Boolean(coverage.currentSynthesisInputHash) &&
      parseKnowledgeDocConfig(doc.config).synthesis_input_hash ===
        coverage.currentSynthesisInputHash));

import { KNOWLEDGE_V2_SYNTHESIS_VERSION } from './knowledgeV2';

export const KNOWLEDGE_SYNTHESIS_VERSION = KNOWLEDGE_V2_SYNTHESIS_VERSION;

export interface KnowledgeDocConfigShape {
  member_entity_ids?: string[];
  synthesis_version?: number;
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
): KnowledgeDocConfigShape => ({
  ...parseKnowledgeDocConfig(raw),
  synthesis_version: KNOWLEDGE_SYNTHESIS_VERSION,
});

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

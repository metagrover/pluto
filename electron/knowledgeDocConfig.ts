import { PERSON_CONTEXT_SYNTHESIS_VERSION } from '../src/utils/personDossierRead';
import { KNOWLEDGE_V2_SYNTHESIS_VERSION } from './knowledgeV2';

export const KNOWLEDGE_SYNTHESIS_VERSION = KNOWLEDGE_V2_SYNTHESIS_VERSION;
export { PERSON_CONTEXT_SYNTHESIS_VERSION };

/** Person dossiers only publish complete reads; keep the last cited read during refresh. */
export const shouldPublishPartialKnowledgeDoc = (scopeType: string): boolean =>
  scopeType !== 'person_context';

const synthesisVersionForScope = (scopeType?: string): number =>
  scopeType === 'person_context'
    ? PERSON_CONTEXT_SYNTHESIS_VERSION
    : KNOWLEDGE_SYNTHESIS_VERSION;

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
  scopeType?: string,
): KnowledgeDocConfigShape => ({
  ...parseKnowledgeDocConfig(raw),
  synthesis_version: synthesisVersionForScope(scopeType),
  ...(synthesisInputHash ? { synthesis_input_hash: synthesisInputHash } : {}),
});

export const getKnowledgeSynthesisInputConfig = (
  raw: string | null | undefined,
  scopeType?: string,
): KnowledgeDocConfigShape => {
  const { synthesis_input_hash: _storedHash, ...inputConfig } =
    withCurrentKnowledgeSynthesisConfig(raw, undefined, scopeType);
  return inputConfig;
};

export const knowledgeDocNeedsSynthesis = (doc: {
  status: string;
  config: string | null;
  scope_type?: string;
}): boolean => {
  if (doc.status !== 'up_to_date') return true;
  return (
    parseKnowledgeDocConfig(doc.config).synthesis_version !==
    synthesisVersionForScope(doc.scope_type)
  );
};

export const knowledgeDocSatisfiesMeetingRefresh = (
  doc: { status: string; config: string | null; scope_type?: string },
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

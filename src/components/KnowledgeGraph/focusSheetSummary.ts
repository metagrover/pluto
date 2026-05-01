import type { EntitySummary } from '../../api/knowledgeWorkspace';

export const resolveFocusSheetSummary = (
  _entityLabel: string,
  summary: EntitySummary | null,
): EntitySummary | null => {
  return summary;
};

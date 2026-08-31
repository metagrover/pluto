export type LLMWorkClass =
  | 'ask_pluto'
  | 'manual_notes'
  | 'automatic_notes'
  | 'project_review'
  | 'meeting_secondary'
  | 'background';

export const LLM_WORK_CLASS_PRIORITY = {
  ask_pluto: 30,
  manual_notes: 20,
  automatic_notes: 15,
  project_review: 15,
  meeting_secondary: 5,
  background: 0,
} as const satisfies Record<LLMWorkClass, number>;

export const defaultLLMWorkClass = (task: string): LLMWorkClass => {
  if (task === 'askPluto' || task === 'askPlutoDeep' || task === 'askPlutoLive')
    return 'ask_pluto';
  if (task === 'projectScopeReview') return 'project_review';
  if (task === 'valueSignals' || task === 'entities')
    return 'meeting_secondary';
  if (
    task === 'knowledgeDoc' ||
    task === 'commitmentReconciliation' ||
    task === 'title'
  )
    return 'background';
  return 'automatic_notes';
};

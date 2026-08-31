import { createSerializedTaskGate } from '../serializedTaskGate';

export type LocalInferenceTask =
  | 'summary'
  | 'summaryRepair'
  | 'structuredAnalysis'
  | 'notesWriter'
  | 'notesAudit'
  | 'notesMerge'
  | 'analysisEditorial'
  | 'topicSegmentation'
  | 'terminologyReconciliation'
  | 'topicAnalysis'
  | 'speaker'
  | 'title'
  | 'entities'
  | 'valueSignals'
  | 'knowledgeDoc'
  | 'projectScopeReview'
  | 'commitmentReconciliation'
  | 'askPluto'
  | 'askPlutoDeep'
  | 'askPlutoLive'
  | 'queryClassification';

const RESUMABLE_ANALYSIS_TASKS = new Set<LocalInferenceTask>([
  'notesWriter',
  'notesAudit',
  'notesMerge',
  'topicSegmentation',
  'terminologyReconciliation',
  'topicAnalysis',
  'analysisEditorial',
]);

export const getLocalInferenceAdmission = (
  task: LocalInferenceTask,
): { priority: number; preemptible: boolean } => ({
  priority:
    task === 'knowledgeDoc' || task === 'commitmentReconciliation'
      ? 0
      : task === 'projectScopeReview'
        ? 15
        : task === 'askPluto' ||
            task === 'askPlutoDeep' ||
            task === 'askPlutoLive'
          ? 20
          : 10,
  preemptible:
    task === 'knowledgeDoc' ||
    task === 'projectScopeReview' ||
    task === 'commitmentReconciliation' ||
    task === 'title' ||
    RESUMABLE_ANALYSIS_TASKS.has(task),
});

const runSerializedInference = createSerializedTaskGate<symbol, unknown>();

export const runWithLocalInferenceCoordinator = <Result>({
  key,
  task,
  signal,
  run,
  onAdmitted,
}: {
  key: symbol;
  task: LocalInferenceTask;
  signal?: AbortSignal;
  run: (signal: AbortSignal) => Promise<Result>;
  onAdmitted?: (metrics: {
    task: LocalInferenceTask;
    queueMs: number;
  }) => void;
}): Promise<Result> => {
  const queuedAt = Date.now();
  const admission = getLocalInferenceAdmission(task);
  return runSerializedInference(
    key,
    async (coordinatorSignal) => {
      onAdmitted?.({ task, queueMs: Date.now() - queuedAt });
      return run(coordinatorSignal);
    },
    admission.priority,
    { signal, preemptible: admission.preemptible },
  ) as Promise<Result>;
};

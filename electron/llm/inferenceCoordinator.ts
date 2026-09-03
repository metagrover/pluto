import { createSerializedTaskGate } from '../serializedTaskGate';
import {
  type LLMWorkClass,
  LLM_WORK_CLASS_PRIORITY,
  defaultLLMWorkClass,
} from './llmWorkClass';

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
  | 'dreaming'
  | 'dreamingCleanup'
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
  workClass: LLMWorkClass = defaultLLMWorkClass(task),
): { priority: number; preemptible: boolean } => ({
  priority: LLM_WORK_CLASS_PRIORITY[workClass],
  preemptible:
    workClass === 'meeting_secondary' ||
    workClass === 'project_review' ||
    workClass === 'background' ||
    RESUMABLE_ANALYSIS_TASKS.has(task),
});

const runSerializedInference = createSerializedTaskGate<symbol, unknown>();

export const runWithLocalInferenceCoordinator = <Result>({
  key,
  task,
  workClass,
  signal,
  run,
  onAdmitted,
}: {
  key: symbol;
  task: LocalInferenceTask;
  workClass?: LLMWorkClass;
  signal?: AbortSignal;
  run: (signal: AbortSignal) => Promise<Result>;
  onAdmitted?: (metrics: {
    task: LocalInferenceTask;
    queueMs: number;
  }) => void;
}): Promise<Result> => {
  const queuedAt = Date.now();
  const admission = getLocalInferenceAdmission(task, workClass);
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

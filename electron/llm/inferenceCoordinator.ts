import { AsyncLocalStorage } from 'node:async_hooks';
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
  | 'queryClassification'
  | 'askPlutoScope';

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
const admissionScope = new AsyncLocalStorage<{
  signal: AbortSignal;
  active: boolean;
  native: boolean;
}>();

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
      const admission = {
        signal: coordinatorSignal,
        active: true,
        native: task === 'speaker',
      };
      try {
        return await admissionScope.run(admission, () =>
          run(coordinatorSignal),
        );
      } finally {
        admission.active = false;
      }
    },
    admission.priority,
    { signal, preemptible: admission.preemptible },
  ) as Promise<Result>;
};

/** Native audio work must settle local generation before loading its runtime. */
export const runWithNativeInferenceCoordinator = <Result>(
  run: (signal: AbortSignal) => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> => {
  // Voice enrollment already owns this gate; its native lease must reuse admission.
  const admission = admissionScope.getStore();
  if (admission?.active && admission.native) {
    return run(
      AbortSignal.any([admission.signal, ...(signal ? [signal] : [])]),
    );
  }
  return runSerializedInference(Symbol('transcription'), run, 40, {
    signal,
    preemptActive: true,
  }) as Promise<Result>;
};

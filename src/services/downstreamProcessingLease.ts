export type DownstreamProcessingStage =
  | 'analysis'
  | 'knowledge_extraction'
  | 'knowledge_synthesis';

export type DownstreamProcessingLease = {
  schemaVersion: 1;
  state: 'processing';
  transcriptValidatedAt: string;
  runId: string;
  startedAt: string;
  deadlineAt: string;
  stage: DownstreamProcessingStage;
};

const DOWNSTREAM_LEASE_MS = 30 * 60_000;

export const buildDownstreamProcessingLease = (input: {
  runId: string;
  transcriptValidatedAt: string;
  now?: number;
  stage: DownstreamProcessingStage;
}): DownstreamProcessingLease => {
  const now = input.now ?? Date.now();
  return {
    schemaVersion: 1,
    state: 'processing',
    transcriptValidatedAt: input.transcriptValidatedAt,
    runId: input.runId,
    startedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + DOWNSTREAM_LEASE_MS).toISOString(),
    stage: input.stage,
  };
};

export const readDownstreamProcessingLease = (
  value: string | null | undefined,
): DownstreamProcessingLease | null => {
  try {
    const parsed = JSON.parse(
      value || '{}',
    ) as Partial<DownstreamProcessingLease>;
    return parsed.schemaVersion === 1 &&
      parsed.state === 'processing' &&
      typeof parsed.transcriptValidatedAt === 'string' &&
      typeof parsed.runId === 'string' &&
      typeof parsed.startedAt === 'string' &&
      typeof parsed.deadlineAt === 'string' &&
      ['analysis', 'knowledge_extraction', 'knowledge_synthesis'].includes(
        String(parsed.stage),
      )
      ? (parsed as DownstreamProcessingLease)
      : null;
  } catch {
    return null;
  }
};

export const advanceDownstreamProcessingLease = (
  lease: DownstreamProcessingLease,
  stage: DownstreamProcessingStage,
  now = Date.now(),
): DownstreamProcessingLease => ({
  ...lease,
  deadlineAt: new Date(now + DOWNSTREAM_LEASE_MS).toISOString(),
  stage,
});

export const selectDownstreamResumeStage = (meeting: {
  analysis_json?: string | null;
  enhanced_notes?: string | null;
  mid_json?: string | null;
}): DownstreamProcessingStage => {
  if (!meeting.analysis_json && !meeting.enhanced_notes) return 'analysis';
  if (meeting.mid_json) return 'knowledge_synthesis';
  return 'knowledge_extraction';
};

export type DownstreamProcessingStage =
  | 'analysis'
  | 'knowledge_extraction'
  | 'knowledge_synthesis';

export type ValidatedDownstreamProcessingLease = {
  schemaVersion: 1;
  state: 'processing';
  transcriptValidatedAt: string;
  runId: string;
  startedAt: string;
  deadlineAt: string;
  stage: DownstreamProcessingStage;
};

export type PartialCaptureGapSourceProof = {
  kind: 'partial_capture_gap';
  captureJournalGeneration: string;
  transcriptSha256: string;
  transcriptIntegritySha256: string;
};

export type PartialCaptureGapProcessingLease = {
  schemaVersion: 2;
  state: 'processing';
  source: PartialCaptureGapSourceProof;
  runId: string;
  startedAt: string;
  deadlineAt: string;
  stage: DownstreamProcessingStage;
};

export type DownstreamProcessingLease =
  | ValidatedDownstreamProcessingLease
  | PartialCaptureGapProcessingLease;

export type DownstreamProcessingComplete =
  | {
      schemaVersion: 1;
      state: 'complete';
      transcriptValidatedAt: string;
    }
  | {
      schemaVersion: 2;
      state: 'complete';
      source: PartialCaptureGapSourceProof;
    };

const DOWNSTREAM_LEASE_MS = 30 * 60_000;

export const buildDownstreamProcessingLease = (input: {
  runId: string;
  transcriptValidatedAt: string;
  now?: number;
  stage: DownstreamProcessingStage;
}): ValidatedDownstreamProcessingLease => {
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

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
};

export const buildPartialCaptureGapProcessingLease = async (input: {
  runId: string;
  transcriptJson: string;
  transcriptIntegrityJson: string;
  captureJournalGeneration: string;
  now?: number;
  stage: DownstreamProcessingStage;
}): Promise<PartialCaptureGapProcessingLease> => {
  const now = input.now ?? Date.now();
  return {
    schemaVersion: 2,
    state: 'processing',
    source: {
      kind: 'partial_capture_gap',
      captureJournalGeneration: input.captureJournalGeneration,
      transcriptSha256: await sha256(input.transcriptJson),
      transcriptIntegritySha256: await sha256(input.transcriptIntegrityJson),
    },
    runId: input.runId,
    startedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + DOWNSTREAM_LEASE_MS).toISOString(),
    stage: input.stage,
  };
};

const sha256Pattern = /^[a-f0-9]{64}$/;

const isPartialCaptureGapSourceProof = (
  value: unknown,
): value is PartialCaptureGapSourceProof => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Partial<PartialCaptureGapSourceProof>;
  return (
    source.kind === 'partial_capture_gap' &&
    typeof source.captureJournalGeneration === 'string' &&
    source.captureJournalGeneration.length > 0 &&
    typeof source.transcriptSha256 === 'string' &&
    sha256Pattern.test(source.transcriptSha256) &&
    typeof source.transcriptIntegritySha256 === 'string' &&
    sha256Pattern.test(source.transcriptIntegritySha256)
  );
};

export const readDownstreamProcessingLease = (
  value: string | null | undefined,
): DownstreamProcessingLease | null => {
  try {
    const parsed = JSON.parse(value || '{}') as Record<string, unknown>;
    const commonValid =
      parsed.state === 'processing' &&
      typeof parsed.runId === 'string' &&
      typeof parsed.startedAt === 'string' &&
      typeof parsed.deadlineAt === 'string' &&
      ['analysis', 'knowledge_extraction', 'knowledge_synthesis'].includes(
        String(parsed.stage),
      );
    if (!commonValid) return null;
    if (
      parsed.schemaVersion === 1 &&
      typeof parsed.transcriptValidatedAt === 'string'
    ) {
      return parsed as ValidatedDownstreamProcessingLease;
    }
    if (
      parsed.schemaVersion === 2 &&
      isPartialCaptureGapSourceProof(parsed.source)
    ) {
      return parsed as PartialCaptureGapProcessingLease;
    }
    return null;
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

export const completeDownstreamProcessing = (
  lease: DownstreamProcessingLease,
): DownstreamProcessingComplete =>
  lease.schemaVersion === 2
    ? { schemaVersion: 2, state: 'complete', source: lease.source }
    : {
        schemaVersion: 1,
        state: 'complete',
        transcriptValidatedAt: lease.transcriptValidatedAt,
      };

export const selectDownstreamResumeStage = (meeting: {
  analysis_json?: string | null;
  enhanced_notes?: string | null;
  mid_json?: string | null;
}): DownstreamProcessingStage => {
  if (!meeting.analysis_json && !meeting.enhanced_notes) return 'analysis';
  if (meeting.mid_json) return 'knowledge_synthesis';
  return 'knowledge_extraction';
};

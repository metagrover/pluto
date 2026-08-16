import type { Meeting } from '../types.ts';
import {
  type ValidatedDownstreamProcessingLease,
  advanceDownstreamProcessingLease,
  buildDownstreamProcessingLease,
  completeDownstreamProcessing,
} from './downstreamProcessingLease.ts';
import {
  DownstreamStageTimeoutError,
  runDownstreamStageBeforeDeadline,
  throwIfDownstreamStageAborted,
} from './downstreamStageDeadline.ts';
import { meetingTitleNeedsGeneration } from './retryMeetingTranscriptValidation.ts';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const DEFAULT_STAGE_TIMEOUT_MS = {
  analysis: 5 * 60_000,
  knowledge_extraction: 5 * 60_000,
  knowledge_synthesis: 15 * 60_000,
} as const;

const transcriptForAnalysis = (transcriptJson: string | null | undefined) => {
  try {
    const parsed = JSON.parse(transcriptJson || '{}') as {
      segments?: Array<{ speaker?: unknown; text?: unknown }>;
    };
    if (!Array.isArray(parsed.segments)) return '';
    return parsed.segments
      .filter(
        (segment) =>
          typeof segment?.text === 'string' && Boolean(segment.text.trim()),
      )
      .map(
        (segment) => `${String(segment.speaker || 'Unknown')}: ${segment.text}`,
      )
      .join('\n');
  } catch {
    return '';
  }
};

export const processValidatedMeetingDownstream = async (
  meetingId: string | number,
  invoke: Invoke,
  options: {
    stageTimeoutMs?: Partial<
      Record<keyof typeof DEFAULT_STAGE_TIMEOUT_MS, number>
    >;
  } = {},
): Promise<{ status: 'complete' | 'superseded' | 'failed' }> => {
  const meeting = (await invoke('GET_MEETING', meetingId)) as Meeting | null;
  if (
    !meeting ||
    meeting.transcript_status !== 'validated' ||
    !meeting.transcript_validated_at
  ) {
    return { status: 'superseded' };
  }
  const transcript = transcriptForAnalysis(meeting.transcript_json);
  if (!transcript) return { status: 'failed' };

  const validatedAt = meeting.transcript_validated_at;
  const runId = crypto.randomUUID();
  let lease = buildDownstreamProcessingLease({
    runId,
    transcriptValidatedAt: validatedAt,
    stage: 'analysis',
  });
  const claimed = await invoke('CLAIM_DOWNSTREAM_PROCESSING', meetingId, lease);
  if (claimed !== true) return { status: 'superseded' };

  const runStage = <T>(
    stage: keyof typeof DEFAULT_STAGE_TIMEOUT_MS,
    operation: (signal: AbortSignal) => Promise<T>,
  ) =>
    runDownstreamStageBeforeDeadline(
      stage,
      operation,
      options.stageTimeoutMs?.[stage] ?? DEFAULT_STAGE_TIMEOUT_MS[stage],
    );
  let stage: keyof typeof DEFAULT_STAGE_TIMEOUT_MS = 'analysis';
  try {
    const { generatedTitle, artifacts } = await runStage(
      'analysis',
      async (signal) => {
        const title = meetingTitleNeedsGeneration(meeting.title)
          ? ((await invoke('GENERATE_TITLE', { transcript })) as string)
          : meeting.title;
        throwIfDownstreamStageAborted(signal);
        const generatedArtifacts = (await invoke('GENERATE_ANALYSIS_V2', {
          transcript,
          userNotes: meeting.user_notes || '',
        })) as { markdown?: string; analysis?: unknown; signals?: unknown };
        throwIfDownstreamStageAborted(signal);
        return { generatedTitle: title, artifacts: generatedArtifacts };
      },
    );
    const latest = (await invoke('GET_MEETING', meetingId)) as Meeting;
    if (latest.transcript_validated_at !== validatedAt) {
      return { status: 'superseded' };
    }
    lease = advanceDownstreamProcessingLease(
      lease,
      'knowledge_extraction',
    ) as ValidatedDownstreamProcessingLease;
    const analysisSaved = await invoke(
      'SAVE_MEETING',
      {
        ...latest,
        title: latest.title === meeting.title ? generatedTitle : latest.title,
        enhanced_notes: artifacts.markdown || '',
        analysis_json: JSON.stringify(artifacts.analysis ?? null),
        value_signals_json: JSON.stringify(artifacts.signals ?? null),
        downstream_processing_json: JSON.stringify(lease),
      },
      { expectedDownstreamRunId: runId, expectedTitle: meeting.title },
    );
    if (analysisSaved === false) return { status: 'superseded' };

    stage = 'knowledge_extraction';
    await runStage('knowledge_extraction', async (signal) => {
      const result = await invoke('EXTRACT_AND_PROCESS_ENTITIES', {
        transcript,
        meetingId: String(meeting.id),
        summary: artifacts.markdown || '',
        valueSignals: artifacts.signals ?? null,
        awaitKnowledgeSynthesis: true,
        expectedDownstreamRunId: runId,
      });
      throwIfDownstreamStageAborted(signal);
      return result;
    });

    stage = 'knowledge_synthesis';
    lease = advanceDownstreamProcessingLease(
      lease,
      'knowledge_synthesis',
    ) as ValidatedDownstreamProcessingLease;
    const afterExtraction = (await invoke('GET_MEETING', meetingId)) as Meeting;
    const synthesisClaimed = await invoke(
      'SAVE_MEETING',
      {
        ...afterExtraction,
        downstream_processing_json: JSON.stringify(lease),
      },
      { expectedDownstreamRunId: runId },
    );
    if (synthesisClaimed === false) return { status: 'superseded' };
    const knowledgeResult = await runStage(
      'knowledge_synthesis',
      async (signal) => {
        const result = (await invoke(
          'REFRESH_KNOWLEDGE_FOR_MEETING_NOW',
          String(meeting.id),
          { expectedDownstreamRunId: runId },
        )) as { requested?: number; completed?: number };
        throwIfDownstreamStageAborted(signal);
        return result;
      },
    );
    if (
      !Number.isFinite(knowledgeResult.requested) ||
      knowledgeResult.completed !== knowledgeResult.requested
    ) {
      throw new Error('knowledge_synthesis_incomplete');
    }
    const completed = (await invoke('GET_MEETING', meetingId)) as Meeting;
    if (completed.transcript_validated_at !== validatedAt) {
      return { status: 'superseded' };
    }
    await invoke(
      'SAVE_MEETING',
      {
        ...completed,
        downstream_processing_json: JSON.stringify(
          completeDownstreamProcessing(lease),
        ),
      },
      { expectedDownstreamRunId: runId },
    );
    return { status: 'complete' };
  } catch (error) {
    console.error('[Pluto] Post-validation intelligence failed', error);
    const latest = (await invoke('GET_MEETING', meetingId)) as Meeting;
    if (latest.transcript_validated_at === validatedAt) {
      await invoke(
        'SAVE_MEETING',
        {
          ...latest,
          downstream_processing_json: JSON.stringify({
            schemaVersion: 1,
            state: 'failed',
            transcriptValidatedAt: validatedAt,
            stage,
            failure:
              error instanceof DownstreamStageTimeoutError
                ? 'stage_timeout'
                : 'generation_failed',
          }),
        },
        { expectedDownstreamRunId: runId },
      );
    }
    return { status: 'failed' };
  }
};

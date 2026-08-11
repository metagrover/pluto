import type { Meeting } from '../../types';

export type DownstreamProcessingPresentation = {
  state: 'processing' | 'failed' | 'missing' | 'ready';
  title: string;
  detail: string;
  canRetry: boolean;
};

const processingCopy = {
  analysis: {
    title: 'Building meeting analysis',
    detail:
      'Pluto is turning the validated transcript into grounded meeting intelligence.',
  },
  knowledge_extraction: {
    title: 'Connecting meeting context',
    detail:
      'The analysis is ready. Pluto is connecting its people, topics, and follow-through.',
  },
  knowledge_synthesis: {
    title: 'Updating your knowledge',
    detail:
      'The meeting analysis is ready. Pluto is updating the background knowledge layer.',
  },
} as const;

export const getDownstreamProcessingPresentation = (
  meeting: Partial<Meeting>,
): DownstreamProcessingPresentation | null => {
  if (
    meeting.transcript_status !== 'validated' &&
    meeting.transcript_status !== 'needs_attention'
  ) {
    return null;
  }

  let state: string | null = null;
  let stage: keyof typeof processingCopy = 'analysis';
  try {
    const parsed = JSON.parse(meeting.downstream_processing_json || '{}') as {
      state?: unknown;
      stage?: unknown;
    };
    state = typeof parsed.state === 'string' ? parsed.state : null;
    if (
      parsed.stage === 'analysis' ||
      parsed.stage === 'knowledge_extraction' ||
      parsed.stage === 'knowledge_synthesis'
    ) {
      stage = parsed.stage;
    }
  } catch {
    state = null;
  }

  const hasAnalysis = Boolean(meeting.analysis_json || meeting.enhanced_notes);
  if (state === 'processing') {
    return {
      state: 'processing',
      ...processingCopy[stage],
      canRetry: false,
    };
  }
  if (state === 'failed') {
    return {
      state: 'failed',
      title: 'Meeting analysis stopped safely',
      detail:
        'The validated transcript is safe. Pluto can retry the analysis without recording again.',
      canRetry: true,
    };
  }
  if (state === 'complete' && hasAnalysis) {
    return {
      state: 'ready',
      title: 'Synthesis ready',
      detail: 'Meeting intelligence is ready.',
      canRetry: false,
    };
  }
  if (!hasAnalysis) {
    return {
      state: 'missing',
      title: 'Meeting analysis not ready',
      detail:
        'The validated transcript is safe. Pluto can build the analysis without recording again.',
      canRetry: true,
    };
  }
  return null;
};

import type { Meeting } from '../../types';

export type DownstreamProcessingPresentation =
  | { state: 'loading' }
  | {
      state: 'failed';
      title: string;
      detail: string;
    }
  | { state: 'ready' };

export const getDownstreamProcessingPresentation = (
  meeting: Partial<Meeting>,
): DownstreamProcessingPresentation => {
  if (meeting.analysis_json || meeting.enhanced_notes) {
    return { state: 'ready' };
  }

  try {
    const integrity = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      finalTranscription?: {
        policy?: unknown;
        state?: unknown;
        failure?: unknown;
      };
    };
    const finalTranscription = integrity.finalTranscription;
    if (
      meeting.transcript_status === 'needs_attention' &&
      finalTranscription?.policy === 'parakeet_final_v1' &&
      finalTranscription.state === 'needs_attention' &&
      typeof finalTranscription.failure === 'string'
    ) {
      return {
        state: 'failed',
        title: "Couldn't finish the transcript",
        detail: 'Your recording is safe. Try again to continue.',
      };
    }
  } catch {
    // A malformed integrity record falls through to the existing safe loading state.
  }

  let state: string | null = null;
  try {
    const parsed = JSON.parse(meeting.downstream_processing_json || '{}') as {
      state?: unknown;
    };
    state = typeof parsed.state === 'string' ? parsed.state : null;
  } catch {
    state = null;
  }

  if (state === 'failed') {
    return {
      state: 'failed',
      title: "Couldn't finish the analysis",
      detail:
        'Your transcript is available. Pluto will try again automatically.',
    };
  }

  return { state: 'loading' };
};

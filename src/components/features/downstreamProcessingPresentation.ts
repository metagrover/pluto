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

  // A structured analysis is safe to render while later knowledge work runs.
  // Legacy markdown is not: it can be a stale snapshot while the current
  // analysis lease is still writing, which previously left the notes surface
  // blank with no visible preparation state.
  if (meeting.analysis_json) {
    try {
      const parsed = JSON.parse(meeting.analysis_json) as {
        quality?: { fallback_used?: boolean };
      };
      if (parsed?.quality?.fallback_used) {
        return {
          state: 'failed',
          title: 'Analysis needs another pass',
          detail: 'Your transcript is ready.',
        };
      }
    } catch {
      // ignore
    }
    return { state: 'ready' };
  }

  if (state === 'processing') {
    return { state: 'loading' };
  }

  if (meeting.enhanced_notes) {
    return { state: 'ready' };
  }

  if (state === 'failed') {
    return {
      state: 'failed',
      title: 'Analysis needs another pass',
      detail: 'Your transcript is ready.',
    };
  }

  return { state: 'loading' };
};

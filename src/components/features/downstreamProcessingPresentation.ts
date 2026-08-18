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

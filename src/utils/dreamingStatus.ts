import type { IdleDreamingResult } from '../../electron/dreaming/idleDreamingCoordinator';

export type DreamingUiStatus =
  | IdleDreamingResult['status']
  | 'idle'
  | 'running'
  | 'review_required'
  | 'error';

export const DREAMING_STATUS_LABEL = {
  idle: 'Dream Now',
  running: 'Dreaming in progress…',
  proposed: 'Updates prepared',
  no_change: 'No new updates',
  cancelled: 'Preparation cancelled',
  existing: 'Already prepared',
  busy: 'Another preparation is running',
  ineligible: 'Preparation is paused',
  backoff: 'Will retry later',
  exhausted: 'Needs review before retrying',
  no_work: 'No source notes available',
  invalid_request: 'Select a person or project',
  review_required: 'Review required',
  failed: 'Preparation failed',
  error: 'Preparation failed',
} as const satisfies Record<DreamingUiStatus, string>;

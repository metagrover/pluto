import type { IdleDreamingResult } from '../../electron/dreaming/idleDreamingCoordinator';

export type DreamingUiStatus =
  | IdleDreamingResult['status']
  | 'idle'
  | 'running'
  | 'review_required'
  | 'error';

export const DREAMING_STATUS_LABEL = {
  idle: 'Prepare updates',
  running: 'Preparing updates…',
  proposed: 'Updates are ready',
  no_change: 'Current — no updates needed',
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

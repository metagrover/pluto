import { captureSessionLease } from './captureSessionLease';
import { createCaptureJournal } from './captureJournal';
import { getRecordingReadinessStatus, type ReadinessStatus } from './recordingReadiness';

type GetReadinessStatusParams = Parameters<typeof getRecordingReadinessStatus>[0];

export async function handleAudioCaptureJournalStart(options: {
  meetingId?: string;
  startedAtMs?: number;
  expectedSources?: any;
  sourceAvailability?: any;
  sender: { id: number };
  readinessParams: GetReadinessStatusParams;
  watchCaptureOwner: (sender: any) => void;
  knowledgeSynthesisPause: { acquire: (k: string) => void; release: (k: string) => void };
  getMeetingArtifactsRootDir: () => string;
  startParakeetLiveRecording: (sender: any, id: string) => Promise<void>;
  checkReadiness?: typeof getRecordingReadinessStatus;
}) {
  const check = options.checkReadiness || getRecordingReadinessStatus;
  const readiness = await check(options.readinessParams);
  if (!readiness.ready) {
    console.warn('[CaptureLease] rejected: recording_not_ready', readiness.blockers);
    throw new Error('recording_not_ready');
  }

  const normalizedMeetingId = String(options.meetingId || '');
  let acquisition: ReturnType<typeof captureSessionLease.acquire>;
  try {
    acquisition = captureSessionLease.acquire(
      normalizedMeetingId,
      options.sender.id,
    );
  } catch (error) {
    console.warn('[CaptureLease] rejected: active_capture_exists');
    throw error;
  }
  options.watchCaptureOwner(options.sender);
  if (acquisition.status === 'acquired') {
    options.knowledgeSynthesisPause.acquire('capture');
  }
  try {
    const manifest = await createCaptureJournal(
      options.getMeetingArtifactsRootDir(),
      {
        meetingId: normalizedMeetingId,
        startedAtMs: typeof options.startedAtMs === 'number' ? options.startedAtMs : Date.now(),
        schemaVersion: 3,
        expectedSources: options.expectedSources,
        sourceAvailability: options.sourceAvailability,
      },
    );
    await options.startParakeetLiveRecording(
      options.sender,
      normalizedMeetingId,
    ).catch(() => console.warn('[Pluto] parakeet_shadow_start_failed'));
    console.log(`[CaptureLease] ${acquisition.status}`);
    return manifest;
  } catch (error) {
    if (
      acquisition.status === 'acquired' &&
      captureSessionLease.release(normalizedMeetingId, options.sender.id)
    ) {
      options.knowledgeSynthesisPause.release('capture');
      console.warn('[CaptureLease] released: journal_start_failed');
    }
    throw error;
  }
}

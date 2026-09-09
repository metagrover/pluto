import {
  createCaptureJournal,
  readCaptureJournalManifest,
} from './captureJournal';
import type { AudioKeyStore } from './crypto/audioKeyStore';
import { getRecordingReadinessStatus } from './recordingReadiness';

type GetReadinessStatusParams = Parameters<
  typeof getRecordingReadinessStatus
>[0];

export async function handleAudioCaptureJournalStart(options: {
  meetingId?: string;
  startedAtMs?: number;
  expectedSources?: any;
  sourceAvailability?: any;
  sender: { id: number };
  captureSessionLease: ReturnType<
    typeof import('./captureSessionLease').createCaptureSessionLeaseRegistry
  >;
  readinessParams: GetReadinessStatusParams;
  watchCaptureOwner: (sender: any) => void;
  knowledgeSynthesisPause: {
    acquire: (k: any) => void;
    release: (k: any) => void;
  };
  getMeetingArtifactsRootDir: () => string;
  startParakeetLiveRecording: (sender: any, id: string) => Promise<void>;
  checkReadiness?: typeof getRecordingReadinessStatus;
  /** Freeze profile state synchronously; the returned write runs only for a new successful journal. */
  prepareCaptureIdentity?: (meetingId: string) => () => void;
  audioKeyStore?: Pick<AudioKeyStore, 'getOrCreateMeetingAudioKey'> | null;
}) {
  const normalizedMeetingId = String(options.meetingId || '');
  const commitCaptureIdentity =
    options.prepareCaptureIdentity?.(normalizedMeetingId);
  const check = options.checkReadiness || getRecordingReadinessStatus;
  const readiness = await check(options.readinessParams);
  if (!readiness.ready) {
    console.warn(
      '[CaptureLease] rejected: recording_not_ready',
      readiness.blockers,
    );
    throw new Error('recording_not_ready');
  }

  let acquisition: ReturnType<typeof options.captureSessionLease.acquire>;
  try {
    acquisition = options.captureSessionLease.acquire(
      normalizedMeetingId,
      options.sender.id,
    );
  } catch (error: any) {
    if (error.message === 'capture_session_already_active') {
      const active = options.captureSessionLease.activeForOwner(
        options.sender.id,
      );
      if (active?.ownerId === options.sender.id) {
        console.log('[CaptureLease] reused by owner');
        return { meetingId: active.meetingId, state: 'resumed' };
      }
    }
    throw error;
  }
  options.watchCaptureOwner(options.sender);
  if (acquisition.status === 'acquired') {
    options.knowledgeSynthesisPause.acquire('capture');
  }
  try {
    const artifactsRoot = options.getMeetingArtifactsRootDir();
    let keyId: string | undefined;
    let meetingKey: Buffer | undefined;
    let schemaVersion: 3 | 4 = 3;

    if (options.audioKeyStore) {
      try {
        const keyResult =
          options.audioKeyStore.getOrCreateMeetingAudioKey(normalizedMeetingId);
        keyId = keyResult.keyId;
        meetingKey = keyResult.meetingKey;
        schemaVersion = 4;
      } catch (err) {
        console.error('[Pluto] Failed to acquire meeting encryption key:', err);
        throw new Error(
          `audio_key_failure: Failed to acquire encryption key for meeting ${normalizedMeetingId}`,
        );
      }
    }

    let newJournal = false;
    if (commitCaptureIdentity && acquisition.status === 'acquired') {
      try {
        await readCaptureJournalManifest(artifactsRoot, normalizedMeetingId, {
          meetingKey,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        newJournal = true;
      }
    }
    const manifest = await createCaptureJournal(artifactsRoot, {
      meetingId: normalizedMeetingId,
      startedAtMs:
        typeof options.startedAtMs === 'number'
          ? options.startedAtMs
          : Date.now(),
      schemaVersion,
      keyId,
      meetingKey,
      expectedSources: options.expectedSources,
      // Fresh main-process readiness admits both required capture permissions.
      // A renderer permission snapshot can be stale after a successful prompt.
      // Actual transport failures are persisted separately during capture.
      sourceAvailability: { mic: 'available', system: 'available' },
    });
    if (newJournal) commitCaptureIdentity?.();
    await options
      .startParakeetLiveRecording(options.sender, normalizedMeetingId)
      .catch(() => console.warn('[Pluto] parakeet_shadow_start_failed'));
    console.log(`[CaptureLease] ${acquisition.status}`);
    return manifest;
  } catch (error) {
    if (
      acquisition.status === 'acquired' &&
      options.captureSessionLease.release(
        normalizedMeetingId,
        options.sender.id,
      )
    ) {
      options.knowledgeSynthesisPause.release('capture');
      console.warn('[CaptureLease] released: journal_start_failed');
    }
    throw error;
  }
}

import type { LiveMeetingContextCheckpointV1 } from '../../src/types/meetingContext';
import { createLiveMeetingContextIndex } from './liveMeetingContextIndex';

export const createLiveMeetingContextCoordinator = (dependencies: {
  loadCheckpoint(meetingId: string): LiveMeetingContextCheckpointV1 | undefined;
  saveCheckpoint(checkpoint: LiveMeetingContextCheckpointV1): void;
  deleteCheckpoint(meetingId: string): void;
  now?: () => number;
  checkpointIntervalMs?: number;
  checkpointSegmentInterval?: number;
  onError?(operation: 'load' | 'save' | 'delete', error: unknown): void;
}) => {
  const index = createLiveMeetingContextIndex();
  const hydrated = new Set<string>();
  const dirtySegments = new Map<string, number>();
  const lastCheckpointAt = new Map<string, number>();
  const now = dependencies.now ?? Date.now;
  const checkpointIntervalMs = Math.max(
    5_000,
    dependencies.checkpointIntervalMs ?? 30_000,
  );
  const checkpointSegmentInterval = Math.max(
    10,
    dependencies.checkpointSegmentInterval ?? 50,
  );

  const report = (operation: 'load' | 'save' | 'delete', error: unknown) =>
    dependencies.onError?.(operation, error);

  const hydrate = (meetingId: string) => {
    const normalizedMeetingId = meetingId.trim();
    if (!normalizedMeetingId || hydrated.has(normalizedMeetingId)) return;
    hydrated.add(normalizedMeetingId);
    try {
      const checkpoint = dependencies.loadCheckpoint(normalizedMeetingId);
      if (checkpoint) index.restoreCheckpoint(checkpoint);
    } catch (error) {
      report('load', error);
    } finally {
      lastCheckpointAt.set(normalizedMeetingId, now());
    }
  };

  const persist = (meetingId: string) => {
    const normalizedMeetingId = meetingId.trim();
    const checkpoint = index.createCheckpoint(
      normalizedMeetingId,
      new Date(now()).toISOString(),
    );
    if (!checkpoint) return;
    try {
      dependencies.saveCheckpoint(checkpoint);
      dirtySegments.set(normalizedMeetingId, 0);
      lastCheckpointAt.set(normalizedMeetingId, now());
    } catch (error) {
      report('save', error);
    }
  };

  return {
    ingest(meetingId: string, segments: Parameters<typeof index.ingest>[1]) {
      const normalizedMeetingId = meetingId.trim();
      hydrate(normalizedMeetingId);
      const accepted = index.ingest(normalizedMeetingId, segments);
      if (accepted === 0) return 0;
      const dirty = (dirtySegments.get(normalizedMeetingId) ?? 0) + accepted;
      dirtySegments.set(normalizedMeetingId, dirty);
      const elapsed = now() - (lastCheckpointAt.get(normalizedMeetingId) ?? 0);
      if (
        dirty >= checkpointSegmentInterval ||
        elapsed >= checkpointIntervalMs
      ) {
        persist(normalizedMeetingId);
      }
      return accepted;
    },

    select(
      meetingId: string,
      query: string,
      limit?: number,
      intentQuery?: string,
    ) {
      hydrate(meetingId);
      return index.select(meetingId, query, limit, intentQuery);
    },

    flush(meetingId: string) {
      hydrate(meetingId);
      if ((dirtySegments.get(meetingId.trim()) ?? 0) > 0) persist(meetingId);
    },

    clear(meetingId: string, options: { retainCheckpoint?: boolean } = {}) {
      const normalizedMeetingId = meetingId.trim();
      index.clear(normalizedMeetingId);
      hydrated.delete(normalizedMeetingId);
      dirtySegments.delete(normalizedMeetingId);
      lastCheckpointAt.delete(normalizedMeetingId);
      if (!options.retainCheckpoint) {
        try {
          dependencies.deleteCheckpoint(normalizedMeetingId);
        } catch (error) {
          report('delete', error);
        }
      }
    },

    inspect(meetingId: string) {
      hydrate(meetingId);
      return index.inspect(meetingId);
    },
  };
};

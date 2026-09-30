import type { LiveJournalAudio } from '../../src/services/liveTranscription/durableEouSession';
import {
  readCaptureJournalChunk,
  readCaptureJournalManifest,
} from '../captureJournal';

/** Read one checksum-verified chunk without replacing or deleting capture audio. */
export async function readLiveJournalAudio(
  root: string,
  request: { meetingId: string; source: 'mic' | 'system'; fromSeconds: number },
): Promise<LiveJournalAudio> {
  if (
    (request.source !== 'mic' && request.source !== 'system') ||
    !Number.isFinite(request.fromSeconds) ||
    request.fromSeconds < 0
  )
    throw new Error('parakeet_request_invalid');
  const manifest = await readCaptureJournalManifest(root, request.meetingId);
  if (manifest.schemaVersion !== 3 && manifest.schemaVersion !== 4)
    throw new Error('parakeet_journal_unavailable');
  const latestEndSeconds = manifest.intervals.at(-1)?.chunkEndSec ?? 0;
  const interval = manifest.intervals.find(
    (entry) => entry.chunkEndSec > request.fromSeconds + 0.000001,
  );
  if (!interval) return { kind: 'waiting', latestEndSeconds };
  const source = interval.sources[request.source];
  if (source.disposition === 'pending')
    return { kind: 'waiting', latestEndSeconds };
  if (
    source.disposition !== 'captured' &&
    source.disposition !== 'raw_durable'
  ) {
    return { kind: 'gap', endSeconds: interval.chunkEndSec, latestEndSeconds };
  }
  const relativePath =
    source.disposition === 'captured'
      ? source.repairRelativePath
      : source.rawRelativePath;
  const data = await readCaptureJournalChunk(
    root,
    request.meetingId,
    relativePath,
  );
  return {
    kind: 'audio',
    data: new Uint8Array(data),
    startSeconds: interval.chunkStartSec,
    endSeconds: interval.chunkEndSec,
    latestEndSeconds,
  };
}

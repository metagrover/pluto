import { selectSpeakerSampleIntervals } from '../src/utils/speakerReview';
import { parseTranscriptSegments } from '../src/utils/transcript';

const CANONICAL_REVIEWABLE_SPEAKER = /^(?:Remote Speaker \d+|Them)$/u;
const MAX_SAMPLE_INDEX = 1;
const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;

export interface SpeakerSampleRequest {
  meetingId: string;
  speaker: string;
  sampleIndex: number;
}

export interface SpeakerSample {
  bytes: Uint8Array;
  mimeType: 'audio/wav';
  durationSeconds: number;
  excerpt: string;
  sampleIndex: number;
  sampleCount: number;
}

type SampleMeeting = {
  id: string | number;
  transcript_json?: string | null;
  system_audio_path?: string | null;
};

export interface SpeakerSampleDependencies {
  getMeeting: (meetingId: string) => SampleMeeting | null | undefined;
  fileExists: (path: string) => boolean;
  createTemporaryPath: () => string;
  sliceWav: (input: {
    inputPath: string;
    outputPath: string;
    startSec: number;
    durationSec: number;
  }) => Promise<boolean>;
  readFile: (path: string) => Promise<Uint8Array>;
  removeFile: (path: string) => Promise<void>;
  readEncryptedSlice?: (input: {
    meetingId: string;
    inputPath: string;
    startSec: number;
    durationSec: number;
  }) => Promise<Uint8Array | null>;
}

const validRequest = (value: unknown): value is SpeakerSampleRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    Object.keys(request).length === 3 &&
    typeof request.meetingId === 'string' &&
    request.meetingId.trim() === request.meetingId &&
    request.meetingId.length > 0 &&
    request.meetingId.length <= 256 &&
    typeof request.speaker === 'string' &&
    CANONICAL_REVIEWABLE_SPEAKER.test(request.speaker) &&
    Number.isInteger(request.sampleIndex) &&
    Number(request.sampleIndex) >= 0 &&
    Number(request.sampleIndex) <= MAX_SAMPLE_INDEX
  );
};

export const loadSpeakerSample = async (
  request: unknown,
  dependencies: SpeakerSampleDependencies,
): Promise<SpeakerSample | null> => {
  if (!validRequest(request)) throw new Error('speaker_sample_request_invalid');

  const meeting = dependencies.getMeeting(request.meetingId);
  const inputPath = meeting?.system_audio_path;
  if (
    !meeting ||
    String(meeting.id) !== request.meetingId ||
    typeof inputPath !== 'string' ||
    !inputPath ||
    !dependencies.fileExists(inputPath)
  ) {
    return null;
  }

  const intervals = selectSpeakerSampleIntervals(
    parseTranscriptSegments(meeting.transcript_json),
    request.speaker,
  );
  const interval = intervals[request.sampleIndex];
  if (!interval) return null;

  if (inputPath.endsWith('.enc')) {
    if (!dependencies.readEncryptedSlice) return null;
    const bytes = await dependencies.readEncryptedSlice({
      meetingId: request.meetingId,
      inputPath,
      startSec: interval.startSec,
      durationSec: interval.endSec - interval.startSec,
    });
    if (
      !bytes ||
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_SAMPLE_BYTES
    ) {
      return null;
    }
    return {
      bytes,
      mimeType: 'audio/wav',
      durationSeconds: interval.endSec - interval.startSec,
      excerpt: interval.excerpt,
      sampleIndex: request.sampleIndex,
      sampleCount: intervals.length,
    };
  }

  const outputPath = dependencies.createTemporaryPath();
  try {
    const sliced = await dependencies.sliceWav({
      inputPath,
      outputPath,
      startSec: interval.startSec,
      durationSec: interval.endSec - interval.startSec,
    });
    if (!sliced || !dependencies.fileExists(outputPath)) return null;
    const bytes = await dependencies.readFile(outputPath);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_SAMPLE_BYTES) {
      return null;
    }
    return {
      bytes,
      mimeType: 'audio/wav',
      durationSeconds: interval.endSec - interval.startSec,
      excerpt: interval.excerpt,
      sampleIndex: request.sampleIndex,
      sampleCount: intervals.length,
    };
  } catch {
    return null;
  } finally {
    await dependencies.removeFile(outputPath).catch(() => undefined);
  }
};

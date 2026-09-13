import type {
  SpeakerSampleAvailability,
  SpeakerSamplePayload,
  SpeakerSampleResult,
  SpeakerSampleUnavailableReason,
} from '../src/types/speakerSample';
import { selectSpeakerPlaybackIntervals } from '../src/utils/speakerReview';
import { parseTranscriptSegments } from '../src/utils/transcript';

const CANONICAL_REVIEWABLE_SPEAKER = /^(?:Remote Speaker \d+|Them)$/u;
const MAX_SAMPLE_INDEX = 1;
const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;
const MAX_RETURNED_SAMPLES = MAX_SAMPLE_INDEX + 1;
const MAX_PLAYBACK_CANDIDATES = 12;
// Reject near-digital silence below -54 dBFS. This is a playback usefulness
// check, not evidence that a clip is clean enough for voice enrollment.
const MIN_AUDIBLE_PCM16_RMS = 10 ** (-54 / 20);

export interface SpeakerSampleRequest {
  meetingId: string;
  speaker: string;
  sampleIndex: number;
}

type SpeakerSample = SpeakerSamplePayload;

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

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

/** Returns null for an unsupported WAV layout so successful decoding remains usable. */
const hasAudiblePcm16Wav = (bytes: Uint8Array): boolean | null => {
  if (
    bytes.byteLength < 44 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WAVE'
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let pcm16 = false;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= bytes.byteLength) {
    const chunk = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    if (payloadOffset + size > bytes.byteLength) return null;
    if (chunk === 'fmt ' && size >= 16) {
      pcm16 =
        view.getUint16(payloadOffset, true) === 1 &&
        view.getUint16(payloadOffset + 14, true) === 16;
    } else if (chunk === 'data') {
      dataOffset = payloadOffset;
      dataLength = size;
      break;
    }
    offset = payloadOffset + size + (size % 2);
  }
  if (!pcm16 || dataOffset < 0 || dataLength < 2) return null;
  let squareSum = 0;
  let count = 0;
  for (
    let index = dataOffset;
    index + 1 < dataOffset + dataLength;
    index += 2
  ) {
    const sample = view.getInt16(index, true) / 32768;
    squareSum += sample * sample;
    count += 1;
  }
  return count > 0 && Math.sqrt(squareSum / count) >= MIN_AUDIBLE_PCM16_RMS;
};

const resolveSpeakerSample = (
  request: SpeakerSampleRequest,
  dependencies: Pick<SpeakerSampleDependencies, 'getMeeting' | 'fileExists'>,
):
  | {
      status: 'available';
      inputPath: string;
      intervals: ReturnType<typeof selectSpeakerPlaybackIntervals>;
      scope: SpeakerSample['scope'];
    }
  | { status: 'unavailable'; reason: SpeakerSampleUnavailableReason } => {
  const meeting = dependencies.getMeeting(request.meetingId);
  if (!meeting || String(meeting.id) !== request.meetingId) {
    return { status: 'unavailable', reason: 'meeting_unavailable' };
  }
  const inputPath = meeting.system_audio_path;
  if (
    typeof inputPath !== 'string' ||
    !inputPath ||
    !dependencies.fileExists(inputPath)
  ) {
    return { status: 'unavailable', reason: 'source_unavailable' };
  }
  const intervals = selectSpeakerPlaybackIntervals(
    parseTranscriptSegments(meeting.transcript_json),
    request.speaker,
    MAX_PLAYBACK_CANDIDATES,
  );
  if (intervals.length === 0) {
    return { status: 'unavailable', reason: 'no_speaker_excerpt' };
  }
  return {
    status: 'available',
    inputPath,
    intervals,
    scope: request.speaker === 'Them' ? 'remote_channel' : 'speaker',
  };
};

export const getSpeakerSampleAvailability = (
  request: unknown,
  dependencies: Pick<SpeakerSampleDependencies, 'getMeeting' | 'fileExists'>,
): SpeakerSampleAvailability => {
  if (!validRequest(request)) throw new Error('speaker_sample_request_invalid');
  const resolved = resolveSpeakerSample(request, dependencies);
  return resolved.status === 'available'
    ? {
        status: 'available',
        sampleCount: Math.min(MAX_RETURNED_SAMPLES, resolved.intervals.length),
        scope: resolved.scope,
      }
    : resolved;
};

export const loadSpeakerSample = async (
  request: unknown,
  dependencies: SpeakerSampleDependencies,
): Promise<SpeakerSampleResult> => {
  if (!validRequest(request)) throw new Error('speaker_sample_request_invalid');
  const resolved = resolveSpeakerSample(request, dependencies);
  if (resolved.status === 'unavailable') return resolved;
  const { inputPath, intervals, scope } = resolved;
  if (inputPath.endsWith('.enc') && !dependencies.readEncryptedSlice) {
    return { status: 'unavailable', reason: 'encrypted_audio_unavailable' };
  }

  const audible: Array<{
    bytes: Uint8Array;
    interval: (typeof intervals)[number];
  }> = [];
  let emptyCandidate = false;
  let silentCandidate = false;
  let oversizedCandidate = false;
  let encryptedAudioUnavailable = false;
  for (const interval of intervals) {
    let bytes: Uint8Array | null = null;
    if (inputPath.endsWith('.enc')) {
      try {
        bytes =
          (await dependencies.readEncryptedSlice?.({
            meetingId: request.meetingId,
            inputPath,
            startSec: interval.startSec,
            durationSec: interval.endSec - interval.startSec,
          })) ?? null;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return { status: 'unavailable', reason: 'cancelled' };
        }
        if (/audio_key|encrypted_audio_unavailable/iu.test(String(error))) {
          encryptedAudioUnavailable = true;
        }
        bytes = null;
      }
    } else {
      const outputPath = dependencies.createTemporaryPath();
      try {
        const sliced = await dependencies.sliceWav({
          inputPath,
          outputPath,
          startSec: interval.startSec,
          durationSec: interval.endSec - interval.startSec,
        });
        if (sliced && dependencies.fileExists(outputPath)) {
          bytes = await dependencies.readFile(outputPath);
        }
      } catch {
        bytes = null;
      } finally {
        await dependencies.removeFile(outputPath).catch(() => undefined);
      }
    }
    if (!bytes) continue;
    if (bytes.byteLength === 0) {
      emptyCandidate = true;
      continue;
    }
    if (bytes.byteLength > MAX_SAMPLE_BYTES) {
      oversizedCandidate = true;
      continue;
    }
    if (hasAudiblePcm16Wav(bytes) === false) {
      silentCandidate = true;
      continue;
    }
    audible.push({ bytes, interval });
    if (audible.length >= MAX_RETURNED_SAMPLES) break;
  }

  const selected = audible[request.sampleIndex];
  if (!selected) {
    let reason: SpeakerSampleUnavailableReason = 'audio_decode_failed';
    if (encryptedAudioUnavailable) reason = 'encrypted_audio_unavailable';
    else if (oversizedCandidate) reason = 'audio_too_large';
    else if (audible.length > 0) reason = 'no_speaker_excerpt';
    else if (silentCandidate) reason = 'no_audible_speech';
    else if (emptyCandidate) reason = 'audio_empty';
    return { status: 'unavailable', reason };
  }
  return {
    status: 'ready',
    sample: {
      bytes: selected.bytes,
      mimeType: 'audio/wav',
      durationSeconds: selected.interval.endSec - selected.interval.startSec,
      excerpt: selected.interval.excerpt,
      sampleIndex: request.sampleIndex,
      sampleCount: audible.length,
      scope,
    },
  };
};

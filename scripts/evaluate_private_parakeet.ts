import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

import { segmentRecognizedWords } from '../src/services/finalTranscription/segmentRecognizedWords.ts';
import { runRecordingTranscriptValidation } from '../src/services/recordingTranscriptValidation.ts';

type MeetingRow = {
  id: string;
  duration_seconds: number;
  audio_path: string | null;
  system_audio_path: string | null;
  transcript_json: string;
};

type ReferenceSegment = {
  text?: string;
  speaker?: string;
  startTime?: number;
  endTime?: number;
};

type RuntimeResponse = {
  id: string;
  ok: boolean;
  result?: {
    modelVersion?: string;
    transcription?: {
      text: string;
      durationSeconds: number;
      noSpeech: boolean;
      words: Array<{
        text: string;
        startSeconds: number;
        endSeconds: number;
      }>;
    };
  };
  error?: { code?: string };
};

const option = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} is required.`);
  }
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} needs a value.`);
  return value;
};

const normalizeTokens = (text: string) =>
  text
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

const editDistance = (left: string[], right: string[]) => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      );
    }
    previous = current;
  }
  return previous[right.length];
};

const multisetIntersectionSize = (left: string[], right: string[]) => {
  const remaining = new Map<string, number>();
  for (const token of right) {
    remaining.set(token, (remaining.get(token) || 0) + 1);
  }
  let intersection = 0;
  for (const token of left) {
    const count = remaining.get(token) || 0;
    if (count <= 0) continue;
    intersection += 1;
    remaining.set(token, count - 1);
  }
  return intersection;
};

const runtimePath = path.resolve(option('--runtime'));
const databasePath = path.resolve(option('--database'));
const modelRoot = path.resolve(option('--model-root'));
const audioRoot = path.resolve(option('--audio-root'));
const meetingLimit = Math.max(1, Math.min(5, Number(option('--limit', '2'))));

for (const [label, filePath] of [
  ['runtime', runtimePath],
  ['database', databasePath],
] as const) {
  if (!fs.statSync(filePath).isFile())
    throw new Error(`${label} is unavailable.`);
}
fs.mkdirSync(modelRoot, { recursive: true });

const sql = `
  SELECT id, duration_seconds, audio_path, system_audio_path, transcript_json
  FROM meetings
  WHERE json_valid(transcript_json)
    AND (
      (json_type(transcript_json) = 'array' AND json_array_length(transcript_json) > 0)
      OR
      (json_type(transcript_json) = 'object' AND json_array_length(transcript_json, '$.segments') > 0)
    )
    AND duration_seconds BETWEEN 120 AND 3600
    AND started_at >= datetime('now', '-30 days')
  ORDER BY started_at DESC
  LIMIT 20;
`;
const candidateJson = execFileSync('sqlite3', ['-json', databasePath, sql], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
}).trim();
const candidates = (
  candidateJson ? JSON.parse(candidateJson) : []
) as MeetingRow[];
const meetings = candidates
  .filter(
    (entry) =>
      (entry.audio_path && fs.existsSync(entry.audio_path)) ||
      (entry.system_audio_path && fs.existsSync(entry.system_audio_path)),
  )
  .slice(0, meetingLimit);
if (meetings.length < meetingLimit) {
  throw new Error('Not enough recent local meeting artifacts are available.');
}

const child = spawn(
  runtimePath,
  ['--model-root', modelRoot, '--audio-root', audioRoot],
  { stdio: ['pipe', 'pipe', 'ignore'] },
);
const pending = new Map<
  string,
  {
    resolve: (response: RuntimeResponse) => void;
    reject: (error: Error) => void;
  }
>();
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let response: RuntimeResponse;
  try {
    response = JSON.parse(line) as RuntimeResponse;
  } catch {
    for (const request of pending.values()) {
      request.reject(new Error('parakeet_protocol_invalid'));
    }
    pending.clear();
    return;
  }
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  request.resolve(response);
});
child.once('exit', () => {
  for (const request of pending.values()) {
    request.reject(new Error('parakeet_process_exited'));
  }
  pending.clear();
});

let requestCounter = 0;
const request = (payload: Record<string, unknown>) =>
  new Promise<RuntimeResponse>((resolve, reject) => {
    const id = `private-eval-${++requestCounter}`;
    pending.set(id, { resolve, reject });
    child.stdin.write(
      `${JSON.stringify({ schemaVersion: 1, id, ...payload })}\n`,
    );
  });

let peakRssBytes = 0;
const sampleRss = setInterval(() => {
  try {
    const rssKb = Number(
      execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)], {
        encoding: 'utf8',
      }).trim(),
    );
    if (Number.isFinite(rssKb))
      peakRssBytes = Math.max(peakRssBytes, rssKb * 1024);
  } catch {
    // Process exit is handled by the request boundary.
  }
}, 250);

const startedAt = performance.now();
const prepare = await request({ method: 'prepare' });
if (!prepare.ok)
  throw new Error(prepare.error?.code || 'parakeet_prepare_failed');

let sourceCount = 0;
let referenceWordCount = 0;
let candidateWordCount = 0;
let editCount = 0;
let canonicalReferenceWordCount = 0;
let canonicalCandidateWordCount = 0;
let canonicalEditCount = 0;
let canonicalTokenIntersectionCount = 0;
let canonicalValidationFailureCount = 0;
let timestampFailureCount = 0;
let overlappingWordCount = 0;
let maximumWordOverlapSeconds = 0;
let outOfBoundsWordCount = 0;
let noSpeechContradictionCount = 0;
let totalAudioSeconds = 0;

for (const meeting of meetings) {
  const parsedReference = JSON.parse(meeting.transcript_json) as
    | ReferenceSegment[]
    | { segments?: ReferenceSegment[] };
  const reference = Array.isArray(parsedReference)
    ? parsedReference
    : parsedReference.segments || [];
  const sourceTranscriptions: Partial<
    Record<
      'mic' | 'system',
      NonNullable<RuntimeResponse['result']>['transcription']
    >
  > = {};
  for (const source of ['mic', 'system'] as const) {
    const audioPath =
      source === 'mic' ? meeting.audio_path : meeting.system_audio_path;
    if (!audioPath || !fs.existsSync(audioPath)) continue;
    const expectedSpeaker = source === 'mic' ? 'Me' : 'Them';
    const referenceTokens = normalizeTokens(
      reference
        .filter((segment) => segment.speaker === expectedSpeaker)
        .map((segment) => String(segment.text || ''))
        .join(' '),
    );
    const response = await request({
      method: 'transcribe',
      audioPath,
      language: 'en',
      vocabulary: [],
    });
    if (!response.ok || !response.result?.transcription) {
      throw new Error(response.error?.code || 'parakeet_transcription_failed');
    }
    const transcription = response.result.transcription;
    sourceTranscriptions[source] = transcription;
    const candidateTokens = normalizeTokens(transcription.text);
    editCount += editDistance(referenceTokens, candidateTokens);
    referenceWordCount += Math.max(1, referenceTokens.length);
    candidateWordCount += candidateTokens.length;
    sourceCount += 1;
    totalAudioSeconds += transcription.durationSeconds;
    if (transcription.noSpeech && referenceTokens.length > 0) {
      noSpeechContradictionCount += 1;
    }
    let priorEnd = 0;
    const timingsValid = transcription.words.every((word) => {
      const overlapSeconds = Math.max(0, priorEnd - word.startSeconds);
      if (overlapSeconds > 0) {
        overlappingWordCount += 1;
        maximumWordOverlapSeconds = Math.max(
          maximumWordOverlapSeconds,
          overlapSeconds,
        );
      }
      if (word.endSeconds > transcription.durationSeconds + 0.25) {
        outOfBoundsWordCount += 1;
      }
      const valid =
        Number.isFinite(word.startSeconds) &&
        Number.isFinite(word.endSeconds) &&
        word.startSeconds >= 0 &&
        word.endSeconds >= word.startSeconds &&
        word.startSeconds + 0.1 >= priorEnd &&
        word.endSeconds <= transcription.durationSeconds + 0.25;
      priorEnd = Math.max(priorEnd, word.endSeconds);
      return valid;
    });
    if (!timingsValid) timestampFailureCount += 1;
  }

  const validation = await runRecordingTranscriptValidation({
    meetingId: meeting.id,
    recordingDurationSeconds: meeting.duration_seconds,
    micAudioPath: meeting.audio_path || '',
    mixAudioPath: '',
    systemAudioPath: meeting.system_audio_path || '',
    provisionalSegments: [],
    activityWindows: reference.flatMap((segment) => {
      const startTime = Number(segment.startTime);
      const endTime = Number(segment.endTime);
      return (segment.speaker === 'Me' || segment.speaker === 'Them') &&
        Number.isFinite(startTime) &&
        Number.isFinite(endTime) &&
        endTime > startTime
        ? [{ speaker: segment.speaker, startTime, endTime }]
        : [];
    }),
    canonicalMode: 'recovered_channels',
    transcriptionScheduling: 'sequential_channels',
    transcribe: async (_audioPath, options) => {
      if (options.canonicalSource === 'mix') return { segments: [] };
      const transcription = sourceTranscriptions[options.canonicalSource];
      if (!transcription) return { segments: [] };
      return {
        segments: segmentRecognizedWords(
          transcription.words.map((word) => ({
            word: word.text,
            start: word.startSeconds,
            end: word.endSeconds,
          })),
          transcription.durationSeconds,
        ),
        vad: {
          status: transcription.noSpeech
            ? ('no_speech' as const)
            : ('speech' as const),
          speechSeconds: transcription.noSpeech
            ? 0
            : transcription.durationSeconds,
        },
      };
    },
    probeDuration: async () => meeting.duration_seconds,
  });
  if (validation.status !== 'validated') canonicalValidationFailureCount += 1;
  const canonicalReferenceTokens = normalizeTokens(
    reference.map((segment) => String(segment.text || '')).join(' '),
  );
  const canonicalCandidateTokens = normalizeTokens(
    validation.segments.map((segment) => segment.text).join(' '),
  );
  canonicalReferenceWordCount += Math.max(1, canonicalReferenceTokens.length);
  canonicalCandidateWordCount += canonicalCandidateTokens.length;
  canonicalEditCount += editDistance(
    canonicalReferenceTokens,
    canonicalCandidateTokens,
  );
  canonicalTokenIntersectionCount += multisetIntersectionSize(
    canonicalReferenceTokens,
    canonicalCandidateTokens,
  );
}

const elapsedSeconds = (performance.now() - startedAt) / 1000;
await request({ method: 'shutdown' });
child.stdin.end();
clearInterval(sampleRss);

console.log(
  JSON.stringify({
    schemaVersion: 1,
    referenceKind: 'existing_local_transcript_proxy_not_human_ground_truth',
    meetingCount: meetings.length,
    sourceCount,
    referenceWordCount,
    candidateWordCount,
    wordDisagreementRate: Number(
      (editCount / Math.max(1, referenceWordCount)).toFixed(4),
    ),
    canonicalReferenceWordCount,
    canonicalCandidateWordCount,
    canonicalWordDisagreementRate: Number(
      (canonicalEditCount / Math.max(1, canonicalReferenceWordCount)).toFixed(
        4,
      ),
    ),
    canonicalLexicalPrecision: Number(
      (
        canonicalTokenIntersectionCount /
        Math.max(1, canonicalCandidateWordCount)
      ).toFixed(4),
    ),
    canonicalLexicalRecall: Number(
      (
        canonicalTokenIntersectionCount /
        Math.max(1, canonicalReferenceWordCount)
      ).toFixed(4),
    ),
    canonicalValidationFailureCount,
    timestampFailureCount,
    overlappingWordCount,
    maximumWordOverlapSeconds: Number(maximumWordOverlapSeconds.toFixed(4)),
    outOfBoundsWordCount,
    noSpeechContradictionCount,
    elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
    realTimeFactor: Number(
      (elapsedSeconds / Math.max(1, totalAudioSeconds)).toFixed(4),
    ),
    peakChildRssMiB: Number((peakRssBytes / 1024 / 1024).toFixed(1)),
  }),
);

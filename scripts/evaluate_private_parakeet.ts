import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

import { segmentRecognizedWords } from '../src/services/finalTranscription/segmentRecognizedWords.ts';
import {
  distributeTimedTokens,
  hasPrivateReviewSpeechInWindow,
  matchTimeAlignedTokens,
  multisetTokenIntersectionSize,
  normalizePrivateEvaluationFailureCode,
  normalizeTranscriptTokens,
  privateEvaluationSourceDuration,
  privateReviewTimelineDuration,
  transcriptEditDistance,
} from '../src/services/privateTranscriptionMetrics.ts';
import { PRIVATE_TRANSCRIPTION_REVIEW_MINIMUM_CASES } from '../src/services/privateTranscriptionReview.ts';
import { runRecordingTranscriptValidation } from '../src/services/recordingTranscriptValidation.ts';
import { writeOwnerOnlyPrivateFile } from './lib/privateEvaluationFile.ts';

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

const optionalOption = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1]
    ? path.resolve(process.argv[index + 1])
    : undefined;
};

const runtimePath = path.resolve(option('--runtime'));
const databasePath = path.resolve(option('--database'));
const modelRoot = path.resolve(option('--model-root'));
const audioRoot = path.resolve(option('--audio-root'));
const meetingLimit = Math.max(1, Math.min(5, Number(option('--limit', '2'))));
const reviewOut = optionalOption('--review-out');
const reviewCaseLimit = Math.max(
  6,
  Math.min(
    40,
    Number(
      option(
        '--review-cases',
        String(PRIVATE_TRANSCRIPTION_REVIEW_MINIMUM_CASES),
      ),
    ),
  ),
);

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
    timeout: NodeJS.Timeout;
  }
>();
const output = readline.createInterface({ input: child.stdout });
const rejectPending = (error: Error) => {
  for (const pendingRequest of pending.values()) {
    clearTimeout(pendingRequest.timeout);
    pendingRequest.reject(error);
  }
  pending.clear();
};
output.on('line', (line) => {
  let response: RuntimeResponse;
  try {
    response = JSON.parse(line) as RuntimeResponse;
  } catch {
    rejectPending(new Error('parakeet_protocol_invalid'));
    return;
  }
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  clearTimeout(request.timeout);
  request.resolve(response);
});
child.once('exit', () => {
  rejectPending(new Error('parakeet_process_exited'));
});
child.once('error', () => rejectPending(new Error('parakeet_process_exited')));

let requestCounter = 0;
const request = (payload: Record<string, unknown>, timeoutMs = 10 * 60_000) =>
  new Promise<RuntimeResponse>((resolve, reject) => {
    const id = `private-eval-${++requestCounter}`;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('parakeet_request_timeout'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
    try {
      child.stdin.write(
        `${JSON.stringify({ schemaVersion: 1, id, ...payload })}\n`,
      );
    } catch {
      clearTimeout(timeout);
      pending.delete(id);
      reject(new Error('parakeet_process_exited'));
    }
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

try {
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
  let timeAlignedReferenceWordCount = 0;
  const timeAlignedMatchCounts = new Map<number, number>([
    [2, 0],
    [5, 0],
    [10, 0],
  ]);
  const timeAlignedCandidateWordCounts = new Map<number, number>([
    [2, 0],
    [5, 0],
    [10, 0],
  ]);
  let maximumSourceDurationMismatchSeconds = 0;
  let maximumReferenceEndMismatchSeconds = 0;
  let minimumReferenceTimelineCoverageRatio = 1;
  let minimumCandidateTimelineCoverageRatio = 1;
  let invalidReferenceSegmentCount = 0;
  const reviewCandidates: Array<{
    score: number;
    caseLabel: string;
    start: number;
    end: number;
    referenceText: string;
    candidateText: string;
    micAudioPath?: string;
    systemAudioPath?: string;
  }> = [];
  let canonicalValidationFailureCount = 0;
  let timestampFailureCount = 0;
  let overlappingWordCount = 0;
  let maximumWordOverlapSeconds = 0;
  let outOfBoundsWordCount = 0;
  let noSpeechContradictionCount = 0;
  let totalAudioSeconds = 0;
  let evaluatedMeetingCount = 0;
  let failedMeetingCount = 0;
  const runtimeFailureCounts = new Map<string, number>();

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
    let meetingFailureCode: string | undefined;
    for (const source of ['mic', 'system'] as const) {
      const audioPath =
        source === 'mic' ? meeting.audio_path : meeting.system_audio_path;
      if (!audioPath || !fs.existsSync(audioPath)) continue;
      let response: RuntimeResponse;
      try {
        response = await request({
          method: 'transcribe',
          audioPath,
          language: 'en',
          vocabulary: [],
        });
      } catch (error) {
        meetingFailureCode = normalizePrivateEvaluationFailureCode(
          error instanceof Error ? error.message : undefined,
        );
        break;
      }
      if (!response.ok || !response.result?.transcription) {
        meetingFailureCode = normalizePrivateEvaluationFailureCode(
          response.error?.code,
        );
        break;
      }
      sourceTranscriptions[source] = response.result.transcription;
    }
    if (meetingFailureCode) {
      failedMeetingCount += 1;
      runtimeFailureCounts.set(
        meetingFailureCode,
        (runtimeFailureCounts.get(meetingFailureCode) || 0) + 1,
      );
      continue;
    }
    evaluatedMeetingCount += 1;

    for (const source of ['mic', 'system'] as const) {
      const transcription = sourceTranscriptions[source];
      if (!transcription) continue;
      const expectedSpeaker = source === 'mic' ? 'Me' : 'Them';
      const referenceTokens = normalizeTranscriptTokens(
        reference
          .filter((segment) => segment.speaker === expectedSpeaker)
          .map((segment) => String(segment.text || ''))
          .join(' '),
      );
      const candidateTokens = normalizeTranscriptTokens(transcription.text);
      editCount += transcriptEditDistance(referenceTokens, candidateTokens);
      referenceWordCount += Math.max(1, referenceTokens.length);
      candidateWordCount += candidateTokens.length;
      sourceCount += 1;
      totalAudioSeconds += transcription.durationSeconds;
      maximumSourceDurationMismatchSeconds = Math.max(
        maximumSourceDurationMismatchSeconds,
        Math.abs(transcription.durationSeconds - meeting.duration_seconds),
      );
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
      probeDuration: async (audioPath) =>
        privateEvaluationSourceDuration(audioPath, {
          micPath: meeting.audio_path,
          micDurationSeconds: sourceTranscriptions.mic?.durationSeconds ?? null,
          systemPath: meeting.system_audio_path,
          systemDurationSeconds:
            sourceTranscriptions.system?.durationSeconds ?? null,
        }),
    });
    if (validation.status !== 'validated') canonicalValidationFailureCount += 1;
    const canonicalReferenceTokens = normalizeTranscriptTokens(
      reference.map((segment) => String(segment.text || '')).join(' '),
    );
    const canonicalCandidateTokens = normalizeTranscriptTokens(
      validation.segments.map((segment) => segment.text).join(' '),
    );
    canonicalReferenceWordCount += Math.max(1, canonicalReferenceTokens.length);
    canonicalCandidateWordCount += canonicalCandidateTokens.length;
    canonicalEditCount += transcriptEditDistance(
      canonicalReferenceTokens,
      canonicalCandidateTokens,
    );
    canonicalTokenIntersectionCount += multisetTokenIntersectionSize(
      canonicalReferenceTokens,
      canonicalCandidateTokens,
    );
    const boundedReference = reference.flatMap((segment) => {
      const start = Number(segment.startTime);
      const end = Number(segment.endTime);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start ||
        start >= meeting.duration_seconds
      ) {
        invalidReferenceSegmentCount += 1;
        return [];
      }
      if (end > meeting.duration_seconds) invalidReferenceSegmentCount += 1;
      return [
        {
          text: String(segment.text || ''),
          start,
          end: Math.min(end, meeting.duration_seconds),
        },
      ];
    });
    const timedReference = distributeTimedTokens(boundedReference);
    const maximumReferenceEnd = reference.reduce(
      (maximum, segment) => Math.max(maximum, Number(segment.endTime) || 0),
      0,
    );
    maximumReferenceEndMismatchSeconds = Math.max(
      maximumReferenceEndMismatchSeconds,
      Math.abs(maximumReferenceEnd - meeting.duration_seconds),
    );
    minimumReferenceTimelineCoverageRatio = Math.min(
      minimumReferenceTimelineCoverageRatio,
      maximumReferenceEnd / Math.max(1, meeting.duration_seconds),
    );
    const timedCandidate = validation.segments.flatMap((segment) =>
      segment.words?.length
        ? segment.words
            .map((word) => ({
              token: normalizeTranscriptTokens(word.word)[0] || '',
              at: (word.start + word.end) / 2,
            }))
            .filter((word) => word.token)
        : distributeTimedTokens([
            {
              text: segment.text,
              start: segment.startTime,
              end: segment.endTime,
            },
          ]),
    );
    const reviewTimelineDuration = privateReviewTimelineDuration(
      meeting.duration_seconds,
      [
        sourceTranscriptions.mic?.durationSeconds,
        sourceTranscriptions.system?.durationSeconds,
      ],
    );
    if (
      reviewOut &&
      validation.status === 'validated' &&
      reviewTimelineDuration !== null
    ) {
      for (let start = 0; start < reviewTimelineDuration; start += 30) {
        const end = Math.min(reviewTimelineDuration, start + 30);
        if (
          !hasPrivateReviewSpeechInWindow(
            sourceTranscriptions.system?.words ?? [],
            start,
            end,
          )
        )
          continue;
        const referenceText = reference
          .filter(
            (segment) =>
              Number(segment.startTime) < end &&
              Number(segment.endTime) > start,
          )
          .map((segment) => String(segment.text || ''))
          .join(' ')
          .trim();
        const candidateText = validation.segments
          .filter(
            (segment) => segment.startTime < end && segment.endTime > start,
          )
          .map((segment) => segment.text)
          .join(' ')
          .trim();
        const referenceTokens = normalizeTranscriptTokens(referenceText);
        const candidateTokens = normalizeTranscriptTokens(candidateText);
        if (referenceTokens.length < 10 || candidateTokens.length < 10)
          continue;
        reviewCandidates.push({
          score:
            transcriptEditDistance(referenceTokens, candidateTokens) /
            Math.max(referenceTokens.length, candidateTokens.length),
          caseLabel: `meeting-${meetings.indexOf(meeting) + 1}`,
          start,
          end,
          referenceText,
          candidateText,
          micAudioPath: meeting.audio_path || undefined,
          systemAudioPath: meeting.system_audio_path || undefined,
        });
      }
    }
    const maximumCandidateEnd = validation.segments.reduce(
      (maximum, segment) => Math.max(maximum, segment.endTime),
      0,
    );
    minimumCandidateTimelineCoverageRatio = Math.min(
      minimumCandidateTimelineCoverageRatio,
      maximumCandidateEnd / Math.max(1, meeting.duration_seconds),
    );
    timeAlignedReferenceWordCount += timedReference.length;
    for (const tolerance of timeAlignedMatchCounts.keys()) {
      const coveredCandidate = timedCandidate.filter(
        (entry) => entry.at <= maximumReferenceEnd + tolerance,
      );
      const aligned = matchTimeAlignedTokens(
        timedReference,
        coveredCandidate,
        tolerance,
      );
      timeAlignedMatchCounts.set(
        tolerance,
        (timeAlignedMatchCounts.get(tolerance) || 0) + aligned.matched,
      );
      timeAlignedCandidateWordCounts.set(
        tolerance,
        (timeAlignedCandidateWordCounts.get(tolerance) || 0) +
          coveredCandidate.length,
      );
    }
  }

  const elapsedSeconds = (performance.now() - startedAt) / 1000;

  if (reviewOut) {
    const reviewId = randomUUID();
    const escapeHtml = (value: string) =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    const selected = reviewCandidates
      .sort((left, right) => right.score - left.score)
      .slice(0, reviewCaseLimit);
    const cards = selected
      .map((entry, index) => {
        const candidateLabel = index % 2 === 0 ? 'b' : 'a';
        const transcriptA =
          candidateLabel === 'a' ? entry.candidateText : entry.referenceText;
        const transcriptB =
          candidateLabel === 'b' ? entry.candidateText : entry.referenceText;
        const media = [
          entry.micAudioPath
            ? `<label>Mic<audio controls preload="metadata" src="${pathToFileURL(entry.micAudioPath).href}#t=${entry.start},${entry.end}"></audio></label>`
            : '',
          entry.systemAudioPath
            ? `<label>System<audio controls preload="metadata" src="${pathToFileURL(entry.systemAudioPath).href}#t=${entry.start},${entry.end}"></audio></label>`
            : '',
        ].join('');
        return `<article data-case="review-${index + 1}"><h2>Excerpt ${index + 1}</h2><p class="meta">${escapeHtml(entry.caseLabel)} · ${Math.round(entry.start)}–${Math.round(entry.end)} seconds</p><div class="audio">${media}</div><div class="comparison"><section><h3>Transcript A</h3><p>${escapeHtml(transcriptA)}</p></section><section><h3>Transcript B</h3><p>${escapeHtml(transcriptB)}</p></section></div><label class="rating">Which is more accurate?<select><option value="">Choose…</option><option value="a">A</option><option value="b">B</option><option value="tie">Tie</option><option value="unclear">Unclear</option></select></label></article>`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Private transcription review</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 24px;color:#171717;background:#f6f4ef}h1{font-size:32px}article{background:white;border:1px solid #ddd6c8;border-radius:16px;padding:24px;margin:24px 0;box-shadow:0 8px 30px #493b2412}.meta{color:#686158}.audio{display:grid;grid-template-columns:1fr 1fr;gap:16px}.audio label{font-weight:650}.audio audio{width:100%;display:block;margin-top:8px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0}.comparison section{background:#f7f5f1;border-radius:10px;padding:16px}.comparison p{white-space:pre-wrap;line-height:1.5}.rating{font-weight:650}.rating select{margin-left:12px;padding:8px}button{padding:10px 16px;border:0;border-radius:8px;background:#222;color:white;font-weight:700}@media(max-width:750px){.audio,.comparison{grid-template-columns:1fr}}</style></head><body><h1>Private transcription review</h1><p>Listen before reading. A and B are balanced neutral labels. Nothing in this file is uploaded.</p>${cards}<button id="download">Download content-free ratings</button><script>document.querySelector('#download').addEventListener('click',()=>{const ratings=[...document.querySelectorAll('article')].map(card=>({caseId:card.dataset.case,rating:card.querySelector('select').value}));const blob=new Blob([JSON.stringify({schemaVersion:1,reviewId:'${reviewId}',ratings},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='parakeet-review-ratings.json';link.click();URL.revokeObjectURL(link.href)});</script></body></html>`;
    writeOwnerOnlyPrivateFile(reviewOut, html);
    writeOwnerOnlyPrivateFile(
      `${reviewOut}.manifest.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          reviewId,
          cases: selected.map((_entry, index) => ({
            caseId: `review-${index + 1}`,
            candidateLabel: index % 2 === 0 ? 'b' : 'a',
          })),
        },
        null,
        2,
      ),
    );
  }

  console.log(
    JSON.stringify({
      schemaVersion: 1,
      referenceKind: 'existing_local_transcript_proxy_not_human_ground_truth',
      meetingCount: meetings.length,
      evaluatedMeetingCount,
      failedMeetingCount,
      runtimeFailureCounts: Object.fromEntries(
        [...runtimeFailureCounts.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
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
      timeAlignedMetrics: Object.fromEntries(
        [...timeAlignedMatchCounts.entries()].map(([tolerance, matched]) => [
          `${tolerance}s`,
          {
            precision: Number(
              (
                matched /
                Math.max(1, timeAlignedCandidateWordCounts.get(tolerance) || 0)
              ).toFixed(4),
            ),
            recall: Number(
              (matched / Math.max(1, timeAlignedReferenceWordCount)).toFixed(4),
            ),
          },
        ]),
      ),
      minimumReferenceTimelineCoverageRatio: Number(
        minimumReferenceTimelineCoverageRatio.toFixed(4),
      ),
      minimumCandidateTimelineCoverageRatio: Number(
        minimumCandidateTimelineCoverageRatio.toFixed(4),
      ),
      invalidReferenceSegmentCount,
      maximumSourceDurationMismatchSeconds: Number(
        maximumSourceDurationMismatchSeconds.toFixed(3),
      ),
      maximumReferenceEndMismatchSeconds: Number(
        maximumReferenceEndMismatchSeconds.toFixed(3),
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
      reviewCaseCount: reviewOut
        ? Math.min(reviewCaseLimit, reviewCandidates.length)
        : undefined,
    }),
  );
  if (
    failedMeetingCount > 0 ||
    canonicalValidationFailureCount > 0 ||
    timestampFailureCount > 0
  )
    process.exitCode = 1;
} finally {
  clearInterval(sampleRss);
  if (child.exitCode === null) {
    try {
      const shutdown = await request({ method: 'shutdown' }, 5_000);
      if (!shutdown.ok) child.kill('SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  if (!child.stdin.destroyed) child.stdin.end();
  output.close();
}

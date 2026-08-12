#!/usr/bin/env node

/* eslint-disable no-console */
/*
 * Env (optional):
 *   PLUTO_CANONICAL_SOURCE=mic|mix|auto — matches app (AudioManager) canonical Whisper source;
 *     replay itself still uses session Whisper attempts from the meeting dir, not mix/mic files.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolveBackendConfig } = require('./lib/transcription_backends');

const DEFAULT_PORT = 5123;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_MAX_LOOKBACK_MS = 5 * 60 * 1000;
const DEFAULT_MAX_GAP_MS = 20 * 1000;
const DEFAULT_SESSION_LEAD_MS = 8 * 1000;
const DEFAULT_DIAGNOSTICS_WINDOW_SECONDS = 5 * 60;
const DEFAULT_LOCAL_FIXTURE_FILE = path.join(
  process.cwd(),
  'scripts',
  'replay.local-fixtures.json',
);

const BUILTIN_TEST_SETS = {};

/** DB transcript_json vs human baseline (ordered speaker + Jaccard). */
const BUILTIN_TRANSCRIPT_REGRESSIONS = [
  {
    id: 'advisor_agent_deployment',
    meetingId: 'd0ae42f8-479a-47bc-ae0e-95cc726da165',
    expectedPath: path.join(
      __dirname,
      'baselines',
      'd0ae42f8-479a-47bc-ae0e-95cc726da165.expected-human.json',
    ),
  },
  {
    id: 'berlin_travel_human',
    meetingId: '8a6dfe36-7151-4763-9f43-2b87b682a386',
    expectedPath: path.join(
      __dirname,
      'baselines',
      '8a6dfe36-7151-4763-9f43-2b87b682a386.expected-human.json',
    ),
  },
];

const TRANSCRIPT_REGRESSION_SIM = 0.38;
const TRANSCRIPT_REGRESSION_SIM_SHORT = 0.55;
const TRANSCRIPT_REGRESSION_SHORT_WORDS = 5;

const normalizeText = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (text) => normalizeText(text).split(' ').filter(Boolean);

const jaccardSimilarity = (left, right) => {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : overlap / union;
};

const tokenCoverage = (left, right) => {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  let overlap = 0;
  const rightSet = new Set(rightTokens);
  for (const token of leftTokens) {
    if (rightSet.has(token)) overlap++;
  }
  return overlap / leftTokens.length;
};

const textCoverage = (query, reference) => {
  const qTokens = new Set(tokenize(query));
  const rTokens = new Set(tokenize(reference));
  if (qTokens.size === 0) return 0;
  let covered = 0;
  for (const w of qTokens) if (rTokens.has(w)) covered++;
  return covered / qTokens.size;
};

const hasHeavyRepetition = (text) => {
  const tokens = tokenize(text);
  if (tokens.length < 8) return false;
  const counts = new Map();
  let maxFreq = 0;
  for (const token of tokens) {
    const next = (counts.get(token) || 0) + 1;
    counts.set(token, next);
    if (next > maxFreq) maxFreq = next;
  }
  const uniqueRatio = counts.size / tokens.length;
  return uniqueRatio <= 0.4 || maxFreq >= 4;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    meetingId: '',
    dbPath: '',
    meetingsDir: '',
    serverUrl: `http://127.0.0.1:${DEFAULT_PORT}`,
    attempts: DEFAULT_ATTEMPTS,
    maxLookbackMs: DEFAULT_MAX_LOOKBACK_MS,
    maxGapMs: DEFAULT_MAX_GAP_MS,
    sessionLeadMs: DEFAULT_SESSION_LEAD_MS,
    model: '',
    backend: '',
    preset: '',
    device: '',
    computeType: '',
    fixedSet: '',
    requireExpected: false,
    allSets: false,
    fixtureFile: DEFAULT_LOCAL_FIXTURE_FILE,
    expectedFile: '',
    echoStats: false,
    dumpBaselineJsonPath: '',
    updateMeetingTranscript: false,
    transcriptRegressions: false,
  };

  const takeValue = (flag, index) => {
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${flag}`);
    }
    return args[index + 1];
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--') && !options.meetingId) {
      options.meetingId = arg;
      continue;
    }
    if (arg === '--meeting-id') {
      options.meetingId = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--db') {
      options.dbPath = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--meetings-dir') {
      options.meetingsDir = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--server-url') {
      options.serverUrl = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--attempts') {
      options.attempts = Math.max(
        1,
        Number.parseInt(takeValue(arg, i), 10) || DEFAULT_ATTEMPTS,
      );
      i++;
      continue;
    }
    if (arg === '--model') {
      options.model = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--backend') {
      options.backend = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--preset') {
      options.preset = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--device') {
      options.device = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--compute-type') {
      options.computeType = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--fixed-set') {
      options.fixedSet = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--fixture-file') {
      options.fixtureFile = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--expected-file') {
      options.expectedFile = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--require-expected') {
      options.requireExpected = true;
      continue;
    }
    if (arg === '--echo-stats') {
      options.echoStats = true;
      continue;
    }
    if (arg === '--dump-baseline-json') {
      options.dumpBaselineJsonPath = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--update-meeting-transcript') {
      options.updateMeetingTranscript = true;
      continue;
    }
    if (arg === '--all-sets') {
      options.allSets = true;
      continue;
    }
    if (arg === '--transcript-regressions') {
      options.transcriptRegressions = true;
      continue;
    }
    if (arg === '--lookback-ms') {
      options.maxLookbackMs = Math.max(
        10_000,
        Number.parseInt(takeValue(arg, i), 10) || DEFAULT_MAX_LOOKBACK_MS,
      );
      i++;
      continue;
    }
    if (arg === '--gap-ms') {
      options.maxGapMs = Math.max(
        1_000,
        Number.parseInt(takeValue(arg, i), 10) || DEFAULT_MAX_GAP_MS,
      );
      i++;
      continue;
    }
    if (arg === '--session-lead-ms') {
      options.sessionLeadMs = Math.max(
        0,
        Number.parseInt(takeValue(arg, i), 10) || DEFAULT_SESSION_LEAD_MS,
      );
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const userDataDir =
    process.env.PLUTO_USER_DATA_DIR ||
    path.join(os.homedir(), 'Library', 'Application Support', 'pluto');
  if (!options.dbPath) options.dbPath = path.join(userDataDir, 'pluto.db');
  if (!options.meetingsDir)
    options.meetingsDir = path.join(userDataDir, 'meetings');
  return options;
};

const extractTimestampFromName = (filename) => {
  const standardMatch = filename.match(
    /^(me|them|session-mic|session-system)_(\d+)_/,
  );
  if (standardMatch) {
    return {
      speaker: standardMatch[1],
      ts: Number.parseInt(standardMatch[2], 10),
    };
  }
  const mixMatch = filename.match(/^mix_session-mix_(\d+)_/);
  if (mixMatch) {
    return {
      speaker: 'session-mix',
      ts: Number.parseInt(mixMatch[1], 10),
    };
  }
  return null;
};

const findNearestCompanionSessionFile = (
  allEntries,
  sessionTs,
  speaker,
  maxDeltaMs = 15_000,
) => {
  const matches = allEntries
    .filter((entry) => entry.speaker === speaker)
    .map((entry) => ({
      ...entry,
      delta: Math.abs(entry.ts - sessionTs),
    }))
    .filter((entry) => entry.delta <= maxDeltaMs)
    .sort((a, b) => a.delta - b.delta);
  return matches[0] || null;
};

const pickContiguousChannelFiles = (allEntries, sessionTs, opts) => {
  const candidates = allEntries
    .filter((entry) => entry.ts >= sessionTs - opts.maxLookbackMs)
    .filter((entry) => entry.ts <= sessionTs + opts.sessionLeadMs)
    .sort((a, b) => a.ts - b.ts);

  if (candidates.length === 0) return [];

  let anchor = -1;
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].ts <= sessionTs) anchor = i;
  }
  if (anchor < 0) anchor = candidates.length - 1;

  let left = anchor;
  while (left > 0) {
    const gap = candidates[left].ts - candidates[left - 1].ts;
    if (gap > opts.maxGapMs) break;
    left--;
  }

  let right = anchor;
  while (right + 1 < candidates.length) {
    const gap = candidates[right + 1].ts - candidates[right].ts;
    if (gap > opts.maxGapMs) break;
    right++;
  }

  return candidates.slice(left, right + 1);
};

const pickMeetingWindowChannelFiles = (
  allEntries,
  meetingStartTs,
  meetingEndTs,
  paddingMs = 15_000,
) =>
  allEntries
    .filter((entry) => entry.speaker === 'Me' || entry.speaker === 'Them')
    .filter((entry) => entry.ts >= meetingStartTs - paddingMs)
    .filter((entry) => entry.ts <= meetingEndTs + paddingMs)
    .sort((a, b) => a.ts - b.ts);

const probeAudioFile = (audioPath) => {
  if (!audioPath || !fs.existsSync(audioPath)) {
    return { exists: false, sizeBytes: 0, durationSec: 0 };
  }
  const sizeBytes = fs.statSync(audioPath).size;
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nokey=1:noprint_wrappers=1',
      audioPath,
    ],
    { encoding: 'utf8' },
  );
  const durationSec =
    result.status === 0
      ? Number.parseFloat(String(result.stdout || '').trim()) || 0
      : 0;
  return { exists: true, sizeBytes, durationSec };
};

const isUsableSessionAudio = (probe) =>
  Boolean(
    probe?.exists &&
      probe.sizeBytes >= 1024 &&
      Number.isFinite(probe.durationSec) &&
      probe.durationSec >= 1,
  );

const chooseReplayEntriesForRecovery = (
  selectedEntries,
  usableSessionSystemAudio,
) => {
  if (!Array.isArray(selectedEntries) || selectedEntries.length === 0) {
    return [];
  }
  if (usableSessionSystemAudio) {
    return selectedEntries;
  }
  const themEntries = selectedEntries.filter(
    (entry) => entry.speaker === 'Them',
  );
  if (themEntries.length > 0) {
    return themEntries;
  }
  return selectedEntries;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const transcribeFile = async (serverUrl, audioPath, config) => {
  const payload = {
    audio_path: audioPath,
    language: config.language || 'en',
    diarize: false,
    model: config.model,
    device: config.device,
    compute_type: config.computeType,
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${serverUrl}/transcribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 200);
    }
  }

  const message =
    lastError && typeof lastError.message === 'string'
      ? lastError.message
      : String(lastError || 'unknown error');
  throw new Error(
    `Transcribe request failed for ${path.basename(audioPath)} after 3 attempts: ${message}`,
  );
};

const bestOfAttempts = async (serverUrl, audioPath, attempts, config) => {
  const attemptsPayload = [];
  for (let i = 0; i < attempts; i++) {
    const result = await transcribeFile(serverUrl, audioPath, config);
    const segments = Array.isArray(result.segments) ? result.segments : [];
    const text = segments
      .map((segment) => String(segment.text || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    attemptsPayload.push({ text, segments });
  }
  const counts = new Map();
  for (const value of attemptsPayload.map((item) => item.text)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const bestText = sorted[0] ? sorted[0][0] : '';
  const bestMatch = attemptsPayload.find((item) => item.text === bestText);
  return {
    best: bestText,
    variants: attemptsPayload.map((item) => item.text),
    bestSegments: Array.isArray(bestMatch?.segments) ? bestMatch.segments : [],
    uniqueCount: counts.size,
    activeConfig: bestMatch?.activeConfig,
  };
};

const mergeTurns = (segments) => {
  const merged = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === segment.speaker) {
      last.text = `${last.text} ${segment.text}`.trim();
      // Preserve the full temporal span when merging consecutive turns.
      if (typeof segment.endMs === 'number') {
        last.endMs =
          typeof last.endMs === 'number'
            ? Math.max(last.endMs, segment.endMs)
            : segment.endMs;
      }
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
};

const computeEchoStats = (turns) => {
  const total = turns.length;
  if (total === 0) {
    return {
      total,
      unique: 0,
      duplicates: 0,
      duplicateRatio: 0,
      crossSpeakerDuplicateTurns: 0,
      crossSpeakerRatio: 0,
      crossSpeakerGroups: 0,
    };
  }
  const normalized = turns.map((turn) => ({
    speaker: turn.speaker,
    text: normalizeText(turn.text),
  }));
  const byText = new Map();
  for (const item of normalized) {
    if (!item.text) continue;
    const entry = byText.get(item.text) || { count: 0, speakers: new Set() };
    entry.count += 1;
    entry.speakers.add(item.speaker);
    byText.set(item.text, entry);
  }
  const unique = byText.size;
  const duplicates = Math.max(0, total - unique);
  let crossSpeakerDuplicateTurns = 0;
  let crossSpeakerGroups = 0;
  for (const [text, info] of byText.entries()) {
    if (info.speakers.size > 1) {
      crossSpeakerGroups += 1;
      crossSpeakerDuplicateTurns += info.count;
    }
  }
  return {
    total,
    unique,
    duplicates,
    duplicateRatio: total === 0 ? 0 : duplicates / total,
    crossSpeakerDuplicateTurns,
    crossSpeakerRatio: total === 0 ? 0 : crossSpeakerDuplicateTurns / total,
    crossSpeakerGroups,
  };
};

const isQuestionLikeReplay = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const n = normalizeText(raw);
  if (!n) return false;
  if (raw.includes('?')) return true;
  return /^(do you|did you|are you|can you|could you|would you|will you|what|why|how|when|where|who)\b/.test(
    n,
  );
};

const isGreetingLikeReplay = (text) => {
  const n = normalizeText(text);
  if (!n) return false;
  return (
    n.startsWith('hey ') ||
    n === 'hey' ||
    n.startsWith('hi ') ||
    n === 'hi' ||
    n.startsWith('hello ') ||
    n === 'hello'
  );
};

const isVeryShortConfirmationReplay = (text) => {
  const n = normalizeText(text);
  return (
    n === 'yes' ||
    n === 'no' ||
    n === 'yeah' ||
    n === 'yep' ||
    n === 'nope' ||
    n === 'sure' ||
    n === 'right'
  );
};

const SHORT_ANSWER_PREFIXES_REPLAY = [
  'not bad',
  'pretty good',
  'good',
  'fine',
  'busy',
  'just',
  'trying to',
  'working on',
  'doing okay',
  'all good',
];

const isLikelyShortAnswerReplay = (text) => {
  const n = normalizeText(text);
  if (!n) return false;
  const words = tokenize(text);
  if (words.length === 0 || words.length > 8) return false;
  const matchesPrefix = SHORT_ANSWER_PREFIXES_REPLAY.some(
    (prefix) => n === prefix || n.startsWith(`${prefix} `),
  );
  if (matchesPrefix) return true;
  if (isQuestionLikeReplay(text)) return false;
  return false;
};

const isLikelySplitFragmentReplay = (text) => {
  const raw = String(text || '').trim();
  const n = normalizeText(raw);
  if (!n || isQuestionLikeReplay(raw)) return false;
  const words = n.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 16) return false;
  const hasTerminalPunctuation = /[.!?]["']?$/.test(raw);
  if (isLikelyShortAnswerReplay(raw) || isVeryShortConfirmationReplay(raw)) {
    return false;
  }
  return !hasTerminalPunctuation;
};

const normalizeTimedTranscriptSegment = (seg) => {
  if (!seg || typeof seg !== 'object') return null;
  const speaker = seg.speaker != null ? String(seg.speaker) : '';
  const text = seg.text != null ? String(seg.text).trim() : '';
  if ((speaker !== 'Me' && speaker !== 'Them') || !text) return null;
  const startTime =
    typeof seg.startTime === 'number'
      ? seg.startTime
      : typeof seg.startMs === 'number'
        ? seg.startMs / 1000
        : typeof seg.start === 'number'
          ? seg.start
          : null;
  const endTime =
    typeof seg.endTime === 'number'
      ? seg.endTime
      : typeof seg.endMs === 'number'
        ? seg.endMs / 1000
        : typeof seg.end === 'number'
          ? seg.end
          : null;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  return { speaker, text, startTime, endTime };
};

const computeTranscriptDiagnostics = (
  segments,
  windowSeconds = DEFAULT_DIAGNOSTICS_WINDOW_SECONDS,
) => {
  const normalized = (segments || [])
    .map(normalizeTimedTranscriptSegment)
    .filter(Boolean)
    .sort((a, b) => a.startTime - b.startTime);
  const inWindow = normalized.filter((s) => s.startTime <= windowSeconds);

  let sameSpeakerQuestionAnswer = 0;
  let sameSpeakerGreetingPairs = 0;
  let suspiciousAlternatingShort = 0;
  let continuationSandwiches = 0;
  let overlappingLexicalDuplicates = 0;
  const openingSamples = [];

  const overlapSecondsLocal = (left, right) =>
    Math.max(
      0,
      Math.min(left.endTime, right.endTime) -
        Math.max(left.startTime, right.startTime),
    );

  for (let i = 1; i < normalized.length; i++) {
    const prev = normalized[i - 1];
    const cur = normalized[i];
    const gap = Math.max(0, cur.startTime - prev.endTime);
    if (
      prev.speaker === cur.speaker &&
      isQuestionLikeReplay(prev.text) &&
      !isQuestionLikeReplay(cur.text) &&
      tokenize(cur.text).length <= 8 &&
      gap <= 1.75
    ) {
      sameSpeakerQuestionAnswer++;
      if (openingSamples.length < 5 && cur.startTime <= windowSeconds) {
        openingSamples.push(
          `Q/A same-speaker ${prev.speaker}: "${prev.text}" -> "${cur.text}"`,
        );
      }
    }

    if (
      prev.speaker === cur.speaker &&
      isGreetingLikeReplay(prev.text) &&
      isGreetingLikeReplay(cur.text) &&
      cur.startTime <= Math.min(windowSeconds, 45) &&
      gap <= 12
    ) {
      sameSpeakerGreetingPairs++;
      if (openingSamples.length < 5) {
        openingSamples.push(
          `Opening greeting same-speaker ${cur.speaker}: "${prev.text}" / "${cur.text}"`,
        );
      }
    }
  }

  for (let i = 1; i < normalized.length - 1; i++) {
    const prev = normalized[i - 1];
    const cur = normalized[i];
    const next = normalized[i + 1];
    const curWords = tokenize(cur.text).length;
    if (
      prev.speaker !== cur.speaker &&
      cur.speaker !== next.speaker &&
      curWords > 0 &&
      curWords <= 6 &&
      cur.startTime <= windowSeconds
    ) {
      suspiciousAlternatingShort++;
    }

    if (
      prev.speaker === next.speaker &&
      cur.speaker !== prev.speaker &&
      curWords <= 12 &&
      isLikelySplitFragmentReplay(cur.text) &&
      Math.max(0, cur.startTime - prev.endTime) <= 1.25 &&
      Math.max(0, next.startTime - cur.endTime) <= 1.25
    ) {
      continuationSandwiches++;
      if (openingSamples.length < 5 && cur.startTime <= windowSeconds) {
        openingSamples.push(
          `Sandwich fragment ${cur.speaker} between ${prev.speaker}: "${cur.text}"`,
        );
      }
    }
  }

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const left = normalized[i];
      const right = normalized[j];
      if (left.speaker === right.speaker) continue;
      const overlap = overlapSecondsLocal(left, right);
      if (overlap < 0.2) continue;
      const overlapRatio =
        overlap /
        Math.max(
          0.01,
          Math.min(
            left.endTime - left.startTime,
            right.endTime - right.startTime,
          ),
        );
      const similarity = jaccardSimilarity(left.text, right.text);
      if (overlapRatio >= 0.45 && similarity >= 0.35) {
        overlappingLexicalDuplicates++;
      }
    }
  }

  const openingSameSpeakerQuestionAnswer = sameSpeakerQuestionAnswer;
  const openingAnomalies =
    sameSpeakerGreetingPairs +
    openingSameSpeakerQuestionAnswer +
    continuationSandwiches;
  const score =
    sameSpeakerGreetingPairs * 4 +
    sameSpeakerQuestionAnswer * 4 +
    continuationSandwiches * 5 +
    suspiciousAlternatingShort * 2 +
    overlappingLexicalDuplicates * 3;

  return {
    totalTurns: normalized.length,
    sameSpeakerGreetingPairs,
    sameSpeakerQuestionAnswer,
    suspiciousAlternatingShort,
    continuationSandwiches,
    overlappingLexicalDuplicates,
    firstFiveMinutesAnomalies: openingAnomalies,
    score,
    openingSamples,
  };
};

const printTranscriptDiagnostics = (label, diagnostics) => {
  console.log(`\n[Diagnostics:${label}] score=${diagnostics.score}`);
  console.log(
    `[Diagnostics:${label}] greetingsSameSpeaker=${diagnostics.sameSpeakerGreetingPairs} questionAnswerSameSpeaker=${diagnostics.sameSpeakerQuestionAnswer} sandwichContinuations=${diagnostics.continuationSandwiches}`,
  );
  console.log(
    `[Diagnostics:${label}] alternatingShort=${diagnostics.suspiciousAlternatingShort} overlappingLexicalDuplicates=${diagnostics.overlappingLexicalDuplicates} firstFiveMinutes=${diagnostics.firstFiveMinutesAnomalies}`,
  );
  for (const sample of diagnostics.openingSamples.slice(0, 5)) {
    console.log(`  - ${sample}`);
  }
};

const hasMaterialDiagnosticImprovement = (current, candidate) => {
  if (!candidate) return false;
  if (!current) return true;
  if (candidate.score < current.score) return true;
  if (
    candidate.firstFiveMinutesAnomalies < current.firstFiveMinutesAnomalies &&
    candidate.overlappingLexicalDuplicates <=
      current.overlappingLexicalDuplicates
  ) {
    return true;
  }
  return false;
};

const qualityScore = (text) => {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;
  const counts = new Map();
  let maxFreq = 0;
  for (const token of tokens) {
    const next = (counts.get(token) || 0) + 1;
    counts.set(token, next);
    if (next > maxFreq) maxFreq = next;
  }
  const uniqueRatio = counts.size / tokens.length;
  const repetitionPenalty = Math.max(0, maxFreq - 2) * 0.12;
  const lengthBonus = Math.min(0.3, tokens.length * 0.02);
  return uniqueRatio + lengthBonus - repetitionPenalty;
};

const pickPreferredNearDuplicate = (left, right) => {
  const leftScore = qualityScore(left.text);
  const rightScore = qualityScore(right.text);
  const leftWords = tokenize(left.text).length;
  const rightWords = tokenize(right.text).length;

  let winnerText = left.text;
  if (rightScore >= leftScore + 0.06) winnerText = right.text;
  else if (leftScore >= rightScore + 0.06) winnerText = left.text;
  else winnerText = rightWords >= leftWords ? right.text : left.text;

  const winnerSpeaker =
    left.speaker === 'Them' || right.speaker === 'Them' ? 'Them' : left.speaker;

  return {
    speaker: winnerSpeaker,
    text: winnerText,
    ts: Math.min(left.ts, right.ts),
  };
};

/** Mirrors src/utils/speakerAttribution.ts applyCrossTurnAttributionRepairs (ms timeline). */
const applyCrossTurnAttributionRepairsReplay = (turns) => {
  if (!Array.isArray(turns) || turns.length < 2) return turns;
  const segmentEndMs = (s) =>
    typeof s.endMs === 'number' ? s.endMs : (Number(s.ts) || 0) + 800;
  const segmentStartMs = (s) =>
    typeof s.startMs === 'number' ? s.startMs : Number(s.ts) || 0;

  const isRemoteStyleUncertaintyAnswer = (text) => {
    const n = normalizeText(text);
    if (!n) return false;
    return (
      n.startsWith('i don t know') ||
      n.startsWith('i dont know') ||
      n.startsWith('not sure') ||
      n.startsWith('i m not sure') ||
      n.startsWith('i am not sure') ||
      n.startsWith('hmm') ||
      n.startsWith('uh ') ||
      (n.startsWith('well') &&
        (n.includes('don t know') || n.includes('dont know')))
    );
  };

  const isLocalAffirmOrCorrection = (text) => {
    const n = normalizeText(text);
    if (!n) return false;
    if (n.includes('correction')) return true;
    return (
      n.startsWith('oh yeah') ||
      n.startsWith('oh ok') ||
      n.startsWith('oh okay') ||
      n.startsWith('yeah yeah') ||
      (n.startsWith('yeah') && n.includes('correction'))
    );
  };

  const out = turns.map((s) => ({ ...s }));

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== cur.speaker) continue;
    if (!isGreetingLikeReplay(prev.text) || !isGreetingLikeReplay(cur.text))
      continue;
    if (segmentStartMs(cur) > 45_000) continue;
    const gapMs = Math.max(0, segmentStartMs(cur) - segmentEndMs(prev));
    if (gapMs > 12_000) continue;
    cur.speaker = prev.speaker === 'Me' ? 'Them' : 'Me';
  }

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Me' || cur.speaker !== 'Me') continue;
    if (!isQuestionLikeReplay(prev.text)) continue;
    if (tokenize(cur.text).length > 3) continue;
    if (!isVeryShortConfirmationReplay(cur.text)) continue;
    const gapMs = Math.max(0, segmentStartMs(cur) - segmentEndMs(prev));
    if (gapMs > 1500) continue;
    cur.speaker = 'Them';
  }

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Me' || cur.speaker !== 'Me') continue;
    if (!isQuestionLikeReplay(prev.text)) continue;
    if (tokenize(cur.text).length > 8) continue;
    if (!isLikelyShortAnswerReplay(cur.text)) continue;
    const gapMs = Math.max(0, segmentStartMs(cur) - segmentEndMs(prev));
    if (gapMs > 3000) continue;
    cur.speaker = 'Them';
  }

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Me' || cur.speaker !== 'Me') continue;
    if (!isQuestionLikeReplay(prev.text)) continue;
    if (!isRemoteStyleUncertaintyAnswer(cur.text)) continue;
    const gapMs = Math.max(0, segmentStartMs(cur) - segmentEndMs(prev));
    if (gapMs > 1250) continue;
    cur.speaker = 'Them';
  }

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Them' || cur.speaker !== 'Me') continue;
    if (tokenize(prev.text).length > 16) continue;
    if (tokenize(cur.text).length > 16) continue;
    if (
      !isLikelySplitFragmentReplay(cur.text) &&
      !isLikelyShortAnswerReplay(cur.text) &&
      !(tokenize(prev.text).length <= 4 && !isQuestionLikeReplay(cur.text))
    ) {
      continue;
    }
    const gapMs = Math.max(0, segmentStartMs(cur) - segmentEndMs(prev));
    if (gapMs > 2500) continue;
    cur.speaker = 'Them';
  }

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.speaker !== 'Them' || cur.speaker !== 'Them') continue;
    if (tokenize(cur.text).length > 14) continue;
    if (!isLocalAffirmOrCorrection(cur.text)) continue;
    const gapMs = Math.max(0, segmentStartMs(cur) - segmentEndMs(prev));
    if (gapMs > 1500) continue;
    cur.speaker = 'Me';
  }

  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    const next = out[i + 1];
    if (prev.speaker !== next.speaker || cur.speaker === prev.speaker) continue;
    if (tokenize(cur.text).length > 12) continue;
    if (!isLikelySplitFragmentReplay(cur.text)) continue;
    const gapBeforeMs = Math.max(0, segmentStartMs(cur) - segmentEndMs(prev));
    const gapAfterMs = Math.max(0, segmentStartMs(next) - segmentEndMs(cur));
    if (gapBeforeMs > 1250 || gapAfterMs > 1250) continue;
    cur.speaker = prev.speaker;
  }

  return out;
};

const collapseCrossSpeakerNearDuplicates = (segments) => {
  const sorted = [...segments].sort((a, b) => a.ts - b.ts);
  const collapsed = [];
  for (const segment of sorted) {
    const last = collapsed[collapsed.length - 1];
    if (
      last &&
      last.speaker !== segment.speaker &&
      Math.abs(segment.ts - last.ts) <= 2500 &&
      jaccardSimilarity(last.text, segment.text) >= 0.42
    ) {
      collapsed[collapsed.length - 1] = pickPreferredNearDuplicate(
        last,
        segment,
      );
      continue;
    }
    collapsed.push({ ...segment });
  }
  return collapsed;
};

const containsTokenSequence = (haystack, needle) => {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    let matches = true;
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
};

const dropShortCrossSpeakerEchoes = (
  segments,
  maxShortWords = 4,
  maxGapMs = 2000,
) => {
  if (segments.length < 2) return { segments: [...segments], dropped: 0 };
  const kept = [];
  let dropped = 0;
  for (const segment of segments) {
    const current = { ...segment };
    const prev = kept[kept.length - 1];
    if (!prev) {
      kept.push(current);
      continue;
    }
    if (prev.speaker === current.speaker) {
      kept.push(current);
      continue;
    }

    const gapMs = Math.max(0, current.ts - prev.ts);
    if (gapMs > maxGapMs) {
      kept.push(current);
      continue;
    }

    const prevTokens = tokenize(prev.text);
    const currTokens = tokenize(current.text);
    const prevIsShort = prevTokens.length <= maxShortWords;
    const currIsShort = currTokens.length <= maxShortWords;

    if (
      currIsShort &&
      prevTokens.length >= currTokens.length + 4 &&
      containsTokenSequence(prevTokens, currTokens)
    ) {
      dropped++;
      continue;
    }

    if (
      prevIsShort &&
      currTokens.length >= prevTokens.length + 4 &&
      containsTokenSequence(currTokens, prevTokens)
    ) {
      kept.pop();
      dropped++;
      kept.push(current);
      continue;
    }

    kept.push(current);
  }
  return { segments: kept, dropped };
};

const pruneSourceEchoBleed = (
  segments,
  maxGapMs = 2600,
  similarityThreshold = 0.34,
) => {
  if (!Array.isArray(segments) || segments.length < 2) {
    return {
      segments: Array.isArray(segments) ? [...segments] : [],
      dropped: 0,
    };
  }

  const sorted = [...segments].sort((a, b) => a.ts - b.ts);
  const kept = [];
  let dropped = 0;

  for (const segment of sorted) {
    if (segment.speaker !== 'Me') {
      kept.push(segment);
      continue;
    }

    const meTokens = tokenize(segment.text);
    let shouldDropAsEcho = false;
    for (const other of sorted) {
      if (other === segment || other.speaker !== 'Them') continue;
      const gapMs = Math.abs((other.ts || 0) - (segment.ts || 0));
      if (gapMs > maxGapMs) continue;

      const isSubset = tokenCoverage(segment.text, other.text) >= 0.5;
      const isSimilar = jaccardSimilarity(segment.text, other.text) >= similarityThreshold;
      if (!isSubset && !isSimilar) continue;

      const themTokens = tokenize(other.text);
      const meIsShorter = meTokens.length <= themTokens.length + 2;
      const meContained =
        meTokens.length > 0 && containsTokenSequence(themTokens, meTokens);
      if (meIsShorter || meContained || meTokens.length <= 6) {
        shouldDropAsEcho = true;
        break;
      }
    }

    if (shouldDropAsEcho) {
      dropped++;
      continue;
    }
    kept.push(segment);
  }

  return { segments: kept, dropped };
};

const mapAttemptSegmentsToAbsolute = (speaker, baseTs, segments) => {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  return segments
    .map((segment) => {
      const text = String(segment.text || '').trim();
      if (!text) return null;
      const startSec = Number.isFinite(segment.start)
        ? Number(segment.start)
        : 0;
      const endSec = Number.isFinite(segment.end)
        ? Number(segment.end)
        : startSec + 0.8;
      const safeStart = Math.max(0, startSec);
      const safeEnd = Math.max(safeStart + 0.05, endSec);
      const mapped = {
        speaker,
        text,
        startMs: baseTs + safeStart * 1000,
        endMs: baseTs + safeEnd * 1000,
      };
      if (Array.isArray(segment.words) && segment.words.length > 0) {
        mapped.words = segment.words
          .filter(
            (w) =>
              w && typeof w.start === 'number' && typeof w.end === 'number',
          )
          .map((w) => ({
            word: String(w.word || ''),
            startMs: baseTs + w.start * 1000,
            endMs: baseTs + w.end * 1000,
          }));
      }
      return mapped;
    })
    .filter(Boolean);
};

/**
 * Port of splitCanonicalSegmentsAtChannelBoundaries from speakerAttribution.ts.
 * When a session-canonical segment contains a run of words matching a Them channel
 * segment's text, split the canonical segment at that boundary.
 */
const splitCanonicalAtChannelBoundaries = (sessionSegments, sourceSegments) => {
  const themSources = (sourceSegments || []).filter(
    (s) => s.speaker === 'Them' && (s.text || '').trim(),
  );
  if (themSources.length === 0 || sessionSegments.length === 0) {
    return { segments: [...sessionSegments], splits: 0 };
  }
  const MIN_THEM_ANCHOR_WORDS = 7;
  const MIN_ME_PREFIX_WORDS = 3;
  const MIN_THEM_CHANNEL_WORDS = 5;
  const MIN_OVERLAP_MS = 80;

  let splits = 0;
  const out = [];
  for (const seg of sessionSegments) {
    const text = (seg.text || '').trim();
    if (!text) {
      out.push(seg);
      continue;
    }
    const canonWords = normalizeText(text).split(' ').filter(Boolean);
    if (canonWords.length < MIN_ME_PREFIX_WORDS + MIN_THEM_ANCHOR_WORDS) {
      out.push(seg);
      continue;
    }

    const overlapping = themSources
      .map((th) => {
        const ovMs = Math.max(
          0,
          Math.min(seg.endMs, th.endMs) - Math.max(seg.startMs, th.startMs),
        );
        return { th, ovMs };
      })
      .filter((x) => x.ovMs >= MIN_OVERLAP_MS)
      .sort((a, b) => b.ovMs - a.ovMs);

    let didSplit = false;
    for (const { th: themSeg } of overlapping) {
      const themWords = normalizeText(themSeg.text).split(' ').filter(Boolean);
      if (themWords.length < MIN_THEM_CHANNEL_WORDS) continue;
      const minAnchor = Math.min(MIN_THEM_ANCHOR_WORDS, themWords.length);
      let anchorStart = -1;
      for (
        let i = MIN_ME_PREFIX_WORDS;
        i <= canonWords.length - minAnchor;
        i++
      ) {
        let k = 0;
        let mismatches = 0;
        while (k < themWords.length && i + k + mismatches < canonWords.length) {
          if (canonWords[i + k + mismatches] === themWords[k]) {
            k++;
          } else {
            mismatches++;
            if (mismatches > 1) break;
          }
        }
        if (k >= minAnchor) {
          anchorStart = i;
          break;
        }
      }
      if (anchorStart < 0) continue;

      const ratio = anchorStart / canonWords.length;
      let cut = Math.min(
        text.length - 1,
        Math.max(1, Math.floor(text.length * ratio)),
      );
      while (cut > 0 && !/\s/.test(text[cut])) cut--;
      if (cut <= 0) continue;
      const leftText = text.slice(0, cut).trim();
      const rightText = text.slice(cut).trim();
      if (!leftText || !rightText) continue;

      const durMs = Math.max(80, seg.endMs - seg.startMs);
      const wL = Math.max(1, leftText.length);
      const wR = Math.max(1, rightText.length);
      const tCut = seg.startMs + durMs * (wL / (wL + wR));

      out.push({ ...seg, text: leftText, endMs: Math.min(seg.endMs, tCut) });
      out.push({
        ...seg,
        text: rightText,
        startMs: Math.max(seg.startMs, tCut),
        endMs: seg.endMs,
      });
      splits++;
      didSplit = true;
      break;
    }
    if (!didSplit) out.push(seg);
  }
  return { segments: out, splits };
};

const splitCanonicalSegmentsIntoSentences = (segments) => {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const expanded = [];
  for (const segment of segments) {
    const text = String(segment.text || '').trim();
    if (!text) continue;
    const pieces = text
      .split(/(?<=[.!?])\s+/)
      .map((piece) => piece.trim())
      .filter(Boolean);
    if (pieces.length <= 1) {
      expanded.push({ ...segment, text });
      continue;
    }
    const totalWeight = pieces.reduce(
      (sum, piece) => sum + Math.max(1, piece.length),
      0,
    );
    const totalDurationMs = Math.max(80, segment.endMs - segment.startMs);
    let cursor = segment.startMs;
    for (let i = 0; i < pieces.length; i++) {
      const weight = Math.max(1, pieces[i].length);
      const remaining = Math.max(50, segment.endMs - cursor);
      const allocated =
        i === pieces.length - 1
          ? remaining
          : Math.max(50, totalDurationMs * (weight / totalWeight));
      const endMs =
        i === pieces.length - 1
          ? segment.endMs
          : Math.min(segment.endMs, cursor + allocated);
      expanded.push({
        ...segment,
        text: pieces[i],
        startMs: cursor,
        endMs: Math.max(cursor + 50, endMs),
      });
      cursor = Math.max(cursor + 50, endMs);
    }
  }
  return expanded;
};

/**
 * Assign speakers to canonical segments using channel overlap logic.
 * Both channels present → Them (Me mic caught loudspeaker bleed).
 * Only Me channel → Me. Only Them channel → Them if text matches, else Me
 * (canonical captured something the Them channel didn't say). Neither → last.
 */
const splitSegmentByWordSpeakers = (seg, meSegs, themSegs) => {
  if (!Array.isArray(seg.words) || seg.words.length === 0) return null;
  const MIN_WORD_OVERLAP_MS = 50;
  const wordSpeakers = seg.words.map((w) => {
    const meHit = meSegs.some(
      (m) =>
        Math.min(w.endMs, m.endMs) - Math.max(w.startMs, m.startMs) >
        MIN_WORD_OVERLAP_MS,
    );
    const themHit = themSegs.some(
      (t) =>
        Math.min(w.endMs, t.endMs) - Math.max(w.startMs, t.startMs) >
        MIN_WORD_OVERLAP_MS,
    );
    if (meHit && themHit) return 'Them';
    if (meHit) return 'Me';
    if (themHit) return 'Them';
    return null;
  });

  // Fill nulls (no overlap) by carrying forward, then backward
  for (let i = 0; i < wordSpeakers.length; i++) {
    if (!wordSpeakers[i] && i > 0) wordSpeakers[i] = wordSpeakers[i - 1];
  }
  for (let i = wordSpeakers.length - 2; i >= 0; i--) {
    if (!wordSpeakers[i]) wordSpeakers[i] = wordSpeakers[i + 1];
  }
  // If still all null, can't split
  if (wordSpeakers.every((s) => !s)) return null;

  // Group consecutive same-speaker words into sub-segments
  const groups = [];
  let groupStart = 0;
  for (let i = 1; i <= wordSpeakers.length; i++) {
    if (
      i === wordSpeakers.length ||
      wordSpeakers[i] !== wordSpeakers[groupStart]
    ) {
      const words = seg.words.slice(groupStart, i);
      groups.push({
        speaker: wordSpeakers[groupStart],
        text: words
          .map((w) => w.word)
          .join(' ')
          .trim(),
        startMs: words[0].startMs,
        endMs: words[words.length - 1].endMs,
      });
      groupStart = i;
    }
  }

  // Only worth splitting if there's more than one speaker group
  if (groups.length <= 1) return null;
  return groups;
};

const assignSpeakersByChannelOverlap = (canonicalSegments, channelSegments) => {
  if (!Array.isArray(canonicalSegments) || canonicalSegments.length === 0)
    return [];
  if (!Array.isArray(channelSegments) || channelSegments.length === 0)
    return [];

  const MIN_OVERLAP_MS = 200;
  const COVERAGE_THRESHOLD = 0.5;
  const meSegs = channelSegments.filter(
    (s) => s.speaker === 'Me' && (s.text || '').trim(),
  );
  const themSegs = channelSegments.filter(
    (s) => s.speaker === 'Them' && (s.text || '').trim(),
  );

  const sorted = [...canonicalSegments].sort((a, b) => a.startMs - b.startMs);

  const labeled = [];
  let lastSpeaker = 'Me';

  for (const seg of sorted) {
    const meOverlapping = meSegs.filter(
      (m) =>
        Math.min(seg.endMs, m.endMs) - Math.max(seg.startMs, m.startMs) >
        MIN_OVERLAP_MS,
    );
    const themOverlapping = themSegs.filter(
      (t) =>
        Math.min(seg.endMs, t.endMs) - Math.max(seg.startMs, t.startMs) >
        MIN_OVERLAP_MS,
    );

    if (meOverlapping.length > 0 && themOverlapping.length > 0) {
      // Bleed case: try word-level splitting
      const wordSplit = splitSegmentByWordSpeakers(
        seg,
        meOverlapping,
        themOverlapping,
      );
      if (wordSplit) {
        for (const sub of wordSplit) {
          lastSpeaker = sub.speaker;
          labeled.push(sub);
        }
      } else {
        lastSpeaker = 'Them';
        labeled.push({ ...seg, speaker: 'Them' });
      }
    } else if (meOverlapping.length > 0 && themOverlapping.length === 0) {
      lastSpeaker = 'Me';
      labeled.push({ ...seg, speaker: 'Me' });
    } else {
      const bestOvCov =
        themOverlapping.length > 0
          ? Math.max(
              ...themOverlapping.map((t) => textCoverage(seg.text, t.text)),
            )
          : 0;
      let speaker;
      if (bestOvCov >= COVERAGE_THRESHOLD) {
        speaker = 'Them';
      } else {
        const bestMeCov =
          meSegs.length > 0
            ? Math.max(...meSegs.map((m) => textCoverage(seg.text, m.text)))
            : 0;
        const bestThemCov =
          themSegs.length > 0
            ? Math.max(...themSegs.map((t) => textCoverage(seg.text, t.text)))
            : 0;
        if (
          bestMeCov >= COVERAGE_THRESHOLD ||
          bestThemCov >= COVERAGE_THRESHOLD
        ) {
          speaker = bestThemCov > bestMeCov ? 'Them' : 'Me';
        } else {
          const wordCount = tokenize(seg.text).length;
          speaker = wordCount < 3 ? lastSpeaker : 'Me';
        }
      }
      lastSpeaker = speaker;
      labeled.push({ ...seg, speaker });
    }
  }

  const merged = [];
  for (const seg of labeled) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.text = `${last.text} ${seg.text}`.trim();
      last.endMs = seg.endMs;
      continue;
    }
    merged.push({
      speaker: seg.speaker,
      text: seg.text,
      startMs: seg.startMs,
      endMs: seg.endMs,
    });
  }

  return merged.map((segment) => ({
    speaker: segment.speaker,
    text: segment.text,
    ts: segment.startMs,
    startMs: segment.startMs,
    endMs: segment.endMs,
  }));
};

const compareAgainstExpectedTurns = (actualTurns, expectedTurns) => {
  if (!Array.isArray(expectedTurns) || expectedTurns.length === 0) return null;
  const comparisons = [];
  const maxLen = Math.max(actualTurns.length, expectedTurns.length);
  let matches = 0;
  for (let i = 0; i < maxLen; i++) {
    const expected = expectedTurns[i];
    const actual = actualTurns[i];
    if (!expected || !actual) {
      comparisons.push({
        index: i + 1,
        expected,
        actual,
        similarity: 0,
        speakerMatch: false,
      });
      continue;
    }
    const speakerMatch = expected.speaker === actual.speaker;
    const similarity = jaccardSimilarity(expected.text, actual.text);
    if (speakerMatch && similarity >= 0.6) matches++;
    comparisons.push({
      index: i + 1,
      expected,
      actual,
      similarity,
      speakerMatch,
    });
  }
  return {
    matches,
    total: expectedTurns.length,
    comparisons,
  };
};

const loadMeetingFromDb = (dbPath, meetingId) => {
  const pyCode = `
import json, sqlite3, sys
db_path = sys.argv[1]
meeting_id = sys.argv[2]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
row = conn.execute(
  "SELECT id, title, audio_path, transcript_json, created_at FROM meetings WHERE id = ?",
  (meeting_id,)
).fetchone()
conn.close()
if not row:
  print("")
else:
  print(json.dumps({k: row[k] for k in row.keys()}))
`.trim();
  const result = spawnSync(
    'python3',
    ['-c', pyCode, dbPath, String(meetingId)],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to query meeting from DB: ${result.stderr || result.stdout}`,
    );
  }
  const output = (result.stdout || '').trim();
  if (!output) return null;
  return JSON.parse(output);
};

const readJsonFileIfExists = (filePath) => {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return null;
  return JSON.parse(raw);
};

const loadFixtureSets = (fixtureFile) => {
  const parsed = readJsonFileIfExists(fixtureFile);
  const transcriptRegressions = Array.isArray(parsed?.transcriptRegressions)
    ? parsed.transcriptRegressions
    : [];

  if (!parsed) {
    return {
      sets: { ...BUILTIN_TEST_SETS },
      defaultSet: '',
      transcriptRegressions,
    };
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (
      parsed.sets &&
      typeof parsed.sets === 'object' &&
      !Array.isArray(parsed.sets)
    ) {
      return {
        sets: { ...BUILTIN_TEST_SETS, ...parsed.sets },
        defaultSet:
          typeof parsed.defaultSet === 'string' ? parsed.defaultSet : '',
        transcriptRegressions,
      };
    }
    return {
      sets: { ...BUILTIN_TEST_SETS, ...parsed },
      defaultSet: '',
      transcriptRegressions,
    };
  }

  throw new Error(`Invalid fixture file format: ${fixtureFile}`);
};

const unwrapTranscriptJsonPayload = (parsed) => {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.segments)) {
    return parsed.segments;
  }
  return [];
};

const loadMeetingTranscriptSegmentsFromDb = (dbPath, meetingId) => {
  const pyCode = `
import json, sqlite3, sys
db_path, mid = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db_path)
row = conn.execute(
    "SELECT transcript_json FROM meetings WHERE id = ?",
    (mid,),
).fetchone()
conn.close()
if not row:
    print(json.dumps([]))
elif not row[0] or not str(row[0]).strip():
    print(json.dumps([]))
else:
    print(row[0])
`.trim();
  const result = spawnSync(
    'python3',
    ['-c', pyCode, dbPath, String(meetingId)],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr ||
        result.stdout ||
        'loadMeetingTranscriptSegmentsFromDb failed',
    );
  }
  const out = (result.stdout || '').trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  return unwrapTranscriptJsonPayload(parsed);
};

const normalizeTranscriptAppSegment = (seg) => {
  if (!seg || typeof seg !== 'object') return null;
  const speaker = seg.speaker != null ? String(seg.speaker) : '';
  const text = seg.text != null ? String(seg.text) : '';
  if (!speaker || !text.trim()) return null;
  if (speaker !== 'Me' && speaker !== 'Them') return null;
  const startTime =
    typeof seg.startTime === 'number'
      ? seg.startTime
      : typeof seg.startMs === 'number'
        ? seg.startMs / 1000
        : typeof seg.start === 'number'
          ? seg.start
          : null;
  const endTime =
    typeof seg.endTime === 'number'
      ? seg.endTime
      : typeof seg.endMs === 'number'
        ? seg.endMs / 1000
        : typeof seg.end === 'number'
          ? seg.end
          : null;
  return {
    speaker,
    text: text.trim(),
    startTime: Number.isFinite(startTime) ? startTime : null,
    endTime: Number.isFinite(endTime) ? endTime : null,
  };
};

const transcriptRegressionThreshold = (expectedText) =>
  tokenize(expectedText).length <= TRANSCRIPT_REGRESSION_SHORT_WORDS
    ? TRANSCRIPT_REGRESSION_SIM_SHORT
    : TRANSCRIPT_REGRESSION_SIM;

const findTranscriptRegressionFailures = (expected, app) => {
  const failures = [];
  let j = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const t = transcriptRegressionThreshold(e.text);
    let found = false;
    while (j < app.length) {
      const a = app[j];
      j += 1;
      if (a.speaker !== e.speaker) continue;
      const sim = jaccardSimilarity(e.text, a.text);
      if (sim >= t) {
        found = true;
        break;
      }
    }
    if (!found) {
      failures.push({
        index: i + 1,
        expectedSpeaker: e.speaker,
        expectedPreview: e.text.slice(0, 72),
        threshold: t,
      });
    }
  }
  return failures;
};

const normalizeTranscriptRegressionFileEntries = (entries, fixtureFile) => {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const baseDir = path.dirname(path.resolve(fixtureFile));
  return entries.map((e, idx) => {
    const meetingId = String(e.meetingId || '');
    let expectedPath = e.expectedPath || e.expectedFile || '';
    if (!meetingId || !expectedPath) {
      throw new Error(
        `transcriptRegressions[${idx}] needs meetingId and expectedPath or expectedFile`,
      );
    }
    if (!path.isAbsolute(expectedPath)) {
      expectedPath = path.join(baseDir, expectedPath);
    }
    return {
      id: String(e.id || meetingId),
      meetingId,
      expectedPath,
    };
  });
};

const evaluateTranscriptRegressionChecks = (app, checks) => {
  if (!Array.isArray(checks) || checks.length === 0) return [];
  const failures = [];
  for (const check of checks) {
    if (!check || typeof check !== 'object') continue;
    const type = String(check.type || '');
    if (type === 'maxDiagnostics') {
      const diagnostics = computeTranscriptDiagnostics(
        app,
        Number.isFinite(check.windowSeconds)
          ? Number(check.windowSeconds)
          : DEFAULT_DIAGNOSTICS_WINDOW_SECONDS,
      );
      const constraints = [
        ['sameSpeakerGreetingPairs', 'sameSpeakerGreetingPairs'],
        ['sameSpeakerQuestionAnswer', 'sameSpeakerQuestionAnswer'],
        ['continuationSandwiches', 'continuationSandwiches'],
        ['suspiciousAlternatingShort', 'suspiciousAlternatingShort'],
        ['overlappingLexicalDuplicates', 'overlappingLexicalDuplicates'],
        ['firstFiveMinutesAnomalies', 'firstFiveMinutesAnomalies'],
        ['score', 'score'],
      ];
      for (const [field, label] of constraints) {
        if (!Number.isFinite(check[field])) continue;
        if (diagnostics[field] > Number(check[field])) {
          failures.push(
            `${type}:${label} expected <= ${check[field]} got ${diagnostics[field]}`,
          );
        }
      }
      continue;
    }

    if (type === 'orderedPrefixTurns') {
      const turns = Array.isArray(check.turns) ? check.turns : [];
      const normalizedTurns = turns.map((turn) => ({
        speaker: String(turn.speaker || ''),
        text: String(turn.text || '').trim(),
      }));
      const failuresForCheck = findTranscriptRegressionFailures(
        normalizedTurns,
        app,
      );
      if (failuresForCheck.length > 0) {
        failures.push(
          `${type} missing ${failuresForCheck.length} ordered turn(s) in prefix`,
        );
      }
    }
  }
  return failures;
};

const runTranscriptRegressionsSuite = (dbPath, entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    console.log('\n[TranscriptRegression] No entries configured.');
    return;
  }
  const seenMeeting = new Set();
  const deduped = [];
  for (const entry of entries) {
    if (seenMeeting.has(entry.meetingId)) continue;
    seenMeeting.add(entry.meetingId);
    deduped.push(entry);
  }
  for (const entry of deduped) {
    console.log(`\n=== Transcript regression: ${entry.id} ===`);
    if (!fs.existsSync(entry.expectedPath)) {
      throw new Error(`Expected file missing: ${entry.expectedPath}`);
    }
    const baseline = JSON.parse(fs.readFileSync(entry.expectedPath, 'utf8'));
    const expected = (baseline.segments || []).map((s) => ({
      speaker: String(s.speaker),
      text: String(s.text || '').trim(),
    }));
    const checks = Array.isArray(baseline.checks) ? baseline.checks : [];
    const rawSegments = loadMeetingTranscriptSegmentsFromDb(
      dbPath,
      entry.meetingId,
    );
    const app = rawSegments.map(normalizeTranscriptAppSegment).filter(Boolean);
    if (app.length === 0) {
      console.warn(
        `[TranscriptRegression] SKIP ${entry.id} — no transcript segments in DB for meeting ${entry.meetingId}`,
      );
      continue;
    }
    console.log(
      `[TranscriptRegression] meeting=${entry.meetingId} appSegments=${app.length} expectedTurns=${expected.length} checks=${checks.length}`,
    );
    const failures = [
      ...findTranscriptRegressionFailures(expected, app),
      ...evaluateTranscriptRegressionChecks(app, checks),
    ];
    if (failures.length > 0) {
      console.error(
        `[TranscriptRegression] FAIL ${entry.id} — ${failures.length} regression issue(s)`,
      );
      for (const f of failures.slice(0, 25)) {
        if (typeof f === 'string') console.error(`  - ${f}`);
        else {
          console.error(
            `  #${f.index} ${f.expectedSpeaker} thr=${f.threshold}: ${f.expectedPreview}…`,
          );
        }
      }
      if (failures.length > 25) {
        console.error(`  … +${failures.length - 25} more`);
      }
      throw new Error(`Transcript regression failed: ${entry.id}`);
    }
    console.log(
      `[TranscriptRegression] PASS ${entry.id} — ordered speaker + text (Jaccard >= ${TRANSCRIPT_REGRESSION_SIM} / ${TRANSCRIPT_REGRESSION_SIM_SHORT} short)`,
    );
  }
};

const loadExpectedOverride = (expectedFile) => {
  const parsed = readJsonFileIfExists(expectedFile);
  if (!parsed) return { meetingId: '', expectedTurns: [] };

  if (Array.isArray(parsed)) {
    return { meetingId: '', expectedTurns: parsed };
  }

  if (typeof parsed === 'object') {
    return {
      meetingId: typeof parsed.meetingId === 'string' ? parsed.meetingId : '',
      expectedTurns: Array.isArray(parsed.expectedTurns)
        ? parsed.expectedTurns
        : [],
    };
  }

  throw new Error(`Invalid expected-file format: ${expectedFile}`);
};

const finalTurnsToAppSegments = (finalTurns, sessionBaseTsMs) => {
  if (!Array.isArray(finalTurns) || finalTurns.length === 0) return [];
  const rows = finalTurns
    .map((turn) => {
      const startMs = Number(turn.startMs ?? turn.ts);
      const endMs = Number(turn.endMs);
      const safeStartMs = Number.isFinite(startMs) ? startMs : sessionBaseTsMs;
      const safeEndMs =
        Number.isFinite(endMs) && endMs > safeStartMs
          ? endMs
          : safeStartMs + 2000;
      const startTime = (safeStartMs - sessionBaseTsMs) / 1000;
      const endTime = (safeEndMs - sessionBaseTsMs) / 1000;
      return {
        startTime,
        endTime,
        text: String(turn.text || '').trim(),
        speaker: turn.speaker,
      };
    })
    .filter((r) => r.text && (r.speaker === 'Me' || r.speaker === 'Them'));
  if (rows.length === 0) return [];
  const minT = Math.min(...rows.map((r) => r.startTime));
  if (!Number.isFinite(minT)) return [];
  if (minT < 0) {
    for (const r of rows) {
      r.startTime -= minT;
      r.endTime -= minT;
    }
  }
  return rows.map((r) => ({
    id: crypto.randomUUID(),
    startTime: r.startTime,
    endTime: r.endTime,
    start: r.startTime,
    end: r.endTime,
    text: r.text,
    speaker: r.speaker,
  }));
};

const appSegmentsToReplayTurns = (segments) => {
  return (segments || [])
    .map(normalizeTimedTranscriptSegment)
    .filter(Boolean)
    .map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
      ts: Math.round(segment.startTime * 1000),
      startMs: Math.round(segment.startTime * 1000),
      endMs: Math.round(segment.endTime * 1000),
    }));
};

const persistTranscriptToDb = (dbPath, meetingId, segments) => {
  const tmp = path.join(
    os.tmpdir(),
    `pluto-txj-${meetingId}-${Date.now()}.json`,
  );
  fs.writeFileSync(tmp, JSON.stringify(segments), 'utf8');
  const py = `
import json, sqlite3, sys
db_path, mid, jpath = sys.argv[1], sys.argv[2], sys.argv[3]
segs = json.load(open(jpath, encoding="utf-8"))
text = " ".join(
  (s.get("text") or "").strip()
  for s in segs
  if isinstance(s, dict) and (s.get("text") or "").strip()
)
con = sqlite3.connect(db_path)
row = con.execute(
  "select title, coalesce(enhanced_notes,''), coalesce(user_notes,'') from meetings where id=?",
  (mid,),
).fetchone()
if not row:
  print("ERROR: meeting not found:", mid)
  sys.exit(2)
title, enh, notes = row
con.execute(
  "update meetings set transcript_json=? where id=?",
  (json.dumps(segs, ensure_ascii=False), mid),
)
con.execute(
  """insert or replace into meetings_fts (title, transcript_text, enhanced_notes, user_notes, meeting_id)
     values (?,?,?,?,?)""",
  (title or "", text, enh or "", notes or "", mid),
)
con.commit()
con.close()
print("OK updated transcript_json + FTS for", mid, "segments", len(segs))
`.trim();
  const res = spawnSync('python3', ['-c', py, dbPath, meetingId, tmp], {
    encoding: 'utf8',
  });
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || 'persistTranscriptToDb failed');
  }
  console.log((res.stdout || '').trim());
};

const main = async () => {
  const benchmarkStart = Date.now();
  const opts = parseArgs();
  if (!fs.existsSync(opts.dbPath)) {
    throw new Error(`DB not found: ${opts.dbPath}`);
  }

  const transcriptOnly =
    opts.transcriptRegressions &&
    !opts.allSets &&
    !opts.fixedSet &&
    !opts.meetingId;

  if (!transcriptOnly && !fs.existsSync(opts.meetingsDir)) {
    throw new Error(`Meetings directory not found: ${opts.meetingsDir}`);
  }
  if (opts.updateMeetingTranscript && opts.allSets) {
    throw new Error('Cannot use --update-meeting-transcript with --all-sets');
  }

  const {
    sets: fixtureSets,
    defaultSet,
    transcriptRegressions: trFromFile,
  } = loadFixtureSets(opts.fixtureFile);

  if (transcriptOnly) {
    const entries = [
      ...BUILTIN_TRANSCRIPT_REGRESSIONS,
      ...normalizeTranscriptRegressionFileEntries(trFromFile, opts.fixtureFile),
    ];
    runTranscriptRegressionsSuite(opts.dbPath, entries);
    return;
  }

  if (opts.allSets) {
    const setNames = Object.keys(fixtureSets);
    if (setNames.length === 0) {
      throw new Error(`No fixture sets found in ${opts.fixtureFile}`);
    }
    for (const setName of setNames) {
      console.log(`\n=== Running fixture set: ${setName} ===`);
      const childArgs = [
        __filename,
        '--fixture-file',
        opts.fixtureFile,
        '--fixed-set',
        setName,
        '--attempts',
        String(opts.attempts),
      ];
      if (opts.requireExpected) childArgs.push('--require-expected');
      if (opts.model) childArgs.push('--model', opts.model);
      if (opts.backend) childArgs.push('--backend', opts.backend);
      if (opts.preset) childArgs.push('--preset', opts.preset);
      if (opts.device) childArgs.push('--device', opts.device);
      if (opts.computeType) childArgs.push('--compute-type', opts.computeType);
      const child = spawnSync(process.execPath, childArgs, {
        stdio: 'inherit',
      });
      if (child.status !== 0) {
        throw new Error(`Fixture set failed: ${setName}`);
      }
    }
    if (opts.transcriptRegressions) {
      const entries = [
        ...BUILTIN_TRANSCRIPT_REGRESSIONS,
        ...normalizeTranscriptRegressionFileEntries(
          trFromFile,
          opts.fixtureFile,
        ),
      ];
      runTranscriptRegressionsSuite(opts.dbPath, entries);
    }
    return;
  }

  const expectedOverride = loadExpectedOverride(opts.expectedFile);
  if (!opts.fixedSet && !opts.meetingId && defaultSet) {
    opts.fixedSet = defaultSet;
  }
  if (!opts.meetingId && expectedOverride.meetingId) {
    opts.meetingId = expectedOverride.meetingId;
  }

  let meeting = null;
  let sessionAudioPath = '';
  let sessionBaseTs = 0;
  let selectedEntries = [];
  let expectedTurns = [];
  let sessionInfo = null;
  let allMeetingEntries = [];
  let channelEntries = [];
  let sessionSystemAudioPath = '';
  let sessionMixedAudioPath = '';

  if (opts.fixedSet) {
    const fixed = fixtureSets[opts.fixedSet];
    if (!fixed) {
      throw new Error(
        `Unknown fixed set: ${opts.fixedSet}. Available: ${Object.keys(fixtureSets).join(', ')}`,
      );
    }

    expectedTurns = fixed.expectedTurns || [];

    if (fixed.meetingId) {
      meeting = loadMeetingFromDb(opts.dbPath, fixed.meetingId);
      if (!meeting)
        throw new Error(
          `Meeting not found for fixed set "${opts.fixedSet}": ${fixed.meetingId}`,
        );
      if (!meeting.audio_path)
        throw new Error(`Meeting has no audio_path: ${fixed.meetingId}`);

      const sessionFile = path.basename(meeting.audio_path);
      sessionInfo = extractTimestampFromName(sessionFile);
      if (!sessionInfo || sessionInfo.speaker !== 'session-mic') {
        throw new Error(
          `Meeting audio_path is not a session-mic file: ${meeting.audio_path}`,
        );
      }

      const allFiles = fs.readdirSync(opts.meetingsDir);
      allMeetingEntries = allFiles
        .map((name) => {
          const info = extractTimestampFromName(name);
          if (!info) return null;
          return {
            name,
            ts: info.ts,
            speaker: info.speaker,
            absolutePath: path.join(opts.meetingsDir, name),
          };
        })
        .filter(Boolean);
      channelEntries = allFiles
        .map((name) => {
          const info = extractTimestampFromName(name);
          if (!info) return null;
          if (info.speaker !== 'me' && info.speaker !== 'them') return null;
          return {
            name,
            ts: info.ts,
            speaker: info.speaker === 'me' ? 'Me' : 'Them',
            absolutePath: path.join(opts.meetingsDir, name),
          };
        })
        .filter(Boolean);

      selectedEntries = pickContiguousChannelFiles(
        channelEntries,
        sessionInfo.ts,
        opts,
      );
      sessionBaseTs = sessionInfo.ts;
      sessionAudioPath = meeting.audio_path;
      meeting = {
        ...meeting,
        id: `(fixed-set:${opts.fixedSet} -> meeting:${meeting.id})`,
        title: fixed.label || meeting.title,
      };
    } else {
      sessionAudioPath = path.join(opts.meetingsDir, fixed.sessionFile);
      if (!fs.existsSync(sessionAudioPath)) {
        throw new Error(
          `Fixed-set session file not found: ${sessionAudioPath}`,
        );
      }
      sessionInfo = extractTimestampFromName(fixed.sessionFile);
      if (sessionInfo && sessionInfo.speaker === 'session-mic') {
        sessionBaseTs = sessionInfo.ts;
      }
      selectedEntries = (fixed.channelFiles || []).map((name) => {
        const info = extractTimestampFromName(name);
        if (!info)
          throw new Error(`Invalid fixed-set channel file name: ${name}`);
        const absolutePath = path.join(opts.meetingsDir, name);
        if (!fs.existsSync(absolutePath)) {
          throw new Error(`Fixed-set channel file not found: ${absolutePath}`);
        }
        return {
          name,
          ts: info.ts,
          speaker: info.speaker === 'me' ? 'Me' : 'Them',
          absolutePath,
        };
      });
      meeting = {
        id: `(fixed-set:${opts.fixedSet})`,
        title: fixed.label || opts.fixedSet,
        audio_path: sessionAudioPath,
      };
    }
  } else {
    if (!opts.meetingId) {
      throw new Error(
        `No meeting id provided. Pass a meeting id, or use --fixture-file ${opts.fixtureFile} with a defaultSet.`,
      );
    }
    meeting = loadMeetingFromDb(opts.dbPath, opts.meetingId);
    if (!meeting) {
      throw new Error(`Meeting not found: ${opts.meetingId}`);
    }
    if (!meeting.audio_path) {
      throw new Error(`Meeting has no audio_path: ${opts.meetingId}`);
    }

    const sessionFile = path.basename(meeting.audio_path);
    sessionInfo = extractTimestampFromName(sessionFile);
    if (!sessionInfo || sessionInfo.speaker !== 'session-mic') {
      throw new Error(
        `Meeting audio_path is not a session-mic file: ${meeting.audio_path}`,
      );
    }

    const allFiles = fs.readdirSync(opts.meetingsDir);
    allMeetingEntries = allFiles
      .map((name) => {
        const info = extractTimestampFromName(name);
        if (!info) return null;
        return {
          name,
          ts: info.ts,
          speaker: info.speaker,
          absolutePath: path.join(opts.meetingsDir, name),
        };
      })
      .filter(Boolean);
    channelEntries = allFiles
      .map((name) => {
        const info = extractTimestampFromName(name);
        if (!info) return null;
        if (info.speaker !== 'me' && info.speaker !== 'them') return null;
        return {
          name,
          ts: info.ts,
          speaker: info.speaker === 'me' ? 'Me' : 'Them',
          absolutePath: path.join(opts.meetingsDir, name),
        };
      })
      .filter(Boolean);
    selectedEntries = pickContiguousChannelFiles(
      channelEntries,
      sessionInfo.ts,
      opts,
    );
    sessionBaseTs = sessionInfo.ts;
    sessionAudioPath = meeting.audio_path;
  }

  if (sessionInfo && allMeetingEntries.length > 0) {
    const sessionSystemEntry = findNearestCompanionSessionFile(
      allMeetingEntries,
      sessionInfo.ts,
      'session-system',
    );
    const sessionMixEntry = findNearestCompanionSessionFile(
      allMeetingEntries,
      sessionInfo.ts,
      'session-mix',
    );
    sessionSystemAudioPath = sessionSystemEntry?.absolutePath || '';
    sessionMixedAudioPath = sessionMixEntry?.absolutePath || '';
  }

  if (expectedOverride.expectedTurns.length > 0) {
    expectedTurns = expectedOverride.expectedTurns;
  }

  const currentTranscriptSegments = meeting.id.startsWith('(fixed-set:')
    ? loadMeetingTranscriptSegmentsFromDb(
        opts.dbPath,
        String(
          fixtureSets[opts.fixedSet]?.meetingId || opts.meetingId || meeting.id,
        ),
      )
    : loadMeetingTranscriptSegmentsFromDb(opts.dbPath, String(meeting.id));

  const transcriptionConfig = resolveBackendConfig({
    backend: opts.backend,
    preset: opts.preset,
    model: opts.model,
    device: opts.device,
    computeType: opts.computeType,
  });

  console.log(
    `[ReplayConfig] backend=${transcriptionConfig.backend} preset=${transcriptionConfig.preset} model=${transcriptionConfig.model} device=${transcriptionConfig.device} computeType=${transcriptionConfig.computeType}`,
  );

  const sessionResult = await bestOfAttempts(
    opts.serverUrl,
    sessionAudioPath,
    opts.attempts,
    transcriptionConfig,
  );
  const sessionText = sessionResult.best;
  const normalizedSession = normalizeText(sessionText);
  const sessionWhisperSegs = sessionResult.bestSegments || [];
  const sessionDurationSec =
    sessionWhisperSegs.length > 0
      ? Math.max(...sessionWhisperSegs.map((s) => Number(s.end) || 0))
      : 0;
  const meetingStartTs = sessionBaseTs - Math.round(sessionDurationSec * 1000);
  const fullMeetingChannelEntries = pickMeetingWindowChannelFiles(
    channelEntries,
    meetingStartTs,
    sessionBaseTs,
  );
  if (fullMeetingChannelEntries.length >= selectedEntries.length) {
    selectedEntries = fullMeetingChannelEntries;
  }
  const sessionSystemProbe = probeAudioFile(sessionSystemAudioPath);
  const usableSessionSystemAudio = isUsableSessionAudio(sessionSystemProbe);
  const replayEntries = chooseReplayEntriesForRecovery(
    selectedEntries,
    usableSessionSystemAudio,
  );

  console.log(`Meeting: ${meeting.id}`);
  console.log(`Title: ${meeting.title}`);
  console.log(`Session audio: ${sessionAudioPath}`);
  if (sessionSystemAudioPath) {
    const status = usableSessionSystemAudio ? 'usable' : 'invalid';
    console.log(
      `Session system audio: ${sessionSystemAudioPath} (${status}, duration=${sessionSystemProbe.durationSec.toFixed(2)}s, bytes=${sessionSystemProbe.sizeBytes})`,
    );
  }
  if (sessionMixedAudioPath) {
    console.log(`Session mixed audio: ${sessionMixedAudioPath}`);
  }
  console.log(`Selected channel files: ${selectedEntries.length}`);
  for (const entry of selectedEntries) {
    console.log(`  - ${entry.name}`);
  }
  if (replayEntries.length !== selectedEntries.length) {
    console.log(
      `[Replay] Recovery mode: replaying ${replayEntries.length}/${selectedEntries.length} channel files (Them-first reconstruction).`,
    );
  }

  console.log('\nSession-mic transcription:');
  console.log(sessionText || '(empty)');

  const rawSegments = [];
  for (const entry of replayEntries) {
    const replay = await bestOfAttempts(
      opts.serverUrl,
      entry.absolutePath,
      opts.attempts,
      transcriptionConfig,
    );
    const text = replay.best;
    const similarity = jaccardSimilarity(text, normalizedSession);
    const normalized = normalizeText(text);
    const tokens = normalized.split(' ').filter(Boolean);
    const sessionContains =
      normalized && normalizedSession.includes(normalized);
    const minSimilarity = entry.speaker === 'Them' ? 0.07 : 0.12;
    const supportedBySession = Boolean(
      normalized && (sessionContains || similarity >= minSimilarity),
    );
    const repetitive = hasHeavyRepetition(text);
    const minWordsForUnsup = entry.speaker === 'Them' ? 3 : 4;
    const substantialText = tokens.length >= minWordsForUnsup;
    const reliable = !repetitive && (supportedBySession || substantialText);
    const uncertain = !reliable;
    const absoluteAttemptSegments = mapAttemptSegmentsToAbsolute(
      entry.speaker,
      entry.ts,
      replay.bestSegments,
    );

    rawSegments.push({
      speaker: entry.speaker,
      ts: entry.ts,
      text,
      file: entry.name,
      uniqueCount: replay.uniqueCount,
      supportedBySession,
      repetitive,
      reliable,
      uncertain,
      similarity,
      absoluteAttemptSegments,
    });
  }

  let fullSessionSystemSegments = [];
  let sessionSystemText = '';
  if (sessionSystemAudioPath && usableSessionSystemAudio) {
    const systemResult = await bestOfAttempts(
      opts.serverUrl,
      sessionSystemAudioPath,
      opts.attempts,
      transcriptionConfig,
    );
    sessionSystemText = systemResult.best;
    fullSessionSystemSegments = mapAttemptSegmentsToAbsolute(
      'Them',
      meetingStartTs,
      systemResult.bestSegments,
    );
    console.log('\nSession-system transcription:');
    console.log(sessionSystemText || '(empty)');
    console.log(
      `[Replay] Full-session system segments: ${fullSessionSystemSegments.length}`,
    );
  } else if (sessionSystemAudioPath) {
    console.warn(
      `[Replay] Session-system audio is invalid; reconstructing system evidence from Them chunk files instead (duration=${sessionSystemProbe.durationSec.toFixed(2)}s, bytes=${sessionSystemProbe.sizeBytes}).`,
    );
  }

  console.log('\nRaw channel replay:');
  for (const segment of rawSegments) {
    const status = segment.reliable ? 'keep' : 'drop';
    const tags = [
      `unique=${segment.uniqueCount}`,
      `sim=${segment.similarity.toFixed(3)}`,
      `session=${segment.supportedBySession ? 'yes' : 'no'}`,
      `repeat=${segment.repetitive ? 'yes' : 'no'}`,
    ].join(' ');
    console.log(
      `[${status}] ${segment.speaker} ${segment.file} | ${tags} | ${segment.text || '(empty)'}`,
    );
  }

  if (fullSessionSystemSegments.length === 0) {
    const reconstructedSystemSegments = rawSegments
      .filter((segment) => segment.speaker === 'Them')
      .filter((segment) => segment.reliable)
      .flatMap((segment) => segment.absoluteAttemptSegments || []);
    if (reconstructedSystemSegments.length > 0) {
      fullSessionSystemSegments = reconstructedSystemSegments;
      console.log(
        `\n[ReplayFallback] Reconstructed full-session system evidence from ${reconstructedSystemSegments.length} Them chunk segments.`,
      );
    }
  }

  const kept = rawSegments
    .filter((segment) => segment.text)
    .filter((segment) => segment.reliable)
    .map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
      ts: segment.ts,
    }));
  const sourceEvidenceSegments = rawSegments
    .filter((segment) => segment.reliable)
    .flatMap((segment) => {
      if (
        Array.isArray(segment.absoluteAttemptSegments) &&
        segment.absoluteAttemptSegments.length > 0
      ) {
        return segment.absoluteAttemptSegments;
      }
      if (!segment.text) return [];
      return [
        {
          speaker: segment.speaker,
          text: segment.text,
          startMs: segment.ts,
          endMs: segment.ts + 30000,
        },
      ];
    });
  if (fullSessionSystemSegments.length > 0) {
    sourceEvidenceSegments.push(...fullSessionSystemSegments);
  }
  const correctedCanonical = mapAttemptSegmentsToAbsolute(
    'Unknown',
    meetingStartTs,
    sessionResult.bestSegments,
  );
  const channelBoundarySplit = splitCanonicalAtChannelBoundaries(
    correctedCanonical,
    sourceEvidenceSegments,
  );
  if (channelBoundarySplit.splits > 0) {
    console.log(
      `\nChannel-boundary splits applied to session canonical: ${channelBoundarySplit.splits}`,
    );
  }
  const sessionSentenceSegments = splitCanonicalSegmentsIntoSentences(
    channelBoundarySplit.segments,
  );
  const collapsed = collapseCrossSpeakerNearDuplicates(kept);
  const shortEchoPruned = dropShortCrossSpeakerEchoes(collapsed);
  if (shortEchoPruned.dropped > 0) {
    console.log(
      `\nDropped short cross-speaker echoes: ${shortEchoPruned.dropped}`,
    );
  }
  const sourceEchoPruned = pruneSourceEchoBleed(shortEchoPruned.segments);
  if (sourceEchoPruned.dropped > 0) {
    console.log(
      `Dropped source-echo segments from Me channel: ${sourceEchoPruned.dropped}`,
    );
  }
  const merged = mergeTurns(sourceEchoPruned.segments);
  const canonicalAssigned = assignSpeakersByChannelOverlap(
    sessionSentenceSegments,
    sourceEvidenceSegments,
  );
  const sourceSpeakers = new Set(sourceEvidenceSegments.map((s) => s.speaker));
  let finalTurns =
    canonicalAssigned.length > 0 ? mergeTurns(canonicalAssigned) : merged;
  finalTurns = applyCrossTurnAttributionRepairsReplay(finalTurns);
  finalTurns = mergeTurns(finalTurns);
  if (
    sourceSpeakers.size < 2 &&
    currentTranscriptSegments.length > 0 &&
    finalTurns.length <= 1
  ) {
    const repairedExistingTranscript = mergeTurns(
      applyCrossTurnAttributionRepairsReplay(
        appSegmentsToReplayTurns(currentTranscriptSegments),
      ),
    );
    if (repairedExistingTranscript.length > 0) {
      console.log(
        '\n[ReplayFallback] Only one speaker channel was captured; using repaired existing transcript turns as the candidate output.',
      );
      finalTurns = repairedExistingTranscript;
    }
  }

  const currentDiagnostics =
    currentTranscriptSegments.length > 0
      ? computeTranscriptDiagnostics(currentTranscriptSegments)
      : null;
  const candidateAppSegments = finalTurnsToAppSegments(
    finalTurns,
    sessionBaseTs,
  );
  const candidateDiagnostics =
    candidateAppSegments.length > 0
      ? computeTranscriptDiagnostics(candidateAppSegments)
      : null;

  if (currentDiagnostics) {
    printTranscriptDiagnostics('current_db', currentDiagnostics);
  }
  if (candidateDiagnostics) {
    printTranscriptDiagnostics('candidate_replay', candidateDiagnostics);
  }
  if (currentDiagnostics && candidateDiagnostics) {
    const delta = candidateDiagnostics.score - currentDiagnostics.score;
    console.log(
      `\n[Diagnostics] deltaScore=${delta} firstFiveMinutes ${currentDiagnostics.firstFiveMinutesAnomalies}->${candidateDiagnostics.firstFiveMinutesAnomalies} lexicalDuplicates ${currentDiagnostics.overlappingLexicalDuplicates}->${candidateDiagnostics.overlappingLexicalDuplicates}`,
    );
  }

  if (opts.dumpBaselineJsonPath) {
    const payload = {
      meetingId: meeting.id,
      title: meeting.title,
      transcription: {
        ...transcriptionConfig,
        elapsedMs: Date.now() - benchmarkStart,
        activeConfig: sessionResult.activeConfig || null,
      },
      segments: finalTurns,
    };
    fs.mkdirSync(path.dirname(opts.dumpBaselineJsonPath), { recursive: true });
    fs.writeFileSync(
      opts.dumpBaselineJsonPath,
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
    console.log(
      `[BaselineDump] Wrote ${finalTurns.length} segments to ${opts.dumpBaselineJsonPath}`,
    );
  }

  if (opts.updateMeetingTranscript) {
    let persistId = null;
    if (opts.fixedSet) {
      const fixed = fixtureSets[opts.fixedSet];
      if (fixed?.meetingId) persistId = String(fixed.meetingId);
    } else if (opts.meetingId) {
      persistId = String(opts.meetingId);
    }
    if (!persistId) {
      throw new Error(
        '--update-meeting-transcript needs a real meeting id (pass <meetingId> or use --fixed-set with meetingId in the fixture)',
      );
    }
    const appSegments = candidateAppSegments;
    if (appSegments.length === 0) {
      console.warn(
        '[Pluto] --update-meeting-transcript: no segments to write; skipping DB update',
      );
    } else if (
      !hasMaterialDiagnosticImprovement(
        currentDiagnostics,
        candidateDiagnostics,
      )
    ) {
      console.warn(
        '[Pluto] --update-meeting-transcript: replay output did not materially improve diagnostics; skipping DB update',
      );
    } else {
      console.log(
        `\n[Pluto] Updating meetings.transcript_json for ${persistId} (${appSegments.length} segments)…`,
      );
      persistTranscriptToDb(opts.dbPath, persistId, appSegments);
      console.log(
        '[Pluto] Quit and reopen the meeting in Pluto (or reload) to refresh the transcript view.',
      );
    }
  }

  console.log('\nSuggested transcript:');
  if (finalTurns.length === 0) {
    console.log('(no reliable channel segments; use session-mic text)');
  } else {
    for (const turn of finalTurns) {
      console.log(`${turn.speaker}: ${turn.text}`);
    }
  }
  if (opts.echoStats) {
    const stats = computeEchoStats(finalTurns);
    console.log('\nEcho duplication stats (final transcript):');
    console.log(
      `turns=${stats.total}, uniqueTexts=${stats.unique}, duplicates=${stats.duplicates} (${(stats.duplicateRatio * 100).toFixed(1)}%)`,
    );
    console.log(
      `crossSpeakerDuplicateTurns=${stats.crossSpeakerDuplicateTurns} (${(stats.crossSpeakerRatio * 100).toFixed(1)}%), crossSpeakerGroups=${stats.crossSpeakerGroups}`,
    );
  }

  const comparison = compareAgainstExpectedTurns(finalTurns, expectedTurns);
  if (comparison) {
    console.log('\nExpected fixture comparison:');
    console.log(
      `Matched turns: ${comparison.matches}/${comparison.total} (speaker + text similarity >= 0.60)`,
    );
    for (const item of comparison.comparisons) {
      const expectedSpeaker = item.expected
        ? item.expected.speaker
        : '(missing)';
      const actualSpeaker = item.actual ? item.actual.speaker : '(missing)';
      const similarity = item.similarity.toFixed(2);
      const status =
        item.speakerMatch && item.similarity >= 0.6 ? 'PASS' : 'FAIL';
      console.log(
        `${status} turn ${item.index}: expected=${expectedSpeaker}, actual=${actualSpeaker}, textSim=${similarity}`,
      );
    }
    const strictPass = comparison.matches === comparison.total;
    if (opts.requireExpected && !strictPass) {
      throw new Error(
        `Expected fixture mismatch: matched=${comparison.matches}/${comparison.total}, actualTurns=${finalTurns.length}`,
      );
    }
  } else if (opts.requireExpected) {
    throw new Error(
      'Expected fixture is required, but no expected turns were provided.',
    );
  }

  console.log('\nTip:');
  console.log(
    `Re-run with more attempts: node scripts/replay_meeting_attribution.js ${meeting.id} --attempts 5`,
  );
};

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});

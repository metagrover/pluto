#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const DEFAULT_PORT = 5123;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_MAX_LOOKBACK_MS = 5 * 60 * 1000;
const DEFAULT_MAX_GAP_MS = 20 * 1000;
const DEFAULT_SESSION_LEAD_MS = 8 * 1000;
const DEFAULT_LOCAL_FIXTURE_FILE = path.join(
  process.cwd(),
  'scripts',
  'replay.local-fixtures.json',
);

const BUILTIN_TEST_SETS = {};

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
    fixedSet: '',
    requireExpected: false,
    allSets: false,
    fixtureFile: DEFAULT_LOCAL_FIXTURE_FILE,
    expectedFile: '',
    echoStats: false,
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
    if (arg === '--all-sets') {
      options.allSets = true;
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
  const match = filename.match(/^(me|them|session-mic)_(\d+)_/);
  if (!match) return null;
  return {
    speaker: match[1],
    ts: Number.parseInt(match[2], 10),
  };
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const transcribeFile = async (serverUrl, audioPath, model) => {
  const payload = {
    audio_path: audioPath,
    language: 'en',
    diarize: false,
  };
  if (model) payload.model = model;

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

const bestOfAttempts = async (serverUrl, audioPath, attempts, model) => {
  const attemptsPayload = [];
  for (let i = 0; i < attempts; i++) {
    const result = await transcribeFile(serverUrl, audioPath, model);
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
  };
};

const mergeTurns = (segments) => {
  const merged = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === segment.speaker) {
      last.text = `${last.text} ${segment.text}`.trim();
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

      const sim = jaccardSimilarity(segment.text, other.text);
      if (sim < similarityThreshold) continue;

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

const clampUnit = (value) => Math.max(0, Math.min(1, value));

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
      return {
        speaker,
        text,
        startMs: baseTs + safeStart * 1000,
        endMs: baseTs + safeEnd * 1000,
      };
    })
    .filter(Boolean);
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

const assignSessionSegmentsFromSource = (sessionSegments, sourceSegments) => {
  if (!Array.isArray(sessionSegments) || sessionSegments.length === 0)
    return [];
  if (!Array.isArray(sourceSegments) || sourceSegments.length === 0) {
    return [];
  }

  const sortedSession = [...sessionSegments].sort(
    (a, b) => a.startMs - b.startMs,
  );
  const sortedSource = [...sourceSegments].sort(
    (a, b) => a.startMs - b.startMs,
  );
  const sentenceAssignments = [];
  let lastSpeaker = 'Them';
  const timelineStart = sortedSession[0].startMs;
  const timelineEnd = sortedSession[sortedSession.length - 1].endMs;
  const timelineSpan = Math.max(1, timelineEnd - timelineStart);

  for (const session of sortedSession) {
    const durationMs = Math.max(50, session.endMs - session.startMs);
    const sessionMid = (session.startMs + session.endMs) / 2;
    const sessionWords = tokenize(session.text).length;

    let meScore = 0;
    let themScore = 0;
    let meLex = 0;
    let themLex = 0;
    for (const source of sortedSource) {
      const overlapMs = Math.max(
        0,
        Math.min(session.endMs, source.endMs) -
          Math.max(session.startMs, source.startMs),
      );
      const overlapRatio = overlapMs > 0 ? overlapMs / durationMs : 0;
      const lexical = jaccardSimilarity(session.text, source.text);
      const sourceMid = (source.startMs + source.endMs) / 2;
      const proximity = clampUnit(1 - Math.abs(sessionMid - sourceMid) / 4500);
      const score =
        overlapRatio * (0.2 + lexical * 0.8) +
        lexical * 0.75 +
        proximity * 0.25;
      if (source.speaker === 'Me') {
        meScore = Math.max(meScore, score);
        meLex = Math.max(meLex, lexical);
      } else if (source.speaker === 'Them') {
        themScore = Math.max(themScore, score);
        themLex = Math.max(themLex, lexical);
      }
    }

    let speaker = 'Them';
    const bestScore = Math.max(meScore, themScore);
    const uncoveredFromThem =
      sessionWords >= 4 && themLex < 0.24 && meScore <= themScore + 0.05;
    if (Math.abs(meScore - themScore) >= 0.12 && bestScore >= 0.18) {
      speaker = meScore >= themScore ? 'Me' : 'Them';
    } else if (uncoveredFromThem) {
      speaker = 'Me';
    } else if (bestScore >= 0.14) {
      speaker = meScore >= themScore ? 'Me' : 'Them';
    } else {
      speaker = lastSpeaker;
    }

    lastSpeaker = speaker;
    sentenceAssignments.push({
      speaker,
      text: session.text,
      startMs: session.startMs,
      endMs: session.endMs,
      meScore,
      themScore,
      meLex,
      themLex,
      relativePos: (sessionMid - timelineStart) / timelineSpan,
    });
  }

  // Smooth unstable Me runs that are likely unmatched system fragments.
  for (let i = 0; i < sentenceAssignments.length; ) {
    if (sentenceAssignments[i].speaker !== 'Me') {
      i++;
      continue;
    }
    let j = i;
    while (
      j + 1 < sentenceAssignments.length &&
      sentenceAssignments[j + 1].speaker === 'Me'
    ) {
      j++;
    }
    const run = sentenceAssignments.slice(i, j + 1);
    const prevSpeaker = i > 0 ? sentenceAssignments[i - 1].speaker : null;
    const nextSpeaker =
      j + 1 < sentenceAssignments.length
        ? sentenceAssignments[j + 1].speaker
        : null;
    const lowConfidenceRun = run.every(
      (item) => item.meScore < 0.2 && item.themScore < 0.2 && item.meLex < 0.25,
    );
    const runMidPos =
      run.reduce((sum, item) => sum + item.relativePos, 0) /
      Math.max(1, run.length);
    const earlyOrMidRun = runMidPos <= 0.55;
    const earlyRun = run.every((item) => item.relativePos <= 0.4);
    const runStartsAsContinuation = /^(or|and|but|so)\b/.test(
      normalizeText(run[0]?.text || ''),
    );

    if (
      lowConfidenceRun &&
      prevSpeaker === 'Them' &&
      runMidPos > 0.65 &&
      run.length >= 2 &&
      runStartsAsContinuation
    ) {
      const tailToKeepAsMe = run.length >= 3 ? 2 : 1;
      const convertThrough = Math.max(i - 1, j - tailToKeepAsMe);
      for (let k = i; k <= convertThrough; k++) {
        sentenceAssignments[k].speaker = 'Them';
      }
      i = j + 1;
      continue;
    }

    if (
      lowConfidenceRun &&
      earlyOrMidRun &&
      ((run.length >= 2 && prevSpeaker === 'Them') ||
        (run.length === 1 &&
          prevSpeaker === 'Them' &&
          nextSpeaker === 'Them' &&
          earlyRun))
    ) {
      for (let k = i; k <= j; k++) {
        sentenceAssignments[k].speaker = 'Them';
      }
    }
    i = j + 1;
  }

  const assigned = [];
  for (const sentence of sentenceAssignments) {
    const last = assigned[assigned.length - 1];
    if (last && last.speaker === sentence.speaker) {
      last.text = `${last.text} ${sentence.text}`.trim();
      last.endMs = sentence.endMs;
      continue;
    }
    assigned.push({
      speaker: sentence.speaker,
      text: sentence.text,
      startMs: sentence.startMs,
      endMs: sentence.endMs,
    });
  }

  return assigned.map((segment) => ({
    speaker: segment.speaker,
    text: segment.text,
    ts: segment.startMs,
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
  if (!parsed) {
    return { sets: { ...BUILTIN_TEST_SETS }, defaultSet: '' };
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
      };
    }
    return {
      sets: { ...BUILTIN_TEST_SETS, ...parsed },
      defaultSet: '',
    };
  }

  throw new Error(`Invalid fixture file format: ${fixtureFile}`);
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

const main = async () => {
  const opts = parseArgs();
  if (!fs.existsSync(opts.meetingsDir)) {
    throw new Error(`Meetings directory not found: ${opts.meetingsDir}`);
  }
  if (!fs.existsSync(opts.dbPath)) {
    throw new Error(`DB not found: ${opts.dbPath}`);
  }

  const { sets: fixtureSets, defaultSet } = loadFixtureSets(opts.fixtureFile);

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
      const child = spawnSync(process.execPath, childArgs, {
        stdio: 'inherit',
      });
      if (child.status !== 0) {
        throw new Error(`Fixture set failed: ${setName}`);
      }
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
      const sessionInfo = extractTimestampFromName(sessionFile);
      if (!sessionInfo || sessionInfo.speaker !== 'session-mic') {
        throw new Error(
          `Meeting audio_path is not a session-mic file: ${meeting.audio_path}`,
        );
      }

      const allFiles = fs.readdirSync(opts.meetingsDir);
      const channelEntries = allFiles
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
      const fixedSessionInfo = extractTimestampFromName(fixed.sessionFile);
      if (fixedSessionInfo && fixedSessionInfo.speaker === 'session-mic') {
        sessionBaseTs = fixedSessionInfo.ts;
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
    const sessionInfo = extractTimestampFromName(sessionFile);
    if (!sessionInfo || sessionInfo.speaker !== 'session-mic') {
      throw new Error(
        `Meeting audio_path is not a session-mic file: ${meeting.audio_path}`,
      );
    }

    const allFiles = fs.readdirSync(opts.meetingsDir);
    const channelEntries = allFiles
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

  if (expectedOverride.expectedTurns.length > 0) {
    expectedTurns = expectedOverride.expectedTurns;
  }

  console.log(`Meeting: ${meeting.id}`);
  console.log(`Title: ${meeting.title}`);
  console.log(`Session audio: ${sessionAudioPath}`);
  console.log(`Selected channel files: ${selectedEntries.length}`);
  for (const entry of selectedEntries) {
    console.log(`  - ${entry.name}`);
  }

  const sessionResult = await bestOfAttempts(
    opts.serverUrl,
    sessionAudioPath,
    opts.attempts,
    opts.model,
  );
  const sessionText = sessionResult.best;
  const normalizedSession = normalizeText(sessionText);

  console.log('\nSession-mic transcription:');
  console.log(sessionText || '(empty)');

  const rawSegments = [];
  for (const entry of selectedEntries) {
    const replay = await bestOfAttempts(
      opts.serverUrl,
      entry.absolutePath,
      opts.attempts,
      opts.model,
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
          endMs: segment.ts + 8000,
        },
      ];
    });
  const sessionCanonicalSegments = mapAttemptSegmentsToAbsolute(
    'Unknown',
    sessionBaseTs,
    sessionResult.bestSegments,
  );
  const sessionSentenceSegments = splitCanonicalSegmentsIntoSentences(
    sessionCanonicalSegments,
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
  const canonicalAssigned = assignSessionSegmentsFromSource(
    sessionSentenceSegments,
    sourceEvidenceSegments,
  );
  const finalTurns =
    canonicalAssigned.length > 0 ? mergeTurns(canonicalAssigned) : merged;

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
    const strictPass =
      comparison.matches === comparison.total &&
      finalTurns.length === expectedTurns.length;
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

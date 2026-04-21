#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  listSupportedBenchmarkBackends,
} = require('./lib/transcription_backends');

const DEFAULT_FIXTURE_FILE = path.join(
  process.cwd(),
  'scripts',
  'replay.local-fixtures.json',
);

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

const overlapSeconds = (a, b) =>
  Math.max(
    0,
    Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime),
  );

const normalizeSegment = (segment) => {
  if (!segment || !segment.text) return null;
  const startTime =
    typeof segment.startTime === 'number'
      ? segment.startTime
      : typeof segment.startMs === 'number'
        ? segment.startMs / 1000
        : typeof segment.start === 'number'
          ? segment.start
          : null;
  const endTime =
    typeof segment.endTime === 'number'
      ? segment.endTime
      : typeof segment.endMs === 'number'
        ? segment.endMs / 1000
        : typeof segment.end === 'number'
          ? segment.end
          : null;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  return {
    speaker: String(segment.speaker || ''),
    text: String(segment.text || ''),
    startTime,
    endTime,
  };
};

const loadSegments = (filePath) => {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const segments = Array.isArray(raw) ? raw : raw.segments;
  if (!Array.isArray(segments)) {
    throw new Error(`No segments array in ${filePath}`);
  }
  return segments.map(normalizeSegment).filter(Boolean);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    fixtureFile: DEFAULT_FIXTURE_FILE,
    out: path.join(
      process.cwd(),
      'tmp',
      `transcription-benchmark-${Date.now()}.json`,
    ),
    serverUrl: 'http://127.0.0.1:5123',
    attempts: 1,
  };

  const takeValue = (flag, index) => {
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${flag}`);
    }
    return args[index + 1];
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--fixture-file') {
      options.fixtureFile = takeValue(arg, i);
      i++;
      continue;
    }
    if (arg === '--out') {
      options.out = takeValue(arg, i);
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
        Number.parseInt(takeValue(arg, i), 10) || 1,
      );
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
};

const loadCorpus = (fixtureFile) => {
  const corpus = [];
  const baselinesDir = path.join(process.cwd(), 'scripts', 'baselines');
  if (fs.existsSync(baselinesDir)) {
    for (const name of fs.readdirSync(baselinesDir)) {
      if (!name.endsWith('.expected-human.json')) continue;
      const meetingId = name.replace(/\.expected-human\.json$/, '');
      corpus.push({
        id: meetingId,
        meetingId,
        expectedPath: path.join(baselinesDir, name),
      });
    }
  }

  if (fixtureFile && fs.existsSync(fixtureFile)) {
    const raw = JSON.parse(fs.readFileSync(fixtureFile, 'utf-8'));
    const entries = Array.isArray(raw.transcriptRegressions)
      ? raw.transcriptRegressions
      : [];
    for (const entry of entries) {
      if (!entry || !entry.meetingId || !entry.expectedPath) continue;
      const expectedPath = path.isAbsolute(entry.expectedPath)
        ? entry.expectedPath
        : path.join(path.dirname(fixtureFile), entry.expectedPath);
      if (corpus.some((item) => item.meetingId === entry.meetingId)) continue;
      corpus.push({
        id: entry.id || entry.meetingId,
        meetingId: entry.meetingId,
        expectedPath,
      });
    }
  }

  return corpus.filter((entry) => fs.existsSync(entry.expectedPath));
};

const computeOverlapMetrics = (segments) => {
  let overlapPairs = 0;
  let totalOverlapSec = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const left = segments[i];
      const right = segments[j];
      if (left.speaker === right.speaker) continue;
      const overlap = overlapSeconds(left, right);
      if (overlap < 0.2) continue;
      overlapPairs++;
      totalOverlapSec += overlap;
    }
  }
  return { overlapPairs, totalOverlapSec: Number(totalOverlapSec.toFixed(2)) };
};

const findBestMatch = (segment, candidates) => {
  let best = null;
  for (const candidate of candidates) {
    const overlap = overlapSeconds(segment, candidate);
    const textSim = jaccardSimilarity(segment.text, candidate.text);
    const score = overlap > 0 ? overlap * 0.7 + textSim * 0.3 : textSim * 0.5;
    if (!best || score > best.score) {
      best = { candidate, overlap, textSim, score };
    }
  }
  return best;
};

const computeScorecard = (generatedSegments, expectedSegments) => {
  const bestMatches = expectedSegments
    .map((segment) => ({
      expected: segment,
      match: findBestMatch(segment, generatedSegments),
    }))
    .filter((entry) => entry.match);

  const averageSimilarity =
    bestMatches.length === 0
      ? 0
      : bestMatches.reduce((sum, entry) => sum + entry.match.textSim, 0) /
        bestMatches.length;
  const speakerAgreement =
    bestMatches.length === 0
      ? 0
      : bestMatches.filter(
          (entry) => entry.expected.speaker === entry.match.candidate.speaker,
        ).length / bestMatches.length;

  const shortBaselineTurns = expectedSegments.filter(
    (segment) => tokenize(segment.text).length <= 3,
  );
  const droppedShortTurns = shortBaselineTurns.filter((segment) => {
    const match = findBestMatch(segment, generatedSegments);
    if (!match) return true;
    return (
      match.candidate.speaker !== segment.speaker &&
      match.textSim < 0.5 &&
      match.overlap < 0.2
    );
  }).length;

  const generatedSpeakers = new Set(
    generatedSegments.map((segment) => segment.speaker),
  );
  const overlap = computeOverlapMetrics(generatedSegments);

  return {
    expectedSegments: expectedSegments.length,
    generatedSegments: generatedSegments.length,
    averageTextSimilarity: Number(averageSimilarity.toFixed(4)),
    speakerAgreement: Number(speakerAgreement.toFixed(4)),
    droppedShortTurns,
    emptyMe: !generatedSpeakers.has('Me'),
    emptyThem: !generatedSpeakers.has('Them'),
    overlapPairs: overlap.overlapPairs,
    totalOverlapSec: overlap.totalOverlapSec,
  };
};

const runReplay = (entry, backendConfig, options) => {
  const tmpOutput = path.join(
    os.tmpdir(),
    `pluto-benchmark-${entry.meetingId}-${backendConfig.backend}-${backendConfig.preset}-${Date.now()}.json`,
  );
  const args = [
    path.join(process.cwd(), 'scripts', 'replay_meeting_attribution.js'),
    entry.meetingId,
    '--server-url',
    options.serverUrl,
    '--attempts',
    String(options.attempts),
    '--backend',
    backendConfig.backend,
    '--preset',
    backendConfig.preset,
    '--dump-baseline-json',
    tmpOutput,
  ];

  const child = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (child.status !== 0) {
    throw new Error(
      `Replay failed for ${entry.meetingId} (${backendConfig.backend}/${backendConfig.preset}): ${child.stderr || child.stdout}`,
    );
  }

  const payload = JSON.parse(fs.readFileSync(tmpOutput, 'utf-8'));
  fs.unlinkSync(tmpOutput);
  return payload;
};

const main = () => {
  const options = parseArgs();
  const corpus = loadCorpus(options.fixtureFile);
  if (corpus.length === 0) {
    throw new Error('No benchmark corpus found.');
  }

  const backends = listSupportedBenchmarkBackends();
  const results = [];

  for (const entry of corpus) {
    const expectedSegments = loadSegments(entry.expectedPath);
    for (const backendConfig of backends) {
      console.log(
        `[Benchmark] ${entry.meetingId} -> ${backendConfig.backend}/${backendConfig.preset}`,
      );
      const generatedPayload = runReplay(entry, backendConfig, options);
      const generatedSegments = (generatedPayload.segments || [])
        .map(normalizeSegment)
        .filter(Boolean);
      results.push({
        meetingId: entry.meetingId,
        corpusId: entry.id,
        expectedPath: entry.expectedPath,
        backend: backendConfig.backend,
        preset: backendConfig.preset,
        transcription: generatedPayload.transcription || null,
        scorecard: computeScorecard(generatedSegments, expectedSegments),
      });
    }
  }

  const summary = backends.map((backendConfig) => {
    const subset = results.filter(
      (entry) =>
        entry.backend === backendConfig.backend &&
        entry.preset === backendConfig.preset,
    );
    const average = (key) =>
      subset.length === 0
        ? 0
        : subset.reduce((sum, entry) => sum + entry.scorecard[key], 0) /
          subset.length;
    return {
      backend: backendConfig.backend,
      preset: backendConfig.preset,
      meetings: subset.length,
      averageTextSimilarity: Number(
        average('averageTextSimilarity').toFixed(4),
      ),
      averageSpeakerAgreement: Number(average('speakerAgreement').toFixed(4)),
      averageDroppedShortTurns: Number(average('droppedShortTurns').toFixed(2)),
      averageOverlapPairs: Number(average('overlapPairs').toFixed(2)),
      emptyMeFailures: subset.filter((entry) => entry.scorecard.emptyMe).length,
      emptyThemFailures: subset.filter((entry) => entry.scorecard.emptyThem)
        .length,
    };
  });

  const payload = {
    createdAt: new Date().toISOString(),
    serverUrl: options.serverUrl,
    attempts: options.attempts,
    corpus,
    summary,
    results,
  };

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, JSON.stringify(payload, null, 2), 'utf-8');

  console.log(`\n[Benchmark] Wrote comparison artifact to ${options.out}`);
  for (const item of summary) {
    console.log(
      `[Benchmark] ${item.backend}/${item.preset} textSim=${item.averageTextSimilarity} speaker=${item.averageSpeakerAgreement} overlapPairs=${item.averageOverlapPairs} emptyMe=${item.emptyMeFailures} emptyThem=${item.emptyThemFailures}`,
    );
  }
};

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

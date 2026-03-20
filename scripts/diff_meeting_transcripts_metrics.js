#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'pluto',
  'pluto.db',
);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const meetingId = args.find((a) => !a.startsWith('--'));
  if (!meetingId)
    throw new Error(
      'Usage: node diff_meeting_transcripts_metrics.js <meetingId> --baseline-manual <path> [--baseline-diarize <path>] [--db <path>]',
    );
  const get = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return undefined;
    return args[i + 1];
  };
  const baselineManual = get('--baseline-manual');
  if (!baselineManual) throw new Error('Missing --baseline-manual <path>');
  const baselineDiarize = get('--baseline-diarize');
  const dbPath = get('--db') || DEFAULT_DB_PATH;
  return { meetingId, baselineManual, baselineDiarize, dbPath };
};

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
  for (const token of leftTokens) if (rightTokens.has(token)) overlap++;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : overlap / union;
};

const overlapSeconds = (a, b) =>
  Math.max(
    0,
    Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime),
  );

const normalizeSegment = (seg) => {
  if (!seg) return null;
  const speaker = seg.speaker ? String(seg.speaker) : '';
  const text = seg.text ? String(seg.text) : '';

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

  if (!speaker || text.length === 0) return null;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  return { speaker, text, startTime, endTime };
};

const loadBaselineSegments = (filePath) => {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const segments = Array.isArray(raw) ? raw : raw.segments;
  if (!Array.isArray(segments))
    throw new Error(`No segments array in baseline: ${filePath}`);
  return segments.map(normalizeSegment).filter(Boolean);
};

const loadTranscriptJsonFromDb = (dbPath, meetingId) => {
  const pyCode = `
import json, sqlite3, sys
db_path = sys.argv[1]
meeting_id = sys.argv[2]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
row = conn.execute(
  "SELECT transcript_json FROM meetings WHERE id = ?",
  (meeting_id,)
).fetchone()
conn.close()
if not row or not row['transcript_json']:
  print("")
else:
  print(row['transcript_json'])
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
      `Failed to query meeting transcript_json: ${result.stderr || result.stdout}`,
    );
  }
  const out = (result.stdout || '').trim();
  if (!out) return null;
  const parsed = JSON.parse(out);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.segments)) {
    return parsed.segments;
  }
  return [];
};

const computeMetrics = (segments, label) => {
  const me = segments.filter((s) => s.speaker === 'Me');
  const them = segments.filter((s) => s.speaker === 'Them');

  const totalDur = (arr) =>
    arr.reduce((acc, s) => acc + Math.max(0, s.endTime - s.startTime), 0);

  // Cross-speaker overlap count/duration
  const overlapPairs = [];
  for (const m of me) {
    for (const t of them) {
      const ov = overlapSeconds(m, t);
      if (ov <= 0) continue;
      const minDur = Math.max(
        0.01,
        Math.min(m.endTime - m.startTime, t.endTime - t.startTime),
      );
      const overlapRatioMin = ov / minDur;
      overlapPairs.push({ m, t, ov, overlapRatioMin });
    }
  }

  const overlapPairsFiltered = overlapPairs.filter((p) => p.ov >= 0.2);
  const totalOverlapSeconds = overlapPairsFiltered.reduce(
    (acc, p) => acc + p.ov,
    0,
  );

  // Likely bleed ranking: for each Me segment, find best Them overlap by token sim + overlap evidence
  const likelyBleedCandidates = [];
  for (const m of me) {
    let best = null;
    for (const t of them) {
      const ov = overlapSeconds(m, t);
      if (ov <= 0) continue;
      const minDur = Math.max(
        0.01,
        Math.min(m.endTime - m.startTime, t.endTime - t.startTime),
      );
      const overlapRatioMin = ov / minDur;
      if (overlapRatioMin < 0.25) continue;
      const tokenSim = jaccardSimilarity(m.text, t.text);
      if (tokenSim < 0.25) continue;

      const score = overlapRatioMin * 0.6 + tokenSim * 0.4;
      if (!best || score > best.score) {
        best = { t, ov, overlapRatioMin, tokenSim, score };
      }
    }
    if (best) {
      likelyBleedCandidates.push({
        m,
        best,
        score: best.score,
      });
    }
  }

  likelyBleedCandidates.sort((a, b) => b.score - a.score);

  const top = likelyBleedCandidates.slice(0, 20).map((c) => {
    const m = c.m;
    const t = c.best.t;
    const prefix = (s, n = 60) => normalizeText(s).slice(0, n);
    return {
      score: Number(c.score.toFixed(3)),
      overlapSec: Number(c.best.ov.toFixed(2)),
      overlapRatioMin: Number(c.best.overlapRatioMin.toFixed(2)),
      tokenSim: Number(c.best.tokenSim.toFixed(2)),
      me: `${m.startTime.toFixed(1)}-${m.endTime.toFixed(1)}`,
      them: `${t.startTime.toFixed(1)}-${t.endTime.toFixed(1)}`,
      meText: prefix(m.text),
      meFullText: m.text,
      themText: prefix(t.text),
      themFullText: t.text,
    };
  });

  const likelyBleedMeCount = likelyBleedCandidates.length;

  console.log(
    `\n[${label}] segments=${segments.length} Me=${me.length} Them=${them.length}`,
  );
  console.log(
    `[${label}] durationSec Me=${totalDur(me).toFixed(1)} Them=${totalDur(them).toFixed(1)}`,
  );
  console.log(
    `[${label}] crossSpeakerOverlapPairs(overlap>=0.2s)=${overlapPairsFiltered.length} totalOverlapSec=${totalOverlapSeconds.toFixed(1)}`,
  );
  console.log(`[${label}] likelyBleedMeCandidates=${likelyBleedMeCount}`);

  console.log(`[${label}] topLikelyBleedPairs:`);
  for (const item of top.slice(0, 20)) {
    console.log(
      `  score=${item.score} ov=${item.overlapSec}s ovRatioMin=${item.overlapRatioMin} tokenSim=${item.tokenSim} | Me(${item.me}): ${item.meText} || Them(${item.them}): ${item.themText}`,
    );
  }

  return {
    meCount: me.length,
    themCount: them.length,
    top,
    likelyBleedMeCount,
  };
};

const main = () => {
  const { meetingId, baselineManual, baselineDiarize, dbPath } = parseArgs();
  const appSegsRaw = loadTranscriptJsonFromDb(dbPath, meetingId);
  if (!appSegsRaw || appSegsRaw.length === 0) {
    throw new Error(`No transcript_json for meeting ${meetingId}`);
  }
  const appSegs = appSegsRaw.map(normalizeSegment).filter(Boolean);

  const manual = loadBaselineSegments(baselineManual);
  const diarize = baselineDiarize
    ? loadBaselineSegments(baselineDiarize)
    : null;

  console.log(`[DiffMetrics] meetingId=${meetingId}`);
  const appMetrics = computeMetrics(appSegs, 'APP(transcript_json)');
  const manualMetrics = computeMetrics(manual, 'BASELINE(manual)');

  // Speaker swap proxy: for each "likely bleed" candidate where app says Me
  // overlaps a similar Them turn, check if baseline assigns the text more to
  // Them than to Me.
  if (appMetrics.top.length > 0) {
    const baselineMe = manual.filter((s) => s.speaker === 'Me');
    const baselineThem = manual.filter((s) => s.speaker === 'Them');
    let swapped = 0;

    for (const cand of appMetrics.top) {
      const meText = cand.meFullText;
      let bestMeSim = 0;
      let bestThemSim = 0;
      for (const s of baselineMe)
        bestMeSim = Math.max(bestMeSim, jaccardSimilarity(meText, s.text));
      for (const s of baselineThem)
        bestThemSim = Math.max(bestThemSim, jaccardSimilarity(meText, s.text));
      if (bestThemSim > bestMeSim) swapped++;
    }

    const proxy = swapped / appMetrics.top.length;
    console.log(
      `\n[APP vs BASELINE(manual)] likelyBleed speaker-swap proxy=${swapped}/${appMetrics.top.length} (~${(proxy * 100).toFixed(1)}%)`,
    );
  }

  // Drop/merge proxy: how many baseline Me turns are "missing" in app under
  // a lexical similarity threshold.
  if (manualMetrics.meCount > 0) {
    const appAll = appSegs;
    const baselineMe = manual.filter((s) => s.speaker === 'Me');
    let dropped = 0;
    for (const b of baselineMe) {
      let best = 0;
      for (const a of appAll)
        best = Math.max(best, jaccardSimilarity(b.text, a.text));
      if (best < 0.35) dropped++;
    }
    console.log(
      `[APP vs BASELINE(manual)] baselineMe dropped/too-dissimilar count=${dropped}/${baselineMe.length}`,
    );
  }

  if (diarize) computeMetrics(diarize, 'BASELINE(diarize)');
};

main();

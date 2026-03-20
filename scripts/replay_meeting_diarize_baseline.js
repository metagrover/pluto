#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const DEFAULT_PORT = 5123;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return undefined;
    return args[i + 1];
  };

  const meetingId = args.find((a) => !a.startsWith('--'));
  if (!meetingId) {
    throw new Error(
      'Usage: node scripts/replay_meeting_diarize_baseline.js <meetingId> [--out <path>] [--server-url http://127.0.0.1:5123] [--hf-token <token>]\n' +
        'Note: Diarization needs a HuggingFace token + pyannote model access; Pluto does not require this for normal use. Without a token this script exits 0 and does nothing.',
    );
  }

  const out =
    get('--out') ||
    path.join('scripts', 'baselines', `${meetingId}.diarize.json`);
  const serverUrl = get('--server-url') || `http://127.0.0.1:${DEFAULT_PORT}`;
  const hfToken =
    get('--hf-token') ||
    process.env.PLUTO_HF_TOKEN ||
    process.env.HF_TOKEN ||
    process.env.hf_token;

  return { meetingId, out, serverUrl, hfToken };
};

const overlapSeconds = (a, b) =>
  Math.max(
    0,
    Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime),
  );

const normalizeText = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mergeSegments = (segments) => {
  const sorted = [...segments].sort((x, y) => x.startTime - y.startTime);
  const out = [];
  for (const seg of sorted) {
    if (!seg.text || !seg.text.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.text = `${last.text} ${seg.text}`.trim();
      last.endTime = Math.max(last.endTime, seg.endTime);
      continue;
    }
    out.push({ ...seg });
  }
  return out;
};

const segmentSpeakerId = (seg) => {
  const speaker =
    seg.speaker ?? seg.speaker_id ?? seg.speakerId ?? seg.speakerLabel;
  if (speaker != null && String(speaker).trim()) return String(speaker).trim();
  if (Array.isArray(seg.words)) {
    const w = seg.words.find((w) => w && w.speaker != null);
    if (w && w.speaker != null && String(w.speaker).trim())
      return String(w.speaker).trim();
  }
  return '';
};

const transcribe = async (serverUrl, audioPath, { hfToken } = {}) => {
  const payload = {
    audio_path: audioPath,
    language: 'en',
    diarize: true,
    hf_token: hfToken || undefined,
  };

  const res = await fetch(`${serverUrl}/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
};

const loadMeetingFromDb = (dbPath, meetingId) => {
  const pyCode = `
import json, sqlite3, sys
db_path = sys.argv[1]
meeting_id = sys.argv[2]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
row = conn.execute(
  "SELECT id, title, audio_path, transcript_json FROM meetings WHERE id = ?",
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

const main = async () => {
  const { meetingId, out, serverUrl, hfToken } = parseArgs();

  if (!hfToken || !String(hfToken).trim()) {
    console.log(
      '[DiarizeBaseline] Skipped: no HuggingFace token. Pyannote diarization is gated; Pluto channel-based + Me-bleed cleanup is the default path.',
    );
    console.log(
      '[DiarizeBaseline] Optional: set PLUTO_HF_TOKEN or pass --hf-token if you have accepted pyannote terms on huggingface.co.',
    );
    process.exit(0);
  }

  const dbPath = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'pluto',
    'pluto.db',
  );
  const row = loadMeetingFromDb(dbPath, meetingId);
  if (!row) throw new Error(`Meeting not found: ${meetingId}`);
  if (!row.audio_path)
    throw new Error(`Meeting audio_path missing for ${meetingId}`);

  const transcriptJson = row.transcript_json
    ? JSON.parse(row.transcript_json)
    : [];
  const referenceSegments = Array.isArray(transcriptJson) ? transcriptJson : [];

  const meRef = referenceSegments.filter(
    (s) =>
      s.speaker === 'Me' &&
      s.text &&
      typeof s.startTime === 'number' &&
      typeof s.endTime === 'number',
  );
  const themRef = referenceSegments.filter(
    (s) =>
      s.speaker === 'Them' &&
      s.text &&
      typeof s.startTime === 'number' &&
      typeof s.endTime === 'number',
  );

  console.log(`[DiarizeBaseline] Meeting=${meetingId} audio=${row.audio_path}`);
  console.log(
    `[DiarizeBaseline] Reference segments: Me=${meRef.length}, Them=${themRef.length}`,
  );

  const result = await transcribe(serverUrl, row.audio_path, { hfToken });
  const diarizeSegments = Array.isArray(result.segments) ? result.segments : [];

  const speakerIds = new Set(
    diarizeSegments.map(segmentSpeakerId).filter(Boolean),
  );
  console.log(
    `[DiarizeBaseline] Diarize segments=${diarizeSegments.length}, speakerIds=[${[...speakerIds].join(', ')}]`,
  );

  const mapping = {};
  for (const speakerId of speakerIds) {
    const diagSegs = diarizeSegments.filter(
      (s) => segmentSpeakerId(s) === speakerId,
    );

    let overlapMe = 0;
    let overlapThem = 0;
    for (const ds of diagSegs) {
      const startTime = Number(
        ds.start ?? ds.start_time ?? ds.startTime ?? ds.start_ms ?? ds.startMs,
      );
      const endTime = Number(
        ds.end ?? ds.end_time ?? ds.endTime ?? ds.end_ms ?? ds.endMs,
      );
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
      const d = { startTime, endTime };

      for (const r of meRef) overlapMe += overlapSeconds(d, r);
      for (const r of themRef) overlapThem += overlapSeconds(d, r);
    }

    mapping[speakerId] = overlapMe >= overlapThem ? 'Me' : 'Them';
  }

  const mapped = diarizeSegments
    .map((seg) => {
      const speakerId = segmentSpeakerId(seg);
      if (!speakerId) return null;

      const startTime = Number(
        seg.start ?? seg.start_time ?? seg.startTime ?? seg.startMs,
      );
      const endTime = Number(
        seg.end ?? seg.end_time ?? seg.endTime ?? seg.endMs,
      );
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;

      const text = String(seg.text || '').trim();
      if (!text) return null;

      return {
        startTime,
        endTime,
        text,
        speaker: mapping[speakerId] || 'Them',
      };
    })
    .filter(Boolean);

  const merged = mergeSegments(mapped);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify({ meetingId, mapping, segments: merged }, null, 2),
    'utf-8',
  );

  console.log(
    `[DiarizeBaseline] Wrote ${merged.length} mapped segments to ${out}`,
  );
};

main().catch((e) => {
  console.error(`[DiarizeBaseline] ERROR: ${e?.stack ? e.stack : e}`);
  process.exit(1);
});

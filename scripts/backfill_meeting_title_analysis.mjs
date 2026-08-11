#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  buildMeetingWhereClause,
  parseBackfillArgs,
  resolvePlutoDbPath,
} from './lib/meeting_backfill_helpers.js';

const OLLAMA_DEFAULT_MODEL = 'phi4-mini:3.8b';

const runPythonJson = (code, args) => {
  const output = execFileSync('python3', ['-c', code, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return output.trim() ? JSON.parse(output) : null;
};

const fetchRows = (dbPath, where) =>
  runPythonJson(
    `
import json, sqlite3, sys
db_path = sys.argv[1]
clause = sys.argv[2]
params = json.loads(sys.argv[3])
con = sqlite3.connect(db_path)
con.row_factory = sqlite3.Row
rows = con.execute(
  f"select rowid, * from meetings {clause} order by created_at desc",
  params
).fetchall()
print(json.dumps([dict(row) for row in rows]))
`,
    [dbPath, where.clause, JSON.stringify(where.params)],
  );

const fetchSettings = (dbPath) =>
  runPythonJson(
    `
import json, sqlite3, sys
con = sqlite3.connect(sys.argv[1])
rows = con.execute("select key, value from settings").fetchall()
print(json.dumps({key: value for key, value in rows}))
`,
    [dbPath],
  ) || {};

const updateMeeting = (dbPath, rowid, update) =>
  runPythonJson(
    `
import json, sqlite3, sys
db_path = sys.argv[1]
rowid = int(sys.argv[2])
payload = json.loads(sys.argv[3])
con = sqlite3.connect(db_path)
row = con.execute("select transcript_json, user_notes from meetings where rowid = ?", (rowid,)).fetchone()
if row is None:
  raise SystemExit(f"meeting rowid {rowid} not found")
transcript_json, user_notes = row
transcript_text = ""
try:
  parsed = json.loads(transcript_json or "[]")
  segments = parsed if isinstance(parsed, list) else parsed.get("segments", [])
  transcript_text = " ".join(
    (segment.get("text") or "").strip()
    for segment in segments
    if isinstance(segment, dict) and (segment.get("text") or "").strip()
  )
except Exception:
  transcript_text = ""
con.execute(
  """
  update meetings
  set title = ?,
      enhanced_notes = ?,
      analysis_json = ?,
      analysis_schema_version = ?,
      analysis_format_pass = ?,
      analysis_retry_count = ?,
      analysis_fallback_used = ?,
      analysis_provider = ?,
      analysis_model = ?,
      analysis_generation_path = ?,
      analysis_prompt_version = ?,
      analysis_generated_at = ?,
      analysis_error_categories_json = ?
  where rowid = ?
  """,
  (
    payload["title"],
    payload["enhanced_notes"],
    payload["analysis_json"],
    payload["analysis_schema_version"],
    1 if payload["analysis_format_pass"] else 0,
    payload["analysis_retry_count"],
    1 if payload["analysis_fallback_used"] else 0,
    payload["analysis_provider"],
    payload["analysis_model"],
    payload["analysis_generation_path"],
    payload["analysis_prompt_version"],
    payload["analysis_generated_at"],
    payload["analysis_error_categories_json"],
    rowid,
  ),
)
meeting_id = con.execute("select id from meetings where rowid = ?", (rowid,)).fetchone()[0]
con.execute("delete from meetings_fts where meeting_id = ?", (meeting_id,))
con.execute(
  """
  insert into meetings_fts
  (title, transcript_text, enhanced_notes, user_notes, mid_participants, mid_topics, mid_decisions, mid_action_items, meeting_id)
  values (?, ?, ?, ?, '', '', '', '', ?)
  """,
  (payload["title"], transcript_text, payload["enhanced_notes"], user_notes or "", meeting_id),
)
con.commit()
print(json.dumps({"updated": con.total_changes}))
`,
    [dbPath, String(rowid), JSON.stringify(update)],
  );

const updateMeetingTitle = (dbPath, rowid, title) =>
  runPythonJson(
    `
import json, sqlite3, sys
con = sqlite3.connect(sys.argv[1])
rowid = int(sys.argv[2])
title = sys.argv[3]
row = con.execute("select id from meetings where rowid = ?", (rowid,)).fetchone()
if row is None:
  raise SystemExit(f"meeting rowid {rowid} not found")
con.execute("update meetings set title = ? where rowid = ?", (title, rowid))
con.execute("update meetings_fts set title = ? where meeting_id = ?", (title, row[0]))
con.commit()
print(json.dumps({"updated": con.total_changes}))
`,
    [dbPath, String(rowid), title],
  );

const transcriptTextFromJson = (transcriptJson) => {
  const parsed = JSON.parse(transcriptJson || '[]');
  const segments = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.segments)
      ? parsed.segments
      : [];
  return segments
    .map((segment, index) => {
      const speaker = segment?.speaker ? `${segment.speaker}: ` : '';
      const text = typeof segment?.text === 'string' ? segment.text.trim() : '';
      return text ? `${index}. ${speaker}${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
};

const representativeTitleTranscript = (transcript, maxChars = 2400) => {
  const normalized = transcript.trim();
  if (normalized.length <= maxChars) return normalized;
  const excerptBudget = Math.floor(maxChars / 3);
  const middleStart = Math.max(
    0,
    Math.floor(normalized.length / 2 - excerptBudget / 2),
  );
  const closingStart = Math.max(0, normalized.length - excerptBudget);
  return [
    `Opening:\n${normalized.slice(0, excerptBudget).trim()}`,
    `Middle:\n${normalized.slice(middleStart, middleStart + excerptBudget).trim()}`,
    `Closing:\n${normalized.slice(closingStart).trim()}`,
  ].join('\n\n[...]\n\n');
};

const titlePrompt = (
  transcript,
) => `Analyze this conversation transcript and generate a concise, descriptive meeting title (max 5-7 words).

The title should:
- Capture the main topic or purpose
- Prefer sustained work topics over brief rapport, greetings, schedule chatter, travel, health, or family check-ins unless those personal topics are the main sustained subject
- If a one-on-one covers several work topics, use the dominant work topic or a neutral one-on-one title
- Be professional and clear
- Not include quotes or special characters
- Be in title case

Respond with ONLY the title, nothing else.

Transcript:
${representativeTitleTranscript(transcript)}`;

const analysisPrompt = (
  transcript,
  userNotes,
) => `You are a rigorous meeting analyst for Pluto. Produce a structured JSON document that reads like well-organized meeting notes.

Analyze this transcript${userNotes ? ' and user notes' : ''} and produce a JSON object with this exact schema:
{
  "overview": "2-3 sentence summary",
  "topics": [{"title": "Short title", "summary": "2-4 sentence digest", "key_points": [{"text": "specific insight", "speaker": "Name or null", "from_user_notes": false}], "decisions": [{"text": "what was decided", "decided_by": "Name or null", "rationale": "why or null"}], "action_items": [{"text": "task", "assignee": "Name or null", "due": "deadline or null"}], "open_questions": ["unresolved question"], "transcript_range": [0, 0]}],
  "all_action_items": [{"text": "task", "assignee": "Name or null", "due": "deadline or null", "topic": "parent topic title"}],
  "all_decisions": [{"text": "decision", "decided_by": "Name or null", "rationale": "why or null"}],
  "meeting_type": "one_on_one | team_sync | brainstorm | presentation | general"
}

Rules:
- Use only transcript${userNotes ? ' and user-note' : ''} details. Never invent facts, owners, decisions, or deadlines.
- Brief rapport and personal check-ins may be included as minor context, but Do not make them major topics or lead the overview when most of the meeting is work-focused.
- If a personal topic is sustained, produces follow-up, or is the clear purpose of the meeting, represent it normally.
- Distinguish between explicit decisions, proposals/recommendations, and unresolved questions.
- Only include an action item when the transcript shows an explicit commitment or assignment.
- Return valid JSON only. No markdown fences, no commentary.

${userNotes ? `User Notes:\n${userNotes}\n\n` : ''}Transcript:
${transcript}`;

const extractJsonObject = (text) => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start)
      throw new Error('No JSON object in LLM response');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
};

const normalizeAnalysis = (analysis, metadata) => {
  const topics = Array.isArray(analysis.topics) ? analysis.topics : [];
  const normalizedTopics = topics.map((topic) => ({
    title: String(topic?.title || 'Discussion'),
    summary: String(topic?.summary || ''),
    key_points: Array.isArray(topic?.key_points) ? topic.key_points : [],
    decisions: Array.isArray(topic?.decisions) ? topic.decisions : [],
    action_items: Array.isArray(topic?.action_items) ? topic.action_items : [],
    open_questions: Array.isArray(topic?.open_questions)
      ? topic.open_questions
      : [],
    transcript_range: Array.isArray(topic?.transcript_range)
      ? topic.transcript_range
      : [0, 0],
  }));

  return {
    analysis_schema_version: 3,
    overview: String(analysis.overview || ''),
    topics: normalizedTopics,
    all_action_items: Array.isArray(analysis.all_action_items)
      ? analysis.all_action_items
      : normalizedTopics.flatMap((topic) =>
          topic.action_items.map((item) => ({ ...item, topic: topic.title })),
        ),
    all_decisions: Array.isArray(analysis.all_decisions)
      ? analysis.all_decisions
      : normalizedTopics.flatMap((topic) => topic.decisions),
    meeting_type: analysis.meeting_type || 'general',
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
    generation_metadata: metadata,
  };
};

const analysisToMarkdown = (analysis) => {
  const lines = [analysis.overview || 'Meeting analysis regenerated.'];
  for (const topic of analysis.topics) {
    lines.push(
      '',
      '─────────────────────────────────────────────────',
      '',
      `## ${topic.title}`,
      '',
    );
    if (topic.summary) lines.push(topic.summary, '');
    for (const point of topic.key_points || []) {
      const speaker = point?.speaker ? `${point.speaker}: ` : '';
      if (point?.text) lines.push(`• ${speaker}${point.text}`);
    }
    for (const item of topic.action_items || []) {
      if (item?.text) lines.push(`• Action: ${item.text}`);
    }
    for (const decision of topic.decisions || []) {
      if (decision?.text) lines.push(`• Decision: ${decision.text}`);
    }
    for (const question of topic.open_questions || []) {
      if (question) lines.push(`• ? ${question}`);
    }
  }
  return lines.join('\n');
};

const ollamaGenerate = async (prompt, settings, jsonMode = false) => {
  const model =
    settings.ollama_model || settings.llm_model || OLLAMA_DEFAULT_MODEL;
  const response = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      ...(jsonMode ? { format: 'json' } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Ollama API error: ${response.status} ${response.statusText}`,
    );
  }
  const body = await response.json();
  return { text: body.response || '', model };
};

const main = async () => {
  const options = parseBackfillArgs(process.argv.slice(2));
  const where = buildMeetingWhereClause({
    meetingId: options.meetingId,
    title: options.title,
  });
  const dbPath = resolvePlutoDbPath({ explicitDbPath: options.dbPath });
  const rows = fetchRows(dbPath, where);

  console.log(`[Backfill] DB: ${dbPath}`);
  console.log(`[Backfill] Target: ${where.description}`);
  console.log(`[Backfill] Matches: ${rows.length}`);

  if (rows.length === 0) return;
  if (options.dryRun) {
    for (const row of rows) {
      console.log(
        `- rowid=${row.rowid} id=${row.id ?? 'NULL'} title="${row.title}"`,
      );
    }
    console.log(
      '[Backfill] Dry run only. Re-run with --write to regenerate and update matching meetings.',
    );
    return;
  }

  const settings = fetchSettings(dbPath);
  if ((settings.llm_provider || 'ollama') !== 'ollama') {
    throw new Error(
      'This backfill script currently supports the configured Ollama provider. Switch Pluto to Ollama or use --dry-run.',
    );
  }

  for (const row of rows) {
    const transcript = transcriptTextFromJson(row.transcript_json);
    if (!transcript.trim()) {
      console.log(
        `[Backfill] Skipping rowid=${row.rowid}; transcript is empty.`,
      );
      continue;
    }
    const titleResult = await ollamaGenerate(titlePrompt(transcript), settings);
    const title = titleResult.text.trim().replace(/["']/g, '') || 'Meeting';
    if (options.titleOnly) {
      updateMeetingTitle(dbPath, row.rowid, title);
      console.log(`[Backfill] Updated title for rowid=${row.rowid}.`);
      continue;
    }
    const analysisResult = await ollamaGenerate(
      analysisPrompt(transcript, row.user_notes || ''),
      settings,
      true,
    );
    const metadata = {
      provider: 'ollama',
      model: analysisResult.model,
      generation_path: 'backfill_single_pass',
      prompt_version: 'notes-v4-rapport-priority-backfill',
      generated_at: new Date().toISOString(),
      error_categories: [],
    };
    const analysis = normalizeAnalysis(
      extractJsonObject(analysisResult.text),
      metadata,
    );
    const enhancedNotes = analysisToMarkdown(analysis);
    updateMeeting(dbPath, row.rowid, {
      title,
      enhanced_notes: enhancedNotes,
      analysis_json: JSON.stringify(analysis),
      analysis_schema_version: 3,
      analysis_format_pass: true,
      analysis_retry_count: 0,
      analysis_fallback_used: false,
      analysis_provider: metadata.provider,
      analysis_model: metadata.model,
      analysis_generation_path: metadata.generation_path,
      analysis_prompt_version: metadata.prompt_version,
      analysis_generated_at: metadata.generated_at,
      analysis_error_categories_json: JSON.stringify([]),
    });
    console.log(
      `[Backfill] Updated rowid=${row.rowid}: "${row.title}" -> "${title}"`,
    );
  }
};

main().catch((error) => {
  console.error(
    `[Backfill] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});

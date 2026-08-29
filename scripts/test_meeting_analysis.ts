import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { UnifiedLLMProvider } from '../electron/llm/unifiedProvider.ts';
import { OLLAMA_GENERAL_MODEL } from '../src/utils/ollamaModels.ts';

const dbPath = path.join(
  process.env.HOME || '',
  'Library/Application Support/Pluto/pluto.db',
);

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

async function main() {
  const meetingId = 'a30c567a-beeb-45a9-a511-434b9ed5fdf8'; // PLP and RSU Discussion on Snowflake Integration (13m)
  console.log(`\n[Test Analysis] Querying meeting ID ${meetingId}...`);

  const meeting = db
    .prepare(`
    SELECT id, title, started_at, duration_seconds, transcript_json, user_notes
    FROM meetings
    WHERE id = ?
  `)
    .get(meetingId) as
    | {
        id: string;
        title: string;
        started_at: string;
        duration_seconds: number;
        transcript_json: string | null;
        user_notes: string | null;
      }
    | undefined;

  if (!meeting) {
    console.error(`Meeting ${meetingId} not found.`);
    process.exit(1);
  }

  console.log(`Meeting Title: "${meeting.title}"`);
  console.log(
    `Duration: ${meeting.duration_seconds}s (${Math.round(meeting.duration_seconds / 60)} minutes)`,
  );

  let transcriptText = '';
  try {
    const parsed = JSON.parse(meeting.transcript_json || '{}');
    let segments: Array<{ speaker?: string; text: string }> = [];
    if (Array.isArray(parsed)) {
      segments = parsed;
    } else if (parsed && Array.isArray(parsed.segments)) {
      segments = parsed.segments;
    }

    transcriptText = segments
      .map((s) => `${s.speaker || 'Unknown'}: ${s.text}`)
      .join('\n');
  } catch (e) {
    console.error(`Failed to parse transcript_json: ${e}`);
    process.exit(1);
  }

  console.log(
    `Transcript length: ${transcriptText.length} characters, ${transcriptText.split('\n').length} lines.`,
  );

  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: OLLAMA_GENERAL_MODEL,
  });

  console.log(
    `\n[Test Analysis] Running UnifiedLLMProvider analysis with ${OLLAMA_GENERAL_MODEL}...`,
  );
  const startTime = Date.now();
  const result = await provider.generateStructuredAnalysis(
    transcriptText,
    meeting.user_notes || undefined,
  );
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(
    '\n================================================================================',
  );
  console.log(`ANALYSIS COMPLETED IN ${elapsedSec}s`);
  console.log(
    '================================================================================',
  );
  console.log(`Overview:\n${result.overview}\n`);
  console.log(`Meeting Type: ${result.meeting_type}`);
  console.log(`Topics Extracted (${result.topics.length}):`);

  result.topics.forEach((topic, idx) => {
    console.log(`\n  Topic ${idx + 1}: "${topic.title}"`);
    console.log(`    Summary: ${topic.summary}`);
    console.log(`    Key Points (${topic.key_points.length}):`);
    topic.key_points.forEach((kp) =>
      console.log(`      - [${kp.speaker || 'Unknown'}] ${kp.text}`),
    );
    console.log(`    Decisions (${topic.decisions.length}):`);
    topic.decisions.forEach((d) =>
      console.log(
        `      - ${d.text} ${d.evidence ? `(Quote: "${d.evidence}")` : ''}`,
      ),
    );
    console.log(`    Action Items (${topic.action_items.length}):`);
    topic.action_items.forEach((a) =>
      console.log(
        `      - [ ] ${a.text} ${a.assignee ? `(Assignee: ${a.assignee})` : ''} ${a.due ? `(Due: ${a.due})` : ''} ${a.evidence ? `(Quote: "${a.evidence}")` : ''}`,
      ),
    );
  });

  console.log(
    '\n================================================================================',
  );
  console.log(`TOTAL ALL ACTION ITEMS (${result.all_action_items.length}):`);
  result.all_action_items.forEach((item, i) => {
    console.log(
      `  ${i + 1}. [ ] ${item.text} ${item.assignee ? `(Owner: ${item.assignee})` : ''} ${item.due ? `(Due: ${item.due})` : ''}`,
    );
    if (item.evidence) console.log(`     Evidence Quote: "${item.evidence}"`);
  });

  console.log(`\nTOTAL ALL DECISIONS (${result.all_decisions.length}):`);
  result.all_decisions.forEach((d, i) => {
    console.log(
      `  ${i + 1}. ${d.text} ${d.decided_by ? `(By: ${d.decided_by})` : ''}`,
    );
    if (d.evidence) console.log(`     Evidence Quote: "${d.evidence}"`);
  });

  console.log('\nGeneration Metadata:');
  console.log(JSON.stringify(result.generation_metadata, null, 2));
}

main().catch(console.error);

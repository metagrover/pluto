import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { UnifiedLLMProvider } from '../electron/llm/unifiedProvider.ts';
import { analysisDocumentV3ToMarkdown } from '../electron/llm/analysisDocumentV3.ts';
import { mergeAdjacentSpeakerSegments, scrubTranscriptArtifacts } from '../src/utils/transcriptSchema.ts';

const dbPath = path.join(
  process.env.HOME || '',
  'Library/Application Support/Pluto/pluto.db'
);

if (!fs.existsSync(dbPath)) {
  console.error(`[Reanalyze] Database not found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

async function main() {
  const limit = 15;
  console.log(`[Reanalyze] Opening database at ${dbPath}...`);
  console.log(`[Reanalyze] Fetching last ${limit} meetings...`);

  const meetings = db.prepare(`
    SELECT rowid, id, title, started_at, duration_seconds, transcript_json, user_notes, analysis_model
    FROM meetings
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    rowid: number;
    id: string;
    title: string;
    started_at: string;
    duration_seconds: number;
    transcript_json: string | null;
    user_notes: string | null;
    analysis_model: string | null;
  }>;

  console.log(`[Reanalyze] Found ${meetings.length} meetings to re-analyze.`);

  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'phi4-mini:3.8b',
  });

  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    console.error('[Reanalyze] Ollama is not available at http://127.0.0.1:11434. Please ensure Ollama is running.');
    process.exit(1);
  }

  const updateStmt = db.prepare(`
    UPDATE meetings
    SET enhanced_notes = ?,
        analysis_json = ?,
        analysis_schema_version = 3,
        analysis_format_pass = 1,
        analysis_retry_count = 0,
        analysis_fallback_used = 0,
        analysis_provider = 'ollama',
        analysis_model = ?,
        analysis_generation_path = 'adaptive_windowed_reanalysis',
        analysis_prompt_version = 'notes-v4',
        analysis_generated_at = ?
    WHERE rowid = ?
  `);

  const updateFtsStmt = db.prepare(`
    UPDATE meetings_fts
    SET enhanced_notes = ?
    WHERE meeting_id = ?
  `);

  for (let i = 0; i < meetings.length; i += 1) {
    const m = meetings[i];
    console.log(`\n---------------------------------------------------------`);
    console.log(`[${i + 1}/${meetings.length}] Processing meeting ${m.id}`);
    console.log(`  Title: "${m.title}"`);
    console.log(`  Started: ${m.started_at} (${m.duration_seconds}s)`);

    let rawSegments: Array<{ speaker?: string; start: number; end: number; text: string }> = [];
    try {
      const parsed = JSON.parse(m.transcript_json || '{}');
      if (Array.isArray(parsed)) {
        rawSegments = parsed;
      } else if (parsed && Array.isArray(parsed.segments)) {
        rawSegments = parsed.segments;
      }
    } catch (_e) {
      console.warn(`  [Warning] Failed to parse transcript_json for meeting ${m.id}`);
    }

    if (rawSegments.length === 0) {
      console.log(`  [Skip] Transcript has 0 segments.`);
      continue;
    }

    // Apply artifact scrubbing & paragraph merging
    const mergedSegments = mergeAdjacentSpeakerSegments(rawSegments);
    const transcriptText = mergedSegments
      .map((s, idx) => `[${s.speaker || 'Unknown'}] (${s.start?.toFixed?.(1) || 0}s): ${s.text}`)
      .join('\n');

    console.log(`  Segments: ${rawSegments.length} raw -> ${mergedSegments.length} merged`);
    console.log(`  Re-analyzing via Ollama adaptive pipeline...`);

    const startMs = Date.now();
    try {
      const analysisDoc = await provider.generateStructuredAnalysis(
        transcriptText,
        m.user_notes || undefined
      );
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

      const enhancedNotes = analysisDocumentV3ToMarkdown(analysisDoc);
      const analysisJsonStr = JSON.stringify(analysisDoc);
      const nowIso = new Date().toISOString();

      updateStmt.run(
        enhancedNotes,
        analysisJsonStr,
        'phi4-mini:3.8b',
        nowIso,
        m.rowid
      );

      try {
        updateFtsStmt.run(enhancedNotes, m.id);
      } catch (_ftsErr) {
        // FTS update optional
      }

      console.log(`  ✅ Successfully updated meeting ${m.id} in ${elapsed}s!`);
      console.log(`     Overview: ${analysisDoc.overview?.slice(0, 120)}...`);
      console.log(`     Topics: ${analysisDoc.topics?.length || 0}`);
      console.log(`     Decisions: ${analysisDoc.all_decisions?.length || 0}`);
      console.log(`     Action Items: ${analysisDoc.all_action_items?.length || 0}`);
    } catch (err) {
      console.error(`  ❌ Error re-analyzing meeting ${m.id}:`, err);
    }
  }

  console.log(`\n=========================================================`);
  console.log(`[Reanalyze] Completed retroactive re-analysis for recent meetings.`);
}

main().catch((err) => {
  console.error('[Reanalyze] Fatal error:', err);
  process.exit(1);
});

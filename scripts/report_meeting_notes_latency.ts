import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

import { parseMeetingNotesRunMetric } from '../electron/llm/meetingNotesRunMetrics.ts';
import {
  aggregateOrganicMeetingNotesLatencySamples,
  assertContentFreeMeetingNotesLatencyReport,
} from './lib/meeting_notes_latency_benchmark.ts';

const databasePath = process.env.PLUTO_DB_PATH;
if (!databasePath || !path.isAbsolute(databasePath)) {
  throw new Error('PLUTO_DB_PATH must be an absolute path');
}
const database = new Database(databasePath, {
  readonly: true,
  fileMustExist: true,
});
database.pragma('query_only = ON');

try {
  const historyColumns = database
    .prepare('PRAGMA table_info(meeting_analysis_run_history)')
    .all() as Array<{ name: string }>;
  const errorCodeSelection = historyColumns.some(
    (column) => column.name === 'error_code',
  )
    ? 'h.error_code'
    : 'NULL AS error_code';
  const rows = database
    .prepare(
      `SELECT h.meeting_id, h.status, ${errorCodeSelection}, h.metrics_json,
              COALESCE(m.duration_seconds, 0) AS duration_seconds
       FROM meeting_analysis_run_history h
       JOIN meetings m ON m.id = h.meeting_id
       WHERE h.completed_at IS NOT NULL
       ORDER BY h.completed_at DESC
       LIMIT 100`,
    )
    .all() as Array<{
    meeting_id: string;
    status: 'published' | 'failed' | 'cancelled';
    error_code: string | null;
    metrics_json: string;
    duration_seconds: number;
  }>;
  const bucketFor = (seconds: number) =>
    seconds < 20 * 60 ? '<20m' : seconds <= 40 * 60 ? '20-40m' : '>40m';
  const report = Object.fromEntries(
    ['<20m', '20-40m', '>40m'].map((bucket) => {
      const matching = rows.filter(
        (row) => bucketFor(row.duration_seconds) === bucket,
      );
      const samples = matching.map((row) => {
        const metrics = parseMeetingNotesRunMetric(row.metrics_json);
        return {
          meetingKey: row.meeting_id,
          status: row.status,
          errorCode: row.error_code ?? undefined,
          totalMs: metrics.totalMs,
          queueMs: metrics.queueMs,
          modelMs: metrics.modelMs,
          modelCallCount: metrics.stages.length,
          truncatedStageCount: metrics.stages.filter(
            (stage) => stage.outcome === 'truncated',
          ).length,
        };
      });
      const aggregate = aggregateOrganicMeetingNotesLatencySamples(samples);
      return [
        bucket,
        matching.length < 3
          ? { status: 'not_enough_evidence', ...aggregate }
          : { status: 'measured', ...aggregate },
      ];
    }),
  );
  const output = { schemaVersion: 2, buckets: report };
  assertContentFreeMeetingNotesLatencyReport(output);
  console.log(JSON.stringify(output, null, 2));
} finally {
  database.close();
}

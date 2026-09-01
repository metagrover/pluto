import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

import { parseMeetingNotesRunMetric } from '../electron/llm/meetingNotesRunMetrics.ts';
import { aggregateMeetingNotesLatencySamples } from './lib/meeting_notes_latency_benchmark.ts';

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
  const rows = database
    .prepare(
      `SELECT h.run_id, h.status, h.metrics_json, COALESCE(m.duration_seconds, 0) AS duration_seconds
       FROM meeting_analysis_run_history h
       JOIN meetings m ON m.id = h.meeting_id
       WHERE h.completed_at IS NOT NULL
       ORDER BY h.completed_at DESC
       LIMIT 100`,
    )
    .all() as Array<{
    run_id: string;
    status: 'published' | 'failed' | 'cancelled';
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
      if (matching.length < 3) {
        return [
          bucket,
          { sampleCount: matching.length, status: 'not_enough_evidence' },
        ];
      }
      const samples = matching.map((row, index) => {
        const metrics = parseMeetingNotesRunMetric(row.metrics_json);
        return {
          caseKey: `history-${index}`,
          durationBucket: '30m' as const,
          status: row.status,
          totalMs: metrics.totalMs,
          queueMs: metrics.queueMs,
          modelMs: metrics.modelMs,
          modelCallCount: metrics.stages.length,
        };
      });
      return [bucket, aggregateMeetingNotesLatencySamples(samples)];
    }),
  );
  console.log(JSON.stringify({ schemaVersion: 1, buckets: report }, null, 2));
} finally {
  database.close();
}

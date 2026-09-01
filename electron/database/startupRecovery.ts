import type Database from 'better-sqlite3';
import { recoverInterruptedIdentityJobs } from '../identityStore';

export interface StartupRecoveryResult {
  identityJobsRecovered: number;
  orphanContextRowsRemoved: number;
}

export const runDatabaseStartupRecovery = (
  sqlite: Database.Database,
): StartupRecoveryResult =>
  sqlite.transaction(() => {
    const events = sqlite
      .prepare(
        `DELETE FROM meeting_context_events
         WHERE NOT EXISTS (
           SELECT 1 FROM meetings
           WHERE meetings.id = meeting_context_events.meeting_id
         )`,
      )
      .run().changes;
    const snapshots = sqlite
      .prepare(
        `DELETE FROM meeting_context_snapshots
         WHERE NOT EXISTS (
           SELECT 1 FROM meetings
           WHERE meetings.id = meeting_context_snapshots.meeting_id
         )`,
      )
      .run().changes;
    return {
      identityJobsRecovered: recoverInterruptedIdentityJobs(sqlite),
      orphanContextRowsRemoved: events + snapshots,
    };
  })();

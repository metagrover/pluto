import type Database from 'better-sqlite3';
import { recoverInterruptedIdentityJobs } from '../identityStore';
import { syncAllMeetingActionEntitiesFromUserEdits } from './meetingActionSync';
import {
  repairMeetingContextSectionIndex,
  repairMeetingFtsIndex,
  repairMeetingNotesFtsIndex,
} from './meetingSearchMaintenance';

export interface StartupRecoveryResult {
  identityJobsRecovered: number;
  orphanContextRowsRemoved: number;
  genericSpeakerEntitiesPurged: number;
  meetingActionsSynced: number;
  meetingFtsRebuilt: boolean;
  meetingNotesFtsRebuilt: boolean;
  meetingContextSectionsRebuilt: boolean;
}

export const runDatabaseStartupRecovery = (
  sqlite: Database.Database,
): StartupRecoveryResult => {
  const relational = sqlite.transaction(() => {
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
    const liveCheckpoints = sqlite
      .prepare(
        `DELETE FROM live_meeting_context_checkpoints
         WHERE NOT EXISTS (
           SELECT 1 FROM meetings
           WHERE meetings.id = live_meeting_context_checkpoints.meeting_id
         )
           AND datetime(updated_at) < datetime('now', '-7 days')`,
      )
      .run().changes;

    const genericCandidates = sqlite
      .prepare(
        `SELECT id FROM entities
         WHERE type = 'person'
           AND (
             name LIKE 'Remote Speaker%'
             OR name LIKE 'Speaker %'
             OR LOWER(name) IN ('remote speaker', 'local speaker', 'me', 'them', 'you', 'unknown', 'unknown speaker')
           )`,
      )
      .all() as { id: string }[];

    for (const candidate of genericCandidates) {
      sqlite.prepare('DELETE FROM entities WHERE id = ?').run(candidate.id);
      try {
        sqlite
          .prepare('DELETE FROM entities_fts WHERE entity_id = ?')
          .run(candidate.id);
      } catch {}
      try {
        sqlite
          .prepare(
            'DELETE FROM entity_links WHERE source_entity_id = ? OR target_entity_id = ?',
          )
          .run(candidate.id, candidate.id);
      } catch {}
      try {
        sqlite
          .prepare('DELETE FROM meeting_entities WHERE entity_id = ?')
          .run(candidate.id);
      } catch {}
    }

    return {
      identityJobsRecovered: recoverInterruptedIdentityJobs(sqlite),
      orphanContextRowsRemoved: events + snapshots + liveCheckpoints,
      genericSpeakerEntitiesPurged: genericCandidates.length,
    };
  })();
  const meetingActions = syncAllMeetingActionEntitiesFromUserEdits(sqlite);
  const meetingFts = repairMeetingFtsIndex(sqlite);
  const meetingNotesFts = repairMeetingNotesFtsIndex(sqlite);
  const meetingContextSections = repairMeetingContextSectionIndex(sqlite);
  return {
    ...relational,
    meetingActionsSynced: meetingActions.totalActionsUpdated,
    meetingFtsRebuilt: meetingFts.rebuilt,
    meetingNotesFtsRebuilt: meetingNotesFts.rebuilt,
    meetingContextSectionsRebuilt: meetingContextSections.rebuilt,
  };
};

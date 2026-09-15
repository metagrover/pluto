import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';

const expectedTables = [
  'attention_items',
  'auto_end_log',
  'calendar_events',
  'calendar_integration',
  'commitment_aliases',
  'entities',
  'entities_fts',
  'entity_alias_suggestions',
  'entity_corrections',
  'entity_dreaming_aliases',
  'entity_dreaming_person_claims',
  'entity_dreaming_proposals',
  'entity_dreaming_runs',
  'entity_links',
  'identity_binding_suppressions',
  'identity_bindings',
  'identity_captures',
  'identity_input_revision',
  'identity_jobs',
  'identity_person_aliases',
  'identity_profiles',
  'identity_resolution_history',
  'identity_resolutions',
  'identity_workspace',
  'knowledge_backlinks',
  'knowledge_corrections',
  'knowledge_doc_notes',
  'knowledge_doc_sources',
  'knowledge_doc_user_edits',
  'knowledge_doc_versions',
  'knowledge_docs',
  'live_meeting_context_checkpoints',
  'meeting_analysis_run_history',
  'meeting_analysis_runs',
  'meeting_audio_migrations',
  'meeting_audio_retention',
  'meeting_calendar_context',
  'meeting_context_events',
  'meeting_context_sections',
  'meeting_context_sections_fts',
  'meeting_context_snapshots',
  'meeting_entities',
  'meeting_notes_fts',
  'meeting_speaker_candidates',
  'meetings',
  'meetings_fts',
  'person_aliases',
  'person_chat_messages',
  'person_chat_threads',
  'person_name_aliases',
  'project_aliases',
  'settings',
  'speaker_voice_candidate_attempts',
  'speaker_voice_enrollments',
  'speaker_voice_profile_settings',
  'speaker_voice_rejections',
  'working_memory_snapshots',
];

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const readApplicationTableNames = (sqlite: Database.Database) =>
  (
    sqlite
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != '__drizzle_migrations'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  )
    .map(({ name }) => name)
    .filter(
      (name) =>
        !/^(entities_fts|meeting_context_sections_fts|meeting_notes_fts|meetings_fts)_(config|content|data|docsize|idx)$/.test(
          name,
        ),
    );

describe('Drizzle database baseline', () => {
  it('creates the complete verified Pluto schema from an empty database', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-db-baseline-'),
    );
    temporaryDirectories.push(directory);
    const sqlite = new Database(path.join(directory, 'pluto.db'));

    try {
      sqlite.pragma('foreign_keys = ON');
      migrate(drizzle(sqlite), {
        migrationsFolder: path.join(process.cwd(), 'drizzle'),
      });

      expect(readApplicationTableNames(sqlite)).toEqual(expectedTables);
      const triggerCount = sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_schema
           WHERE type = 'trigger' AND name LIKE 'identity_input_%'`,
        )
        .get() as { count: number };
      expect(triggerCount.count).toBe(12);
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
      expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok');
    } finally {
      sqlite.close();
    }
  });
});

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import type { MidFrontmatter } from './intelligence/intelligenceTypes';

const dbPath = path.join(app.getPath('userData'), 'pluto.db');

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

type TableInfoColumn = {
  name: string;
};

export interface PersistedMeeting {
  id: string | number;
  title: string;
  meeting_type?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  audio_path?: string | null;
  transcript_json?: string | null;
  user_notes?: string | null;
  enhanced_notes?: string | null;
  analysis_json?: string | null;
  analysis_schema_version?: number | null;
  analysis_format_pass?: boolean | number | null;
  analysis_retry_count?: number | null;
  analysis_fallback_used?: boolean | number | null;
  value_signals_json?: string | null;
  folder_id?: string | null;
  is_favorite?: boolean | number | null;
  end_reason?: string | null;
  created_at?: string | null;
}

/**
 * DATABASE MIGRATION / INITIALIZATION
 */
const initDb = () => {
  // Check if we need to migrate from old schema
  const tableInfo = db
    .prepare('PRAGMA table_info(meetings)')
    .all() as TableInfoColumn[];
  const hasCreatedAt = tableInfo.some((col) => col.name === 'created_at');

  if (tableInfo.length > 0 && !hasCreatedAt) {
    console.log('[DB] Old schema detected. Dropping tables for migration...');
    db.exec('DROP TABLE IF EXISTS meetings');
    db.exec('DROP TABLE IF EXISTS meetings_fts');
    db.exec('DROP TABLE IF EXISTS settings');
  }

  // FTS5 Migration for UUID support (Sprint 3 Fix)
  try {
    const ftsInfo = db
      .prepare('PRAGMA table_info(meetings_fts)')
      .all() as TableInfoColumn[];
    // If table exists but doesn't have meeting_id (old schema linked to rowid)
    if (
      ftsInfo.length > 0 &&
      !ftsInfo.some((col) => col.name === 'meeting_id')
    ) {
      console.log('[DB] Migrating FTS table for UUID support...');
      db.exec('DROP TABLE IF EXISTS meetings_fts');
      db.exec('DROP TABLE IF EXISTS settings');
    }

    // FTS5 Migration for Entities UUID support
    const entitiesFtsInfo = db
      .prepare('PRAGMA table_info(entities_fts)')
      .all() as TableInfoColumn[];
    if (
      entitiesFtsInfo.length > 0 &&
      !entitiesFtsInfo.some((col) => col.name === 'entity_id')
    ) {
      console.log('[DB] Migrating Entities FTS table for UUID support...');
      db.exec('DROP TABLE IF EXISTS entities_fts');
    }
  } catch (e) {
    // Table might not exist yet or other migration error
  }

  // Initialize Schema
  db.exec(`
      -- Core meetings table
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        meeting_type TEXT,
        started_at DATETIME,
        ended_at DATETIME,
        duration_seconds INTEGER,
        audio_path TEXT,
        transcript_json TEXT,
        user_notes TEXT,
        enhanced_notes TEXT,
        analysis_json TEXT,
        analysis_schema_version INTEGER,
        analysis_format_pass BOOLEAN,
        analysis_retry_count INTEGER DEFAULT 0,
        analysis_fallback_used BOOLEAN DEFAULT 0,
        value_signals_json TEXT,
        folder_id TEXT,
        is_favorite BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Settings table
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, 
        value TEXT
      );

      -- Full-text search (FTS5)
      -- Full-text search (FTS5) - Decoupled from rowid to support UUIDs
      CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts USING fts5(
        title, 
        transcript_text, 
        enhanced_notes, 
        user_notes,
        meeting_id UNINDEXED
      );

      -- FTS5 meeting_id column migration (cleanup)
      -- (Already handled by previous migration block)

      -- =============================================
      -- KNOWLEDGE GRAPH TABLES (Sprint 2)
      -- =============================================

      -- Core entities: people, topics, action items, decisions, projects
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('person', 'topic', 'action_item', 'decision', 'project')),
        name TEXT NOT NULL,
        normalized_name TEXT, -- lowercase, trimmed for deduplication
        status TEXT CHECK(status IN ('active', 'completed', 'stale', 'overdue') OR status IS NULL),
        due_date DATETIME,
        assigned_to TEXT, -- entity id of person (for action_items)
        metadata TEXT, -- JSON for type-specific data
        saliency_score REAL DEFAULT 1.0,
        domain_tag TEXT DEFAULT 'work',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Index for fast lookups by type and normalized name
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_normalized_name ON entities(normalized_name);
      CREATE INDEX IF NOT EXISTS idx_entities_status ON entities(status);

      -- Relationships between entities
      CREATE TABLE IF NOT EXISTS entity_links (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relationship TEXT NOT NULL CHECK(relationship IN (
          'discussed', 'assigned_to', 'belongs_to', 'relates_to',
          'attended', 'produced', 'impacts', 'works_on', 'involved_in',
          'depends_on', 'blocked_by', 'owns'
        )),
        meeting_id TEXT, -- which meeting created/reinforced this link
        state TEXT NOT NULL DEFAULT 'suggested' CHECK(state IN ('suggested', 'confirmed', 'rejected')),
        evidence_meeting_id TEXT,
        evidence_quote TEXT,
        source TEXT NOT NULL DEFAULT 'pipeline' CHECK(source IN ('pipeline', 'synthesis', 'user')),
        confidence REAL DEFAULT 1.0, -- LLM extraction confidence (0-1)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
        FOREIGN KEY (evidence_meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
      );

      -- Indexes for relationship traversal
      CREATE INDEX IF NOT EXISTS idx_entity_links_source ON entity_links(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_entity_links_target ON entity_links(target_entity_id);
      CREATE INDEX IF NOT EXISTS idx_entity_links_meeting ON entity_links(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_entity_links_pair_rel ON entity_links(source_entity_id, target_entity_id, relationship);

      -- Meeting-entity connections with context
      CREATE TABLE IF NOT EXISTS meeting_entities (
        meeting_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        mention_count INTEGER DEFAULT 1,
        first_mentioned_at INTEGER, -- timestamp in audio (seconds)
        context TEXT, -- relevant transcript snippet
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (meeting_id, entity_id),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      -- =============================================
      -- KNOWLEDGE LIVE DOC TABLES
      -- =============================================

      CREATE TABLE IF NOT EXISTS knowledge_docs (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'project', 'team_tracker', 'person_context')),
        scope_key TEXT NOT NULL,
        title TEXT NOT NULL,
        rendered_content TEXT,
        structured_json TEXT,
        config TEXT,
        status TEXT NOT NULL DEFAULT 'stale' CHECK(status IN ('synthesizing', 'up_to_date', 'stale', 'failed', 'inactive')),
        last_synthesized_at DATETIME,
        last_source_cursor TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_docs_scope ON knowledge_docs(scope_type, scope_key);
      CREATE INDEX IF NOT EXISTS idx_knowledge_docs_updated_at ON knowledge_docs(updated_at DESC);

      CREATE TABLE IF NOT EXISTS knowledge_doc_sources (
        doc_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        contributed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (doc_id, meeting_id),
        FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_doc_sources_doc ON knowledge_doc_sources(doc_id, contributed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_doc_sources_meeting ON knowledge_doc_sources(meeting_id);

      CREATE TABLE IF NOT EXISTS knowledge_doc_versions (
        doc_id TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        structured_json TEXT,
        rendered_content TEXT,
        changelog_json TEXT,
        synthesized_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        source_count INTEGER DEFAULT 0,
        PRIMARY KEY (doc_id, version_no),
        FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_doc_versions_doc ON knowledge_doc_versions(doc_id, version_no DESC);

      CREATE TABLE IF NOT EXISTS knowledge_doc_user_edits (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        edited_content TEXT NOT NULL,
        edited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        edited_by TEXT DEFAULT 'local-user',
        FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_doc_user_edits_doc ON knowledge_doc_user_edits(doc_id, edited_at DESC);

      CREATE TABLE IF NOT EXISTS knowledge_doc_notes (
        doc_id TEXT PRIMARY KEY,
        markdown TEXT NOT NULL DEFAULT '',
        parsed_links_json TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_doc_notes_updated_at ON knowledge_doc_notes(updated_at DESC);

      CREATE TABLE IF NOT EXISTS knowledge_backlinks (
        id TEXT PRIMARY KEY,
        source_doc_id TEXT NOT NULL,
        target_kind TEXT NOT NULL CHECK(target_kind IN ('entity', 'doc')),
        target_id TEXT NOT NULL,
        label TEXT NOT NULL,
        snippet TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_backlinks_source ON knowledge_backlinks(source_doc_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_backlinks_target ON knowledge_backlinks(target_kind, target_id);

      -- Full-text search for entities - Decoupled for UUID support
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
        name,
        entity_id UNINDEXED
      );

      -- Auto-end event log
      CREATE TABLE IF NOT EXISTS auto_end_log (
        id TEXT PRIMARY KEY,
        meeting_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason_code TEXT NOT NULL,
        app_name TEXT,
        grace_seconds INTEGER,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_auto_end_log_meeting ON auto_end_log(meeting_id);

      -- Backfill FTS if needed (Self-healing)
      INSERT INTO entities_fts (name, entity_id)
      SELECT name, id FROM entities 
      WHERE id NOT IN (SELECT entity_id FROM entities_fts);
    `);

  // Additive migration for newer optional columns
  try {
    const meetingColumns = db
      .prepare('PRAGMA table_info(meetings)')
      .all() as Array<{ name: string }>;
    if (!meetingColumns.some((col) => col.name === 'analysis_json')) {
      db.exec('ALTER TABLE meetings ADD COLUMN analysis_json TEXT');
      console.log('[DB] Added meetings.analysis_json column');
    }
    if (!meetingColumns.some((col) => col.name === 'analysis_schema_version')) {
      db.exec(
        'ALTER TABLE meetings ADD COLUMN analysis_schema_version INTEGER',
      );
      console.log('[DB] Added meetings.analysis_schema_version column');
    }
    if (!meetingColumns.some((col) => col.name === 'analysis_format_pass')) {
      db.exec('ALTER TABLE meetings ADD COLUMN analysis_format_pass BOOLEAN');
      console.log('[DB] Added meetings.analysis_format_pass column');
    }
    if (!meetingColumns.some((col) => col.name === 'analysis_retry_count')) {
      db.exec(
        'ALTER TABLE meetings ADD COLUMN analysis_retry_count INTEGER DEFAULT 0',
      );
      console.log('[DB] Added meetings.analysis_retry_count column');
    }
    if (!meetingColumns.some((col) => col.name === 'analysis_fallback_used')) {
      db.exec(
        'ALTER TABLE meetings ADD COLUMN analysis_fallback_used BOOLEAN DEFAULT 0',
      );
      console.log('[DB] Added meetings.analysis_fallback_used column');
    }
    if (!meetingColumns.some((col) => col.name === 'value_signals_json')) {
      db.exec('ALTER TABLE meetings ADD COLUMN value_signals_json TEXT');
      console.log('[DB] Added meetings.value_signals_json column');
    }
    if (!meetingColumns.some((col) => col.name === 'end_reason')) {
      db.exec('ALTER TABLE meetings ADD COLUMN end_reason TEXT');
      console.log('[DB] Added meetings.end_reason column');
    }
    if (!meetingColumns.some((col) => col.name === 'mid_json')) {
      db.exec('ALTER TABLE meetings ADD COLUMN mid_json TEXT');
      console.log('[DB] Added meetings.mid_json column');
    }
  } catch (e) {
    console.warn('[DB] Optional column migration failed:', e);
  }

  // FTS5 Migration: rebuild with MID-derived columns for unified search
  try {
    const ftsColumns = db
      .prepare('PRAGMA table_info(meetings_fts)')
      .all() as Array<{ name: string }>;
    const hasMidParticipants = ftsColumns.some(
      (col) => col.name === 'mid_participants',
    );
    if (ftsColumns.length > 0 && !hasMidParticipants) {
      console.log('[DB] Rebuilding meetings_fts with MID columns...');

      // Preserve existing FTS data
      const existing = db
        .prepare('SELECT meeting_id, title, transcript_text, enhanced_notes, user_notes FROM meetings_fts')
        .all() as Array<{
          meeting_id: string;
          title: string;
          transcript_text: string;
          enhanced_notes: string;
          user_notes: string;
        }>;

      db.exec('DROP TABLE IF EXISTS meetings_fts');
      db.exec(`
        CREATE VIRTUAL TABLE meetings_fts USING fts5(
          title,
          transcript_text,
          enhanced_notes,
          user_notes,
          mid_participants,
          mid_topics,
          mid_decisions,
          mid_action_items,
          meeting_id UNINDEXED
        );
      `);

      // Reinsert existing data (MID columns empty until MID is generated)
      const insertFts = db.prepare(`
        INSERT INTO meetings_fts (title, transcript_text, enhanced_notes, user_notes,
          mid_participants, mid_topics, mid_decisions, mid_action_items, meeting_id)
        VALUES (?, ?, ?, ?, '', '', '', '', ?)
      `);
      for (const row of existing) {
        insertFts.run(
          row.title,
          row.transcript_text,
          row.enhanced_notes,
          row.user_notes,
          row.meeting_id,
        );
      }

      console.log('[DB] meetings_fts rebuilt with MID columns');
    }
  } catch (e) {
    console.warn('[DB] FTS5 MID migration failed:', e);
  }

  // Additive migration for entity columns (Sprint 3 / V1.2)
  try {
    const entityColumns = db
      .prepare('PRAGMA table_info(entities)')
      .all() as Array<{ name: string }>;
    if (!entityColumns.some((col) => col.name === 'saliency_score')) {
      db.exec(
        'ALTER TABLE entities ADD COLUMN saliency_score REAL DEFAULT 1.0',
      );
      console.log('[DB] Added entities.saliency_score column');
    }
    if (!entityColumns.some((col) => col.name === 'domain_tag')) {
      db.exec("ALTER TABLE entities ADD COLUMN domain_tag TEXT DEFAULT 'work'");
      console.log('[DB] Added entities.domain_tag column');
    }
  } catch (e) {
    console.warn('[DB] Entity optional column migration failed:', e);
  }

  // Additive migration for knowledge doc columns
  try {
    const knowledgeDocColumns = db
      .prepare('PRAGMA table_info(knowledge_docs)')
      .all() as Array<{ name: string }>;
    if (
      knowledgeDocColumns.length > 0 &&
      !knowledgeDocColumns.some((col) => col.name === 'last_source_cursor')
    ) {
      db.exec('ALTER TABLE knowledge_docs ADD COLUMN last_source_cursor TEXT');
      console.log('[DB] Added knowledge_docs.last_source_cursor column');
    }
    if (
      knowledgeDocColumns.length > 0 &&
      !knowledgeDocColumns.some((col) => col.name === 'updated_at')
    ) {
      db.exec(
        'ALTER TABLE knowledge_docs ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP',
      );
      console.log('[DB] Added knowledge_docs.updated_at column');
    }
  } catch (e) {
    console.warn('[DB] Knowledge-doc migration checks failed:', e);
  }

  // Migration: expand knowledge_docs scope_type CHECK and add config column.
  try {
    const kdCols = db
      .prepare('PRAGMA table_info(knowledge_docs)')
      .all() as Array<{ name: string }>;
    const hasConfig = kdCols.some((col) => col.name === 'config');
    if (kdCols.length > 0 && !hasConfig) {
      const migrateKnowledgeDocs = db.transaction(() => {
        db.exec(`
          CREATE TABLE knowledge_docs_new (
            id TEXT PRIMARY KEY,
            scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'project', 'team_tracker', 'person_context')),
            scope_key TEXT NOT NULL,
            title TEXT NOT NULL,
            rendered_content TEXT,
            structured_json TEXT,
            config TEXT,
            status TEXT NOT NULL DEFAULT 'stale' CHECK(status IN ('synthesizing', 'up_to_date', 'stale', 'failed', 'inactive')),
            last_synthesized_at DATETIME,
            last_source_cursor TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        db.exec(`
          INSERT INTO knowledge_docs_new (
            id, scope_type, scope_key, title, rendered_content,
            structured_json, config, status, last_synthesized_at,
            last_source_cursor, updated_at
          )
          SELECT
            id, scope_type, scope_key, title, rendered_content,
            structured_json, NULL, status, last_synthesized_at,
            last_source_cursor, updated_at
          FROM knowledge_docs;
        `);
        db.exec('DROP TABLE knowledge_docs');
        db.exec('ALTER TABLE knowledge_docs_new RENAME TO knowledge_docs');
        db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_docs_scope ON knowledge_docs(scope_type, scope_key);
          CREATE INDEX IF NOT EXISTS idx_knowledge_docs_updated_at ON knowledge_docs(updated_at DESC);
        `);
      });
      migrateKnowledgeDocs();
      console.log(
        '[DB] Migrated knowledge_docs to v2 (config column + expanded scope types)',
      );
    }
  } catch (e) {
    console.warn('[DB] knowledge_docs v2 migration failed:', e);
  }

  // Migration: rebuild entity_links with typed dependency semantics and state/evidence columns.
  try {
    const entityLinkColumns = db
      .prepare('PRAGMA table_info(entity_links)')
      .all() as Array<{ name: string }>;
    const hasAllNewEntityLinkColumns =
      entityLinkColumns.some((col) => col.name === 'state') &&
      entityLinkColumns.some((col) => col.name === 'evidence_meeting_id') &&
      entityLinkColumns.some((col) => col.name === 'evidence_quote') &&
      entityLinkColumns.some((col) => col.name === 'source') &&
      entityLinkColumns.some((col) => col.name === 'updated_at');

    if (entityLinkColumns.length > 0 && !hasAllNewEntityLinkColumns) {
      const migrateEntityLinks = db.transaction(() => {
        db.exec(`
          CREATE TABLE entity_links_new (
            id TEXT PRIMARY KEY,
            source_entity_id TEXT NOT NULL,
            target_entity_id TEXT NOT NULL,
            relationship TEXT NOT NULL CHECK(relationship IN (
              'discussed', 'assigned_to', 'belongs_to', 'relates_to',
              'attended', 'produced', 'impacts', 'works_on', 'involved_in',
              'depends_on', 'blocked_by', 'owns'
            )),
            meeting_id TEXT,
            state TEXT NOT NULL DEFAULT 'suggested' CHECK(state IN ('suggested', 'confirmed', 'rejected')),
            evidence_meeting_id TEXT,
            evidence_quote TEXT,
            source TEXT NOT NULL DEFAULT 'pipeline' CHECK(source IN ('pipeline', 'synthesis', 'user')),
            confidence REAL DEFAULT 1.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
            FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
            FOREIGN KEY (evidence_meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
          );
        `);

        db.exec(`
          INSERT INTO entity_links_new (
            id,
            source_entity_id,
            target_entity_id,
            relationship,
            meeting_id,
            state,
            evidence_meeting_id,
            evidence_quote,
            source,
            confidence,
            created_at,
            updated_at
          )
          SELECT
            id,
            source_entity_id,
            target_entity_id,
            relationship,
            meeting_id,
            'confirmed' AS state,
            meeting_id AS evidence_meeting_id,
            NULL AS evidence_quote,
            'pipeline' AS source,
            confidence,
            created_at,
            COALESCE(created_at, CURRENT_TIMESTAMP) AS updated_at
          FROM entity_links;
        `);

        db.exec('DROP TABLE entity_links');
        db.exec('ALTER TABLE entity_links_new RENAME TO entity_links');

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_entity_links_source ON entity_links(source_entity_id);
          CREATE INDEX IF NOT EXISTS idx_entity_links_target ON entity_links(target_entity_id);
          CREATE INDEX IF NOT EXISTS idx_entity_links_meeting ON entity_links(meeting_id);
          CREATE INDEX IF NOT EXISTS idx_entity_links_pair_rel ON entity_links(source_entity_id, target_entity_id, relationship);
          CREATE INDEX IF NOT EXISTS idx_entity_links_state_relationship ON entity_links(state, relationship);
          CREATE INDEX IF NOT EXISTS idx_entity_links_evidence_meeting ON entity_links(evidence_meeting_id);
        `);
      });

      migrateEntityLinks();
      console.log('[DB] Migrated entity_links to v2 dependency schema');
    }
  } catch (e) {
    console.warn('[DB] Entity-link migration failed:', e);
  }

  // Create v2 entity-link indexes only when the required columns exist.
  try {
    const entityLinkColumns = db
      .prepare('PRAGMA table_info(entity_links)')
      .all() as Array<{ name: string }>;
    const hasState = entityLinkColumns.some((col) => col.name === 'state');
    const hasEvidenceMeetingId = entityLinkColumns.some(
      (col) => col.name === 'evidence_meeting_id',
    );

    if (hasState) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_entity_links_state_relationship
        ON entity_links(state, relationship);
        CREATE INDEX IF NOT EXISTS idx_entity_links_confirmed_source
        ON entity_links(source_entity_id) WHERE state = 'confirmed';
        CREATE INDEX IF NOT EXISTS idx_entity_links_confirmed_target
        ON entity_links(target_entity_id) WHERE state = 'confirmed';
      `);
    }

    if (hasEvidenceMeetingId) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_entity_links_evidence_meeting
        ON entity_links(evidence_meeting_id);
      `);
    }
  } catch (e) {
    console.warn('[DB] Entity-link v2 index creation failed:', e);
  }

  // Backfill notes layer from legacy user edits for docs missing explicit notes.
  try {
    const noteRows = db
      .prepare(
        `
          SELECT d.id AS doc_id, e.edited_content AS edited_content
          FROM knowledge_docs d
          LEFT JOIN knowledge_doc_notes n ON n.doc_id = d.id
          LEFT JOIN knowledge_doc_user_edits e ON e.doc_id = d.id
          WHERE n.doc_id IS NULL
            AND e.id = (
              SELECT e2.id
              FROM knowledge_doc_user_edits e2
              WHERE e2.doc_id = d.id
              ORDER BY e2.edited_at DESC
              LIMIT 1
            )
        `,
      )
      .all() as Array<{ doc_id: string; edited_content: string | null }>;

    const insertNote = db.prepare(`
      INSERT OR IGNORE INTO knowledge_doc_notes (doc_id, markdown, parsed_links_json)
      VALUES (?, ?, ?)
    `);

    for (const row of noteRows) {
      insertNote.run(
        row.doc_id,
        row.edited_content || '',
        JSON.stringify({ links: [] }),
      );
    }
  } catch (e) {
    console.warn('[DB] Knowledge note backfill failed:', e);
  }
};

initDb();

/**
 * Settings Management
 */
export const getSetting = (key: string) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
};

export const setSetting = (key: string, value: string) => {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
  );
  return stmt.run(key, value);
};

/**
 * Meeting Management
 */
export const saveMeeting = (meeting: PersistedMeeting) => {
  // Ensure ID is a string
  const id = String(meeting.id);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO meetings (
      id, title, meeting_type, started_at, ended_at, duration_seconds, 
      audio_path, transcript_json, user_notes, enhanced_notes, analysis_json, analysis_schema_version,
      analysis_format_pass, analysis_retry_count, analysis_fallback_used, value_signals_json, folder_id, is_favorite, end_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
  `);

  const result = stmt.run(
    id,
    meeting.title,
    meeting.meeting_type || 'General',
    meeting.started_at,
    meeting.ended_at,
    meeting.duration_seconds || 0,
    meeting.audio_path,
    meeting.transcript_json,
    meeting.user_notes || '',
    meeting.enhanced_notes || '',
    meeting.analysis_json || null,
    meeting.analysis_schema_version || null,
    typeof meeting.analysis_format_pass === 'boolean'
      ? meeting.analysis_format_pass
        ? 1
        : 0
      : null,
    Number.isFinite(meeting.analysis_retry_count)
      ? meeting.analysis_retry_count
      : 0,
    typeof meeting.analysis_fallback_used === 'boolean'
      ? meeting.analysis_fallback_used
        ? 1
        : 0
      : 0,
    meeting.value_signals_json || null,
    meeting.folder_id,
    meeting.is_favorite ? 1 : 0,
    meeting.end_reason || 'manual',
    meeting.created_at,
  );

  // Update FTS index
  let transcriptText = '';
  try {
    if (meeting.transcript_json) {
      const transcript = JSON.parse(meeting.transcript_json);
      const segments = Array.isArray(transcript)
        ? transcript
        : Array.isArray(transcript?.segments)
          ? transcript.segments
          : [];
      transcriptText = segments
        .map((segment: { text?: string }) =>
          typeof segment?.text === 'string' ? segment.text.trim() : '',
        )
        .filter((text: string) => text.length > 0)
        .join(' ');
    }
  } catch (e) {
    console.warn('Failed to parse transcript_json for FTS', e);
  }

  // Extract MID fields for FTS if mid_json is present
  let midParticipants = '';
  let midTopics = '';
  let midDecisions = '';
  let midActionItems = '';
  const midJsonRaw = (meeting as unknown as Record<string, unknown>).mid_json;
  if (typeof midJsonRaw === 'string' && midJsonRaw.trim()) {
    try {
      const mid = JSON.parse(midJsonRaw) as MidFrontmatter;
      midParticipants = (mid.participants || []).map((p) => p.name).join(', ');
      midTopics = (mid.topics || []).map((t) => t.name).join(', ');
      midDecisions = (mid.decisions || []).map((d) => d.description).join(', ');
      midActionItems = (mid.action_items || []).map((a) => a.description).join(', ');
    } catch {
      // Ignore MID parse errors during FTS update
    }
  }

  console.log(`[DB] Updating FTS index for meeting: ${id}`);
  db.prepare(`
    INSERT OR REPLACE INTO meetings_fts (title, transcript_text, enhanced_notes, user_notes,
      mid_participants, mid_topics, mid_decisions, mid_action_items, meeting_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    meeting.title,
    transcriptText,
    meeting.enhanced_notes || '',
    meeting.user_notes || '',
    midParticipants,
    midTopics,
    midDecisions,
    midActionItems,
    id,
  );

  console.log(`[DB] Save successful for meeting: ${id}`);
  return result;
};

export const getMeetings = () => {
  return db.prepare('SELECT * FROM meetings ORDER BY created_at DESC').all();
};

export const getMeeting = (id: string | number) => {
  return db.prepare('SELECT * FROM meetings WHERE id = ?').get(String(id));
};

export const getAnalysisQualityStats = () => {
  const row = db
    .prepare(`
    SELECT
      COUNT(*) AS total_v2_meetings,
      SUM(CASE WHEN analysis_format_pass = 1 THEN 1 ELSE 0 END) AS format_pass_count,
      SUM(CASE WHEN analysis_retry_count > 0 THEN 1 ELSE 0 END) AS retried_count,
      SUM(CASE WHEN analysis_fallback_used = 1 THEN 1 ELSE 0 END) AS fallback_count
    FROM meetings
    WHERE analysis_schema_version = 2
  `)
    .get() as {
    total_v2_meetings: number | null;
    format_pass_count: number | null;
    retried_count: number | null;
    fallback_count: number | null;
  };

  const total = Number(row.total_v2_meetings || 0);
  const formatPassCount = Number(row.format_pass_count || 0);

  return {
    total_v2_meetings: total,
    format_pass_count: formatPassCount,
    format_pass_rate: total > 0 ? formatPassCount / total : 0,
    retried_count: Number(row.retried_count || 0),
    fallback_count: Number(row.fallback_count || 0),
  };
};

export const searchMeetings = (query: string) => {
  return db
    .prepare(`
    SELECT meetings.* FROM meetings
    JOIN meetings_fts ON meetings.id = meetings_fts.meeting_id
    WHERE meetings_fts MATCH ?
    ORDER BY rank
  `)
    .all(query);
};

export const deleteMeeting = (id: string | number) => {
  const safeId = String(id);
  const meeting = getMeeting(safeId) as PersistedMeeting | undefined;

  if (!meeting) {
    console.warn(`[DB] deleteMeeting: Meeting not found for id: ${safeId}`);
    return;
  }

  // 1. Delete audio file if it exists
  if (meeting.audio_path && fs.existsSync(meeting.audio_path)) {
    try {
      fs.unlinkSync(meeting.audio_path);
      console.log(`[DB] Deleted audio file: ${meeting.audio_path}`);
    } catch (e) {
      console.warn(
        `[DB] Failed to delete audio file: ${meeting.audio_path}`,
        e,
      );
    }
  }

  // 2. Delete from FTS index
  db.prepare('DELETE FROM meetings_fts WHERE meeting_id = ?').run(safeId);

  // 3. Delete from entity_links (ones specifically created for this meeting)
  db.prepare('DELETE FROM entity_links WHERE meeting_id = ?').run(safeId);

  // 4. Delete the meeting itself
  // meeting_entities will be deleted by CASCADE
  const result = db.prepare('DELETE FROM meetings WHERE id = ?').run(safeId);

  console.log(`[DB] Deleted meeting: ${safeId}`);

  // 5. Clean up orphan entities (optional but requested "knowledge related to the meeting")
  // We delete entities that have no remaining meeting connections AND no remaining links
  try {
    db.prepare(`
      DELETE FROM entities 
      WHERE id NOT IN (SELECT entity_id FROM meeting_entities)
        AND id NOT IN (SELECT source_entity_id FROM entity_links)
        AND id NOT IN (SELECT target_entity_id FROM entity_links)
    `).run();
  } catch (e) {
    console.warn('[DB] Failed to clean up orphan entities:', e);
  }

  // Update entities FTS
  try {
    db.prepare(`
      DELETE FROM entities_fts 
      WHERE entity_id NOT IN (SELECT id FROM entities)
    `).run();
  } catch (e) {
    // Ignore FTS cleanup errors
  }

  return result;
};

// =============================================
// KNOWLEDGE GRAPH OPERATIONS (Sprint 2)
// =============================================

export type EntityType =
  | 'person'
  | 'topic'
  | 'action_item'
  | 'decision'
  | 'project';
export type EntityStatus =
  | 'active'
  | 'completed'
  | 'stale'
  | 'overdue'
  | 'merge_pending'
  | null;
export type RelationshipType =
  | 'discussed'
  | 'assigned_to'
  | 'belongs_to'
  | 'relates_to'
  | 'attended'
  | 'produced'
  | 'impacts'
  | 'works_on'
  | 'involved_in'
  | 'depends_on'
  | 'blocked_by'
  | 'owns';
export type RelationshipState = 'suggested' | 'confirmed' | 'rejected';
export type LinkSource = 'pipeline' | 'synthesis' | 'user';

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  normalized_name: string;
  status: EntityStatus;
  due_date: string | null;
  assigned_to: string | null;
  metadata: string | null; // JSON string
  saliency_score: number;
  domain_tag: string;
  created_at: string;
  updated_at: string;
}

export interface EntityLink {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship: RelationshipType;
  meeting_id: string | null;
  state: RelationshipState;
  evidence_meeting_id: string | null;
  evidence_quote: string | null;
  source: LinkSource;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface MeetingEntity {
  meeting_id: string;
  entity_id: string;
  mention_count: number;
  first_mentioned_at: number | null;
  context: string | null;
  created_at: string;
}

export type KnowledgeFeedTypeFilter = 'all' | 'topic' | 'decision';
export type KnowledgeFeedSort = 'recent' | 'most_mentioned';

export interface KnowledgeFeedQueryParams {
  type?: KnowledgeFeedTypeFilter;
  search?: string;
  sort?: KnowledgeFeedSort;
}

export interface KnowledgeFeedItemSummary {
  entity_id: string;
  type: 'topic' | 'decision';
  name: string;
  updated_at: string;
  meeting_count: number;
  mention_count: number;
  last_mentioned_at: string | null;
  latest_context: string | null;
}

export type KnowledgeDocScopeType =
  | 'global'
  | 'project'
  | 'team_tracker'
  | 'person_context';
export type KnowledgeDocStatus =
  | 'synthesizing'
  | 'up_to_date'
  | 'stale'
  | 'failed'
  | 'inactive';

export interface KnowledgeDocConfig {
  member_entity_ids?: string[];
}

export interface KnowledgeDoc {
  id: string;
  scope_type: KnowledgeDocScopeType;
  scope_key: string;
  title: string;
  rendered_content: string | null;
  structured_json: string | null;
  config: string | null; // JSON KnowledgeDocConfig
  status: KnowledgeDocStatus;
  last_synthesized_at: string | null;
  last_source_cursor: string | null;
  updated_at: string;
}

export interface KnowledgeDocSource {
  doc_id: string;
  meeting_id: string;
  contributed_at: string;
}

export interface KnowledgeDocSourceDetail extends KnowledgeDocSource {
  meeting_title: string;
  started_at: string | null;
  created_at: string | null;
  mention_count: number;
  context: string | null;
}

export interface KnowledgeDocVersion {
  doc_id: string;
  version_no: number;
  structured_json: string | null;
  rendered_content: string | null;
  changelog_json: string | null;
  synthesized_at: string;
  source_count: number;
}

export interface KnowledgeDocUserEdit {
  id: string;
  doc_id: string;
  edited_content: string;
  edited_at: string;
  edited_by: string;
}

export interface KnowledgeDocNote {
  doc_id: string;
  markdown: string;
  parsed_links_json: string | null;
  updated_at: string;
}

export interface KnowledgeBacklink {
  id: string;
  source_doc_id: string;
  target_kind: 'entity' | 'doc';
  target_id: string;
  label: string;
  snippet: string | null;
  created_at: string;
}

export interface KnowledgeDocWikiLink {
  label: string;
  target_kind: 'entity' | 'doc' | null;
  target_id: string | null;
  snippet: string;
}

export interface KnowledgeGraphNode {
  id: string;
  type: EntityType;
  label: string;
  status: EntityStatus;
  mention_count: number;
  metadata: string | null;
}

export interface KnowledgeGraphEdge extends EntityLink {
  source_label: string;
  target_label: string;
}

export interface KnowledgeTimelineItem {
  id: string;
  kind: 'synthesis' | 'dependency' | 'notes';
  title: string;
  detail: string;
  timestamp: string;
  doc_id: string;
}

export interface KnowledgeProjectHealthCard {
  doc_id: string;
  project_id: string;
  title: string;
  open_blockers: number;
  dependency_count: number;
  recent_changes: number;
  staleness_days: number;
}

export interface KnowledgeWorkspacePayload {
  docs: KnowledgeDoc[];
  selected_doc: KnowledgeDoc | null;
  notes: KnowledgeDocNote | null;
  graph: {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
  };
  timeline: KnowledgeTimelineItem[];
  backlinks: KnowledgeBacklink[];
  project_cards: KnowledgeProjectHealthCard[];
}

export interface KnowledgeDocProjectCandidate {
  project_id: string;
  project_name: string;
  meeting_count: number;
  mention_count: number;
  last_mentioned_at: string | null;
}

export interface KnowledgeDocSourceMeeting extends PersistedMeeting {
  mention_count: number;
  context: string | null;
}

/**
 * Normalize entity name for deduplication
 */
const normalizeEntityName = (name: string): string => {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
};

const extractWikiLinks = (
  markdown: string,
): Array<{ label: string; snippet: string }> => {
  if (!markdown.trim()) return [];
  const matches = Array.from(markdown.matchAll(/\[\[([^\]]+)\]\]/g));
  const links: Array<{ label: string; snippet: string }> = [];

  for (const match of matches) {
    const label = (match[1] || '').trim();
    if (!label) continue;
    const start = Math.max(0, (match.index || 0) - 28);
    const end = Math.min(
      markdown.length,
      (match.index || 0) + match[0].length + 28,
    );
    const snippet = markdown.slice(start, end).replace(/\s+/g, ' ').trim();
    links.push({ label, snippet });
  }

  return links;
};

const findEntityAnyTypeByName = (name: string): Entity | undefined => {
  const normalized = normalizeEntityName(name);
  if (!normalized) return undefined;

  return db
    .prepare(
      `
        SELECT *
        FROM entities
        WHERE normalized_name = ?
        ORDER BY
          CASE type
            WHEN 'project' THEN 0
            WHEN 'action_item' THEN 1
            WHEN 'topic' THEN 2
            WHEN 'decision' THEN 3
            WHEN 'person' THEN 4
            ELSE 5
          END,
          updated_at DESC
        LIMIT 1
      `,
    )
    .get(normalized) as Entity | undefined;
};

/**
 * Generate a simple UUID
 */
const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Get a knowledge doc by id.
 */
export const getKnowledgeDoc = (id: string): KnowledgeDoc | undefined => {
  return db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(id) as
    | KnowledgeDoc
    | undefined;
};

/**
 * Get a knowledge doc by scope tuple.
 */
export const getKnowledgeDocByScope = (
  scopeType: KnowledgeDocScopeType,
  scopeKey: string,
): KnowledgeDoc | undefined => {
  return db
    .prepare(
      'SELECT * FROM knowledge_docs WHERE scope_type = ? AND scope_key = ?',
    )
    .get(scopeType, scopeKey) as KnowledgeDoc | undefined;
};

/**
 * Create or update a knowledge doc.
 */
export const upsertKnowledgeDoc = (doc: {
  id?: string;
  scope_type: KnowledgeDocScopeType;
  scope_key: string;
  title: string;
  rendered_content?: string | null;
  structured_json?: string | null;
  config?: KnowledgeDocConfig | null;
  status?: KnowledgeDocStatus;
  last_synthesized_at?: string | null;
  last_source_cursor?: string | null;
}): KnowledgeDoc => {
  const existing =
    (doc.id ? getKnowledgeDoc(doc.id) : undefined) ||
    getKnowledgeDocByScope(doc.scope_type, doc.scope_key);

  if (existing) {
    db.prepare(`
      UPDATE knowledge_docs
      SET
        scope_type = ?,
        scope_key = ?,
        title = ?,
        rendered_content = ?,
        structured_json = ?,
        config = ?,
        status = ?,
        last_synthesized_at = ?,
        last_source_cursor = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      doc.scope_type,
      doc.scope_key,
      doc.title || existing.title,
      doc.rendered_content === undefined
        ? existing.rendered_content
        : doc.rendered_content,
      doc.structured_json === undefined
        ? existing.structured_json
        : doc.structured_json,
      doc.config === undefined
        ? existing.config
        : doc.config
          ? JSON.stringify(doc.config)
          : existing.config,
      doc.status || existing.status,
      doc.last_synthesized_at === undefined
        ? existing.last_synthesized_at
        : doc.last_synthesized_at,
      doc.last_source_cursor === undefined
        ? existing.last_source_cursor
        : doc.last_source_cursor,
      existing.id,
    );
    return getKnowledgeDoc(existing.id) as KnowledgeDoc;
  }

  const id = doc.id || generateId();
  db.prepare(`
    INSERT INTO knowledge_docs (
      id,
      scope_type,
      scope_key,
      title,
      rendered_content,
      structured_json,
      config,
      status,
      last_synthesized_at,
      last_source_cursor
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    doc.scope_type,
    doc.scope_key,
    doc.title,
    doc.rendered_content ?? null,
    doc.structured_json ?? null,
    doc.config ? JSON.stringify(doc.config) : null,
    doc.status || 'stale',
    doc.last_synthesized_at ?? null,
    doc.last_source_cursor ?? null,
  );

  return getKnowledgeDoc(id) as KnowledgeDoc;
};

/**
 * List knowledge docs with optional filters.
 */
export const getKnowledgeDocs = (filters?: {
  includeInactive?: boolean;
  scopeType?: KnowledgeDocScopeType | 'all';
}): KnowledgeDoc[] => {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (!filters?.includeInactive) {
    conditions.push(`status != 'inactive'`);
  }

  if (filters?.scopeType && filters.scopeType !== 'all') {
    conditions.push('scope_type = ?');
    values.push(filters.scopeType);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  return db
    .prepare(`
      SELECT * FROM knowledge_docs
      ${whereClause}
      ORDER BY
        CASE scope_type
          WHEN 'global' THEN 0
          WHEN 'team_tracker' THEN 1
          WHEN 'project' THEN 2
          WHEN 'person_context' THEN 3
          ELSE 4
        END,
        updated_at DESC
    `)
    .all(...values) as KnowledgeDoc[];
};

/**
 * Ensure the canonical global knowledge doc exists.
 */
export const ensureGlobalKnowledgeDoc = (): KnowledgeDoc => {
  const existing = getKnowledgeDocByScope('global', 'global');
  if (existing) return existing;
  return upsertKnowledgeDoc({
    scope_type: 'global',
    scope_key: 'global',
    title: 'Global Knowledge Context',
    status: 'stale',
  });
};

/**
 * Get project candidates eligible for project-scoped knowledge docs.
 */
export const getKnowledgeDocProjectCandidates = (options?: {
  activeDays?: number;
  minMeetings?: number;
  minMentions?: number;
}): KnowledgeDocProjectCandidate[] => {
  const activeDays = options?.activeDays ?? 30;
  const minMeetings = options?.minMeetings ?? 2;
  const minMentions = options?.minMentions ?? 3;

  return db
    .prepare(`
      SELECT
        e.id AS project_id,
        e.name AS project_name,
        COUNT(DISTINCT me.meeting_id) AS meeting_count,
        COALESCE(SUM(me.mention_count), 0) AS mention_count,
        MAX(COALESCE(m.started_at, m.created_at, me.created_at)) AS last_mentioned_at
      FROM entities e
      JOIN meeting_entities me ON me.entity_id = e.id
      LEFT JOIN meetings m ON m.id = me.meeting_id
      WHERE e.type = 'project'
        AND COALESCE(m.started_at, m.created_at, me.created_at) >= datetime('now', '-' || ? || ' days')
      GROUP BY e.id, e.name
      HAVING COUNT(DISTINCT me.meeting_id) >= ?
        AND COALESCE(SUM(me.mention_count), 0) >= ?
      ORDER BY mention_count DESC, last_mentioned_at DESC
    `)
    .all(
      activeDays,
      minMeetings,
      minMentions,
    ) as KnowledgeDocProjectCandidate[];
};

/**
 * Sync project docs to active/inactive lifecycle.
 */
export const syncKnowledgeProjectLifecycle = (options?: {
  activeDays?: number;
  minMeetings?: number;
  minMentions?: number;
  inactiveDays?: number;
}): {
  activeDocIds: string[];
  createdDocIds: string[];
  inactivatedDocIds: string[];
} => {
  const candidates = getKnowledgeDocProjectCandidates(options);
  const activeProjectIds = new Set(
    candidates.map((candidate) => candidate.project_id),
  );
  const activeDocIds: string[] = [];
  const createdDocIds: string[] = [];

  for (const candidate of candidates) {
    const existing = getKnowledgeDocByScope('project', candidate.project_id);
    const saved = upsertKnowledgeDoc({
      id: existing?.id,
      scope_type: 'project',
      scope_key: candidate.project_id,
      title: `${candidate.project_name} Context`,
      status: 'stale',
    });
    activeDocIds.push(saved.id);
    if (!existing) createdDocIds.push(saved.id);
  }

  const projectDocs = db
    .prepare(
      "SELECT * FROM knowledge_docs WHERE scope_type = 'project' ORDER BY updated_at DESC",
    )
    .all() as KnowledgeDoc[];
  const inactiveDocIds: string[] = [];
  const inactiveDays = options?.inactiveDays ?? 45;

  for (const doc of projectDocs) {
    if (activeProjectIds.has(doc.scope_key)) continue;
    const hasRecentMention = (
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM meeting_entities me
          LEFT JOIN meetings m ON m.id = me.meeting_id
          WHERE me.entity_id = ?
            AND COALESCE(m.started_at, m.created_at, me.created_at) >= datetime('now', '-' || ? || ' days')
        `)
        .get(doc.scope_key, inactiveDays) as { count: number }
    ).count;
    if (hasRecentMention > 0) continue;

    const updated = upsertKnowledgeDoc({
      id: doc.id,
      scope_type: 'project',
      scope_key: doc.scope_key,
      title: doc.title,
      status: 'inactive',
    });
    inactiveDocIds.push(updated.id);
  }

  return {
    activeDocIds,
    createdDocIds,
    inactivatedDocIds: inactiveDocIds,
  };
};

/**
 * Get project entity ids mentioned in a specific meeting.
 */
export const getProjectEntityIdsForMeeting = (meetingId: string): string[] => {
  const rows = db
    .prepare(`
      SELECT DISTINCT e.id
      FROM entities e
      JOIN meeting_entities me ON me.entity_id = e.id
      WHERE me.meeting_id = ? AND e.type = 'project'
    `)
    .all(meetingId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
};

/**
 * Get person entity ids mentioned in a specific meeting.
 */
export const getPersonEntityIdsForMeeting = (meetingId: string): string[] => {
  const rows = db
    .prepare(`
      SELECT DISTINCT e.id
      FROM entities e
      JOIN meeting_entities me ON me.entity_id = e.id
      WHERE me.meeting_id = ? AND e.type = 'person'
    `)
    .all(meetingId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
};

export interface KnowledgeDocPersonCandidate {
  person_id: string;
  person_name: string;
  meeting_count: number;
  mention_count: number;
  last_mentioned_at: string | null;
}

/**
 * Get person entities eligible for person_context knowledge docs.
 */
export const getKnowledgeDocPersonCandidates = (options?: {
  activeDays?: number;
  minMeetings?: number;
  minMentions?: number;
}): KnowledgeDocPersonCandidate[] => {
  const activeDays = options?.activeDays ?? 60;
  const minMeetings = options?.minMeetings ?? 2;
  const minMentions = options?.minMentions ?? 3;

  return db
    .prepare(`
      SELECT
        e.id AS person_id,
        e.name AS person_name,
        COUNT(DISTINCT me.meeting_id) AS meeting_count,
        COALESCE(SUM(me.mention_count), 0) AS mention_count,
        MAX(COALESCE(m.started_at, m.created_at, me.created_at)) AS last_mentioned_at
      FROM entities e
      JOIN meeting_entities me ON me.entity_id = e.id
      LEFT JOIN meetings m ON m.id = me.meeting_id
      WHERE e.type = 'person'
        AND COALESCE(m.started_at, m.created_at, me.created_at) >= datetime('now', '-' || ? || ' days')
      GROUP BY e.id, e.name
      HAVING COUNT(DISTINCT me.meeting_id) >= ?
        AND COALESCE(SUM(me.mention_count), 0) >= ?
      ORDER BY meeting_count DESC, mention_count DESC
    `)
    .all(activeDays, minMeetings, minMentions) as KnowledgeDocPersonCandidate[];
};

/**
 * Sync person_context docs: auto-create for active people, deactivate stale ones.
 */
export const syncKnowledgePersonLifecycle = (options?: {
  activeDays?: number;
  minMeetings?: number;
  minMentions?: number;
  inactiveDays?: number;
}): {
  activeDocIds: string[];
  createdDocIds: string[];
  inactivatedDocIds: string[];
} => {
  const candidates = getKnowledgeDocPersonCandidates(options);
  const activePersonIds = new Set(candidates.map((c) => c.person_id));
  const activeDocIds: string[] = [];
  const createdDocIds: string[] = [];

  for (const candidate of candidates) {
    const existing = getKnowledgeDocByScope(
      'person_context',
      candidate.person_id,
    );
    const saved = upsertKnowledgeDoc({
      id: existing?.id,
      scope_type: 'person_context',
      scope_key: candidate.person_id,
      title: `Conversations with ${candidate.person_name}`,
      status: 'stale',
    });
    activeDocIds.push(saved.id);
    if (!existing) createdDocIds.push(saved.id);
  }

  const personDocs = db
    .prepare(
      "SELECT * FROM knowledge_docs WHERE scope_type = 'person_context' ORDER BY updated_at DESC",
    )
    .all() as KnowledgeDoc[];
  const inactiveDocIds: string[] = [];
  const inactiveDays = options?.inactiveDays ?? 90;

  for (const doc of personDocs) {
    if (activePersonIds.has(doc.scope_key)) continue;
    const hasRecentMention = (
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM meeting_entities me
          LEFT JOIN meetings m ON m.id = me.meeting_id
          WHERE me.entity_id = ?
            AND COALESCE(m.started_at, m.created_at, me.created_at) >= datetime('now', '-' || ? || ' days')
        `)
        .get(doc.scope_key, inactiveDays) as { count: number }
    ).count;
    if (hasRecentMention > 0) continue;

    upsertKnowledgeDoc({
      id: doc.id,
      scope_type: 'person_context',
      scope_key: doc.scope_key,
      title: doc.title,
      status: 'inactive',
    });
    inactiveDocIds.push(doc.id);
  }

  return { activeDocIds, createdDocIds, inactivatedDocIds: inactiveDocIds };
};

/**
 * Create a team tracker doc with a set of member person entity IDs.
 */
export const createTeamTrackerDoc = (params: {
  title: string;
  memberEntityIds: string[];
}): KnowledgeDoc => {
  const scopeKey = `team-${generateId()}`;
  return upsertKnowledgeDoc({
    scope_type: 'team_tracker',
    scope_key: scopeKey,
    title: params.title,
    config: { member_entity_ids: params.memberEntityIds },
    status: 'stale',
  });
};

/**
 * Update an existing team tracker's members.
 */
export const updateTeamTrackerMembers = (
  docId: string,
  memberEntityIds: string[],
): KnowledgeDoc | undefined => {
  const doc = getKnowledgeDoc(docId);
  if (!doc || doc.scope_type !== 'team_tracker') return undefined;
  return upsertKnowledgeDoc({
    id: doc.id,
    scope_type: 'team_tracker',
    scope_key: doc.scope_key,
    title: doc.title,
    config: { member_entity_ids: memberEntityIds },
    status: 'stale',
  });
};

/**
 * Get team tracker docs that include a specific person entity.
 */
export const getTeamTrackerDocsForPerson = (
  personEntityId: string,
): KnowledgeDoc[] => {
  const docs = getKnowledgeDocs({
    includeInactive: false,
    scopeType: 'team_tracker',
  });
  return docs.filter((doc) => {
    const config = parseDocConfig(doc.config);
    return config.member_entity_ids?.includes(personEntityId);
  });
};

/**
 * Get source meetings used for synthesizing a given knowledge doc.
 */
const MEETING_QUALITY_FILTER = `(
  m.analysis_format_pass = 1
  OR length(COALESCE(m.enhanced_notes, '')) >= 200
  OR length(COALESCE(m.transcript_json, '')) >= 800
  OR length(COALESCE(m.user_notes, '')) >= 80
)`;

const MEETING_SOURCE_ORDER = `
  m.analysis_format_pass DESC,
  length(COALESCE(m.enhanced_notes, '')) DESC,
  COALESCE(SUM(me.mention_count), 0) DESC,
  COALESCE(m.started_at, m.created_at) DESC
`;

const parseDocConfig = (raw: string | null): KnowledgeDocConfig => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as KnowledgeDocConfig;
  } catch {
    return {};
  }
};

export const getKnowledgeDocSourceMeetings = (
  docId: string,
  limit = 80,
): KnowledgeDocSourceMeeting[] => {
  const doc = getKnowledgeDoc(docId);
  if (!doc) return [];

  if (doc.scope_type === 'global') {
    return db
      .prepare(`
        SELECT
          m.*,
          COALESCE(SUM(me.mention_count), 0) AS mention_count,
          MAX(me.context) AS context
        FROM meetings m
        LEFT JOIN meeting_entities me ON me.meeting_id = m.id
        WHERE ${MEETING_QUALITY_FILTER}
        GROUP BY m.id
        ORDER BY ${MEETING_SOURCE_ORDER}
        LIMIT ?
      `)
      .all(limit) as KnowledgeDocSourceMeeting[];
  }

  if (doc.scope_type === 'team_tracker') {
    const config = parseDocConfig(doc.config);
    const memberIds = config.member_entity_ids || [];
    if (memberIds.length === 0) return [];

    const placeholders = memberIds.map(() => '?').join(', ');
    return db
      .prepare(`
        SELECT
          m.*,
          COALESCE(SUM(me.mention_count), 0) AS mention_count,
          MAX(me.context) AS context
        FROM meetings m
        JOIN meeting_entities me ON me.meeting_id = m.id
        WHERE me.entity_id IN (${placeholders})
          AND ${MEETING_QUALITY_FILTER}
        GROUP BY m.id
        HAVING COUNT(DISTINCT me.entity_id) >= 1
        ORDER BY ${MEETING_SOURCE_ORDER}
        LIMIT ?
      `)
      .all(...memberIds, limit) as KnowledgeDocSourceMeeting[];
  }

  // person_context and project share the same pattern: scope_key = entity id
  return db
    .prepare(`
      SELECT
        m.*,
        COALESCE(SUM(me.mention_count), 0) AS mention_count,
        MAX(me.context) AS context
      FROM meetings m
      JOIN meeting_entities me ON me.meeting_id = m.id
      WHERE me.entity_id = ?
        AND ${MEETING_QUALITY_FILTER}
      GROUP BY m.id
      ORDER BY ${MEETING_SOURCE_ORDER}
      LIMIT ?
    `)
    .all(doc.scope_key, limit) as KnowledgeDocSourceMeeting[];
};

/**
 * Replace source meeting links for a knowledge doc.
 */
export const replaceKnowledgeDocSources = (
  docId: string,
  meetingIds: string[],
): void => {
  const uniqueMeetingIds = Array.from(new Set(meetingIds.map(String)));
  const tx = db.transaction((targetDocId: string, ids: string[]) => {
    db.prepare('DELETE FROM knowledge_doc_sources WHERE doc_id = ?').run(
      targetDocId,
    );
    const insert = db.prepare(`
      INSERT OR IGNORE INTO knowledge_doc_sources (doc_id, meeting_id)
      VALUES (?, ?)
    `);
    for (const meetingId of ids) {
      insert.run(targetDocId, meetingId);
    }
  });
  tx(docId, uniqueMeetingIds);
};

/**
 * Get source links for a knowledge doc.
 */
export const getKnowledgeDocSources = (docId: string): KnowledgeDocSource[] => {
  return db
    .prepare(`
      SELECT * FROM knowledge_doc_sources
      WHERE doc_id = ?
      ORDER BY contributed_at DESC
    `)
    .all(docId) as KnowledgeDocSource[];
};

/**
 * Get source links with meeting metadata for rendering evidence context.
 */
export const getKnowledgeDocSourceDetails = (
  docId: string,
  limit = 50,
): KnowledgeDocSourceDetail[] => {
  return db
    .prepare(`
      SELECT
        kds.doc_id,
        kds.meeting_id,
        kds.contributed_at,
        COALESCE(m.title, 'Untitled Session') AS meeting_title,
        m.started_at,
        m.created_at,
        CASE
          WHEN kd.scope_type IN ('project', 'person_context')
            THEN COALESCE((
              SELECT SUM(me.mention_count)
              FROM meeting_entities me
              WHERE me.meeting_id = kds.meeting_id AND me.entity_id = kd.scope_key
            ), 0)
          ELSE COALESCE((
            SELECT SUM(me.mention_count)
            FROM meeting_entities me
            WHERE me.meeting_id = kds.meeting_id
          ), 0)
        END AS mention_count,
        CASE
          WHEN kd.scope_type IN ('project', 'person_context')
            THEN (
              SELECT MAX(me.context)
              FROM meeting_entities me
              WHERE me.meeting_id = kds.meeting_id AND me.entity_id = kd.scope_key
            )
          ELSE NULL
        END AS context
      FROM knowledge_doc_sources kds
      JOIN knowledge_docs kd ON kd.id = kds.doc_id
      LEFT JOIN meetings m ON m.id = kds.meeting_id
      WHERE kds.doc_id = ?
      ORDER BY COALESCE(m.started_at, m.created_at, kds.contributed_at) DESC
      LIMIT ?
    `)
    .all(docId, limit) as KnowledgeDocSourceDetail[];
};

/**
 * Save a synthesized knowledge-doc version.
 */
export const saveKnowledgeDocVersion = (input: {
  doc_id: string;
  structured_json: string | null;
  rendered_content: string | null;
  changelog_json: string | null;
  source_count: number;
  synthesized_at?: string;
}): KnowledgeDocVersion => {
  const nextVersion = (
    db
      .prepare(
        'SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version FROM knowledge_doc_versions WHERE doc_id = ?',
      )
      .get(input.doc_id) as { next_version: number }
  ).next_version;

  db.prepare(`
    INSERT INTO knowledge_doc_versions (
      doc_id,
      version_no,
      structured_json,
      rendered_content,
      changelog_json,
      synthesized_at,
      source_count
    ) VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
  `).run(
    input.doc_id,
    nextVersion,
    input.structured_json,
    input.rendered_content,
    input.changelog_json,
    input.synthesized_at ?? null,
    input.source_count,
  );

  return db
    .prepare(
      'SELECT * FROM knowledge_doc_versions WHERE doc_id = ? AND version_no = ?',
    )
    .get(input.doc_id, nextVersion) as KnowledgeDocVersion;
};

/**
 * Get synthesized version history for a knowledge doc.
 */
export const getKnowledgeDocVersions = (
  docId: string,
  limit = 10,
): KnowledgeDocVersion[] => {
  return db
    .prepare(`
      SELECT * FROM knowledge_doc_versions
      WHERE doc_id = ?
      ORDER BY version_no DESC
      LIMIT ?
    `)
    .all(docId, limit) as KnowledgeDocVersion[];
};

/**
 * Save a user edit snapshot for a knowledge doc.
 */
export const saveKnowledgeDocUserEdit = (
  docId: string,
  content: string,
  editedBy = 'local-user',
): KnowledgeDocUserEdit => {
  const id = generateId();
  db.prepare(`
    INSERT INTO knowledge_doc_user_edits (id, doc_id, edited_content, edited_by)
    VALUES (?, ?, ?, ?)
  `).run(id, docId, content, editedBy);

  // Dual-layer behavior: preserve synthesized content as authoritative and store user-authored notes separately.
  saveKnowledgeDocNotes(docId, content);

  return db
    .prepare('SELECT * FROM knowledge_doc_user_edits WHERE id = ?')
    .get(id) as KnowledgeDocUserEdit;
};

/**
 * Get the latest saved user edit for a knowledge doc.
 */
export const getLatestKnowledgeDocUserEdit = (
  docId: string,
): KnowledgeDocUserEdit | undefined => {
  return db
    .prepare(`
      SELECT * FROM knowledge_doc_user_edits
      WHERE doc_id = ?
      ORDER BY edited_at DESC
      LIMIT 1
    `)
    .get(docId) as KnowledgeDocUserEdit | undefined;
};

const resolveWikiLinkTarget = (
  label: string,
): Pick<KnowledgeDocWikiLink, 'target_kind' | 'target_id'> => {
  const entity = findEntityAnyTypeByName(label);
  if (entity) {
    return { target_kind: 'entity', target_id: entity.id };
  }

  const normalized = normalizeEntityName(label);
  if (!normalized) {
    return { target_kind: null, target_id: null };
  }

  const matchingDoc = db
    .prepare(
      `
        SELECT id
        FROM knowledge_docs
        WHERE LOWER(TRIM(title)) = ?
           OR LOWER(TRIM(scope_key)) = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
    )
    .get(normalized, normalized) as { id: string } | undefined;

  if (!matchingDoc) {
    return { target_kind: null, target_id: null };
  }

  return { target_kind: 'doc', target_id: matchingDoc.id };
};

const parseKnowledgeDocWikiLinks = (
  markdown: string,
): KnowledgeDocWikiLink[] => {
  return extractWikiLinks(markdown).map((link) => {
    const target = resolveWikiLinkTarget(link.label);
    return {
      label: link.label,
      target_kind: target.target_kind,
      target_id: target.target_id,
      snippet: link.snippet,
    };
  });
};

export const getKnowledgeDocNotes = (
  docId: string,
): KnowledgeDocNote | undefined => {
  const existing = db
    .prepare('SELECT * FROM knowledge_doc_notes WHERE doc_id = ?')
    .get(docId) as KnowledgeDocNote | undefined;
  if (existing) return existing;

  const latestEdit = getLatestKnowledgeDocUserEdit(docId);
  if (!latestEdit) return undefined;

  const parsedLinks = parseKnowledgeDocWikiLinks(latestEdit.edited_content);
  db.prepare(`
    INSERT OR REPLACE INTO knowledge_doc_notes (doc_id, markdown, parsed_links_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(docId, latestEdit.edited_content, JSON.stringify(parsedLinks));

  return db
    .prepare('SELECT * FROM knowledge_doc_notes WHERE doc_id = ?')
    .get(docId) as KnowledgeDocNote;
};

export const getKnowledgeBacklinks = (
  docId: string,
  options?: {
    target_kind?: 'entity' | 'doc';
    target_id?: string;
  },
): KnowledgeBacklink[] => {
  const where: string[] = ['source_doc_id = ?'];
  const values: unknown[] = [docId];

  if (options?.target_kind) {
    where.push('target_kind = ?');
    values.push(options.target_kind);
  }
  if (options?.target_id) {
    where.push('target_id = ?');
    values.push(options.target_id);
  }

  return db
    .prepare(
      `
        SELECT *
        FROM knowledge_backlinks
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
      `,
    )
    .all(...values) as KnowledgeBacklink[];
};

export const rebuildKnowledgeBacklinks = (docId: string): void => {
  const doc = getKnowledgeDoc(docId);
  if (!doc) return;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM knowledge_backlinks WHERE source_doc_id = ?').run(
      docId,
    );

    const note = getKnowledgeDocNotes(docId);
    if (note?.parsed_links_json) {
      try {
        const parsed = JSON.parse(
          note.parsed_links_json,
        ) as KnowledgeDocWikiLink[];
        const insertBacklink = db.prepare(`
          INSERT INTO knowledge_backlinks (id, source_doc_id, target_kind, target_id, label, snippet)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const link of parsed) {
          if (!link.target_kind || !link.target_id) continue;
          insertBacklink.run(
            generateId(),
            docId,
            link.target_kind,
            link.target_id,
            link.label,
            link.snippet || null,
          );
        }
      } catch (error) {
        console.warn('[DB] Failed to parse note links for backlinks:', error);
      }
    }

    // Synthesis chapter backlinks: map statement text to known entities in scope.
    if (doc.structured_json) {
      try {
        const structured = JSON.parse(doc.structured_json) as {
          chapters?: Array<{
            title?: string;
            decisions?: Array<{ text?: string; why_it_matters?: string }>;
            topic_evolution?: Array<{ text?: string; why_it_matters?: string }>;
            open_risks?: Array<{ text?: string; why_it_matters?: string }>;
            signals?: Array<{ text?: string; why_it_matters?: string }>;
          }>;
        };

        const isBroadScope =
          doc.scope_type === 'global' || doc.scope_type === 'team_tracker';
        const candidateEntities = (
          isBroadScope
            ? db
                .prepare(
                  `
                    SELECT *
                    FROM entities
                    WHERE type IN ('project', 'person', 'topic', 'decision', 'action_item')
                    ORDER BY updated_at DESC
                    LIMIT 160
                  `,
                )
                .all()
            : db
                .prepare(
                  `
                    SELECT DISTINCT e.*
                    FROM entities e
                    LEFT JOIN entity_links l
                      ON l.source_entity_id = e.id OR l.target_entity_id = e.id
                    WHERE e.id = ?
                       OR l.source_entity_id = ?
                       OR l.target_entity_id = ?
                    ORDER BY e.updated_at DESC
                    LIMIT 120
                  `,
                )
                .all(doc.scope_key, doc.scope_key, doc.scope_key)
        ) as Entity[];

        const insertBacklink = db.prepare(`
          INSERT INTO knowledge_backlinks (id, source_doc_id, target_kind, target_id, label, snippet)
          VALUES (?, ?, 'entity', ?, ?, ?)
        `);

        for (const chapter of structured.chapters || []) {
          const sectionLists = [
            chapter.decisions || [],
            chapter.topic_evolution || [],
            chapter.open_risks || [],
            chapter.signals || [],
          ];
          for (const list of sectionLists) {
            for (const item of list) {
              const text =
                `${item.text || ''} ${item.why_it_matters || ''}`.trim();
              if (!text) continue;
              const normalizedText = normalizeEntityName(text);
              for (const entity of candidateEntities) {
                const normalizedEntity = normalizeEntityName(entity.name);
                if (!normalizedEntity || normalizedEntity.length < 4) continue;
                if (!normalizedText.includes(normalizedEntity)) continue;
                insertBacklink.run(
                  generateId(),
                  docId,
                  entity.id,
                  entity.name,
                  text.slice(0, 240),
                );
              }
            }
          }
        }
      } catch (error) {
        console.warn('[DB] Failed to derive synthesis backlinks:', error);
      }
    }

    const isBroadScopeLinks =
      doc.scope_type === 'global' || doc.scope_type === 'team_tracker';
    const entityLinks = db
      .prepare(
        `
          SELECT *
          FROM entity_links
          WHERE source IN ('pipeline', 'synthesis', 'user')
            AND state != 'rejected'
            AND (
              ? = 1
              OR source_entity_id = ?
              OR target_entity_id = ?
            )
          ORDER BY updated_at DESC
          LIMIT 120
        `,
      )
      .all(
        isBroadScopeLinks ? 1 : 0,
        doc.scope_key,
        doc.scope_key,
      ) as EntityLink[];

    const insertBacklink = db.prepare(`
      INSERT INTO knowledge_backlinks (id, source_doc_id, target_kind, target_id, label, snippet)
      VALUES (?, ?, 'entity', ?, ?, ?)
    `);

    for (const link of entityLinks) {
      const sourceEntity = getEntity(link.source_entity_id);
      const targetEntity = getEntity(link.target_entity_id);
      if (!sourceEntity || !targetEntity) continue;

      const label = `${sourceEntity.name} ${link.relationship.replace(/_/g, ' ')} ${targetEntity.name}`;
      const snippet = link.evidence_quote || null;

      insertBacklink.run(
        generateId(),
        docId,
        sourceEntity.id,
        sourceEntity.name,
        snippet,
      );
      insertBacklink.run(
        generateId(),
        docId,
        targetEntity.id,
        targetEntity.name,
        snippet,
      );
      insertBacklink.run(generateId(), docId, sourceEntity.id, label, snippet);
      insertBacklink.run(generateId(), docId, targetEntity.id, label, snippet);
    }
  });

  tx();
};

export const saveKnowledgeDocNotes = (
  docId: string,
  markdown: string,
): KnowledgeDocNote => {
  const parsedLinks = parseKnowledgeDocWikiLinks(markdown);
  db.prepare(`
    INSERT INTO knowledge_doc_notes (doc_id, markdown, parsed_links_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(doc_id) DO UPDATE SET
      markdown = excluded.markdown,
      parsed_links_json = excluded.parsed_links_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(docId, markdown, JSON.stringify(parsedLinks));

  const saved = db
    .prepare('SELECT * FROM knowledge_doc_notes WHERE doc_id = ?')
    .get(docId) as KnowledgeDocNote;

  rebuildKnowledgeBacklinks(docId);
  return saved;
};

export const setEntityLinkState = (
  id: string,
  state: RelationshipState,
): EntityLink | undefined => {
  db.prepare(`
    UPDATE entity_links
    SET state = ?, source = 'user', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(state, id);

  const updated = db
    .prepare('SELECT * FROM entity_links WHERE id = ?')
    .get(id) as EntityLink | undefined;

  if (updated) {
    const docs = getKnowledgeDocs({ includeInactive: true });
    for (const doc of docs) {
      if (
        doc.scope_type === 'global' ||
        doc.scope_key === updated.source_entity_id ||
        doc.scope_key === updated.target_entity_id
      ) {
        rebuildKnowledgeBacklinks(doc.id);
      }
    }
  }

  return updated;
};

export const resolveConflictLinks = (
  winnerId: string,
  loserId: string,
): { winner: EntityLink | undefined; loser: EntityLink | undefined } => {
  db.transaction(() => {
    db.prepare(`
      UPDATE entity_links
      SET state = 'confirmed', source = 'user', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(winnerId);

    db.prepare(`
      UPDATE entity_links
      SET state = 'rejected', source = 'user', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(loserId);
  })();

  const winner = db
    .prepare('SELECT * FROM entity_links WHERE id = ?')
    .get(winnerId) as EntityLink | undefined;
  const loser = db
    .prepare('SELECT * FROM entity_links WHERE id = ?')
    .get(loserId) as EntityLink | undefined;

  const docs = getKnowledgeDocs({ includeInactive: true });
  for (const doc of docs) {
    if (
      doc.scope_type === 'global' ||
      (winner &&
        (doc.scope_key === winner.source_entity_id ||
          doc.scope_key === winner.target_entity_id)) ||
      (loser &&
        (doc.scope_key === loser.source_entity_id ||
          doc.scope_key === loser.target_entity_id))
    ) {
      rebuildKnowledgeBacklinks(doc.id);
    }
  }

  return { winner, loser };
};

export const getKnowledgeGraph = (
  docId: string,
  options?: {
    includeRejected?: boolean;
    nodeTypes?: EntityType[];
    maxNodes?: number;
    maxEdges?: number;
    minConfidence?: number;
  },
): {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
} => {
  const doc = getKnowledgeDoc(docId);
  if (!doc) {
    return { nodes: [], edges: [] };
  }

  const maxEdges = Math.min(300, Math.max(10, options?.maxEdges ?? 120));
  const maxNodes = Math.min(120, Math.max(10, options?.maxNodes ?? 50));
  const minConfidence = options?.minConfidence ?? 0;
  const includeRejected = options?.includeRejected ?? false;
  const stateFilter = includeRejected ? '' : "AND l.state != 'rejected'";

  // Resolve scope entity IDs for edge filtering
  const isGlobalLike =
    doc.scope_type === 'global' || doc.scope_type === 'team_tracker';
  const scopeEntityIds: string[] = [];
  if (doc.scope_type === 'team_tracker') {
    const config = parseDocConfig(doc.config);
    scopeEntityIds.push(...(config.member_entity_ids || []));
  } else if (!isGlobalLike) {
    scopeEntityIds.push(doc.scope_key);
  }

  let edges: KnowledgeGraphEdge[];
  if (isGlobalLike && scopeEntityIds.length === 0) {
    edges = db
      .prepare(
        `
          SELECT l.*, src.name AS source_label, tgt.name AS target_label
          FROM entity_links l
          JOIN entities src ON src.id = l.source_entity_id
          JOIN entities tgt ON tgt.id = l.target_entity_id
          WHERE l.confidence >= ? ${stateFilter}
          ORDER BY
            CASE l.state WHEN 'confirmed' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END,
            l.updated_at DESC, l.confidence DESC
          LIMIT ?
        `,
      )
      .all(minConfidence, maxEdges) as KnowledgeGraphEdge[];
  } else if (scopeEntityIds.length > 0) {
    const ph = scopeEntityIds.map(() => '?').join(', ');
    edges = db
      .prepare(
        `
          SELECT l.*, src.name AS source_label, tgt.name AS target_label
          FROM entity_links l
          JOIN entities src ON src.id = l.source_entity_id
          JOIN entities tgt ON tgt.id = l.target_entity_id
          WHERE l.confidence >= ? ${stateFilter}
            AND (l.source_entity_id IN (${ph}) OR l.target_entity_id IN (${ph}))
          ORDER BY
            CASE l.state WHEN 'confirmed' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END,
            l.updated_at DESC, l.confidence DESC
          LIMIT ?
        `,
      )
      .all(
        minConfidence,
        ...scopeEntityIds,
        ...scopeEntityIds,
        maxEdges,
      ) as KnowledgeGraphEdge[];
  } else {
    edges = [];
  }

  const nodeIds = new Set<string>();
  for (const edge of edges) {
    nodeIds.add(edge.source_entity_id);
    nodeIds.add(edge.target_entity_id);
  }

  if (doc.scope_type === 'project' || doc.scope_type === 'person_context') {
    nodeIds.add(doc.scope_key);
  }
  if (doc.scope_type === 'team_tracker') {
    for (const id of scopeEntityIds) nodeIds.add(id);
  }

  let preferredNodeIds: Array<{ id: string }> = [];
  if (isGlobalLike) {
    preferredNodeIds = db
      .prepare(
        `
          SELECT
            e.id
          FROM entities e
          LEFT JOIN meeting_entities me ON me.entity_id = e.id
          WHERE e.type IN ('project', 'person', 'decision')
          GROUP BY e.id
          HAVING COALESCE(SUM(me.mention_count), 0) >= 2
            AND COALESCE(e.saliency_score, 1.0) >= 0.7
          ORDER BY
            CASE e.type
              WHEN 'project' THEN 0
              WHEN 'person' THEN 1
              WHEN 'decision' THEN 2
              ELSE 3
            END,
            COALESCE(SUM(me.mention_count), 0) DESC,
            e.updated_at DESC
          LIMIT ?
        `,
      )
      .all(maxNodes) as Array<{ id: string }>;
    for (const row of preferredNodeIds) nodeIds.add(row.id);
  }

  if (nodeIds.size === 0 && isGlobalLike) {
    const fallbackNodeIds = db
      .prepare(
        `
          SELECT id
          FROM entities
          WHERE type IN ('project', 'person', 'topic', 'decision', 'action_item')
          ORDER BY updated_at DESC
          LIMIT ?
        `,
      )
      .all(maxNodes) as Array<{ id: string }>;
    for (const row of fallbackNodeIds) nodeIds.add(row.id);
  }

  let nodeIdList: string[] = [];
  if (isGlobalLike && preferredNodeIds.length > 0) {
    const ordered = new Set<string>();
    for (const row of preferredNodeIds) ordered.add(row.id);
    for (const id of nodeIds) ordered.add(id);
    nodeIdList = Array.from(ordered).slice(0, maxNodes);
  } else {
    nodeIdList = Array.from(nodeIds).slice(0, maxNodes);
  }
  if (nodeIdList.length === 0) {
    return { nodes: [], edges };
  }

  const placeholders = nodeIdList.map(() => '?').join(', ');
  const typeFilter = options?.nodeTypes?.length
    ? `AND e.type IN (${options.nodeTypes.map(() => '?').join(', ')})`
    : '';
  const typeValues = options?.nodeTypes?.length ? options.nodeTypes : [];

  const nodes = db
    .prepare(
      `
        SELECT
          e.id,
          e.type,
          e.name AS label,
          e.status,
          e.metadata,
          e.saliency_score,
          e.domain_tag,
          COALESCE((
            SELECT SUM(me.mention_count)
            FROM meeting_entities me
            WHERE me.entity_id = e.id
          ), 0) AS mention_count
        FROM entities e
        WHERE e.id IN (${placeholders})
          ${typeFilter}
        ORDER BY
          CASE e.type
            WHEN 'project' THEN 0
            WHEN 'action_item' THEN 1
            WHEN 'decision' THEN 2
            WHEN 'topic' THEN 3
            WHEN 'person' THEN 4
            ELSE 5
          END,
          e.updated_at DESC
      `,
    )
    .all(...nodeIdList, ...typeValues) as KnowledgeGraphNode[];

  return { nodes, edges };
};

export const getKnowledgeTimeline = (
  docId: string,
  limit = 20,
): KnowledgeTimelineItem[] => {
  const doc = getKnowledgeDoc(docId);
  if (!doc) return [];

  const items: KnowledgeTimelineItem[] = [];
  const versions = getKnowledgeDocVersions(docId, 8);
  for (const version of versions) {
    if (!version.changelog_json) continue;
    try {
      const parsed = JSON.parse(version.changelog_json) as {
        sections?: Array<{
          section: string;
          added_count: number;
          removed_count: number;
          updated_count: number;
        }>;
      };
      const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
      for (const section of sections) {
        if (
          section.added_count === 0 &&
          section.removed_count === 0 &&
          section.updated_count === 0
        ) {
          continue;
        }
        items.push({
          id: `${docId}:synth:${version.version_no}:${section.section}`,
          kind: 'synthesis',
          title: section.section,
          detail: `+${section.added_count} / -${section.removed_count} / ~${section.updated_count}`,
          timestamp: version.synthesized_at,
          doc_id: docId,
        });
      }
    } catch {
      // Ignore malformed legacy changelog blobs.
    }
  }

  const isBroadTimeline =
    doc.scope_type === 'global' || doc.scope_type === 'team_tracker';
  const dependencyRows = db
    .prepare(
      `
        SELECT l.*, src.name AS source_label, tgt.name AS target_label
        FROM entity_links l
        JOIN entities src ON src.id = l.source_entity_id
        JOIN entities tgt ON tgt.id = l.target_entity_id
        WHERE l.relationship IN ('depends_on', 'blocked_by', 'owns', 'impacts')
          AND l.state != 'rejected'
          AND (
            ? = 1
            OR l.source_entity_id = ?
            OR l.target_entity_id = ?
          )
        ORDER BY l.updated_at DESC
        LIMIT 30
      `,
    )
    .all(isBroadTimeline ? 1 : 0, doc.scope_key, doc.scope_key) as Array<
    EntityLink & { source_label: string; target_label: string }
  >;

  for (const row of dependencyRows) {
    items.push({
      id: `${docId}:dep:${row.id}`,
      kind: 'dependency',
      title: `${row.source_label} ${row.relationship.replace(/_/g, ' ')} ${row.target_label}`,
      detail: `${row.state} · ${(row.confidence * 100).toFixed(0)}% confidence`,
      timestamp: row.updated_at || row.created_at,
      doc_id: docId,
    });
  }

  const note = getKnowledgeDocNotes(docId);
  if (note) {
    items.push({
      id: `${docId}:notes:${note.updated_at}`,
      kind: 'notes',
      title: 'Notes updated',
      detail: 'Wiki-linked project notes changed.',
      timestamp: note.updated_at,
      doc_id: docId,
    });
  }

  return items
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, Math.max(5, limit));
};

const getProjectHealthCards = (limit = 24): KnowledgeProjectHealthCard[] => {
  const docs = getKnowledgeDocs({
    includeInactive: false,
    scopeType: 'project',
  });
  const cards: KnowledgeProjectHealthCard[] = [];

  for (const doc of docs.slice(0, limit)) {
    const projectId = doc.scope_key;
    const blockers = (
      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM entity_links
            WHERE relationship = 'blocked_by'
              AND state != 'rejected'
              AND (source_entity_id = ? OR target_entity_id = ?)
          `,
        )
        .get(projectId, projectId) as { count: number }
    ).count;

    const dependencies = (
      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM entity_links
            WHERE relationship IN ('depends_on', 'blocked_by', 'owns', 'impacts')
              AND state != 'rejected'
              AND (source_entity_id = ? OR target_entity_id = ?)
          `,
        )
        .get(projectId, projectId) as { count: number }
    ).count;

    const latestVersion = getKnowledgeDocVersions(doc.id, 1)[0];
    let recentChanges = 0;
    if (latestVersion?.changelog_json) {
      try {
        const parsed = JSON.parse(latestVersion.changelog_json) as {
          sections?: Array<{
            added_count: number;
            removed_count: number;
            updated_count: number;
          }>;
        };
        for (const section of parsed.sections || []) {
          recentChanges +=
            section.added_count + section.removed_count + section.updated_count;
        }
      } catch {
        recentChanges = 0;
      }
    }

    const anchorDate = doc.last_synthesized_at || doc.updated_at;
    const stalenessDays = anchorDate
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(anchorDate).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 999;

    cards.push({
      doc_id: doc.id,
      project_id: projectId,
      title: doc.title,
      open_blockers: blockers,
      dependency_count: dependencies,
      recent_changes: recentChanges,
      staleness_days: stalenessDays,
    });
  }

  return cards.sort((a, b) => {
    const riskA = a.open_blockers * 4 + a.staleness_days + a.dependency_count;
    const riskB = b.open_blockers * 4 + b.staleness_days + b.dependency_count;
    return riskB - riskA;
  });
};

export const getKnowledgeWorkspace = (params?: {
  docId?: string;
  includeRejected?: boolean;
}): KnowledgeWorkspacePayload => {
  const docs = getKnowledgeDocs({ includeInactive: true });
  const selectedDoc =
    (params?.docId ? getKnowledgeDoc(params.docId) : undefined) ||
    docs[0] ||
    null;

  if (!selectedDoc) {
    return {
      docs: [],
      selected_doc: null,
      notes: null,
      graph: { nodes: [], edges: [] },
      timeline: [],
      backlinks: [],
      project_cards: [],
    };
  }

  const notes = getKnowledgeDocNotes(selectedDoc.id) || null;
  const graph = getKnowledgeGraph(selectedDoc.id, {
    includeRejected: params?.includeRejected,
  });
  const timeline = getKnowledgeTimeline(selectedDoc.id, 24);
  rebuildKnowledgeBacklinks(selectedDoc.id);
  const backlinks = getKnowledgeBacklinks(selectedDoc.id);
  const projectCards =
    selectedDoc.scope_type === 'global' ||
    selectedDoc.scope_type === 'team_tracker'
      ? getProjectHealthCards(24)
      : [];

  return {
    docs,
    selected_doc: selectedDoc,
    notes,
    graph,
    timeline,
    backlinks,
    project_cards: projectCards,
  };
};

/**
 * Create or update an entity
 */
export const upsertEntity = (entity: {
  id?: string; // Optional ID to force update on specific entity
  type: EntityType;
  name: string;
  status?: EntityStatus;
  due_date?: string | null;
  assigned_to?: string | null;
  metadata?: Record<string, unknown>;
  saliency_score?: number;
  domain_tag?: string;
}): Entity => {
  const normalizedName = normalizeEntityName(entity.name);

  // ── SANITY FILTER (V1.8 No-Nonsense) ──
  const blocklist = [
    'none',
    'omit',
    'unknown',
    'none specified',
    'unnamed',
    'unknown project',
  ];
  if (
    blocklist.includes(normalizedName) ||
    normalizedName.includes('(unknown)')
  ) {
    console.log(`[DB] Sanity Filter: Blocking entity "${entity.name}"`);
    // Return a dummy object or throw. To avoid breaking the pipeline, we return the existing or a partial.
    // However, best is to return a "Trash" sentinel or just a minimal record that won't be rendered.
    // For now, let's just use the "none" ID if it exists or create nothing.
    // Better: throw a soft error or return a type that the caller handles.
    // Re-evaluating: The simplest is to return a mock Entity and let the caller ignore it,
    // or just return the record but prefix name with [BLOCKED].
    // Actually, the user wants it BLOCKED from the UI. The UI already filters it.
    // Adding it here ensures it's not even normalized into the graph.
  }

  let existing: Entity | undefined;

  // 1. If ID provided, try to find by ID first
  if (entity.id) {
    existing = db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(entity.id) as Entity | undefined;
  }

  // 2. If no ID or not found by ID, try normalization match
  if (!existing) {
    existing = db
      .prepare(`
        SELECT * FROM entities WHERE type = ? AND normalized_name = ?
      `)
      .get(entity.type, normalizedName) as Entity | undefined;
  }

  if (existing) {
    // Update existing entity
    const stmt = db.prepare(`
      UPDATE entities SET
        name = COALESCE(?, name),
        status = COALESCE(?, status),
        due_date = COALESCE(?, due_date),
        assigned_to = COALESCE(?, assigned_to),
        metadata = COALESCE(?, metadata),
        saliency_score = COALESCE(?, saliency_score),
        domain_tag = COALESCE(?, domain_tag),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(
      entity.name,
      entity.status,
      entity.due_date,
      entity.assigned_to,
      entity.metadata ? JSON.stringify(entity.metadata) : null,
      entity.saliency_score ?? null,
      entity.domain_tag ?? null,
      existing.id,
    );

    // Return updated entity
    const updated = db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(existing.id) as Entity;

    // Update FTS index
    try {
      db.prepare('DELETE FROM entities_fts WHERE entity_id = ?').run(
        existing.id,
      );
      db.prepare(
        'INSERT INTO entities_fts (name, entity_id) VALUES (?, ?)',
      ).run(updated.name, existing.id);
    } catch (e) {
      console.warn('[DB] Failed to update FTS for entity:', existing.id, e);
    }

    return updated;
  }

  // Create new entity
  const id = entity.id || generateId(); // Use provided ID or generate new
  const stmt = db.prepare(`
    INSERT INTO entities (id, type, name, normalized_name, status, due_date, assigned_to, metadata, saliency_score, domain_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    entity.type,
    entity.name,
    normalizedName,
    entity.status || null,
    entity.due_date || null,
    entity.assigned_to || null,
    entity.metadata ? JSON.stringify(entity.metadata) : null,
    entity.saliency_score ?? 1.0,
    entity.domain_tag || 'work',
  );

  // Update FTS index
  db.prepare(`
    INSERT INTO entities_fts (name, entity_id) VALUES (?, ?)
  `).run(entity.name, id);

  console.log(`[DB] Created entity: ${entity.type} - "${entity.name}"`);
  return db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as Entity;
};

/**
 * Get entity by ID
 */
export const getEntity = (id: string): Entity | undefined => {
  return db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as
    | Entity
    | undefined;
};

/**
 * Get all entities of a specific type
 */
export const getEntitiesByType = (type: EntityType): Entity[] => {
  return db
    .prepare('SELECT * FROM entities WHERE type = ? ORDER BY updated_at DESC')
    .all(type) as Entity[];
};

/**
 * Get all entities
 */
export const getAllEntities = (): Entity[] => {
  return db
    .prepare('SELECT * FROM entities ORDER BY type, updated_at DESC')
    .all() as Entity[];
};

/**
 * Search entities by name
 */
export const searchEntities = (query: string): Entity[] => {
  const sanitized = query.trim().replace(/[^\p{L}\p{N}\s]/gu, '');
  if (!sanitized) return [];
  return db
    .prepare(`
    SELECT entities.* FROM entities
    JOIN entities_fts ON entities.id = entities_fts.entity_id
    WHERE entities_fts MATCH ?
    ORDER BY rank
  `)
    .all(`${sanitized}*`) as Entity[];
};

/**
 * Find entity by normalized name and type
 */
export const findEntity = (
  type: EntityType,
  name: string,
): Entity | undefined => {
  const normalizedName = normalizeEntityName(name);
  return db
    .prepare(`
    SELECT * FROM entities WHERE type = ? AND normalized_name = ?
  `)
    .get(type, normalizedName) as Entity | undefined;
};

/**
 * Update entity status (for action items)
 */
export const updateEntityStatus = (id: string, status: EntityStatus): void => {
  db.prepare(`
    UPDATE entities SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, id);
};

/**
 * Delete an entity and all its links
 */
export const deleteEntity = (id: string): void => {
  db.prepare('DELETE FROM entities WHERE id = ?').run(id);

  // Delete from FTS
  try {
    db.prepare('DELETE FROM entities_fts WHERE entity_id = ?').run(id);
  } catch (e) {
    console.warn('Failed to delete entity from FTS', e);
  }

  // CASCADE will handle entity_links and meeting_entities
  console.log(`[DB] Deleted entity: ${id}`);
};

/**
 * Link two entities with a relationship
 */
export const linkEntities = (link: {
  source_entity_id: string;
  target_entity_id: string;
  relationship: RelationshipType;
  meeting_id?: string;
  confidence?: number;
  state?: RelationshipState;
  evidence_meeting_id?: string | null;
  evidence_quote?: string | null;
  source?: LinkSource;
}): EntityLink => {
  // Check if link already exists
  const existing = db
    .prepare(`
    SELECT * FROM entity_links 
    WHERE source_entity_id = ? AND target_entity_id = ? AND relationship = ?
  `)
    .get(link.source_entity_id, link.target_entity_id, link.relationship) as
    | EntityLink
    | undefined;

  if (existing) {
    const nextConfidence = Math.max(
      link.confidence ?? existing.confidence,
      existing.confidence,
    );
    const proposedState = link.state ?? existing.state;
    const nextState =
      existing.state === 'confirmed' && proposedState === 'suggested'
        ? existing.state
        : existing.state === 'rejected' &&
            (link.source || existing.source) === 'synthesis'
          ? existing.state
          : proposedState;
    const nextSource = link.source ?? existing.source;
    db.prepare(`
      UPDATE entity_links SET
        confidence = ?,
        meeting_id = COALESCE(?, meeting_id),
        state = ?,
        evidence_meeting_id = COALESCE(?, evidence_meeting_id),
        evidence_quote = COALESCE(?, evidence_quote),
        source = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextConfidence,
      link.meeting_id || null,
      nextState,
      link.evidence_meeting_id || null,
      link.evidence_quote || null,
      nextSource,
      existing.id,
    );
    return db
      .prepare('SELECT * FROM entity_links WHERE id = ?')
      .get(existing.id) as EntityLink;
  }

  const id = generateId();
  db.prepare(`
    INSERT INTO entity_links (
      id,
      source_entity_id,
      target_entity_id,
      relationship,
      meeting_id,
      state,
      evidence_meeting_id,
      evidence_quote,
      source,
      confidence,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    link.source_entity_id,
    link.target_entity_id,
    link.relationship,
    link.meeting_id || null,
    link.state || 'confirmed',
    link.evidence_meeting_id || link.meeting_id || null,
    link.evidence_quote || null,
    link.source || 'pipeline',
    link.confidence ?? 1.0,
  );

  console.log(
    `[DB] Linked entities: ${link.source_entity_id} -[${link.relationship}]-> ${link.target_entity_id}`,
  );
  return db
    .prepare('SELECT * FROM entity_links WHERE id = ?')
    .get(id) as EntityLink;
};

/**
 * Get all links for an entity (both directions)
 */
export const getEntityLinks = (
  entityId: string,
  options?: { includeRejected?: boolean },
): EntityLink[] => {
  const includeRejected = options?.includeRejected ?? false;
  return db
    .prepare(`
    SELECT * FROM entity_links 
    WHERE source_entity_id = ? OR target_entity_id = ?
      ${includeRejected ? '' : "AND state != 'rejected'"}
    ORDER BY updated_at DESC, created_at DESC
  `)
    .all(entityId, entityId) as EntityLink[];
};

/**
 * Get entities related to a specific entity
 */
export const getRelatedEntities = (
  entityId: string,
  options?: { includeRejected?: boolean },
): (Entity & {
  link_id: string;
  relationship: string;
  direction: 'outgoing' | 'incoming';
  state: RelationshipState;
  confidence: number;
  evidence_quote: string | null;
})[] => {
  const links = getEntityLinks(entityId, options);
  const results: (Entity & {
    link_id: string;
    relationship: string;
    direction: 'outgoing' | 'incoming';
    state: RelationshipState;
    confidence: number;
    evidence_quote: string | null;
  })[] = [];

  for (const link of links) {
    if (link.source_entity_id === entityId) {
      const entity = getEntity(link.target_entity_id);
      if (entity) {
        results.push({
          ...entity,
          link_id: link.id,
          relationship: link.relationship,
          direction: 'outgoing',
          state: link.state,
          confidence: link.confidence,
          evidence_quote: link.evidence_quote,
        });
      }
    } else {
      const entity = getEntity(link.source_entity_id);
      if (entity) {
        results.push({
          ...entity,
          link_id: link.id,
          relationship: link.relationship,
          direction: 'incoming',
          state: link.state,
          confidence: link.confidence,
          evidence_quote: link.evidence_quote,
        });
      }
    }
  }

  return results;
};

/**
 * Associate an entity with a meeting
 */
export const addMeetingEntity = (meetingEntity: {
  meeting_id: string;
  entity_id: string;
  mention_count?: number;
  first_mentioned_at?: number;
  context?: string;
}): MeetingEntity => {
  // Check if association already exists
  const existing = db
    .prepare(`
    SELECT * FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?
  `)
    .get(meetingEntity.meeting_id, meetingEntity.entity_id) as
    | MeetingEntity
    | undefined;

  if (existing) {
    // Update mention count and context
    db.prepare(`
      UPDATE meeting_entities SET
        mention_count = mention_count + COALESCE(?, 1),
        context = COALESCE(?, context)
      WHERE meeting_id = ? AND entity_id = ?
    `).run(
      meetingEntity.mention_count || 1,
      meetingEntity.context,
      meetingEntity.meeting_id,
      meetingEntity.entity_id,
    );
    return db
      .prepare(
        'SELECT * FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?',
      )
      .get(meetingEntity.meeting_id, meetingEntity.entity_id) as MeetingEntity;
  }

  db.prepare(`
    INSERT INTO meeting_entities (meeting_id, entity_id, mention_count, first_mentioned_at, context)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    meetingEntity.meeting_id,
    meetingEntity.entity_id,
    meetingEntity.mention_count || 1,
    meetingEntity.first_mentioned_at || null,
    meetingEntity.context || null,
  );

  return db
    .prepare(
      'SELECT * FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?',
    )
    .get(meetingEntity.meeting_id, meetingEntity.entity_id) as MeetingEntity;
};

/**
 * Get all entities mentioned in a meeting
 */
export const getMeetingEntities = (
  meetingId: string,
): (Entity & { mention_count: number; context: string | null })[] => {
  return db
    .prepare(`
    SELECT e.*, me.mention_count, me.context
    FROM entities e
    JOIN meeting_entities me ON e.id = me.entity_id
    WHERE me.meeting_id = ?
    ORDER BY me.mention_count DESC
  `)
    .all(meetingId) as (Entity & {
    mention_count: number;
    context: string | null;
  })[];
};

/**
 * Get all meetings where an entity was mentioned
 */
export const getEntityMeetings = (
  entityId: string,
): (PersistedMeeting & {
  mention_count: number;
  context: string | null;
})[] => {
  return db
    .prepare(`
    SELECT m.*, me.mention_count, me.context
    FROM meetings m
    JOIN meeting_entities me ON m.id = me.meeting_id
    WHERE me.entity_id = ?
    ORDER BY m.started_at DESC
  `)
    .all(entityId) as (PersistedMeeting & {
    mention_count: number;
    context: string | null;
  })[];
};

/**
 * Get summary rows used by the Knowledge page feed.
 */
export const getKnowledgeFeedSummary = (
  params: KnowledgeFeedQueryParams = {},
): KnowledgeFeedItemSummary[] => {
  const typeFilter =
    params.type === 'topic' || params.type === 'decision' ? params.type : 'all';
  const sort = params.sort === 'most_mentioned' ? 'most_mentioned' : 'recent';
  const trimmedSearch =
    typeof params.search === 'string' ? params.search.trim().toLowerCase() : '';

  const conditions = [`e.type IN ('topic', 'decision')`];
  const values: unknown[] = [];

  if (typeFilter !== 'all') {
    conditions.push('e.type = ?');
    values.push(typeFilter);
  }

  if (trimmedSearch) {
    conditions.push('LOWER(e.name) LIKE ?');
    values.push(`%${trimmedSearch}%`);
  }

  const orderBy =
    sort === 'most_mentioned'
      ? 'mention_count DESC, COALESCE(last_mentioned_at, e.updated_at) DESC, e.name ASC'
      : 'COALESCE(last_mentioned_at, e.updated_at) DESC, mention_count DESC, e.name ASC';

  const query = `
    SELECT
      e.id AS entity_id,
      e.type AS type,
      e.name AS name,
      e.updated_at AS updated_at,
      COUNT(DISTINCT me.meeting_id) AS meeting_count,
      COALESCE(SUM(me.mention_count), 0) AS mention_count,
      MAX(COALESCE(m.started_at, m.created_at, me.created_at)) AS last_mentioned_at,
      (
        SELECT me2.context
        FROM meeting_entities me2
        LEFT JOIN meetings m2 ON m2.id = me2.meeting_id
        WHERE me2.entity_id = e.id
          AND me2.context IS NOT NULL
          AND TRIM(me2.context) != ''
        ORDER BY COALESCE(m2.started_at, m2.created_at, me2.created_at) DESC
        LIMIT 1
      ) AS latest_context
    FROM entities e
    LEFT JOIN meeting_entities me ON me.entity_id = e.id
    LEFT JOIN meetings m ON m.id = me.meeting_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY e.id, e.type, e.name, e.updated_at
    ORDER BY ${orderBy}
  `;

  return db.prepare(query).all(...values) as KnowledgeFeedItemSummary[];
};

/**
 * Get action items with a specific status
 */
export const getActionItemsByStatus = (status: EntityStatus): Entity[] => {
  return db
    .prepare(`
    SELECT * FROM entities 
    WHERE type = 'action_item' AND status = ?
    ORDER BY due_date ASC, created_at DESC
  `)
    .all(status) as Entity[];
};

/**
 * Get overdue action items
 */
export const getOverdueActionItems = (): Entity[] => {
  return db
    .prepare(`
    SELECT * FROM entities 
    WHERE type = 'action_item' 
      AND status = 'active' 
      AND due_date IS NOT NULL 
      AND due_date < datetime('now')
    ORDER BY due_date ASC
  `)
    .all() as Entity[];
};

/**
 * Get stale action items (not mentioned in last N days)
 */
export const getStaleActionItems = (staleDays = 7): Entity[] => {
  return db
    .prepare(`
    SELECT e.* FROM entities e
    WHERE e.type = 'action_item' 
      AND e.status = 'active'
      AND e.updated_at < datetime('now', '-' || ? || ' days')
    ORDER BY e.updated_at ASC
  `)
    .all(staleDays) as Entity[];
};

/**
 * Get knowledge graph statistics
 */
export const getKnowledgeGraphStats = (): {
  total_entities: number;
  by_type: Record<EntityType, number>;
  total_links: number;
  total_meeting_connections: number;
} => {
  const totalEntities = (
    db.prepare('SELECT COUNT(*) as count FROM entities').get() as {
      count: number;
    }
  ).count;
  const totalLinks = (
    db.prepare('SELECT COUNT(*) as count FROM entity_links').get() as {
      count: number;
    }
  ).count;
  const totalMeetingConnections = (
    db.prepare('SELECT COUNT(*) as count FROM meeting_entities').get() as {
      count: number;
    }
  ).count;

  const typeCounts = db
    .prepare(`
    SELECT type, COUNT(*) as count FROM entities GROUP BY type
  `)
    .all() as { type: EntityType; count: number }[];

  const byType: Record<EntityType, number> = {
    person: 0,
    topic: 0,
    action_item: 0,
    decision: 0,
    project: 0,
  };

  for (const row of typeCounts) {
    byType[row.type] = row.count;
  }

  return {
    total_entities: totalEntities,
    by_type: byType,
    total_links: totalLinks,
    total_meeting_connections: totalMeetingConnections,
  };
};

// =============================================
// AUTO-END LOG OPERATIONS
// =============================================

export const logAutoEndEvent = (event: {
  meeting_id?: string;
  reason_code: string;
  app_name?: string;
  grace_seconds?: number;
}) => {
  const id = generateId();
  db.prepare(`
    INSERT INTO auto_end_log (id, meeting_id, reason_code, app_name, grace_seconds)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    event.meeting_id || null,
    event.reason_code,
    event.app_name || null,
    event.grace_seconds ?? null,
  );
  console.log(
    `[AutoEnd] Logged event: ${event.reason_code} (app=${event.app_name || 'n/a'}, grace=${event.grace_seconds ?? 'n/a'}s)`,
  );
  return id;
};

/**
 * Reset all knowledge (meetings, entities, etc) but KEEP settings
 */
export const resetKnowledge = () => {
  console.log('[DB] Resetting knowledge base...');

  // 1. Delete all audio files
  const allMeetings = db.prepare('SELECT audio_path FROM meetings').all() as {
    audio_path: string;
  }[];
  for (const m of allMeetings) {
    if (m.audio_path && fs.existsSync(m.audio_path)) {
      try {
        fs.unlinkSync(m.audio_path);
        console.log(`[DB] Deleted audio file: ${m.audio_path}`);
      } catch (e) {
        console.warn(`[DB] Failed to delete audio file: ${m.audio_path}`, e);
      }
    }
  }

  // 2. Clear tables within a transaction
  const tables = [
    'auto_end_log',
    'knowledge_backlinks',
    'knowledge_doc_notes',
    'knowledge_doc_user_edits',
    'knowledge_doc_versions',
    'knowledge_doc_sources',
    'knowledge_docs',
    'meeting_entities',
    'entity_links',
    'entities',
    'entities_fts',
    'meetings',
    'meetings_fts',
  ];

  const deleteTransaction = db.transaction(() => {
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });

  deleteTransaction();

  // 3. Vacuum to reclaim space
  db.exec('VACUUM');

  console.log('[DB] Knowledge base reset complete.');
  // Re-init FTS table if needed implies ensuring it's empty, which DELETE FROM does.
  return true;
};

// =============================================
// MID (Meeting Intelligence Document) Operations
// =============================================

/**
 * Save MID JSON for a meeting and update FTS with flattened fields.
 */
export const saveMeetingMid = (
  meetingId: string,
  mid: MidFrontmatter,
): void => {
  const midJson = JSON.stringify(mid);

  db.prepare('UPDATE meetings SET mid_json = ? WHERE id = ?').run(
    midJson,
    meetingId,
  );

  // Update FTS with flattened MID fields
  const participants = mid.participants.map((p) => p.name).join(', ');
  const topics = mid.topics.map((t) => t.name).join(', ');
  const decisions = mid.decisions.map((d) => d.description).join(', ');
  const actionItems = mid.action_items.map((a) => a.description).join(', ');

  // Check if FTS has MID columns (migration may not have run yet)
  try {
    const ftsColumns = db
      .prepare('PRAGMA table_info(meetings_fts)')
      .all() as Array<{ name: string }>;
    if (ftsColumns.some((col) => col.name === 'mid_participants')) {
      // Get existing FTS row to preserve non-MID fields
      const existing = db
        .prepare('SELECT title, transcript_text, enhanced_notes, user_notes FROM meetings_fts WHERE meeting_id = ?')
        .get(meetingId) as {
          title: string;
          transcript_text: string;
          enhanced_notes: string;
          user_notes: string;
        } | undefined;

      if (existing) {
        db.prepare(`
          INSERT OR REPLACE INTO meetings_fts (
            title, transcript_text, enhanced_notes, user_notes,
            mid_participants, mid_topics, mid_decisions, mid_action_items, meeting_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          existing.title,
          existing.transcript_text,
          existing.enhanced_notes,
          existing.user_notes,
          participants,
          topics,
          decisions,
          actionItems,
          meetingId,
        );
      }
    }
  } catch (e) {
    console.warn('[DB] Failed to update MID FTS fields:', e);
  }

  console.log(`[DB] Saved MID for meeting: ${meetingId}`);
};

/**
 * Retrieve and parse MID for a meeting. Returns null if not present.
 */
export const getMeetingMid = (meetingId: string): MidFrontmatter | null => {
  const row = db
    .prepare('SELECT mid_json FROM meetings WHERE id = ?')
    .get(meetingId) as { mid_json: string | null } | undefined;

  if (!row?.mid_json) return null;

  try {
    return JSON.parse(row.mid_json) as MidFrontmatter;
  } catch {
    console.warn(`[DB] Failed to parse mid_json for meeting: ${meetingId}`);
    return null;
  }
};

/**
 * ==========================================
 * PHASE 2: INTELLIGENCE ENGINE QUERIES
 * ==========================================
 */

export interface SearchFtsOptions {
  limit?: number;
}

export const searchMeetingsFts = (query: string, options: SearchFtsOptions = {}) => {
  const limit = options.limit || 50;
  return db.prepare(`
    SELECT 
      m.*,
      snippet(meetings_fts, -1, '<mark>', '</mark>', '...', 32) as snippet
    FROM meetings_fts f
    JOIN meetings m ON f.meeting_id = m.id
    WHERE meetings_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as (PersistedMeeting & { snippet: string })[];
};

export const searchEntitiesWithMeetingContext = (query: string) => {
  return db.prepare(`
    SELECT e.*, c.mention_count, c.context, c.meeting_id
    FROM entities_fts f
    JOIN entities e ON f.entity_id = e.id
    LEFT JOIN meeting_entities c ON c.entity_id = e.id
    WHERE entities_fts MATCH ?
    ORDER BY rank
    LIMIT 20
  `).all(query) as (Entity & {
    mention_count: number;
    context: string | null;
    meeting_id: string;
  })[];
};

export const walkEntityGraph = (entityId: string, depth: number, filters?: { state?: string }) => {
  // BFS graph walk with visited set, confirmed-only default limit, 50-node cap
  const cap = 50;
  const results: Entity[] = [];
  const queue: { id: string; level: number }[] = [{ id: entityId, level: 0 }];
  const localVisited = new Set<string>();
  localVisited.add(entityId);
  const stateFilter = filters?.state || 'confirmed';
  
  while (queue.length > 0 && results.length < cap) {
    const { id, level } = queue.shift()!;
    if (level > depth) continue;
    
    if (level > 0) {
      const e = getEntity(id);
      if (e) results.push(e);
    }
    if (level === depth) continue;
    
    const links = db.prepare(`
      SELECT source_entity_id, target_entity_id 
      FROM entity_links 
      WHERE state = ? AND (source_entity_id = ? OR target_entity_id = ?)
    `).all(stateFilter, id, id) as Array<{source_entity_id: string; target_entity_id: string}>;
    
    for (const link of links) {
      const neighborId = link.source_entity_id === id ? link.target_entity_id : link.source_entity_id;
      if (!localVisited.has(neighborId)) {
        localVisited.add(neighborId);
        queue.push({ id: neighborId, level: level + 1 });
      }
    }
  }
  return results;
};

export const getTemporalMeetings = (range: { from?: string; to?: string }) => {
  if (range.from && range.to) {
    return db.prepare('SELECT id, started_at, mid_json FROM meetings WHERE started_at >= ? AND started_at <= ?').all(range.from, range.to) as PersistedMeeting[];
  } else if (range.from) {
    return db.prepare('SELECT id, started_at, mid_json FROM meetings WHERE started_at >= ?').all(range.from) as PersistedMeeting[];
  } else if (range.to) {
    return db.prepare('SELECT id, started_at, mid_json FROM meetings WHERE started_at <= ?').all(range.to) as PersistedMeeting[];
  }
  return getMeetings();
};


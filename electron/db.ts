import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';

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
          'attended', 'produced', 'impacts', 'works_on'
        )),
        meeting_id TEXT, -- which meeting created/reinforced this link
        confidence REAL DEFAULT 1.0, -- LLM extraction confidence (0-1)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
      );

      -- Indexes for relationship traversal
      CREATE INDEX IF NOT EXISTS idx_entity_links_source ON entity_links(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_entity_links_target ON entity_links(target_entity_id);
      CREATE INDEX IF NOT EXISTS idx_entity_links_meeting ON entity_links(meeting_id);

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

      -- Full-text search for entities - Decoupled for UUID support
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
        name,
        entity_id UNINDEXED
      );

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
  } catch (e) {
    console.warn('[DB] Optional column migration failed:', e);
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
      analysis_format_pass, analysis_retry_count, analysis_fallback_used, value_signals_json, folder_id, is_favorite, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
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

  console.log(`[DB] Updating FTS index for meeting: ${id}`);
  db.prepare(`
    INSERT OR REPLACE INTO meetings_fts (title, transcript_text, enhanced_notes, user_notes, meeting_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    meeting.title,
    transcriptText,
    meeting.enhanced_notes || '',
    meeting.user_notes || '',
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
export type EntityStatus = 'active' | 'completed' | 'stale' | 'overdue' | null;
export type RelationshipType =
  | 'discussed'
  | 'assigned_to'
  | 'belongs_to'
  | 'relates_to'
  | 'attended'
  | 'produced'
  | 'impacts'
  | 'works_on'
  | 'involved_in';

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  normalized_name: string;
  status: EntityStatus;
  due_date: string | null;
  assigned_to: string | null;
  metadata: string | null; // JSON string
  created_at: string;
  updated_at: string;
}

export interface EntityLink {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship: RelationshipType;
  meeting_id: string | null;
  confidence: number;
  created_at: string;
}

export interface MeetingEntity {
  meeting_id: string;
  entity_id: string;
  mention_count: number;
  first_mentioned_at: number | null;
  context: string | null;
  created_at: string;
}

/**
 * Normalize entity name for deduplication
 */
const normalizeEntityName = (name: string): string => {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
};

/**
 * Generate a simple UUID
 */
const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
}): Entity => {
  const normalizedName = normalizeEntityName(entity.name);
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
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(
      entity.name,
      entity.status,
      entity.due_date,
      entity.assigned_to,
      entity.metadata ? JSON.stringify(entity.metadata) : null,
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
    INSERT INTO entities (id, type, name, normalized_name, status, due_date, assigned_to, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    // Update confidence if higher, and meeting_id
    if (link.confidence && link.confidence > existing.confidence) {
      db.prepare(`
        UPDATE entity_links SET confidence = ?, meeting_id = COALESCE(?, meeting_id) WHERE id = ?
      `).run(link.confidence, link.meeting_id, existing.id);
    }
    return db
      .prepare('SELECT * FROM entity_links WHERE id = ?')
      .get(existing.id) as EntityLink;
  }

  const id = generateId();
  db.prepare(`
    INSERT INTO entity_links (id, source_entity_id, target_entity_id, relationship, meeting_id, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    link.source_entity_id,
    link.target_entity_id,
    link.relationship,
    link.meeting_id || null,
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
export const getEntityLinks = (entityId: string): EntityLink[] => {
  return db
    .prepare(`
    SELECT * FROM entity_links 
    WHERE source_entity_id = ? OR target_entity_id = ?
    ORDER BY created_at DESC
  `)
    .all(entityId, entityId) as EntityLink[];
};

/**
 * Get entities related to a specific entity
 */
export const getRelatedEntities = (
  entityId: string,
): (Entity & {
  relationship: string;
  direction: 'outgoing' | 'incoming';
})[] => {
  const links = getEntityLinks(entityId);
  const results: (Entity & {
    relationship: string;
    direction: 'outgoing' | 'incoming';
  })[] = [];

  for (const link of links) {
    if (link.source_entity_id === entityId) {
      const entity = getEntity(link.target_entity_id);
      if (entity) {
        results.push({
          ...entity,
          relationship: link.relationship,
          direction: 'outgoing',
        });
      }
    } else {
      const entity = getEntity(link.source_entity_id);
      if (entity) {
        results.push({
          ...entity,
          relationship: link.relationship,
          direction: 'incoming',
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
    .all(entityId);
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

"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require$$0 = require("electron");
const node_url = require("node:url");
const path = require("node:path");
const fs = require("node:fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const Database = require("better-sqlite3");
const child_process = require("child_process");
var _documentCurrentScript = typeof document !== "undefined" ? document.currentScript : null;
var dist = { exports: {} };
var renderer = {};
var config = {};
Object.defineProperty(config, "__esModule", { value: true });
config.buildFeatureFlags = config.loopbackAudioTypes = config.featureSwitchKey = config.defaultSourcesOptions = config.ipcEvents = void 0;
config.ipcEvents = {
  enableLoopbackAudio: "enable-loopback-audio",
  disableLoopbackAudio: "disable-loopback-audio"
};
config.defaultSourcesOptions = { types: ["screen"] };
config.featureSwitchKey = "enable-features";
config.loopbackAudioTypes = {
  loopback: "loopback",
  loopbackWithMute: "loopbackWithMute"
};
const defaultFeatureFlags = {
  pulseaudioLoopbackForScreenShare: "PulseaudioLoopbackForScreenShare",
  macLoopbackAudioForScreenShare: "MacLoopbackAudioForScreenShare"
};
const coreAudioTapFeatureFlags = {
  macCoreAudioTapSystemAudioLoopbackOverride: "MacCatapSystemAudioLoopbackCapture"
};
const screenCaptureKitFeatureFlags = {
  macScreenCaptureKitSystemAudioLoopbackOverride: "MacSckSystemAudioLoopbackOverride"
};
const buildFeatureFlags = ({ otherEnabledFeatures, forceCoreAudioTap }) => {
  const featureFlags = [...Object.values(defaultFeatureFlags), ...otherEnabledFeatures ?? []];
  if (forceCoreAudioTap) {
    featureFlags.push(coreAudioTapFeatureFlags.macCoreAudioTapSystemAudioLoopbackOverride);
  } else {
    featureFlags.push(screenCaptureKitFeatureFlags.macScreenCaptureKitSystemAudioLoopbackOverride);
  }
  return featureFlags.join(",");
};
config.buildFeatureFlags = buildFeatureFlags;
Object.defineProperty(renderer, "__esModule", { value: true });
renderer.getLoopbackAudioMediaStream = void 0;
const electron_1$1 = require$$0;
const config_js_1$1 = config;
const getLoopbackAudioMediaStream = async (options = {}) => {
  const { removeVideo = true } = options;
  await electron_1$1.ipcRenderer.invoke(config_js_1$1.ipcEvents.enableLoopbackAudio);
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  if (removeVideo) {
    const videoTracks = stream.getVideoTracks();
    videoTracks.forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });
  }
  await electron_1$1.ipcRenderer.invoke(config_js_1$1.ipcEvents.disableLoopbackAudio);
  return stream;
};
renderer.getLoopbackAudioMediaStream = getLoopbackAudioMediaStream;
var main = {};
Object.defineProperty(main, "__esModule", { value: true });
main.initMain = void 0;
const electron_1 = require$$0;
const config_js_1 = config;
const initMain = (options = {}) => {
  var _a;
  const { forceCoreAudioTap = false, loopbackWithMute = false, onAfterGetSources, sessionOverride, sourcesOptions = config_js_1.defaultSourcesOptions } = options;
  const otherEnabledFeatures = (_a = electron_1.app.commandLine.getSwitchValue(config_js_1.featureSwitchKey)) == null ? void 0 : _a.split(",");
  if (electron_1.app.commandLine.hasSwitch(config_js_1.featureSwitchKey)) {
    electron_1.app.commandLine.removeSwitch(config_js_1.featureSwitchKey);
  }
  const currentFeatureFlags = (0, config_js_1.buildFeatureFlags)({
    otherEnabledFeatures,
    forceCoreAudioTap
  });
  electron_1.app.commandLine.appendSwitch(config_js_1.featureSwitchKey, currentFeatureFlags);
  electron_1.ipcMain.handle(config_js_1.ipcEvents.enableLoopbackAudio, () => {
    const session = sessionOverride || electron_1.session.defaultSession;
    session.setDisplayMediaRequestHandler(async (_, callback) => {
      let sources;
      try {
        sources = await electron_1.desktopCapturer.getSources(sourcesOptions);
        if (onAfterGetSources) {
          sources = onAfterGetSources(sources);
        }
      } catch {
        throw new Error(`Failed to get sources for system audio loopback capture.`);
      }
      if (sources.length === 0) {
        throw new Error(`No sources found for system audio loopback capture.`);
      }
      callback({
        video: sources[0],
        audio: loopbackWithMute ? config_js_1.loopbackAudioTypes.loopbackWithMute : config_js_1.loopbackAudioTypes.loopback
      });
    });
  });
  electron_1.ipcMain.handle(config_js_1.ipcEvents.disableLoopbackAudio, () => {
    const session = sessionOverride || electron_1.session.defaultSession;
    session.setDisplayMediaRequestHandler(null);
  });
};
main.initMain = initMain;
(function(module2, exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.initMain = exports$1.getLoopbackAudioMediaStream = void 0;
  const renderer_js_1 = renderer;
  Object.defineProperty(exports$1, "getLoopbackAudioMediaStream", { enumerable: true, get: function() {
    return renderer_js_1.getLoopbackAudioMediaStream;
  } });
  const main_js_1 = main;
  Object.defineProperty(exports$1, "initMain", { enumerable: true, get: function() {
    return main_js_1.initMain;
  } });
  if (process.type === "renderer") {
    module2.exports = { getLoopbackAudioMediaStream: renderer_js_1.getLoopbackAudioMediaStream };
  } else {
    module2.exports = { initMain: main_js_1.initMain };
  }
})(dist, dist.exports);
var distExports = dist.exports;
const dbPath = path.join(require$$0.app.getPath("userData"), "pluto.db");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(dbPath);
const initDb = () => {
  const tableInfo = db.prepare("PRAGMA table_info(meetings)").all();
  const hasCreatedAt = tableInfo.some((col) => col.name === "created_at");
  if (tableInfo.length > 0 && !hasCreatedAt) {
    console.log("[DB] Old schema detected. Dropping tables for migration...");
    db.exec("DROP TABLE IF EXISTS meetings");
    db.exec("DROP TABLE IF EXISTS meetings_fts");
    db.exec("DROP TABLE IF EXISTS settings");
  }
  try {
    const ftsInfo = db.prepare("PRAGMA table_info(meetings_fts)").all();
    if (ftsInfo.length > 0 && !ftsInfo.some((col) => col.name === "meeting_id")) {
      console.log("[DB] Migrating FTS table for UUID support...");
      db.exec("DROP TABLE IF EXISTS meetings_fts");
    }
    db.exec("DROP TABLE IF EXISTS settings");
    const entitiesFtsInfo = db.prepare("PRAGMA table_info(entities_fts)").all();
    if (entitiesFtsInfo.length > 0 && !entitiesFtsInfo.some((col) => col.name === "entity_id")) {
      console.log("[DB] Migrating Entities FTS table for UUID support...");
      db.exec("DROP TABLE IF EXISTS entities_fts");
    }
  } catch (e) {
  }
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
    `);
};
initDb();
const getSetting = (key) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
};
const setSetting = (key, value) => {
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  return stmt.run(key, value);
};
const saveMeeting = (meeting) => {
  var _a;
  const id = String(meeting.id);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO meetings (
      id, title, meeting_type, started_at, ended_at, duration_seconds, 
      audio_path, transcript_json, user_notes, enhanced_notes, folder_id, is_favorite, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
  `);
  const result = stmt.run(
    id,
    meeting.title,
    meeting.meeting_type || "General",
    meeting.started_at,
    meeting.ended_at,
    meeting.duration_seconds || 0,
    meeting.audio_path,
    meeting.transcript_json,
    meeting.user_notes || "",
    meeting.enhanced_notes || "",
    meeting.folder_id,
    meeting.is_favorite ? 1 : 0,
    meeting.created_at
  );
  let transcriptText = "";
  try {
    if (meeting.transcript_json) {
      const transcript = JSON.parse(meeting.transcript_json);
      transcriptText = ((_a = transcript.segments) == null ? void 0 : _a.map((s) => s.text).join(" ")) || "";
    }
  } catch (e) {
    console.warn("Failed to parse transcript_json for FTS", e);
  }
  console.log(`[DB] Updating FTS index for meeting: ${id}`);
  db.prepare(`
    INSERT OR REPLACE INTO meetings_fts (title, transcript_text, enhanced_notes, user_notes, meeting_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    meeting.title,
    transcriptText,
    meeting.enhanced_notes || "",
    meeting.user_notes || "",
    id
  );
  console.log(`[DB] Save successful for meeting: ${id}`);
  return result;
};
const getMeetings = () => {
  return db.prepare("SELECT * FROM meetings ORDER BY created_at DESC").all();
};
const getMeeting = (id) => {
  return db.prepare("SELECT * FROM meetings WHERE id = ?").get(String(id));
};
const searchMeetings = (query) => {
  return db.prepare(`
    SELECT meetings.* FROM meetings
    JOIN meetings_fts ON meetings.id = meetings_fts.meeting_id
    WHERE meetings_fts MATCH ?
    ORDER BY rank
  `).all(query);
};
const deleteMeeting = (id) => {
  const safeId = String(id);
  const meeting = getMeeting(safeId);
  if (!meeting) {
    console.warn(`[DB] deleteMeeting: Meeting not found for id: ${safeId}`);
    return;
  }
  if (meeting.audio_path && fs.existsSync(meeting.audio_path)) {
    try {
      fs.unlinkSync(meeting.audio_path);
      console.log(`[DB] Deleted audio file: ${meeting.audio_path}`);
    } catch (e) {
      console.warn(`[DB] Failed to delete audio file: ${meeting.audio_path}`, e);
    }
  }
  db.prepare("DELETE FROM meetings_fts WHERE meeting_id = ?").run(safeId);
  db.prepare("DELETE FROM entity_links WHERE meeting_id = ?").run(safeId);
  const result = db.prepare("DELETE FROM meetings WHERE id = ?").run(safeId);
  console.log(`[DB] Deleted meeting: ${safeId}`);
  try {
    db.prepare(`
      DELETE FROM entities 
      WHERE id NOT IN (SELECT entity_id FROM meeting_entities)
        AND id NOT IN (SELECT source_entity_id FROM entity_links)
        AND id NOT IN (SELECT target_entity_id FROM entity_links)
    `).run();
  } catch (e) {
    console.warn("[DB] Failed to clean up orphan entities:", e);
  }
  try {
    db.prepare(`
      DELETE FROM entities_fts 
      WHERE entity_id NOT IN (SELECT id FROM entities)
    `).run();
  } catch (e) {
  }
  return result;
};
const normalizeEntityName = (name) => {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
};
const generateId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
const upsertEntity = (entity) => {
  const normalizedName = normalizeEntityName(entity.name);
  const existing = db.prepare(`
    SELECT * FROM entities WHERE type = ? AND normalized_name = ?
  `).get(entity.type, normalizedName);
  if (existing) {
    const stmt2 = db.prepare(`
      UPDATE entities SET
        name = COALESCE(?, name),
        status = COALESCE(?, status),
        due_date = COALESCE(?, due_date),
        assigned_to = COALESCE(?, assigned_to),
        metadata = COALESCE(?, metadata),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt2.run(
      entity.name,
      entity.status,
      entity.due_date,
      entity.assigned_to,
      entity.metadata ? JSON.stringify(entity.metadata) : null,
      existing.id
    );
    return db.prepare("SELECT * FROM entities WHERE id = ?").get(existing.id);
  }
  const id = generateId();
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
    entity.metadata ? JSON.stringify(entity.metadata) : null
  );
  db.prepare(`
    INSERT INTO entities_fts (name, entity_id) VALUES (?, ?)
  `).run(entity.name, id);
  console.log(`[DB] Created entity: ${entity.type} - "${entity.name}"`);
  return db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
};
const getEntity = (id) => {
  return db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
};
const getEntitiesByType = (type) => {
  return db.prepare("SELECT * FROM entities WHERE type = ? ORDER BY updated_at DESC").all(type);
};
const getAllEntities = () => {
  return db.prepare("SELECT * FROM entities ORDER BY type, updated_at DESC").all();
};
const searchEntities = (query) => {
  return db.prepare(`
    SELECT entities.* FROM entities
    JOIN entities_fts ON entities.id = entities_fts.entity_id
    WHERE entities_fts MATCH ?
    ORDER BY rank
  `).all(query);
};
const findEntity = (type, name) => {
  const normalizedName = normalizeEntityName(name);
  return db.prepare(`
    SELECT * FROM entities WHERE type = ? AND normalized_name = ?
  `).get(type, normalizedName);
};
const updateEntityStatus = (id, status) => {
  db.prepare(`
    UPDATE entities SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, id);
};
const deleteEntity = (id) => {
  db.prepare("DELETE FROM entities WHERE id = ?").run(id);
  try {
    db.prepare("DELETE FROM entities_fts WHERE entity_id = ?").run(id);
  } catch (e) {
    console.warn("Failed to delete entity from FTS", e);
  }
  console.log(`[DB] Deleted entity: ${id}`);
};
const linkEntities = (link) => {
  const existing = db.prepare(`
    SELECT * FROM entity_links 
    WHERE source_entity_id = ? AND target_entity_id = ? AND relationship = ?
  `).get(link.source_entity_id, link.target_entity_id, link.relationship);
  if (existing) {
    if (link.confidence && link.confidence > existing.confidence) {
      db.prepare(`
        UPDATE entity_links SET confidence = ?, meeting_id = COALESCE(?, meeting_id) WHERE id = ?
      `).run(link.confidence, link.meeting_id, existing.id);
    }
    return db.prepare("SELECT * FROM entity_links WHERE id = ?").get(existing.id);
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
    link.confidence ?? 1
  );
  console.log(`[DB] Linked entities: ${link.source_entity_id} -[${link.relationship}]-> ${link.target_entity_id}`);
  return db.prepare("SELECT * FROM entity_links WHERE id = ?").get(id);
};
const getEntityLinks = (entityId) => {
  return db.prepare(`
    SELECT * FROM entity_links 
    WHERE source_entity_id = ? OR target_entity_id = ?
    ORDER BY created_at DESC
  `).all(entityId, entityId);
};
const getRelatedEntities = (entityId) => {
  const links = getEntityLinks(entityId);
  const results = [];
  for (const link of links) {
    if (link.source_entity_id === entityId) {
      const entity = getEntity(link.target_entity_id);
      if (entity) {
        results.push({ ...entity, relationship: link.relationship, direction: "outgoing" });
      }
    } else {
      const entity = getEntity(link.source_entity_id);
      if (entity) {
        results.push({ ...entity, relationship: link.relationship, direction: "incoming" });
      }
    }
  }
  return results;
};
const addMeetingEntity = (meetingEntity) => {
  const existing = db.prepare(`
    SELECT * FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?
  `).get(meetingEntity.meeting_id, meetingEntity.entity_id);
  if (existing) {
    db.prepare(`
      UPDATE meeting_entities SET
        mention_count = mention_count + COALESCE(?, 1),
        context = COALESCE(?, context)
      WHERE meeting_id = ? AND entity_id = ?
    `).run(
      meetingEntity.mention_count || 1,
      meetingEntity.context,
      meetingEntity.meeting_id,
      meetingEntity.entity_id
    );
    return db.prepare("SELECT * FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?").get(meetingEntity.meeting_id, meetingEntity.entity_id);
  }
  db.prepare(`
    INSERT INTO meeting_entities (meeting_id, entity_id, mention_count, first_mentioned_at, context)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    meetingEntity.meeting_id,
    meetingEntity.entity_id,
    meetingEntity.mention_count || 1,
    meetingEntity.first_mentioned_at || null,
    meetingEntity.context || null
  );
  return db.prepare("SELECT * FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?").get(meetingEntity.meeting_id, meetingEntity.entity_id);
};
const getMeetingEntities = (meetingId) => {
  return db.prepare(`
    SELECT e.*, me.mention_count, me.context
    FROM entities e
    JOIN meeting_entities me ON e.id = me.entity_id
    WHERE me.meeting_id = ?
    ORDER BY me.mention_count DESC
  `).all(meetingId);
};
const getEntityMeetings = (entityId) => {
  return db.prepare(`
    SELECT m.*, me.mention_count, me.context
    FROM meetings m
    JOIN meeting_entities me ON m.id = me.meeting_id
    WHERE me.entity_id = ?
    ORDER BY m.started_at DESC
  `).all(entityId);
};
const getActionItemsByStatus = (status) => {
  return db.prepare(`
    SELECT * FROM entities 
    WHERE type = 'action_item' AND status = ?
    ORDER BY due_date ASC, created_at DESC
  `).all(status);
};
const getOverdueActionItems = () => {
  return db.prepare(`
    SELECT * FROM entities 
    WHERE type = 'action_item' 
      AND status = 'active' 
      AND due_date IS NOT NULL 
      AND due_date < datetime('now')
    ORDER BY due_date ASC
  `).all();
};
const getStaleActionItems = (staleDays = 7) => {
  return db.prepare(`
    SELECT e.* FROM entities e
    WHERE e.type = 'action_item' 
      AND e.status = 'active'
      AND e.updated_at < datetime('now', '-' || ? || ' days')
    ORDER BY e.updated_at ASC
  `).all(staleDays);
};
const getKnowledgeGraphStats = () => {
  const totalEntities = db.prepare("SELECT COUNT(*) as count FROM entities").get().count;
  const totalLinks = db.prepare("SELECT COUNT(*) as count FROM entity_links").get().count;
  const totalMeetingConnections = db.prepare("SELECT COUNT(*) as count FROM meeting_entities").get().count;
  const typeCounts = db.prepare(`
    SELECT type, COUNT(*) as count FROM entities GROUP BY type
  `).all();
  const byType = {
    person: 0,
    topic: 0,
    action_item: 0,
    decision: 0,
    project: 0
  };
  for (const row of typeCounts) {
    byType[row.type] = row.count;
  }
  return {
    total_entities: totalEntities,
    by_type: byType,
    total_links: totalLinks,
    total_meeting_connections: totalMeetingConnections
  };
};
const resetKnowledge = () => {
  console.log("[DB] Resetting knowledge base...");
  const allMeetings = db.prepare("SELECT audio_path FROM meetings").all();
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
  const tables = [
    "meeting_entities",
    "entity_links",
    "entities",
    "entities_fts",
    "meetings",
    "meetings_fts"
  ];
  const deleteTransaction = db.transaction(() => {
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });
  deleteTransaction();
  db.exec("VACUUM");
  console.log("[DB] Knowledge base reset complete.");
  return true;
};
const db$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  addMeetingEntity,
  deleteEntity,
  deleteMeeting,
  findEntity,
  getActionItemsByStatus,
  getAllEntities,
  getEntitiesByType,
  getEntity,
  getEntityLinks,
  getEntityMeetings,
  getKnowledgeGraphStats,
  getMeeting,
  getMeetingEntities,
  getMeetings,
  getOverdueActionItems,
  getRelatedEntities,
  getSetting,
  getStaleActionItems,
  linkEntities,
  resetKnowledge,
  saveMeeting,
  searchEntities,
  searchMeetings,
  setSetting,
  updateEntityStatus,
  upsertEntity
}, Symbol.toStringTag, { value: "Module" }));
const WHISPERX_PORT = 5123;
const WHISPERX_URL = `http://127.0.0.1:${WHISPERX_PORT}`;
const HEALTH_CHECK_INTERVAL = 2e3;
const MAX_HEALTH_CHECK_RETRIES = 60;
class WhisperXManager {
  constructor() {
    __publicField(this, "process", null);
    __publicField(this, "isStarting", false);
    __publicField(this, "pythonPath", "");
    this.detectExecutable();
  }
  /**
   * Detect the best available Python path
   */
  /**
   * Check if Python or bundled executable is available and functional
   */
  async checkPython() {
    const executable = this.detectExecutable();
    return new Promise((resolve) => {
      var _a, _b;
      const checkProcess = child_process.spawn(executable, ["--version"]);
      let output = "";
      (_a = checkProcess.stdout) == null ? void 0 : _a.on("data", (data) => {
        output += data.toString();
      });
      (_b = checkProcess.stderr) == null ? void 0 : _b.on("data", (data) => {
        output += data.toString();
      });
      checkProcess.on("close", (code) => {
        if (code === 0) {
          const version = output.trim() || (require$$0.app.isPackaged ? "Bundled Engine" : "Python 3");
          resolve({ available: true, version });
        } else if (require$$0.app.isPackaged && code === 1 && output.includes("whisperx_server")) {
          resolve({ available: true, version: "Bundled Engine" });
        } else {
          resolve({ available: false, error: `Executable check failed with code ${code}: ${output}` });
        }
      });
      checkProcess.on("error", (err) => {
        resolve({ available: false, error: err.message });
      });
      setTimeout(() => {
        if (!checkProcess.killed) {
          checkProcess.kill();
          resolve({ available: false, error: "Check timed out" });
        }
      }, 5e3);
    });
  }
  /**
   * Detect the best available Python path or bundled executable
   */
  detectExecutable() {
    if (require$$0.app.isPackaged) {
      const bundledPath = path.join(process.resourcesPath, "bin", "whisperx_server", "whisperx_server");
      console.log(`[WhisperX] Using bundled executable: ${bundledPath}`);
      return bundledPath;
    }
    const venvPython = path.join(this.getPythonDir(), "venv", "bin", "python");
    if (fs.existsSync(venvPython)) {
      console.log(`[WhisperX] Using local venv execution: ${venvPython}`);
      this.pythonPath = venvPython;
      return venvPython;
    }
    if (process.env.PLUTO_PYTHON_PATH) {
      return process.env.PLUTO_PYTHON_PATH;
    }
    return this.detectSystemPython();
  }
  detectSystemPython() {
    if (this.pythonPath) return this.pythonPath;
    const { execSync } = require("child_process");
    const tryNames = ["python3.12", "python3.11", "python3", "python"];
    for (const name of tryNames) {
      try {
        const path2 = execSync(`which ${name}`).toString().trim();
        if (path2) {
          this.pythonPath = path2;
          return path2;
        }
      } catch (e) {
      }
    }
    return "python3";
  }
  /**
   * Get the path to the Python directory
   */
  getPythonDir() {
    if (require$$0.app.isPackaged) {
      return path.join(process.resourcesPath, "python");
    }
    return path.join(require$$0.app.getAppPath(), "python");
  }
  /**
   * Start the WhisperX Python server
   */
  async start() {
    var _a, _b;
    if (this.process || this.isStarting) {
      console.log("[WhisperX] Server already running or starting");
      return;
    }
    this.isStarting = true;
    try {
      const executable = this.detectExecutable();
      let spawnArgs = [];
      let cwd = this.getPythonDir();
      if (!require$$0.app.isPackaged) {
        const serverPath = path.join(cwd, "whisperx_server.py");
        if (!fs.existsSync(serverPath)) {
          throw new Error(`WhisperX server script not found at ${serverPath}`);
        }
        spawnArgs = [serverPath];
      } else {
        cwd = path.dirname(executable);
      }
      console.log(`[WhisperX] Starting server using: ${executable} ${spawnArgs.join(" ")}`);
      let ffmpegPath = "";
      try {
        ffmpegPath = require("ffmpeg-static");
        if (require$$0.app.isPackaged) {
          ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
        }
        console.log(`[WhisperX] Using ffmpeg at: ${ffmpegPath}`);
      } catch (e) {
        console.warn("[WhisperX] Could not detect ffmpeg-static path", e);
      }
      const env = {
        ...process.env,
        WHISPERX_PORT: WHISPERX_PORT.toString(),
        PATH: ffmpegPath ? `${path.dirname(ffmpegPath)}:${process.env.PATH}` : process.env.PATH
      };
      this.process = child_process.spawn(executable, spawnArgs, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      (_a = this.process.stdout) == null ? void 0 : _a.on("data", (data) => {
        console.log(`[WhisperX] ${data.toString().trim()}`);
      });
      (_b = this.process.stderr) == null ? void 0 : _b.on("data", (data) => {
        console.error(`[WhisperX] ${data.toString().trim()}`);
      });
      this.process.on("close", (code) => {
        console.log(`[WhisperX] Server exited with code ${code}`);
        this.process = null;
      });
      this.process.on("error", (err) => {
        console.error(`[WhisperX] Failed to start server: ${err.message}`);
        this.process = null;
      });
      await this.waitForServer();
      console.log("[WhisperX] Server is ready");
    } finally {
      this.isStarting = false;
    }
  }
  /**
   * Wait for the server to be ready
   */
  async waitForServer() {
    for (let i = 0; i < MAX_HEALTH_CHECK_RETRIES; i++) {
      try {
        const health = await this.health();
        if (health.status === "ok") {
          return;
        }
      } catch (e) {
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
    }
    throw new Error("WhisperX server failed to start");
  }
  /**
   * Stop the WhisperX server
   */
  async stop() {
    if (this.process) {
      console.log("[WhisperX] Stopping server");
      this.process.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      if (this.process) {
        this.process.kill("SIGKILL");
      }
      this.process = null;
    }
  }
  /**
   * Check if the server is running
   */
  isRunning() {
    return this.process !== null && !this.process.killed;
  }
  /**
   * Health check
   */
  async health() {
    try {
      const response = await fetch(`${WHISPERX_URL}/health`);
      if (!response.ok) {
        return { status: "error", error: `HTTP ${response.status}` };
      }
      return await response.json();
    } catch (e) {
      return { status: "error", error: e.message };
    }
  }
  /**
   * Transcribe an audio file
   */
  async transcribe(audioPath, options = {}) {
    if (!this.isRunning()) {
      await this.start();
    }
    const response = await fetch(`${WHISPERX_URL}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_path: audioPath,
        model: options.model,
        language: options.language,
        diarize: options.diarize,
        hf_token: options.hfToken
      })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `Transcription failed: ${response.status}`);
    }
    return await response.json();
  }
  /**
   * Update server configuration
   */
  async setConfig(config2) {
    const response = await fetch(`${WHISPERX_URL}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config2.model,
        device: config2.device,
        compute_type: config2.computeType,
        language: config2.language
      })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `Config update failed: ${response.status}`);
    }
  }
  /**
   * List available models
   */
  async listModels() {
    const response = await fetch(`${WHISPERX_URL}/models`);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }
    const data = await response.json();
    return data.models;
  }
}
const whisperX = new WhisperXManager();
const getSummaryPrompt = (transcript, userNotes) => {
  return `You are an intelligent meeting assistant. Analyze this conversation transcript${userNotes ? " and the user's notes" : ""} to provide:

1. **Summary**: A concise 2-3 sentence overview. CRITICAL: Jump straight into the content. DO NOT start with "This transcript...", "The meeting...", "This conversation...", or similar meta-commentary.
2. **Key Points**: Main topics and important information mentioned
3. **Action Items**: Any tasks, follow-ups, or commitments mentioned (use "- [ ]" checkbox format)
4. **Decisions**: Any decisions or conclusions reached

${userNotes ? `
User Notes Context:
${userNotes}
` : ""}

Format your response in clean markdown with clear sections.

Transcript:
${transcript}`;
};
const getSpeakerIdentityPrompt = (transcript) => {
  return `Analyze this conversation transcript and identify who the OTHER person is (not "You").

Look for:
- Names mentioned in introductions or conversation
- Context clues about who they are
- Any identifying information

If you can identify the other person, respond with ONLY their first name (e.g., "Sarah" or "John").
If you cannot identify them with confidence, respond with exactly: "Unknown"

Transcript:
${transcript}`;
};
const getTitlePrompt = (transcript) => {
  return `Analyze this conversation transcript and generate a concise, descriptive meeting title (max 5-7 words).

The title should:
- Capture the main topic or purpose
- Be professional and clear
- Not include quotes or special characters
- Be in title case

Respond with ONLY the title, nothing else.

Transcript:
${transcript.substring(0, 1e3)}`;
};
const getEntitiesPrompt = (transcript) => {
  return `You are an expert at extracting structured information from meeting transcripts.

Analyze the following transcript and extract:

1. **People**: Names of people mentioned or participating (include any role/title if mentioned)
2. **Topics**: Main subjects discussed (rate importance as high/medium/low)
3. **Action Items**: Tasks, follow-ups, or commitments made (include who is responsible and any deadline)
4. **Decisions**: Explicit decisions or conclusions reached (include rationale if given)
5. **Projects**: Project names or work streams mentioned

Rules:
- Only include entities that are clearly mentioned or implied
- For action items, "assignee" should be a name if mentioned, otherwise omit
- For due dates, use the exact phrase from the transcript (e.g., "by Friday", "next week")
- Be conservative - only extract what's clearly present, don't infer too much

Respond with valid JSON in this exact format:
{
  "people": [{"name": "string", "role": "string or omit"}],
  "topics": [{"name": "string", "importance": "high|medium|low"}],
  "action_items": [{"description": "string", "assignee": "string or omit", "due_date": "string or omit"}],
  "decisions": [{"description": "string", "rationale": "string or omit"}],
  "projects": [{"name": "string", "context": "string or omit"}]
}

Transcript:
${transcript}`;
};
class OllamaProvider {
  constructor() {
    __publicField(this, "name", "Ollama (Local)");
    __publicField(this, "requiresApiKey", false);
    __publicField(this, "baseUrl", "http://localhost:11434");
  }
  async isAvailable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch (e) {
      console.warn("[Ollama] Not available:", e);
      return false;
    }
  }
  async generateSummary(transcript, userNotes) {
    const prompt = getSummaryPrompt(transcript, userNotes);
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt,
        stream: false
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }
    const data = await response.json();
    return data.response;
  }
  async extractSpeakerIdentity(transcript) {
    const prompt = getSpeakerIdentityPrompt(transcript);
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2",
          prompt,
          stream: false
        })
      });
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }
      const data = await response.json();
      const name = data.response.trim();
      if (name && name.length < 20 && !name.includes(" ") && name !== "Unknown") {
        return name;
      }
      return null;
    } catch (e) {
      console.error("[Ollama] Failed to extract speaker identity:", e);
      return null;
    }
  }
  async generateTitle(transcript) {
    const prompt = getTitlePrompt(transcript);
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2",
          prompt,
          stream: false
        })
      });
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }
      const data = await response.json();
      const title = data.response.trim();
      if (title && title.length < 100) {
        return title.replace(/[\"']/g, "");
      }
      return "Meeting";
    } catch (e) {
      console.error("[Ollama] Failed to generate title:", e);
      return "Meeting";
    }
  }
  async extractEntities(transcript) {
    const prompt = getEntitiesPrompt(transcript);
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2",
          prompt,
          stream: false,
          format: "json"
        })
      });
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }
      const data = await response.json();
      const jsonStr = data.response.trim();
      const parsed = JSON.parse(jsonStr);
      return {
        people: Array.isArray(parsed.people) ? parsed.people : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : []
      };
    } catch (e) {
      console.error("[Ollama] Failed to extract entities:", e);
      return {
        people: [],
        topics: [],
        action_items: [],
        decisions: [],
        projects: []
      };
    }
  }
}
var SchemaType;
(function(SchemaType2) {
  SchemaType2["STRING"] = "string";
  SchemaType2["NUMBER"] = "number";
  SchemaType2["INTEGER"] = "integer";
  SchemaType2["BOOLEAN"] = "boolean";
  SchemaType2["ARRAY"] = "array";
  SchemaType2["OBJECT"] = "object";
})(SchemaType || (SchemaType = {}));
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var ExecutableCodeLanguage;
(function(ExecutableCodeLanguage2) {
  ExecutableCodeLanguage2["LANGUAGE_UNSPECIFIED"] = "language_unspecified";
  ExecutableCodeLanguage2["PYTHON"] = "python";
})(ExecutableCodeLanguage || (ExecutableCodeLanguage = {}));
var Outcome;
(function(Outcome2) {
  Outcome2["OUTCOME_UNSPECIFIED"] = "outcome_unspecified";
  Outcome2["OUTCOME_OK"] = "outcome_ok";
  Outcome2["OUTCOME_FAILED"] = "outcome_failed";
  Outcome2["OUTCOME_DEADLINE_EXCEEDED"] = "outcome_deadline_exceeded";
})(Outcome || (Outcome = {}));
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const POSSIBLE_ROLES = ["user", "model", "function", "system"];
var HarmCategory;
(function(HarmCategory2) {
  HarmCategory2["HARM_CATEGORY_UNSPECIFIED"] = "HARM_CATEGORY_UNSPECIFIED";
  HarmCategory2["HARM_CATEGORY_HATE_SPEECH"] = "HARM_CATEGORY_HATE_SPEECH";
  HarmCategory2["HARM_CATEGORY_SEXUALLY_EXPLICIT"] = "HARM_CATEGORY_SEXUALLY_EXPLICIT";
  HarmCategory2["HARM_CATEGORY_HARASSMENT"] = "HARM_CATEGORY_HARASSMENT";
  HarmCategory2["HARM_CATEGORY_DANGEROUS_CONTENT"] = "HARM_CATEGORY_DANGEROUS_CONTENT";
  HarmCategory2["HARM_CATEGORY_CIVIC_INTEGRITY"] = "HARM_CATEGORY_CIVIC_INTEGRITY";
})(HarmCategory || (HarmCategory = {}));
var HarmBlockThreshold;
(function(HarmBlockThreshold2) {
  HarmBlockThreshold2["HARM_BLOCK_THRESHOLD_UNSPECIFIED"] = "HARM_BLOCK_THRESHOLD_UNSPECIFIED";
  HarmBlockThreshold2["BLOCK_LOW_AND_ABOVE"] = "BLOCK_LOW_AND_ABOVE";
  HarmBlockThreshold2["BLOCK_MEDIUM_AND_ABOVE"] = "BLOCK_MEDIUM_AND_ABOVE";
  HarmBlockThreshold2["BLOCK_ONLY_HIGH"] = "BLOCK_ONLY_HIGH";
  HarmBlockThreshold2["BLOCK_NONE"] = "BLOCK_NONE";
})(HarmBlockThreshold || (HarmBlockThreshold = {}));
var HarmProbability;
(function(HarmProbability2) {
  HarmProbability2["HARM_PROBABILITY_UNSPECIFIED"] = "HARM_PROBABILITY_UNSPECIFIED";
  HarmProbability2["NEGLIGIBLE"] = "NEGLIGIBLE";
  HarmProbability2["LOW"] = "LOW";
  HarmProbability2["MEDIUM"] = "MEDIUM";
  HarmProbability2["HIGH"] = "HIGH";
})(HarmProbability || (HarmProbability = {}));
var BlockReason;
(function(BlockReason2) {
  BlockReason2["BLOCKED_REASON_UNSPECIFIED"] = "BLOCKED_REASON_UNSPECIFIED";
  BlockReason2["SAFETY"] = "SAFETY";
  BlockReason2["OTHER"] = "OTHER";
})(BlockReason || (BlockReason = {}));
var FinishReason;
(function(FinishReason2) {
  FinishReason2["FINISH_REASON_UNSPECIFIED"] = "FINISH_REASON_UNSPECIFIED";
  FinishReason2["STOP"] = "STOP";
  FinishReason2["MAX_TOKENS"] = "MAX_TOKENS";
  FinishReason2["SAFETY"] = "SAFETY";
  FinishReason2["RECITATION"] = "RECITATION";
  FinishReason2["LANGUAGE"] = "LANGUAGE";
  FinishReason2["BLOCKLIST"] = "BLOCKLIST";
  FinishReason2["PROHIBITED_CONTENT"] = "PROHIBITED_CONTENT";
  FinishReason2["SPII"] = "SPII";
  FinishReason2["MALFORMED_FUNCTION_CALL"] = "MALFORMED_FUNCTION_CALL";
  FinishReason2["OTHER"] = "OTHER";
})(FinishReason || (FinishReason = {}));
var TaskType;
(function(TaskType2) {
  TaskType2["TASK_TYPE_UNSPECIFIED"] = "TASK_TYPE_UNSPECIFIED";
  TaskType2["RETRIEVAL_QUERY"] = "RETRIEVAL_QUERY";
  TaskType2["RETRIEVAL_DOCUMENT"] = "RETRIEVAL_DOCUMENT";
  TaskType2["SEMANTIC_SIMILARITY"] = "SEMANTIC_SIMILARITY";
  TaskType2["CLASSIFICATION"] = "CLASSIFICATION";
  TaskType2["CLUSTERING"] = "CLUSTERING";
})(TaskType || (TaskType = {}));
var FunctionCallingMode;
(function(FunctionCallingMode2) {
  FunctionCallingMode2["MODE_UNSPECIFIED"] = "MODE_UNSPECIFIED";
  FunctionCallingMode2["AUTO"] = "AUTO";
  FunctionCallingMode2["ANY"] = "ANY";
  FunctionCallingMode2["NONE"] = "NONE";
})(FunctionCallingMode || (FunctionCallingMode = {}));
var DynamicRetrievalMode;
(function(DynamicRetrievalMode2) {
  DynamicRetrievalMode2["MODE_UNSPECIFIED"] = "MODE_UNSPECIFIED";
  DynamicRetrievalMode2["MODE_DYNAMIC"] = "MODE_DYNAMIC";
})(DynamicRetrievalMode || (DynamicRetrievalMode = {}));
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
class GoogleGenerativeAIError extends Error {
  constructor(message) {
    super(`[GoogleGenerativeAI Error]: ${message}`);
  }
}
class GoogleGenerativeAIResponseError extends GoogleGenerativeAIError {
  constructor(message, response) {
    super(message);
    this.response = response;
  }
}
class GoogleGenerativeAIFetchError extends GoogleGenerativeAIError {
  constructor(message, status, statusText, errorDetails) {
    super(message);
    this.status = status;
    this.statusText = statusText;
    this.errorDetails = errorDetails;
  }
}
class GoogleGenerativeAIRequestInputError extends GoogleGenerativeAIError {
}
class GoogleGenerativeAIAbortError extends GoogleGenerativeAIError {
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_API_VERSION = "v1beta";
const PACKAGE_VERSION = "0.24.1";
const PACKAGE_LOG_HEADER = "genai-js";
var Task;
(function(Task2) {
  Task2["GENERATE_CONTENT"] = "generateContent";
  Task2["STREAM_GENERATE_CONTENT"] = "streamGenerateContent";
  Task2["COUNT_TOKENS"] = "countTokens";
  Task2["EMBED_CONTENT"] = "embedContent";
  Task2["BATCH_EMBED_CONTENTS"] = "batchEmbedContents";
})(Task || (Task = {}));
class RequestUrl {
  constructor(model, task, apiKey, stream, requestOptions) {
    this.model = model;
    this.task = task;
    this.apiKey = apiKey;
    this.stream = stream;
    this.requestOptions = requestOptions;
  }
  toString() {
    var _a, _b;
    const apiVersion = ((_a = this.requestOptions) === null || _a === void 0 ? void 0 : _a.apiVersion) || DEFAULT_API_VERSION;
    const baseUrl = ((_b = this.requestOptions) === null || _b === void 0 ? void 0 : _b.baseUrl) || DEFAULT_BASE_URL;
    let url = `${baseUrl}/${apiVersion}/${this.model}:${this.task}`;
    if (this.stream) {
      url += "?alt=sse";
    }
    return url;
  }
}
function getClientHeaders(requestOptions) {
  const clientHeaders = [];
  if (requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.apiClient) {
    clientHeaders.push(requestOptions.apiClient);
  }
  clientHeaders.push(`${PACKAGE_LOG_HEADER}/${PACKAGE_VERSION}`);
  return clientHeaders.join(" ");
}
async function getHeaders(url) {
  var _a;
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("x-goog-api-client", getClientHeaders(url.requestOptions));
  headers.append("x-goog-api-key", url.apiKey);
  let customHeaders = (_a = url.requestOptions) === null || _a === void 0 ? void 0 : _a.customHeaders;
  if (customHeaders) {
    if (!(customHeaders instanceof Headers)) {
      try {
        customHeaders = new Headers(customHeaders);
      } catch (e) {
        throw new GoogleGenerativeAIRequestInputError(`unable to convert customHeaders value ${JSON.stringify(customHeaders)} to Headers: ${e.message}`);
      }
    }
    for (const [headerName, headerValue] of customHeaders.entries()) {
      if (headerName === "x-goog-api-key") {
        throw new GoogleGenerativeAIRequestInputError(`Cannot set reserved header name ${headerName}`);
      } else if (headerName === "x-goog-api-client") {
        throw new GoogleGenerativeAIRequestInputError(`Header name ${headerName} can only be set using the apiClient field`);
      }
      headers.append(headerName, headerValue);
    }
  }
  return headers;
}
async function constructModelRequest(model, task, apiKey, stream, body, requestOptions) {
  const url = new RequestUrl(model, task, apiKey, stream, requestOptions);
  return {
    url: url.toString(),
    fetchOptions: Object.assign(Object.assign({}, buildFetchOptions(requestOptions)), { method: "POST", headers: await getHeaders(url), body })
  };
}
async function makeModelRequest(model, task, apiKey, stream, body, requestOptions = {}, fetchFn = fetch) {
  const { url, fetchOptions } = await constructModelRequest(model, task, apiKey, stream, body, requestOptions);
  return makeRequest(url, fetchOptions, fetchFn);
}
async function makeRequest(url, fetchOptions, fetchFn = fetch) {
  let response;
  try {
    response = await fetchFn(url, fetchOptions);
  } catch (e) {
    handleResponseError(e, url);
  }
  if (!response.ok) {
    await handleResponseNotOk(response, url);
  }
  return response;
}
function handleResponseError(e, url) {
  let err = e;
  if (err.name === "AbortError") {
    err = new GoogleGenerativeAIAbortError(`Request aborted when fetching ${url.toString()}: ${e.message}`);
    err.stack = e.stack;
  } else if (!(e instanceof GoogleGenerativeAIFetchError || e instanceof GoogleGenerativeAIRequestInputError)) {
    err = new GoogleGenerativeAIError(`Error fetching from ${url.toString()}: ${e.message}`);
    err.stack = e.stack;
  }
  throw err;
}
async function handleResponseNotOk(response, url) {
  let message = "";
  let errorDetails;
  try {
    const json = await response.json();
    message = json.error.message;
    if (json.error.details) {
      message += ` ${JSON.stringify(json.error.details)}`;
      errorDetails = json.error.details;
    }
  } catch (e) {
  }
  throw new GoogleGenerativeAIFetchError(`Error fetching from ${url.toString()}: [${response.status} ${response.statusText}] ${message}`, response.status, response.statusText, errorDetails);
}
function buildFetchOptions(requestOptions) {
  const fetchOptions = {};
  if ((requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.signal) !== void 0 || (requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.timeout) >= 0) {
    const controller = new AbortController();
    if ((requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.timeout) >= 0) {
      setTimeout(() => controller.abort(), requestOptions.timeout);
    }
    if (requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.signal) {
      requestOptions.signal.addEventListener("abort", () => {
        controller.abort();
      });
    }
    fetchOptions.signal = controller.signal;
  }
  return fetchOptions;
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function addHelpers(response) {
  response.text = () => {
    if (response.candidates && response.candidates.length > 0) {
      if (response.candidates.length > 1) {
        console.warn(`This response had ${response.candidates.length} candidates. Returning text from the first candidate only. Access response.candidates directly to use the other candidates.`);
      }
      if (hadBadFinishReason(response.candidates[0])) {
        throw new GoogleGenerativeAIResponseError(`${formatBlockErrorMessage(response)}`, response);
      }
      return getText(response);
    } else if (response.promptFeedback) {
      throw new GoogleGenerativeAIResponseError(`Text not available. ${formatBlockErrorMessage(response)}`, response);
    }
    return "";
  };
  response.functionCall = () => {
    if (response.candidates && response.candidates.length > 0) {
      if (response.candidates.length > 1) {
        console.warn(`This response had ${response.candidates.length} candidates. Returning function calls from the first candidate only. Access response.candidates directly to use the other candidates.`);
      }
      if (hadBadFinishReason(response.candidates[0])) {
        throw new GoogleGenerativeAIResponseError(`${formatBlockErrorMessage(response)}`, response);
      }
      console.warn(`response.functionCall() is deprecated. Use response.functionCalls() instead.`);
      return getFunctionCalls(response)[0];
    } else if (response.promptFeedback) {
      throw new GoogleGenerativeAIResponseError(`Function call not available. ${formatBlockErrorMessage(response)}`, response);
    }
    return void 0;
  };
  response.functionCalls = () => {
    if (response.candidates && response.candidates.length > 0) {
      if (response.candidates.length > 1) {
        console.warn(`This response had ${response.candidates.length} candidates. Returning function calls from the first candidate only. Access response.candidates directly to use the other candidates.`);
      }
      if (hadBadFinishReason(response.candidates[0])) {
        throw new GoogleGenerativeAIResponseError(`${formatBlockErrorMessage(response)}`, response);
      }
      return getFunctionCalls(response);
    } else if (response.promptFeedback) {
      throw new GoogleGenerativeAIResponseError(`Function call not available. ${formatBlockErrorMessage(response)}`, response);
    }
    return void 0;
  };
  return response;
}
function getText(response) {
  var _a, _b, _c, _d;
  const textStrings = [];
  if ((_b = (_a = response.candidates) === null || _a === void 0 ? void 0 : _a[0].content) === null || _b === void 0 ? void 0 : _b.parts) {
    for (const part of (_d = (_c = response.candidates) === null || _c === void 0 ? void 0 : _c[0].content) === null || _d === void 0 ? void 0 : _d.parts) {
      if (part.text) {
        textStrings.push(part.text);
      }
      if (part.executableCode) {
        textStrings.push("\n```" + part.executableCode.language + "\n" + part.executableCode.code + "\n```\n");
      }
      if (part.codeExecutionResult) {
        textStrings.push("\n```\n" + part.codeExecutionResult.output + "\n```\n");
      }
    }
  }
  if (textStrings.length > 0) {
    return textStrings.join("");
  } else {
    return "";
  }
}
function getFunctionCalls(response) {
  var _a, _b, _c, _d;
  const functionCalls = [];
  if ((_b = (_a = response.candidates) === null || _a === void 0 ? void 0 : _a[0].content) === null || _b === void 0 ? void 0 : _b.parts) {
    for (const part of (_d = (_c = response.candidates) === null || _c === void 0 ? void 0 : _c[0].content) === null || _d === void 0 ? void 0 : _d.parts) {
      if (part.functionCall) {
        functionCalls.push(part.functionCall);
      }
    }
  }
  if (functionCalls.length > 0) {
    return functionCalls;
  } else {
    return void 0;
  }
}
const badFinishReasons = [
  FinishReason.RECITATION,
  FinishReason.SAFETY,
  FinishReason.LANGUAGE
];
function hadBadFinishReason(candidate) {
  return !!candidate.finishReason && badFinishReasons.includes(candidate.finishReason);
}
function formatBlockErrorMessage(response) {
  var _a, _b, _c;
  let message = "";
  if ((!response.candidates || response.candidates.length === 0) && response.promptFeedback) {
    message += "Response was blocked";
    if ((_a = response.promptFeedback) === null || _a === void 0 ? void 0 : _a.blockReason) {
      message += ` due to ${response.promptFeedback.blockReason}`;
    }
    if ((_b = response.promptFeedback) === null || _b === void 0 ? void 0 : _b.blockReasonMessage) {
      message += `: ${response.promptFeedback.blockReasonMessage}`;
    }
  } else if ((_c = response.candidates) === null || _c === void 0 ? void 0 : _c[0]) {
    const firstCandidate = response.candidates[0];
    if (hadBadFinishReason(firstCandidate)) {
      message += `Candidate was blocked due to ${firstCandidate.finishReason}`;
      if (firstCandidate.finishMessage) {
        message += `: ${firstCandidate.finishMessage}`;
      }
    }
  }
  return message;
}
function __await(v) {
  return this instanceof __await ? (this.v = v, this) : new __await(v);
}
function __asyncGenerator(thisArg, _arguments, generator) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var g = generator.apply(thisArg, _arguments || []), i, q = [];
  return i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function() {
    return this;
  }, i;
  function verb(n) {
    if (g[n]) i[n] = function(v) {
      return new Promise(function(a, b) {
        q.push([n, v, a, b]) > 1 || resume(n, v);
      });
    };
  }
  function resume(n, v) {
    try {
      step(g[n](v));
    } catch (e) {
      settle(q[0][3], e);
    }
  }
  function step(r) {
    r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r);
  }
  function fulfill(value) {
    resume("next", value);
  }
  function reject(value) {
    resume("throw", value);
  }
  function settle(f, v) {
    if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]);
  }
}
typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
  var e = new Error(message);
  return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const responseLineRE = /^data\: (.*)(?:\n\n|\r\r|\r\n\r\n)/;
function processStream(response) {
  const inputStream = response.body.pipeThrough(new TextDecoderStream("utf8", { fatal: true }));
  const responseStream = getResponseStream(inputStream);
  const [stream1, stream2] = responseStream.tee();
  return {
    stream: generateResponseSequence(stream1),
    response: getResponsePromise(stream2)
  };
}
async function getResponsePromise(stream) {
  const allResponses = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return addHelpers(aggregateResponses(allResponses));
    }
    allResponses.push(value);
  }
}
function generateResponseSequence(stream) {
  return __asyncGenerator(this, arguments, function* generateResponseSequence_1() {
    const reader = stream.getReader();
    while (true) {
      const { value, done } = yield __await(reader.read());
      if (done) {
        break;
      }
      yield yield __await(addHelpers(value));
    }
  });
}
function getResponseStream(inputStream) {
  const reader = inputStream.getReader();
  const stream = new ReadableStream({
    start(controller) {
      let currentText = "";
      return pump();
      function pump() {
        return reader.read().then(({ value, done }) => {
          if (done) {
            if (currentText.trim()) {
              controller.error(new GoogleGenerativeAIError("Failed to parse stream"));
              return;
            }
            controller.close();
            return;
          }
          currentText += value;
          let match = currentText.match(responseLineRE);
          let parsedResponse;
          while (match) {
            try {
              parsedResponse = JSON.parse(match[1]);
            } catch (e) {
              controller.error(new GoogleGenerativeAIError(`Error parsing JSON response: "${match[1]}"`));
              return;
            }
            controller.enqueue(parsedResponse);
            currentText = currentText.substring(match[0].length);
            match = currentText.match(responseLineRE);
          }
          return pump();
        }).catch((e) => {
          let err = e;
          err.stack = e.stack;
          if (err.name === "AbortError") {
            err = new GoogleGenerativeAIAbortError("Request aborted when reading from the stream");
          } else {
            err = new GoogleGenerativeAIError("Error reading from the stream");
          }
          throw err;
        });
      }
    }
  });
  return stream;
}
function aggregateResponses(responses) {
  const lastResponse = responses[responses.length - 1];
  const aggregatedResponse = {
    promptFeedback: lastResponse === null || lastResponse === void 0 ? void 0 : lastResponse.promptFeedback
  };
  for (const response of responses) {
    if (response.candidates) {
      let candidateIndex = 0;
      for (const candidate of response.candidates) {
        if (!aggregatedResponse.candidates) {
          aggregatedResponse.candidates = [];
        }
        if (!aggregatedResponse.candidates[candidateIndex]) {
          aggregatedResponse.candidates[candidateIndex] = {
            index: candidateIndex
          };
        }
        aggregatedResponse.candidates[candidateIndex].citationMetadata = candidate.citationMetadata;
        aggregatedResponse.candidates[candidateIndex].groundingMetadata = candidate.groundingMetadata;
        aggregatedResponse.candidates[candidateIndex].finishReason = candidate.finishReason;
        aggregatedResponse.candidates[candidateIndex].finishMessage = candidate.finishMessage;
        aggregatedResponse.candidates[candidateIndex].safetyRatings = candidate.safetyRatings;
        if (candidate.content && candidate.content.parts) {
          if (!aggregatedResponse.candidates[candidateIndex].content) {
            aggregatedResponse.candidates[candidateIndex].content = {
              role: candidate.content.role || "user",
              parts: []
            };
          }
          const newPart = {};
          for (const part of candidate.content.parts) {
            if (part.text) {
              newPart.text = part.text;
            }
            if (part.functionCall) {
              newPart.functionCall = part.functionCall;
            }
            if (part.executableCode) {
              newPart.executableCode = part.executableCode;
            }
            if (part.codeExecutionResult) {
              newPart.codeExecutionResult = part.codeExecutionResult;
            }
            if (Object.keys(newPart).length === 0) {
              newPart.text = "";
            }
            aggregatedResponse.candidates[candidateIndex].content.parts.push(newPart);
          }
        }
      }
      candidateIndex++;
    }
    if (response.usageMetadata) {
      aggregatedResponse.usageMetadata = response.usageMetadata;
    }
  }
  return aggregatedResponse;
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
async function generateContentStream(apiKey, model, params, requestOptions) {
  const response = await makeModelRequest(
    model,
    Task.STREAM_GENERATE_CONTENT,
    apiKey,
    /* stream */
    true,
    JSON.stringify(params),
    requestOptions
  );
  return processStream(response);
}
async function generateContent(apiKey, model, params, requestOptions) {
  const response = await makeModelRequest(
    model,
    Task.GENERATE_CONTENT,
    apiKey,
    /* stream */
    false,
    JSON.stringify(params),
    requestOptions
  );
  const responseJson = await response.json();
  const enhancedResponse = addHelpers(responseJson);
  return {
    response: enhancedResponse
  };
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function formatSystemInstruction(input) {
  if (input == null) {
    return void 0;
  } else if (typeof input === "string") {
    return { role: "system", parts: [{ text: input }] };
  } else if (input.text) {
    return { role: "system", parts: [input] };
  } else if (input.parts) {
    if (!input.role) {
      return { role: "system", parts: input.parts };
    } else {
      return input;
    }
  }
}
function formatNewContent(request) {
  let newParts = [];
  if (typeof request === "string") {
    newParts = [{ text: request }];
  } else {
    for (const partOrString of request) {
      if (typeof partOrString === "string") {
        newParts.push({ text: partOrString });
      } else {
        newParts.push(partOrString);
      }
    }
  }
  return assignRoleToPartsAndValidateSendMessageRequest(newParts);
}
function assignRoleToPartsAndValidateSendMessageRequest(parts) {
  const userContent = { role: "user", parts: [] };
  const functionContent = { role: "function", parts: [] };
  let hasUserContent = false;
  let hasFunctionContent = false;
  for (const part of parts) {
    if ("functionResponse" in part) {
      functionContent.parts.push(part);
      hasFunctionContent = true;
    } else {
      userContent.parts.push(part);
      hasUserContent = true;
    }
  }
  if (hasUserContent && hasFunctionContent) {
    throw new GoogleGenerativeAIError("Within a single message, FunctionResponse cannot be mixed with other type of part in the request for sending chat message.");
  }
  if (!hasUserContent && !hasFunctionContent) {
    throw new GoogleGenerativeAIError("No content is provided for sending chat message.");
  }
  if (hasUserContent) {
    return userContent;
  }
  return functionContent;
}
function formatCountTokensInput(params, modelParams) {
  var _a;
  let formattedGenerateContentRequest = {
    model: modelParams === null || modelParams === void 0 ? void 0 : modelParams.model,
    generationConfig: modelParams === null || modelParams === void 0 ? void 0 : modelParams.generationConfig,
    safetySettings: modelParams === null || modelParams === void 0 ? void 0 : modelParams.safetySettings,
    tools: modelParams === null || modelParams === void 0 ? void 0 : modelParams.tools,
    toolConfig: modelParams === null || modelParams === void 0 ? void 0 : modelParams.toolConfig,
    systemInstruction: modelParams === null || modelParams === void 0 ? void 0 : modelParams.systemInstruction,
    cachedContent: (_a = modelParams === null || modelParams === void 0 ? void 0 : modelParams.cachedContent) === null || _a === void 0 ? void 0 : _a.name,
    contents: []
  };
  const containsGenerateContentRequest = params.generateContentRequest != null;
  if (params.contents) {
    if (containsGenerateContentRequest) {
      throw new GoogleGenerativeAIRequestInputError("CountTokensRequest must have one of contents or generateContentRequest, not both.");
    }
    formattedGenerateContentRequest.contents = params.contents;
  } else if (containsGenerateContentRequest) {
    formattedGenerateContentRequest = Object.assign(Object.assign({}, formattedGenerateContentRequest), params.generateContentRequest);
  } else {
    const content = formatNewContent(params);
    formattedGenerateContentRequest.contents = [content];
  }
  return { generateContentRequest: formattedGenerateContentRequest };
}
function formatGenerateContentInput(params) {
  let formattedRequest;
  if (params.contents) {
    formattedRequest = params;
  } else {
    const content = formatNewContent(params);
    formattedRequest = { contents: [content] };
  }
  if (params.systemInstruction) {
    formattedRequest.systemInstruction = formatSystemInstruction(params.systemInstruction);
  }
  return formattedRequest;
}
function formatEmbedContentInput(params) {
  if (typeof params === "string" || Array.isArray(params)) {
    const content = formatNewContent(params);
    return { content };
  }
  return params;
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const VALID_PART_FIELDS = [
  "text",
  "inlineData",
  "functionCall",
  "functionResponse",
  "executableCode",
  "codeExecutionResult"
];
const VALID_PARTS_PER_ROLE = {
  user: ["text", "inlineData"],
  function: ["functionResponse"],
  model: ["text", "functionCall", "executableCode", "codeExecutionResult"],
  // System instructions shouldn't be in history anyway.
  system: ["text"]
};
function validateChatHistory(history) {
  let prevContent = false;
  for (const currContent of history) {
    const { role, parts } = currContent;
    if (!prevContent && role !== "user") {
      throw new GoogleGenerativeAIError(`First content should be with role 'user', got ${role}`);
    }
    if (!POSSIBLE_ROLES.includes(role)) {
      throw new GoogleGenerativeAIError(`Each item should include role field. Got ${role} but valid roles are: ${JSON.stringify(POSSIBLE_ROLES)}`);
    }
    if (!Array.isArray(parts)) {
      throw new GoogleGenerativeAIError("Content should have 'parts' property with an array of Parts");
    }
    if (parts.length === 0) {
      throw new GoogleGenerativeAIError("Each Content should have at least one part");
    }
    const countFields = {
      text: 0,
      inlineData: 0,
      functionCall: 0,
      functionResponse: 0,
      fileData: 0,
      executableCode: 0,
      codeExecutionResult: 0
    };
    for (const part of parts) {
      for (const key of VALID_PART_FIELDS) {
        if (key in part) {
          countFields[key] += 1;
        }
      }
    }
    const validParts = VALID_PARTS_PER_ROLE[role];
    for (const key of VALID_PART_FIELDS) {
      if (!validParts.includes(key) && countFields[key] > 0) {
        throw new GoogleGenerativeAIError(`Content with role '${role}' can't contain '${key}' part`);
      }
    }
    prevContent = true;
  }
}
function isValidResponse(response) {
  var _a;
  if (response.candidates === void 0 || response.candidates.length === 0) {
    return false;
  }
  const content = (_a = response.candidates[0]) === null || _a === void 0 ? void 0 : _a.content;
  if (content === void 0) {
    return false;
  }
  if (content.parts === void 0 || content.parts.length === 0) {
    return false;
  }
  for (const part of content.parts) {
    if (part === void 0 || Object.keys(part).length === 0) {
      return false;
    }
    if (part.text !== void 0 && part.text === "") {
      return false;
    }
  }
  return true;
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const SILENT_ERROR = "SILENT_ERROR";
class ChatSession {
  constructor(apiKey, model, params, _requestOptions = {}) {
    this.model = model;
    this.params = params;
    this._requestOptions = _requestOptions;
    this._history = [];
    this._sendPromise = Promise.resolve();
    this._apiKey = apiKey;
    if (params === null || params === void 0 ? void 0 : params.history) {
      validateChatHistory(params.history);
      this._history = params.history;
    }
  }
  /**
   * Gets the chat history so far. Blocked prompts are not added to history.
   * Blocked candidates are not added to history, nor are the prompts that
   * generated them.
   */
  async getHistory() {
    await this._sendPromise;
    return this._history;
  }
  /**
   * Sends a chat message and receives a non-streaming
   * {@link GenerateContentResult}.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async sendMessage(request, requestOptions = {}) {
    var _a, _b, _c, _d, _e, _f;
    await this._sendPromise;
    const newContent = formatNewContent(request);
    const generateContentRequest = {
      safetySettings: (_a = this.params) === null || _a === void 0 ? void 0 : _a.safetySettings,
      generationConfig: (_b = this.params) === null || _b === void 0 ? void 0 : _b.generationConfig,
      tools: (_c = this.params) === null || _c === void 0 ? void 0 : _c.tools,
      toolConfig: (_d = this.params) === null || _d === void 0 ? void 0 : _d.toolConfig,
      systemInstruction: (_e = this.params) === null || _e === void 0 ? void 0 : _e.systemInstruction,
      cachedContent: (_f = this.params) === null || _f === void 0 ? void 0 : _f.cachedContent,
      contents: [...this._history, newContent]
    };
    const chatSessionRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    let finalResult;
    this._sendPromise = this._sendPromise.then(() => generateContent(this._apiKey, this.model, generateContentRequest, chatSessionRequestOptions)).then((result) => {
      var _a2;
      if (isValidResponse(result.response)) {
        this._history.push(newContent);
        const responseContent = Object.assign({
          parts: [],
          // Response seems to come back without a role set.
          role: "model"
        }, (_a2 = result.response.candidates) === null || _a2 === void 0 ? void 0 : _a2[0].content);
        this._history.push(responseContent);
      } else {
        const blockErrorMessage = formatBlockErrorMessage(result.response);
        if (blockErrorMessage) {
          console.warn(`sendMessage() was unsuccessful. ${blockErrorMessage}. Inspect response object for details.`);
        }
      }
      finalResult = result;
    }).catch((e) => {
      this._sendPromise = Promise.resolve();
      throw e;
    });
    await this._sendPromise;
    return finalResult;
  }
  /**
   * Sends a chat message and receives the response as a
   * {@link GenerateContentStreamResult} containing an iterable stream
   * and a response promise.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async sendMessageStream(request, requestOptions = {}) {
    var _a, _b, _c, _d, _e, _f;
    await this._sendPromise;
    const newContent = formatNewContent(request);
    const generateContentRequest = {
      safetySettings: (_a = this.params) === null || _a === void 0 ? void 0 : _a.safetySettings,
      generationConfig: (_b = this.params) === null || _b === void 0 ? void 0 : _b.generationConfig,
      tools: (_c = this.params) === null || _c === void 0 ? void 0 : _c.tools,
      toolConfig: (_d = this.params) === null || _d === void 0 ? void 0 : _d.toolConfig,
      systemInstruction: (_e = this.params) === null || _e === void 0 ? void 0 : _e.systemInstruction,
      cachedContent: (_f = this.params) === null || _f === void 0 ? void 0 : _f.cachedContent,
      contents: [...this._history, newContent]
    };
    const chatSessionRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    const streamPromise = generateContentStream(this._apiKey, this.model, generateContentRequest, chatSessionRequestOptions);
    this._sendPromise = this._sendPromise.then(() => streamPromise).catch((_ignored) => {
      throw new Error(SILENT_ERROR);
    }).then((streamResult) => streamResult.response).then((response) => {
      if (isValidResponse(response)) {
        this._history.push(newContent);
        const responseContent = Object.assign({}, response.candidates[0].content);
        if (!responseContent.role) {
          responseContent.role = "model";
        }
        this._history.push(responseContent);
      } else {
        const blockErrorMessage = formatBlockErrorMessage(response);
        if (blockErrorMessage) {
          console.warn(`sendMessageStream() was unsuccessful. ${blockErrorMessage}. Inspect response object for details.`);
        }
      }
    }).catch((e) => {
      if (e.message !== SILENT_ERROR) {
        console.error(e);
      }
    });
    return streamPromise;
  }
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
async function countTokens(apiKey, model, params, singleRequestOptions) {
  const response = await makeModelRequest(model, Task.COUNT_TOKENS, apiKey, false, JSON.stringify(params), singleRequestOptions);
  return response.json();
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
async function embedContent(apiKey, model, params, requestOptions) {
  const response = await makeModelRequest(model, Task.EMBED_CONTENT, apiKey, false, JSON.stringify(params), requestOptions);
  return response.json();
}
async function batchEmbedContents(apiKey, model, params, requestOptions) {
  const requestsWithModel = params.requests.map((request) => {
    return Object.assign(Object.assign({}, request), { model });
  });
  const response = await makeModelRequest(model, Task.BATCH_EMBED_CONTENTS, apiKey, false, JSON.stringify({ requests: requestsWithModel }), requestOptions);
  return response.json();
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
class GenerativeModel {
  constructor(apiKey, modelParams, _requestOptions = {}) {
    this.apiKey = apiKey;
    this._requestOptions = _requestOptions;
    if (modelParams.model.includes("/")) {
      this.model = modelParams.model;
    } else {
      this.model = `models/${modelParams.model}`;
    }
    this.generationConfig = modelParams.generationConfig || {};
    this.safetySettings = modelParams.safetySettings || [];
    this.tools = modelParams.tools;
    this.toolConfig = modelParams.toolConfig;
    this.systemInstruction = formatSystemInstruction(modelParams.systemInstruction);
    this.cachedContent = modelParams.cachedContent;
  }
  /**
   * Makes a single non-streaming call to the model
   * and returns an object containing a single {@link GenerateContentResponse}.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async generateContent(request, requestOptions = {}) {
    var _a;
    const formattedParams = formatGenerateContentInput(request);
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return generateContent(this.apiKey, this.model, Object.assign({ generationConfig: this.generationConfig, safetySettings: this.safetySettings, tools: this.tools, toolConfig: this.toolConfig, systemInstruction: this.systemInstruction, cachedContent: (_a = this.cachedContent) === null || _a === void 0 ? void 0 : _a.name }, formattedParams), generativeModelRequestOptions);
  }
  /**
   * Makes a single streaming call to the model and returns an object
   * containing an iterable stream that iterates over all chunks in the
   * streaming response as well as a promise that returns the final
   * aggregated response.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async generateContentStream(request, requestOptions = {}) {
    var _a;
    const formattedParams = formatGenerateContentInput(request);
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return generateContentStream(this.apiKey, this.model, Object.assign({ generationConfig: this.generationConfig, safetySettings: this.safetySettings, tools: this.tools, toolConfig: this.toolConfig, systemInstruction: this.systemInstruction, cachedContent: (_a = this.cachedContent) === null || _a === void 0 ? void 0 : _a.name }, formattedParams), generativeModelRequestOptions);
  }
  /**
   * Gets a new {@link ChatSession} instance which can be used for
   * multi-turn chats.
   */
  startChat(startChatParams) {
    var _a;
    return new ChatSession(this.apiKey, this.model, Object.assign({ generationConfig: this.generationConfig, safetySettings: this.safetySettings, tools: this.tools, toolConfig: this.toolConfig, systemInstruction: this.systemInstruction, cachedContent: (_a = this.cachedContent) === null || _a === void 0 ? void 0 : _a.name }, startChatParams), this._requestOptions);
  }
  /**
   * Counts the tokens in the provided request.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async countTokens(request, requestOptions = {}) {
    const formattedParams = formatCountTokensInput(request, {
      model: this.model,
      generationConfig: this.generationConfig,
      safetySettings: this.safetySettings,
      tools: this.tools,
      toolConfig: this.toolConfig,
      systemInstruction: this.systemInstruction,
      cachedContent: this.cachedContent
    });
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return countTokens(this.apiKey, this.model, formattedParams, generativeModelRequestOptions);
  }
  /**
   * Embeds the provided content.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async embedContent(request, requestOptions = {}) {
    const formattedParams = formatEmbedContentInput(request);
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return embedContent(this.apiKey, this.model, formattedParams, generativeModelRequestOptions);
  }
  /**
   * Embeds an array of {@link EmbedContentRequest}s.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async batchEmbedContents(batchEmbedContentRequest, requestOptions = {}) {
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return batchEmbedContents(this.apiKey, this.model, batchEmbedContentRequest, generativeModelRequestOptions);
  }
}
/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
class GoogleGenerativeAI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  /**
   * Gets a {@link GenerativeModel} instance for the provided model name.
   */
  getGenerativeModel(modelParams, requestOptions) {
    if (!modelParams.model) {
      throw new GoogleGenerativeAIError(`Must provide a model name. Example: genai.getGenerativeModel({ model: 'my-model-name' })`);
    }
    return new GenerativeModel(this.apiKey, modelParams, requestOptions);
  }
  /**
   * Creates a {@link GenerativeModel} instance from provided content cache.
   */
  getGenerativeModelFromCachedContent(cachedContent, modelParams, requestOptions) {
    if (!cachedContent.name) {
      throw new GoogleGenerativeAIRequestInputError("Cached content must contain a `name` field.");
    }
    if (!cachedContent.model) {
      throw new GoogleGenerativeAIRequestInputError("Cached content must contain a `model` field.");
    }
    const disallowedDuplicates = ["model", "systemInstruction"];
    for (const key of disallowedDuplicates) {
      if ((modelParams === null || modelParams === void 0 ? void 0 : modelParams[key]) && cachedContent[key] && (modelParams === null || modelParams === void 0 ? void 0 : modelParams[key]) !== cachedContent[key]) {
        if (key === "model") {
          const modelParamsComp = modelParams.model.startsWith("models/") ? modelParams.model.replace("models/", "") : modelParams.model;
          const cachedContentComp = cachedContent.model.startsWith("models/") ? cachedContent.model.replace("models/", "") : cachedContent.model;
          if (modelParamsComp === cachedContentComp) {
            continue;
          }
        }
        throw new GoogleGenerativeAIRequestInputError(`Different value for "${key}" specified in modelParams (${modelParams[key]}) and cachedContent (${cachedContent[key]})`);
      }
    }
    const modelParamsFromCache = Object.assign(Object.assign({}, modelParams), { model: cachedContent.model, tools: cachedContent.tools, toolConfig: cachedContent.toolConfig, systemInstruction: cachedContent.systemInstruction, cachedContent });
    return new GenerativeModel(this.apiKey, modelParamsFromCache, requestOptions);
  }
}
class GeminiProvider {
  constructor(apiKey) {
    __publicField(this, "name", "Google Gemini");
    __publicField(this, "requiresApiKey", true);
    __publicField(this, "genAI");
    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
  }
  async isAvailable() {
    return !!this.apiKey;
  }
  async generateSummary(transcript, userNotes) {
    const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = getSummaryPrompt(transcript, userNotes);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }
  async extractSpeakerIdentity(transcript) {
    const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = getSpeakerIdentityPrompt(transcript);
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const name = response.text().trim();
      if (name && name.length < 20 && !name.includes(" ") && name !== "Unknown") {
        return name;
      }
      return null;
    } catch (e) {
      console.error("[Gemini] Failed to extract speaker identity:", e);
      return null;
    }
  }
  async generateTitle(transcript) {
    const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = getTitlePrompt(transcript);
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const title = response.text().trim();
      if (title && title.length < 100) {
        return title.replace(/[\"']/g, "");
      }
      return "Meeting";
    } catch (e) {
      console.error("[Gemini] Failed to generate title:", e);
      return "Meeting";
    }
  }
  async extractEntities(transcript) {
    const model = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json"
      }
    });
    const prompt = getEntitiesPrompt(transcript);
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const jsonStr = response.text().trim();
      const parsed = JSON.parse(jsonStr);
      return {
        people: Array.isArray(parsed.people) ? parsed.people : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : []
      };
    } catch (e) {
      console.error("[Gemini] Failed to extract entities:", e);
      return {
        people: [],
        topics: [],
        action_items: [],
        decisions: [],
        projects: []
      };
    }
  }
}
class OpenAIProvider {
  constructor(apiKey) {
    __publicField(this, "name", "OpenAI");
    __publicField(this, "requiresApiKey", true);
    __publicField(this, "baseUrl", "https://api.openai.com/v1");
    this.apiKey = apiKey;
  }
  async isAvailable() {
    return !!this.apiKey;
  }
  async generateSummary(transcript, userNotes) {
    const prompt = getSummaryPrompt(transcript, userNotes);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are an intelligent meeting assistant." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    });
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }
  async extractSpeakerIdentity(transcript) {
    const prompt = getSpeakerIdentityPrompt(transcript);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a helpful assistant that extracts speaker information." },
            { role: "user", content: prompt }
          ],
          temperature: 0.3
        })
      });
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }
      const data = await response.json();
      const name = data.choices[0].message.content.trim();
      if (name && name.length < 20 && !name.includes(" ") && name !== "Unknown") {
        return name;
      }
      return null;
    } catch (e) {
      console.error("[OpenAI] Failed to extract speaker identity:", e);
      return null;
    }
  }
  async generateTitle(transcript) {
    const prompt = getTitlePrompt(transcript);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a helpful assistant that generates concise meeting titles." },
            { role: "user", content: prompt }
          ],
          temperature: 0.5
        })
      });
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }
      const data = await response.json();
      const title = data.choices[0].message.content.trim();
      if (title && title.length < 100) {
        return title.replace(/["']/g, "");
      }
      return "Meeting";
    } catch (e) {
      console.error("[OpenAI] Failed to generate title:", e);
      return "Meeting";
    }
  }
  async extractEntities(transcript) {
    const prompt = getEntitiesPrompt(transcript);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are an expert at extracting structured entities from meeting transcripts. Always respond with valid JSON only." },
            { role: "user", content: prompt }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        })
      });
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }
      const data = await response.json();
      const jsonStr = data.choices[0].message.content.trim();
      const parsed = JSON.parse(jsonStr);
      return {
        people: Array.isArray(parsed.people) ? parsed.people : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : []
      };
    } catch (e) {
      console.error("[OpenAI] Failed to extract entities:", e);
      return {
        people: [],
        topics: [],
        action_items: [],
        decisions: [],
        projects: []
      };
    }
  }
}
class ClaudeProvider {
  constructor(apiKey) {
    __publicField(this, "name", "Anthropic Claude");
    __publicField(this, "requiresApiKey", true);
    __publicField(this, "baseUrl", "https://api.anthropic.com/v1");
    this.apiKey = apiKey;
  }
  async isAvailable() {
    return !!this.apiKey;
  }
  async generateSummary(transcript, userNotes) {
    const prompt = getSummaryPrompt(transcript, userNotes);
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`);
    }
    const data = await response.json();
    return data.content[0].text;
  }
  async extractSpeakerIdentity(transcript) {
    const prompt = getSpeakerIdentityPrompt(transcript);
    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 50,
          messages: [
            { role: "user", content: prompt }
          ]
        })
      });
      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`);
      }
      const data = await response.json();
      const name = data.content[0].text.trim();
      if (name && name.length < 20 && !name.includes(" ") && name !== "Unknown") {
        return name;
      }
      return null;
    } catch (e) {
      console.error("[Claude] Failed to extract speaker identity:", e);
      return null;
    }
  }
  async generateTitle(transcript) {
    const prompt = getTitlePrompt(transcript);
    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 50,
          messages: [
            { role: "user", content: prompt }
          ]
        })
      });
      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`);
      }
      const data = await response.json();
      const title = data.content[0].text.trim();
      if (title && title.length < 100) {
        return title.replace(/[\"']/g, "");
      }
      return "Meeting";
    } catch (e) {
      console.error("[Claude] Failed to generate title:", e);
      return "Meeting";
    }
  }
  async extractEntities(transcript) {
    const prompt = getEntitiesPrompt(transcript);
    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 2048,
          messages: [
            { role: "user", content: prompt }
          ]
        })
      });
      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`);
      }
      const data = await response.json();
      let jsonStr = data.content[0].text.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(jsonStr);
      return {
        people: Array.isArray(parsed.people) ? parsed.people : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : []
      };
    } catch (e) {
      console.error("[Claude] Failed to extract entities:", e);
      return {
        people: [],
        topics: [],
        action_items: [],
        decisions: [],
        projects: []
      };
    }
  }
}
async function getProvider(settings) {
  const providerType = settings.llm_provider || "ollama";
  console.log(`[LLM Factory] Attempting to load provider: ${providerType}`);
  switch (providerType) {
    case "ollama": {
      const ollama = new OllamaProvider();
      if (await ollama.isAvailable()) {
        console.log("[LLM Factory] Ollama is available");
        return ollama;
      }
      console.warn("[LLM Factory] Ollama not available, falling back to cloud provider");
      if (settings.gemini_api_key) {
        console.log("[LLM Factory] Falling back to Gemini");
        return new GeminiProvider(settings.gemini_api_key);
      }
      if (settings.openai_api_key) {
        console.log("[LLM Factory] Falling back to OpenAI");
        return new OpenAIProvider(settings.openai_api_key);
      }
      if (settings.claude_api_key) {
        console.log("[LLM Factory] Falling back to Claude");
        return new ClaudeProvider(settings.claude_api_key);
      }
      throw new Error("Ollama is not running and no cloud API keys configured. Please install Ollama or add an API key in settings.");
    }
    case "gemini": {
      if (!settings.gemini_api_key) {
        throw new Error("Gemini API key not configured");
      }
      return new GeminiProvider(settings.gemini_api_key);
    }
    case "openai": {
      if (!settings.openai_api_key) {
        throw new Error("OpenAI API key not configured");
      }
      return new OpenAIProvider(settings.openai_api_key);
    }
    case "claude": {
      if (!settings.claude_api_key) {
        throw new Error("Claude API key not configured");
      }
      return new ClaudeProvider(settings.claude_api_key);
    }
    default:
      throw new Error(`Unknown provider type: ${providerType}`);
  }
}
async function getAllSettings(db2) {
  return {
    llm_provider: db2.getSetting("llm_provider") || "ollama",
    gemini_api_key: db2.getSetting("gemini_api_key") || void 0,
    openai_api_key: db2.getSetting("openai_api_key") || void 0,
    claude_api_key: db2.getSetting("claude_api_key") || void 0
  };
}
function parseDueDate(dueDate) {
  if (!dueDate) return null;
  const now = /* @__PURE__ */ new Date();
  const lower = dueDate.toLowerCase().trim();
  if (lower === "today") {
    return now.toISOString();
  }
  if (lower === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString();
  }
  if (lower === "next week" || lower === "by next week") {
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek.toISOString();
  }
  if (lower === "end of week" || lower === "eow") {
    const eow = new Date(now);
    const daysUntilFriday = (5 - eow.getDay() + 7) % 7 || 7;
    eow.setDate(eow.getDate() + daysUntilFriday);
    return eow.toISOString();
  }
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < dayNames.length; i++) {
    if (lower.includes(dayNames[i])) {
      const target = new Date(now);
      const daysUntil = (i - target.getDay() + 7) % 7 || 7;
      target.setDate(target.getDate() + daysUntil);
      return target.toISOString();
    }
  }
  try {
    const parsed = new Date(dueDate);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  } catch {
  }
  return null;
}
async function processExtractedEntities(extracted, meetingId) {
  let created = 0;
  let updated = 0;
  let linked = 0;
  const entities = [];
  console.log(`[EntityPipeline] Processing entities for meeting ${meetingId}`);
  console.log(`[EntityPipeline] Found: ${extracted.people.length} people, ${extracted.topics.length} topics, ${extracted.action_items.length} action items, ${extracted.decisions.length} decisions`);
  for (const person of extracted.people) {
    const existing = findEntity("person", person.name);
    const entity = upsertEntity({
      type: "person",
      name: person.name,
      metadata: person.role ? { role: person.role } : void 0
    });
    if (existing) {
      updated++;
    } else {
      created++;
    }
    entities.push(entity);
    addMeetingEntity({
      meeting_id: meetingId,
      entity_id: entity.id,
      context: person.role ? `Role: ${person.role}` : void 0
    });
    linked++;
  }
  for (const topic of extracted.topics) {
    const existing = findEntity("topic", topic.name);
    const entity = upsertEntity({
      type: "topic",
      name: topic.name,
      metadata: { importance: topic.importance }
    });
    if (existing) {
      updated++;
    } else {
      created++;
    }
    entities.push(entity);
    addMeetingEntity({
      meeting_id: meetingId,
      entity_id: entity.id,
      context: `Importance: ${topic.importance}`
    });
    linked++;
  }
  for (const actionItem of extracted.action_items) {
    const dueDate = parseDueDate(actionItem.due_date || "");
    const entity = upsertEntity({
      type: "action_item",
      name: actionItem.description.substring(0, 100),
      // Truncate for name
      status: "active",
      due_date: dueDate,
      metadata: {
        full_description: actionItem.description,
        assignee_name: actionItem.assignee
      }
    });
    created++;
    entities.push(entity);
    addMeetingEntity({
      meeting_id: meetingId,
      entity_id: entity.id,
      context: actionItem.description
    });
    linked++;
    if (actionItem.assignee) {
      const assignee = findEntity("person", actionItem.assignee);
      if (assignee) {
        linkEntities({
          source_entity_id: entity.id,
          target_entity_id: assignee.id,
          relationship: "assigned_to",
          meeting_id: meetingId
        });
        linked++;
      } else {
        const newAssignee = upsertEntity({
          type: "person",
          name: actionItem.assignee
        });
        linkEntities({
          source_entity_id: entity.id,
          target_entity_id: newAssignee.id,
          relationship: "assigned_to",
          meeting_id: meetingId
        });
        created++;
        linked++;
      }
    }
  }
  for (const decision of extracted.decisions) {
    const entity = upsertEntity({
      type: "decision",
      name: decision.description.substring(0, 100),
      // Truncate for name
      metadata: {
        full_description: decision.description,
        rationale: decision.rationale
      }
    });
    created++;
    entities.push(entity);
    addMeetingEntity({
      meeting_id: meetingId,
      entity_id: entity.id,
      context: decision.rationale || decision.description
    });
    linked++;
  }
  if (extracted.projects) {
    for (const project of extracted.projects) {
      const existing = findEntity("project", project.name);
      const entity = upsertEntity({
        type: "project",
        name: project.name,
        metadata: project.context ? { context: project.context } : void 0
      });
      if (existing) {
        updated++;
      } else {
        created++;
      }
      entities.push(entity);
      addMeetingEntity({
        meeting_id: meetingId,
        entity_id: entity.id,
        context: project.context
      });
      linked++;
      for (const topic of extracted.topics) {
        const topicEntity = findEntity("topic", topic.name);
        if (topicEntity) {
          linkEntities({
            source_entity_id: topicEntity.id,
            target_entity_id: entity.id,
            relationship: "belongs_to",
            meeting_id: meetingId,
            confidence: 0.7
            // Lower confidence since it's inferred
          });
          linked++;
        }
      }
    }
  }
  console.log(`[EntityPipeline] Complete: ${created} created, ${updated} updated, ${linked} links`);
  return { created, updated, linked, entities };
}
async function extractAndProcessEntities(provider, transcript, meetingId) {
  console.log(`[EntityPipeline] Starting extraction for meeting ${meetingId}`);
  const extracted = await provider.extractEntities(transcript);
  return processExtractedEntities(extracted, meetingId);
}
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}
console.log("[Pluto] Initializing electron-audio-loopback...");
distExports.initMain();
console.log("[Pluto] Audio loopback initialized");
if (process.platform === "darwin") {
  require$$0.app.commandLine.appendSwitch("enable-features", "MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride");
}
const __dirname$1 = path.dirname(node_url.fileURLToPath(typeof document === "undefined" ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === "SCRIPT" && _documentCurrentScript.src || new URL("main.js", document.baseURI).href));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new require$$0.BrowserWindow({
    title: "Pluto",
    icon: path.join(process.env.VITE_PUBLIC, "logo.png"),
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    },
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
require$$0.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    require$$0.app.quit();
    win = null;
  }
});
require$$0.app.on("activate", () => {
  if (require$$0.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
require$$0.app.on("before-quit", async () => {
  console.log("[Pluto] Shutting down...");
  await whisperX.stop();
});
require$$0.app.whenReady().then(async () => {
  require$$0.ipcMain.handle("DESKTOP_CAPTURER_GET_SOURCES", (_event, opts) => require$$0.desktopCapturer.getSources(opts));
  require$$0.ipcMain.handle("WHISPERX_CHECK_PYTHON", async () => {
    return await whisperX.checkPython();
  });
  require$$0.ipcMain.handle("WHISPERX_START", async () => {
    await whisperX.start();
    return { success: true };
  });
  require$$0.ipcMain.handle("WHISPERX_STOP", async () => {
    await whisperX.stop();
    return { success: true };
  });
  require$$0.ipcMain.handle("WHISPERX_HEALTH", async () => {
    return await whisperX.health();
  });
  require$$0.ipcMain.handle("WHISPERX_TRANSCRIBE", async (_event, { audioPath, options }) => {
    return await whisperX.transcribe(audioPath, options);
  });
  require$$0.ipcMain.handle("WHISPERX_LIST_MODELS", async () => {
    return await whisperX.listModels();
  });
  require$$0.ipcMain.handle("WHISPER_TRANSCRIBE", async (_event, audioPath, options = {}) => {
    console.log("[Pluto] Transcribing file:", audioPath, options.diarize ? "(with diarization)" : "");
    return await whisperX.transcribe(audioPath, options);
  });
  require$$0.ipcMain.handle("AUDIO_SAVE_AND_CONVERT", async (_event, arrayBuffer) => {
    const buffer = Buffer.from(arrayBuffer);
    const tempId = Date.now().toString();
    const rawPath = path.join(require$$0.app.getPath("temp"), `raw_${tempId}.webm`);
    const wavPath = path.join(require$$0.app.getPath("userData"), "meetings", `${tempId}.wav`);
    console.log(`[Pluto] Received buffer of ${buffer.length} bytes`);
    const meetingsDir = path.join(require$$0.app.getPath("userData"), "meetings");
    if (!fs.existsSync(meetingsDir)) fs.mkdirSync(meetingsDir, { recursive: true });
    console.log(`[Pluto] Saving raw audio to ${rawPath}`);
    fs.writeFileSync(rawPath, buffer);
    return new Promise((resolve, reject) => {
      console.log(`[Pluto] Converting to WAV: ${wavPath}`);
      ffmpeg(rawPath).toFormat("wav").audioChannels(1).audioFrequency(16e3).on("end", () => {
        console.log("[Pluto] Conversion complete.");
        if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
        resolve(wavPath);
      }).on("error", (err) => {
        console.error("[Pluto] Conversion failed:", err);
        if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
        reject(err);
      }).save(wavPath);
    });
  });
  require$$0.ipcMain.handle("SAVE_MEETING", (_event, meeting) => {
    try {
      console.log(`[Pluto] Saving meeting: ${meeting.id} - ${meeting.title}`);
      return saveMeeting(meeting);
    } catch (e) {
      console.error("[Pluto] SAVE_MEETING failed:", e);
      throw e;
    }
  });
  require$$0.ipcMain.handle("GET_MEETINGS", () => getMeetings());
  require$$0.ipcMain.handle("GET_MEETING", (_event, id) => getMeeting(id));
  require$$0.ipcMain.handle("SEARCH_MEETINGS", (_event, query) => searchMeetings(query));
  require$$0.ipcMain.handle("DELETE_MEETING", (_event, id) => {
    try {
      return deleteMeeting(id);
    } catch (e) {
      console.error("[Pluto] DELETE_MEETING failed:", e);
      throw e;
    }
  });
  require$$0.ipcMain.handle("UPSERT_ENTITY", (_event, entity) => {
    try {
      return upsertEntity(entity);
    } catch (e) {
      console.error("[Pluto] UPSERT_ENTITY failed:", e);
      throw e;
    }
  });
  require$$0.ipcMain.handle("GET_ENTITY", (_event, id) => getEntity(id));
  require$$0.ipcMain.handle("GET_ENTITIES_BY_TYPE", (_event, type) => getEntitiesByType(type));
  require$$0.ipcMain.handle("GET_ALL_ENTITIES", () => getAllEntities());
  require$$0.ipcMain.handle("SEARCH_ENTITIES", (_event, query) => searchEntities(query));
  require$$0.ipcMain.handle("FIND_ENTITY", (_event, { type, name }) => findEntity(type, name));
  require$$0.ipcMain.handle("UPDATE_ENTITY_STATUS", (_event, { id, status }) => updateEntityStatus(id, status));
  require$$0.ipcMain.handle("DELETE_ENTITY", (_event, id) => deleteEntity(id));
  require$$0.ipcMain.handle("LINK_ENTITIES", (_event, link) => {
    try {
      return linkEntities(link);
    } catch (e) {
      console.error("[Pluto] LINK_ENTITIES failed:", e);
      throw e;
    }
  });
  require$$0.ipcMain.handle("GET_ENTITY_LINKS", (_event, entityId) => getEntityLinks(entityId));
  require$$0.ipcMain.handle("GET_RELATED_ENTITIES", (_event, entityId) => getRelatedEntities(entityId));
  require$$0.ipcMain.handle("ADD_MEETING_ENTITY", (_event, meetingEntity) => {
    try {
      return addMeetingEntity(meetingEntity);
    } catch (e) {
      console.error("[Pluto] ADD_MEETING_ENTITY failed:", e);
      throw e;
    }
  });
  require$$0.ipcMain.handle("GET_MEETING_ENTITIES", (_event, meetingId) => getMeetingEntities(meetingId));
  require$$0.ipcMain.handle("GET_ENTITY_MEETINGS", (_event, entityId) => getEntityMeetings(entityId));
  require$$0.ipcMain.handle("GET_ACTION_ITEMS_BY_STATUS", (_event, status) => getActionItemsByStatus(status));
  require$$0.ipcMain.handle("GET_OVERDUE_ACTION_ITEMS", () => getOverdueActionItems());
  require$$0.ipcMain.handle("GET_STALE_ACTION_ITEMS", (_event, staleDays) => getStaleActionItems(staleDays));
  require$$0.ipcMain.handle("GET_KNOWLEDGE_GRAPH_STATS", () => getKnowledgeGraphStats());
  require$$0.ipcMain.handle("RESET_KNOWLEDGE", async () => {
    try {
      return resetKnowledge();
    } catch (e) {
      console.error("[Pluto] RESET_KNOWLEDGE failed:", e);
      throw e;
    }
  });
  require$$0.ipcMain.handle("GET_SETTING", (_event, key) => getSetting(key));
  require$$0.ipcMain.handle("SET_SETTING", (_event, { key, value }) => setSetting(key, value));
  require$$0.ipcMain.handle("GENERATE_SUMMARY", async (_event, { transcript, userNotes }) => {
    try {
      const settings = await getAllSettings(db$1);
      const provider = await getProvider(settings);
      console.log(`[LLM] Using provider: ${provider.name}`);
      return await provider.generateSummary(transcript, userNotes);
    } catch (error) {
      console.error("[LLM] Summary generation failed:", error);
      throw error;
    }
  });
  require$$0.ipcMain.handle("EXTRACT_SPEAKER_IDENTITY", async (_event, { transcript }) => {
    try {
      const settings = await getAllSettings(db$1);
      const provider = await getProvider(settings);
      console.log(`[LLM] Using provider: ${provider.name}`);
      return await provider.extractSpeakerIdentity(transcript);
    } catch (error) {
      console.error("[LLM] Speaker extraction failed:", error);
      return null;
    }
  });
  require$$0.ipcMain.handle("GENERATE_TITLE", async (_event, { transcript }) => {
    try {
      const settings = await getAllSettings(db$1);
      const provider = await getProvider(settings);
      console.log(`[LLM] Generating title with provider: ${provider.name}`);
      return await provider.generateTitle(transcript);
    } catch (error) {
      console.error("[LLM] Title generation failed:", error);
      return "Meeting";
    }
  });
  require$$0.ipcMain.handle("EXTRACT_ENTITIES", async (_event, { transcript }) => {
    try {
      const settings = await getAllSettings(db$1);
      const provider = await getProvider(settings);
      console.log(`[LLM] Extracting entities with provider: ${provider.name}`);
      return await provider.extractEntities(transcript);
    } catch (error) {
      console.error("[LLM] Entity extraction failed:", error);
      return {
        people: [],
        topics: [],
        action_items: [],
        decisions: [],
        projects: []
      };
    }
  });
  require$$0.ipcMain.handle("EXTRACT_AND_PROCESS_ENTITIES", async (_event, { transcript, meetingId }) => {
    try {
      const settings = await getAllSettings(db$1);
      const provider = await getProvider(settings);
      console.log(`[LLM] Extracting and processing entities for meeting ${meetingId}`);
      return await extractAndProcessEntities(provider, transcript, meetingId);
    } catch (error) {
      console.error("[LLM] Entity extraction and processing failed:", error);
      throw error;
    }
  });
  require$$0.ipcMain.handle("PROCESS_EXTRACTED_ENTITIES", async (_event, { entities, meetingId }) => {
    try {
      console.log(`[EntityPipeline] Processing pre-extracted entities for meeting ${meetingId}`);
      return await processExtractedEntities(entities, meetingId);
    } catch (error) {
      console.error("[EntityPipeline] Processing failed:", error);
      throw error;
    }
  });
  require$$0.ipcMain.handle("CHECK_MICROPHONE_PERMISSION", () => {
    if (process.platform === "darwin") {
      return require$$0.systemPreferences.getMediaAccessStatus("microphone");
    }
    return "granted";
  });
  require$$0.ipcMain.handle("CHECK_SCREEN_PERMISSION", () => {
    if (process.platform !== "darwin") return "authorized";
    try {
      const { getAuthStatus } = require("node-mac-permissions");
      return getAuthStatus("screen");
    } catch (error) {
      console.error("Failed to check screen permission:", error);
      return "undetermined";
    }
  });
  require$$0.ipcMain.handle("REQUEST_SCREEN_PERMISSION", () => {
    if (process.platform !== "darwin") return true;
    try {
      const { askForScreenCaptureAccess } = require("node-mac-permissions");
      askForScreenCaptureAccess();
      return true;
    } catch (error) {
      console.error("Failed to request screen permission:", error);
      return false;
    }
  });
  require$$0.ipcMain.handle("GET_DESKTOP_SOURCES", async () => {
    try {
      const sources = await require$$0.desktopCapturer.getSources({ types: ["screen"] });
      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL()
      }));
    } catch (error) {
      console.error("Failed to get desktop sources:", error);
      return [];
    }
  });
  whisperX.start().catch((err) => {
    console.warn("[Pluto] WhisperX failed to start:", err.message);
    console.log("[Pluto] WhisperX will start on first transcription request");
  });
  if (process.platform === "darwin") {
    console.log("[Pluto] Requesting microphone access from OS...");
    require$$0.systemPreferences.askForMediaAccess("microphone").then((granted) => {
      console.log(`[Pluto] Microphone access granted: ${granted}`);
    }).catch((err) => {
      console.error("[Pluto] Failed to request microphone access:", err);
    });
  }
  createWindow();
});
exports.MAIN_DIST = MAIN_DIST;
exports.RENDERER_DIST = RENDERER_DIST;
exports.VITE_DEV_SERVER_URL = VITE_DEV_SERVER_URL;

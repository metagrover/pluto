/**
 * Knowledge Graph API
 *
 * Typed wrapper for Knowledge Graph IPC calls.
 * Sprint 2: Entity extraction, resolution, and relationship management.
 */

// Type definitions matching the database schema
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

export interface EntityMeeting {
  id: string;
  title: string;
  meeting_type: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string | null;
  mention_count: number;
  context: string | null;
}

export interface KnowledgeGraphStats {
  total_entities: number;
  by_type: Record<EntityType, number>;
  total_links: number;
  total_meeting_connections: number;
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
  type: Extract<EntityType, 'topic' | 'decision'>;
  name: string;
  updated_at: string;
  meeting_count: number;
  mention_count: number;
  last_mentioned_at: string | null;
  latest_context: string | null;
}

// =============================================
// ENTITY EXTRACTION TYPES
// =============================================

export interface ExtractedEntities {
  people: Array<{
    name: string;
    role?: string;
  }>;
  topics: Array<{
    name: string;
    importance: 'high' | 'medium' | 'low';
  }>;
  action_items: Array<{
    description: string;
    assignee?: string;
    due_date?: string;
  }>;
  decisions: Array<{
    description: string;
    rationale?: string;
  }>;
  projects?: Array<{
    name: string;
    context?: string;
  }>;
}

export interface ValueGainSignals {
  analysis_schema_version?: number;
  continuity: string[];
  accountability_risks: string[];
  decision_impacts: string[];
  extra_tags?: Array<{
    tag: string;
    confidence: number;
  }>;
}

export interface ExtractionPriorityHints {
  prioritized_terms: string[];
  relationship_bias: Record<string, number>;
}

export interface ProcessedEntities {
  created: number;
  updated: number;
  linked: number;
  entities: Entity[];
}

// Entity emoji map for UI
export const ENTITY_ICONS: Record<EntityType, string> = {
  person: '👤',
  topic: '💡',
  action_item: '✅',
  decision: '⚖️',
  project: '📁',
};

// Status badge colors
export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  completed: { bg: 'bg-green-500/20', text: 'text-green-400' },
  stale: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  overdue: { bg: 'bg-red-500/20', text: 'text-red-400' },
};

// IPC invoke helper
const invoke = <T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> => {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

// =============================================
// ENTITY EXTRACTION
// =============================================

/**
 * Extract entities from a transcript (returns raw LLM extraction)
 */
export const extractEntities = async (
  transcript: string,
  context?: {
    summary?: string;
    valueSignals?: ValueGainSignals;
    priorityHints?: ExtractionPriorityHints;
  },
): Promise<ExtractedEntities> => {
  return invoke('EXTRACT_ENTITIES', {
    transcript,
    summary: context?.summary,
    valueSignals: context?.valueSignals,
    priorityHints: context?.priorityHints,
  });
};

/**
 * Extract entities from a transcript AND save them to the knowledge graph
 */
export const extractAndProcessEntities = async (
  transcript: string,
  meetingId: string,
  context?: {
    summary?: string;
    valueSignals?: ValueGainSignals;
    priorityHints?: ExtractionPriorityHints;
  },
): Promise<ProcessedEntities> => {
  return invoke('EXTRACT_AND_PROCESS_ENTITIES', {
    transcript,
    meetingId,
    summary: context?.summary,
    valueSignals: context?.valueSignals,
    priorityHints: context?.priorityHints,
  });
};

/**
 * Process pre-extracted entities (save to knowledge graph)
 */
export const processExtractedEntities = async (
  entities: ExtractedEntities,
  meetingId: string,
): Promise<ProcessedEntities> => {
  return invoke('PROCESS_EXTRACTED_ENTITIES', { entities, meetingId });
};

/**
 * Delete a meeting and all associated knowledge
 */
export const deleteMeeting = async (id: string): Promise<void> => {
  return invoke('DELETE_MEETING', id);
};

// =============================================
// ENTITY OPERATIONS
// =============================================

/**
 * Create or update an entity
 */
export const upsertEntity = async (entity: {
  id?: string;
  type: EntityType;
  name: string;
  status?: EntityStatus;
  due_date?: string | null;
  assigned_to?: string | null;
  metadata?: Record<string, unknown>;
  dedupe_by_name?: boolean;
}): Promise<Entity> => {
  return invoke('UPSERT_ENTITY', entity);
};

/**
 * Get entity by ID
 */
export const getEntity = async (id: string): Promise<Entity | undefined> => {
  return invoke('GET_ENTITY', id);
};

/**
 * Get all entities of a specific type
 */
export const getEntitiesByType = async (
  type: EntityType,
): Promise<Entity[]> => {
  return invoke('GET_ENTITIES_BY_TYPE', type);
};

/** Read-only source summaries for the Projects overview. */
export const getProjectPortfolio = async (): Promise<
  import('../utils/projectPortfolio').ProjectPortfolioEntry[]
> => invoke('GET_PROJECT_PORTFOLIO');

export const getProjectBrief = async (
  projectId: string,
): Promise<import('../utils/projectBriefing').ProjectBrief | null> =>
  invoke('GET_PROJECT_BRIEF', projectId);

export const updateProjectDisplayTitle = async (
  projectId: string,
  title: string,
): Promise<Entity> =>
  invoke('UPDATE_PROJECT_DISPLAY_TITLE', { projectId, title });

export const mergeProject = async (
  projectId: string,
  destinationProjectId: string,
): Promise<void> =>
  invoke('MERGE_PROJECT', { projectId, destinationProjectId });

export const restoreProjectMerge = async (projectId: string): Promise<void> =>
  invoke('RESTORE_PROJECT_MERGE', projectId);

/** Discover at most one source-grounded initiative from one conversation. */
export const discoverProjectInitiative = async (
  options: { retryFailed?: boolean } = {},
): Promise<{
  discovered: number;
  remaining: number;
  failed: number;
  deferred: boolean;
  attemptedSourceId?: string;
  failedSourceId?: string;
  discoveredProjectId?: string;
}> => invoke('DISCOVER_PROJECT_INITIATIVE', options);

/** Review one bounded batch of existing candidates against their source conversations. */
export const reviewProjectScope = async (
  options: { excludeProjectIds?: string[] } = {},
): Promise<{
  reviewed: number;
  remaining: number;
  deferred: boolean;
  failedProjectId?: string;
  unresolvedProjectId?: string;
  attemptedProjectId?: string;
}> => invoke('REVIEW_PROJECT_SCOPE', options);

/**
 * Get all entities
 */
export const getAllEntities = async (): Promise<Entity[]> => {
  return invoke('GET_ALL_ENTITIES');
};

/**
 * Search entities by name
 */
export const searchEntities = async (query: string): Promise<Entity[]> => {
  return invoke('SEARCH_ENTITIES', query);
};

/**
 * Find entity by type and name
 */
export const findEntity = async (
  type: EntityType,
  name: string,
): Promise<Entity | undefined> => {
  return invoke('FIND_ENTITY', { type, name });
};

/**
 * Update entity status (for action items)
 */
export const updateEntityStatus = async (
  id: string,
  status: EntityStatus,
): Promise<void> => {
  return invoke('UPDATE_ENTITY_STATUS', { id, status });
};

export const updateActionCommitmentState = async (
  id: string,
  commitmentState: 'confirmed' | 'rejected',
): Promise<Entity> => {
  return invoke('UPDATE_ACTION_COMMITMENT_STATE', { id, commitmentState });
};

/**
 * Delete an entity
 */
export const deleteEntity = async (id: string): Promise<void> => {
  return invoke('DELETE_ENTITY', id);
};

// =============================================
// RELATIONSHIP OPERATIONS
// =============================================

/**
 * Link two entities with a relationship
 */
export const linkEntities = async (link: {
  source_entity_id: string;
  target_entity_id: string;
  relationship: RelationshipType;
  meeting_id?: string;
  confidence?: number;
  state?: RelationshipState;
  source?: LinkSource;
  evidence_meeting_id?: string;
  evidence_quote?: string;
}): Promise<EntityLink> => {
  return invoke('LINK_ENTITIES', link);
};

/**
 * Get all links for an entity (both directions)
 */
export const getEntityLinks = async (
  entityId: string,
  includeRejected = false,
): Promise<EntityLink[]> => {
  return invoke('GET_ENTITY_LINKS', { entityId, includeRejected });
};

/**
 * Get entities related to a specific entity
 */
export const getRelatedEntities = async (
  entityId: string,
  includeRejected = false,
): Promise<
  (Entity & {
    link_id: string;
    relationship: string;
    direction: 'outgoing' | 'incoming';
    state: RelationshipState;
    confidence: number;
    evidence_quote: string | null;
  })[]
> => {
  return invoke('GET_RELATED_ENTITIES', { entityId, includeRejected });
};

// =============================================
// MEETING-ENTITY ASSOCIATIONS
// =============================================

/**
 * Associate an entity with a meeting
 */
export const addMeetingEntity = async (meetingEntity: {
  meeting_id: string;
  entity_id: string;
  mention_count?: number;
  first_mentioned_at?: number;
  context?: string;
}): Promise<MeetingEntity> => {
  return invoke('ADD_MEETING_ENTITY', meetingEntity);
};

/**
 * Get all entities mentioned in a meeting
 */
export const getMeetingEntities = async (
  meetingId: string,
): Promise<(Entity & { mention_count: number; context: string | null })[]> => {
  return invoke('GET_MEETING_ENTITIES', meetingId);
};

/**
 * Get all meetings where an entity was mentioned
 */
export const getEntityMeetings = async (
  entityId: string,
): Promise<EntityMeeting[]> => {
  return invoke('GET_ENTITY_MEETINGS', entityId);
};

// =============================================
// ACTION ITEM QUERIES
// =============================================

/**
 * Get action items by status
 */
export const getActionItemsByStatus = async (
  status: EntityStatus,
): Promise<Entity[]> => {
  return invoke('GET_ACTION_ITEMS_BY_STATUS', status);
};

/**
 * Get overdue action items
 */
export const getOverdueActionItems = async (): Promise<Entity[]> => {
  return invoke('GET_OVERDUE_ACTION_ITEMS');
};

/**
 * Get stale action items (not mentioned in N days)
 */
export const getStaleActionItems = async (
  staleDays?: number,
): Promise<Entity[]> => {
  return invoke('GET_STALE_ACTION_ITEMS', staleDays);
};

// =============================================
// KNOWLEDGE GRAPH STATS
// =============================================

/**
 * Get knowledge graph statistics
 */
export const getKnowledgeGraphStats =
  async (): Promise<KnowledgeGraphStats> => {
    return invoke('GET_KNOWLEDGE_GRAPH_STATS');
  };

/**
 * Get knowledge feed summary rows for topic/decision entities.
 */
export const getKnowledgeFeedSummary = async (
  params: KnowledgeFeedQueryParams = {},
): Promise<KnowledgeFeedItemSummary[]> => {
  return invoke('GET_KNOWLEDGE_FEED_SUMMARY', params);
};

// =============================================
// HELPER FUNCTIONS
// =============================================

/**
 * Parse entity metadata JSON
 */
export const parseMetadata = <T extends Record<string, unknown>>(
  entity: Entity,
): T | null => {
  if (!entity.metadata) return null;
  try {
    return JSON.parse(entity.metadata) as T;
  } catch {
    return null;
  }
};

/**
 * Format entity for display
 */
export const formatEntityDisplay = (entity: Entity): string => {
  const icon = ENTITY_ICONS[entity.type];
  return `${icon} ${entity.name}`;
};

/**
 * Get human-readable entity type label
 */
export const getEntityTypeLabel = (type: EntityType): string => {
  const labels: Record<EntityType, string> = {
    person: 'Person',
    topic: 'Topic',
    action_item: 'Action Item',
    decision: 'Decision',
    project: 'Project',
  };
  return labels[type];
};

/**
 * Get human-readable relationship label
 */
export const getRelationshipLabel = (
  relationship: RelationshipType,
): string => {
  const labels: Record<RelationshipType, string> = {
    discussed: 'discussed',
    assigned_to: 'assigned to',
    belongs_to: 'belongs to',
    relates_to: 'relates to',
    attended: 'attended',
    produced: 'produced',
    impacts: 'impacts',
    works_on: 'works on',
    involved_in: 'involved in',
    depends_on: 'depends on',
    blocked_by: 'blocked by',
    owns: 'owns',
  };
  return labels[relationship];
};

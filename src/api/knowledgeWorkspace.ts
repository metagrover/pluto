import type { KnowledgeDoc } from './knowledgeDocs';
import type {
  EntityStatus,
  EntityType,
  RelationshipState,
  RelationshipType,
} from './knowledgeGraph';

export interface KnowledgeGraphNode {
  id: string;
  type: EntityType;
  label: string;
  status: EntityStatus;
  mention_count: number;
  metadata: string | null;
  saliency_score: number;
  domain_tag: string;
}

export interface KnowledgeGraphEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  source_label: string;
  target_label: string;
  relationship: RelationshipType;
  state: RelationshipState;
  confidence: number;
  evidence_meeting_id: string | null;
  evidence_quote: string | null;
  source: 'pipeline' | 'synthesis' | 'user';
  meeting_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeTimelineItem {
  id: string;
  kind: 'synthesis' | 'dependency' | 'notes';
  title: string;
  detail: string;
  timestamp: string;
  doc_id: string;
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

export interface KnowledgeDocNote {
  doc_id: string;
  markdown: string;
  parsed_links_json: string | null;
  updated_at: string;
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

const invoke = <T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> => {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

export const getKnowledgeWorkspace = async (params?: {
  docId?: string;
  includeRejected?: boolean;
}): Promise<KnowledgeWorkspacePayload> => {
  return invoke('GET_KNOWLEDGE_WORKSPACE', params);
};

export const getKnowledgeGraph = async (
  docId: string,
  options?: {
    includeRejected?: boolean;
    nodeTypes?: EntityType[];
    maxNodes?: number;
    maxEdges?: number;
    minConfidence?: number;
  },
): Promise<KnowledgeWorkspacePayload['graph']> => {
  return invoke('GET_KNOWLEDGE_GRAPH', { docId, options });
};

export const getKnowledgeTimeline = async (
  docId: string,
  limit = 20,
): Promise<KnowledgeTimelineItem[]> => {
  return invoke('GET_KNOWLEDGE_TIMELINE', { docId, limit });
};

export const getKnowledgeBacklinks = async (
  docId: string,
  options?: {
    target_kind?: 'entity' | 'doc';
    target_id?: string;
  },
): Promise<KnowledgeBacklink[]> => {
  return invoke('GET_KNOWLEDGE_BACKLINKS', { docId, options });
};

export const getKnowledgeDocNotes = async (
  docId: string,
): Promise<KnowledgeDocNote | undefined> => {
  return invoke('GET_KNOWLEDGE_DOC_NOTES', docId);
};

export const saveKnowledgeDocNotes = async (
  docId: string,
  markdown: string,
): Promise<KnowledgeDocNote> => {
  return invoke('SAVE_KNOWLEDGE_DOC_NOTES', { docId, markdown });
};

export const setEntityLinkState = async (
  id: string,
  state: RelationshipState,
): Promise<KnowledgeGraphEdge | undefined> => {
  return invoke('SET_ENTITY_LINK_STATE', { id, state });
};

export const resolveConflictLinks = async (
  winnerId: string,
  loserId: string,
): Promise<{
  winner: KnowledgeGraphEdge | undefined;
  loser: KnowledgeGraphEdge | undefined;
}> => {
  return invoke('RESOLVE_CONFLICT', { winnerId, loserId });
};

export interface EntitySummarySentence {
  text: string;
  source_meeting_ids: string[];
}

export interface EntitySummary {
  sentences: EntitySummarySentence[];
  isInitialExtraction: boolean;
}

export const getEntitySummary = async (
  entityId: string,
): Promise<EntitySummary> => {
  return invoke('GET_ENTITY_SUMMARY', entityId);
};

export const parseNoteLinks = (
  note: KnowledgeDocNote | null | undefined,
): Array<{
  label: string;
  target_kind: 'entity' | 'doc' | null;
  target_id: string | null;
  snippet: string;
}> => {
  if (!note?.parsed_links_json) return [];
  try {
    const parsed = JSON.parse(note.parsed_links_json) as unknown;
    return Array.isArray(parsed)
      ? (parsed as Array<{
          label: string;
          target_kind: 'entity' | 'doc' | null;
          target_id: string | null;
          snippet: string;
        }>)
      : [];
  } catch {
    return [];
  }
};

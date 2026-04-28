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
  synthesis_version?: number;
}

export interface KnowledgeDoc {
  id: string;
  scope_type: KnowledgeDocScopeType;
  scope_key: string;
  title: string;
  rendered_content: string | null;
  structured_json: string | null;
  config: string | null;
  status: KnowledgeDocStatus;
  last_synthesized_at: string | null;
  last_source_cursor: string | null;
  updated_at: string;
}

export interface KnowledgeDocSource {
  doc_id: string;
  meeting_id: string;
  contributed_at: string;
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

export type KnowledgeCorrectionTargetKind = 'source' | 'stream' | 'item';
export type KnowledgeCorrectionAction =
  | 'exclude_source'
  | 'rename_stream'
  | 'merge_stream'
  | 'split_stream'
  | 'pin_stream'
  | 'promote_item'
  | 'demote_item'
  | 'correct_classification';

export interface KnowledgeCorrection {
  id: string;
  doc_id: string;
  target_kind: KnowledgeCorrectionTargetKind;
  target_id: string;
  action: KnowledgeCorrectionAction;
  payload_json: string | null;
  created_at: string;
}

const invoke = <T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> => {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

export const getKnowledgeDocs = async (filters?: {
  includeInactive?: boolean;
  scopeType?: KnowledgeDocScopeType | 'all';
}): Promise<KnowledgeDoc[]> => {
  return invoke('GET_KNOWLEDGE_DOCS', filters);
};

export const getKnowledgeDoc = async (
  id: string,
): Promise<KnowledgeDoc | undefined> => {
  return invoke('GET_KNOWLEDGE_DOC', id);
};

export const getKnowledgeDocVersions = async (
  docId: string,
  limit = 10,
): Promise<KnowledgeDocVersion[]> => {
  return invoke('GET_KNOWLEDGE_DOC_VERSIONS', { docId, limit });
};

export const getKnowledgeDocSources = async (
  docId: string,
): Promise<KnowledgeDocSource[]> => {
  return invoke('GET_KNOWLEDGE_DOC_SOURCES', docId);
};

export const refreshKnowledgeDoc = async (
  docId: string,
): Promise<KnowledgeDoc | undefined> => {
  return invoke('REFRESH_KNOWLEDGE_DOC', docId);
};

export const saveKnowledgeDocEdit = async (
  docId: string,
  content: string,
): Promise<KnowledgeDocUserEdit> => {
  return invoke('SAVE_KNOWLEDGE_DOC_EDIT', { docId, content });
};

export const getKnowledgeCorrections = async (
  docId: string,
): Promise<KnowledgeCorrection[]> => {
  return invoke('GET_KNOWLEDGE_CORRECTIONS', docId);
};

export const saveKnowledgeCorrection = async (params: {
  docId: string;
  targetKind: KnowledgeCorrectionTargetKind;
  targetId: string;
  action: KnowledgeCorrectionAction;
  payload?: Record<string, unknown> | null;
}): Promise<KnowledgeCorrection> => {
  return invoke('SAVE_KNOWLEDGE_CORRECTION', params);
};

export const parseKnowledgeDocStructured = <T = Record<string, unknown>>(
  doc: KnowledgeDoc,
): T | null => {
  if (!doc.structured_json) return null;
  try {
    return JSON.parse(doc.structured_json) as T;
  } catch {
    return null;
  }
};

export const parseKnowledgeDocChangelog = <T = Record<string, unknown>>(
  version: KnowledgeDocVersion,
): T | null => {
  if (!version.changelog_json) return null;
  try {
    return JSON.parse(version.changelog_json) as T;
  } catch {
    return null;
  }
};

export const parseKnowledgeDocConfig = (
  doc: KnowledgeDoc,
): KnowledgeDocConfig => {
  if (!doc.config) return {};
  try {
    return JSON.parse(doc.config) as KnowledgeDocConfig;
  } catch {
    return {};
  }
};

export interface PersonContextCandidate {
  person_id: string;
  person_name: string;
  meeting_count: number;
  mention_count: number;
  last_mentioned_at: string | null;
}

export const createTeamTracker = async (params: {
  title: string;
  memberEntityIds: string[];
}): Promise<KnowledgeDoc> => {
  return invoke('CREATE_TEAM_TRACKER', params);
};

export const updateTeamTrackerMembers = async (
  docId: string,
  memberEntityIds: string[],
): Promise<KnowledgeDoc | undefined> => {
  return invoke('UPDATE_TEAM_TRACKER_MEMBERS', { docId, memberEntityIds });
};

export const getPersonContextCandidates = async (): Promise<
  PersonContextCandidate[]
> => {
  return invoke('GET_PERSON_CONTEXT_CANDIDATES');
};

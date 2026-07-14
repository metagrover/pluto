import { deriveKnowledgeTrustStatus } from '../src/utils/trustStatus';
import type {
  KnowledgeDoc,
  WorkingMemorySnapshot,
  WorkingMemorySnapshotPayload,
  WorkingMemorySnapshotScopeType,
} from './db';
import { upsertWorkingMemorySnapshot } from './db';
import type { KnowledgeV2Document } from './knowledgeV2';

const parseMemberEntityIds = (
  knowledgeDoc: KnowledgeDoc,
): string[] | undefined => {
  if (knowledgeDoc.scope_type !== 'team_tracker' || !knowledgeDoc.config) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(knowledgeDoc.config) as {
      member_entity_ids?: unknown;
    };

    if (!Array.isArray(parsed.member_entity_ids)) {
      return undefined;
    }

    const memberEntityIds = parsed.member_entity_ids.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );

    return memberEntityIds.length > 0 ? memberEntityIds : undefined;
  } catch {
    return undefined;
  }
};

const buildWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  scopeType,
  generatedAt = new Date().toISOString(),
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  scopeType: WorkingMemorySnapshotScopeType;
  generatedAt?: string;
}): Omit<WorkingMemorySnapshot, 'id' | 'updated_at'> => {
  const trustStatus = deriveKnowledgeTrustStatus({
    docStatus: knowledgeDoc.status,
    evidenceQuality: structured.current_read.evidence_quality,
  });
  const memberEntityIds =
    scopeType === 'team_tracker'
      ? parseMemberEntityIds(knowledgeDoc)
      : undefined;

  const payload: WorkingMemorySnapshotPayload = {
    schema_version: 1,
    scope: {
      type: scopeType,
      key: knowledgeDoc.scope_key,
      title: knowledgeDoc.title,
      ...(memberEntityIds ? { member_entity_ids: memberEntityIds } : {}),
    },
    source: {
      knowledge_doc_id: knowledgeDoc.id,
      knowledge_doc_last_synthesized_at: knowledgeDoc.last_synthesized_at,
      knowledge_doc_last_source_cursor: knowledgeDoc.last_source_cursor,
    },
    current_read: {
      headline: structured.current_read.headline,
      supporting_bullets: [...structured.current_read.supporting_bullets],
      freshness: structured.current_read.freshness,
      trust_status: trustStatus,
      trust_message: structured.current_read.trust_message,
      source_count: structured.current_read.source_count,
      cited_item_count: structured.current_read.cited_item_count,
      cited_meeting_count: structured.current_read.cited_meeting_count,
      evidence_quality: { ...structured.current_read.evidence_quality },
    },
    active_streams: structured.active_streams.map((stream) => ({ ...stream })),
    open_loops: structured.needs_attention.map((item) => ({ ...item })),
    patterns: structured.patterns.map((item) => ({ ...item })),
    risks_and_unknowns: structured.risks_and_unknowns.map((item) => ({
      ...item,
    })),
    evidence_index: structured.evidence_index.map((entry) => ({ ...entry })),
    source_quality_summary: {
      included_count: structured.source_quality_summary.included_count,
      excluded_count: structured.source_quality_summary.excluded_count,
      weak_count: structured.source_quality_summary.weak_count,
      records: structured.source_quality_summary.records.map((record) => ({
        ...record,
      })),
    },
    change_summary: {
      generated_at: structured.change_summary.generated_at,
      added_count: structured.change_summary.added_count,
      removed_count: structured.change_summary.removed_count,
      updated_count: structured.change_summary.updated_count,
      notable_changes: [...structured.change_summary.notable_changes],
    },
  };

  return {
    scope_type: scopeType,
    scope_key: knowledgeDoc.scope_key,
    title: knowledgeDoc.title,
    source_doc_id: knowledgeDoc.id,
    source_doc_last_synthesized_at: knowledgeDoc.last_synthesized_at,
    freshness: structured.current_read.freshness,
    trust_status: trustStatus,
    source_count: structured.current_read.source_count,
    cited_meeting_count: structured.current_read.cited_meeting_count,
    payload,
    generated_at: generatedAt,
  };
};

const persistWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  scopeType,
  generatedAt,
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  scopeType: WorkingMemorySnapshotScopeType;
  generatedAt?: string;
}): WorkingMemorySnapshot => {
  const snapshot = buildWorkingMemorySnapshot({
    knowledgeDoc,
    structured,
    scopeType,
    generatedAt,
  });

  return upsertWorkingMemorySnapshot(snapshot);
};

export const buildGlobalWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  generatedAt = new Date().toISOString(),
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  generatedAt?: string;
}): Omit<WorkingMemorySnapshot, 'id' | 'updated_at'> =>
  buildWorkingMemorySnapshot({
    knowledgeDoc,
    structured,
    scopeType: 'global',
    generatedAt,
  });

export const persistGlobalWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  generatedAt,
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  generatedAt?: string;
}): WorkingMemorySnapshot =>
  persistWorkingMemorySnapshot({
    knowledgeDoc,
    structured,
    scopeType: 'global',
    generatedAt,
  });

export const buildProjectWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  generatedAt = new Date().toISOString(),
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  generatedAt?: string;
}): Omit<WorkingMemorySnapshot, 'id' | 'updated_at'> =>
  buildWorkingMemorySnapshot({
    knowledgeDoc,
    structured,
    scopeType: 'project',
    generatedAt,
  });

export const persistProjectWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  generatedAt,
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  generatedAt?: string;
}): WorkingMemorySnapshot =>
  persistWorkingMemorySnapshot({
    knowledgeDoc,
    structured,
    scopeType: 'project',
    generatedAt,
  });

export const buildTeamTrackerWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  generatedAt = new Date().toISOString(),
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  generatedAt?: string;
}): Omit<WorkingMemorySnapshot, 'id' | 'updated_at'> =>
  buildWorkingMemorySnapshot({
    knowledgeDoc,
    structured,
    scopeType: 'team_tracker',
    generatedAt,
  });

export const persistTeamTrackerWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  generatedAt,
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  generatedAt?: string;
}): WorkingMemorySnapshot =>
  persistWorkingMemorySnapshot({
    knowledgeDoc,
    structured,
    scopeType: 'team_tracker',
    generatedAt,
  });

export const buildPersonContextWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  generatedAt = new Date().toISOString(),
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  generatedAt?: string;
}): Omit<WorkingMemorySnapshot, 'id' | 'updated_at'> =>
  buildWorkingMemorySnapshot({
    knowledgeDoc,
    structured,
    scopeType: 'person_context',
    generatedAt,
  });

export const persistPersonContextWorkingMemorySnapshot = ({
  knowledgeDoc,
  structured,
  generatedAt,
}: {
  knowledgeDoc: KnowledgeDoc;
  structured: KnowledgeV2Document;
  generatedAt?: string;
}): WorkingMemorySnapshot =>
  persistWorkingMemorySnapshot({
    knowledgeDoc,
    structured,
    scopeType: 'person_context',
    generatedAt,
  });

import {
  readUserProjectMilestones,
  withSavedUserProjectMilestone,
} from '../../src/utils/projectMilestones';
import * as db from '../db';
import type { Entity } from '../db';
import type { DreamingEntityType } from './types';

interface LegacyProjectDreamingOutput {
  status: 'updated' | 'no_change';
  dossier_summary?: string;
  milestones?: Array<{
    name: string;
    status: 'planned' | 'in_progress' | 'completed';
    source_meeting_id: string;
    evidence_snippet: string;
  }>;
  associated_commitments?: Array<{
    task: string;
    owner_name: string;
    source_meeting_id: string;
  }>;
  suggested_aliases?: string[];
}

interface LegacyPersonDreamingOutput {
  status: 'updated' | 'no_change';
  headline?: string;
  current_focus?: string;
  recent_collaborators?: string[];
  suggested_aliases?: string[];
}

export interface ReconcileDreamingOutputDeps {
  getEntity(id: string): Entity | null | undefined;
  upsertEntity: typeof db.upsertEntity;
  saveAliasSuggestion(input: {
    entityId: string;
    suggestedName: string;
    sourceMeetingIds?: string[];
    evidenceSnippet?: string;
  }): void;
  isItemDismissed(
    entityId: string,
    itemType: string,
    fingerprint: string,
  ): boolean;
  now?: () => string;
}

export const reconcileDreamingOutput = async (
  entityId: string,
  type: DreamingEntityType,
  output: LegacyProjectDreamingOutput | LegacyPersonDreamingOutput,
  deps?: Partial<ReconcileDreamingOutputDeps>,
): Promise<void> => {
  const getEntity = deps?.getEntity ?? db.getEntity;
  const upsertEntity = deps?.upsertEntity ?? db.upsertEntity;
  const saveAliasSuggestion =
    deps?.saveAliasSuggestion ?? db.saveEntityAliasSuggestion;
  const isItemDismissed = deps?.isItemDismissed ?? db.isItemDismissed;

  const entity = getEntity(entityId);
  if (!entity) return;

  const now = deps?.now?.() ?? new Date().toISOString();
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(entity.metadata || '{}');
  } catch {
    metadata = {};
  }

  if (type === 'project') {
    const projectOutput = output as LegacyProjectDreamingOutput;

    if (projectOutput.dossier_summary) {
      metadata.dossierSummary = projectOutput.dossier_summary;
    }

    let metadataStr = JSON.stringify(metadata);
    let finalMetadata = metadata;
    if (projectOutput.milestones && projectOutput.milestones.length > 0) {
      const existing = readUserProjectMilestones(metadataStr);
      for (const m of projectOutput.milestones) {
        const alreadyExists = existing.some(
          (ex) => ex.title.trim().toLowerCase() === m.name.trim().toLowerCase(),
        );
        const dismissed = isItemDismissed(entityId, 'milestone', m.name);
        if (!alreadyExists && !dismissed) {
          const res = withSavedUserProjectMilestone(
            metadataStr,
            {
              title: m.name,
              status: m.status,
              note: `From meeting: ${m.source_meeting_id} | ${m.evidence_snippet}`,
            },
            {
              id: `ms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              now,
            },
          );
          metadataStr = res.metadata;
        }
      }
      try {
        finalMetadata = JSON.parse(metadataStr);
      } catch {
        finalMetadata = metadata;
      }
    }

    if (projectOutput.suggested_aliases) {
      for (const alias of projectOutput.suggested_aliases) {
        saveAliasSuggestion({
          entityId,
          suggestedName: alias,
        });
      }
    }

    upsertEntity({
      id: entity.id,
      type: entity.type,
      name: entity.name,
      metadata: finalMetadata,
    });
  } else if (type === 'person') {
    const personOutput = output as LegacyPersonDreamingOutput;

    if (personOutput.headline) {
      metadata.headline = personOutput.headline;
    }
    if (personOutput.current_focus) {
      metadata.currentFocus = personOutput.current_focus;
    }
    if (personOutput.recent_collaborators) {
      metadata.recentCollaborators = personOutput.recent_collaborators;
    }

    if (personOutput.suggested_aliases) {
      for (const alias of personOutput.suggested_aliases) {
        saveAliasSuggestion({
          entityId,
          suggestedName: alias,
        });
      }
    }

    upsertEntity({
      id: entity.id,
      type: entity.type,
      name: entity.name,
      metadata,
    });
  }
};

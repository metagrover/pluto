import type Database from 'better-sqlite3';
import {
  type ActionCommitmentMetadata,
  canonicalizeActionText,
  parseActionMetadata,
} from '../../src/utils/actionCommitment';
const truncateAtWordBoundary = (text: string, maxLength = 100): string => {
  if (text.length <= maxLength) return text;
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (
    lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated
  ).trim();
};

export interface MeetingActionSyncResult {
  actionsUpdated: number;
  continuationsCreated: number;
  continuationsUpdated: number;
  continuationsRemoved: number;
}

interface PersistedMeetingRow {
  id: string;
  user_edits_json: string | null;
  analysis_json: string | null;
}

interface PersistedEntityRow {
  id: string;
  type: string;
  name: string;
  status: string;
  metadata: string | null;
}

interface NativeContinuationItem {
  id: string;
  text: string;
  completed?: boolean;
}

/**
 * Synchronize action item entities and user-authored continuation commitments
 * for a meeting from its user_edits_json.
 */
export const syncMeetingActionEntitiesFromUserEdits = (
  sqlite: Database.Database,
  meetingId: string,
): MeetingActionSyncResult => {
  const meeting = sqlite
    .prepare(
      'SELECT id, user_edits_json, analysis_json FROM meetings WHERE id = ?',
    )
    .get(meetingId) as PersistedMeetingRow | undefined;

  if (!meeting) {
    return {
      actionsUpdated: 0,
      continuationsCreated: 0,
      continuationsUpdated: 0,
      continuationsRemoved: 0,
    };
  }

  let editsMap: Record<
    string,
    { original?: string; edited?: string; edited_at?: string }
  > = {};
  if (meeting.user_edits_json) {
    try {
      editsMap = JSON.parse(meeting.user_edits_json);
    } catch {
      editsMap = {};
    }
  }

  let actionItems: Array<{
    text: string;
    assignee?: string | null;
    due?: string | null;
  }> = [];
  if (meeting.analysis_json) {
    try {
      const parsed = JSON.parse(meeting.analysis_json) as Record<
        string,
        unknown
      >;
      if (Array.isArray(parsed.all_action_items)) {
        actionItems = parsed.all_action_items as typeof actionItems;
      } else if (Array.isArray(parsed.action_items)) {
        actionItems = parsed.action_items as typeof actionItems;
      }
    } catch {
      actionItems = [];
    }
  }

  // Retrieve unretired action item entities for this meeting
  const existingEntities = sqlite
    .prepare(
      `
      SELECT id, type, name, status, metadata FROM entities
      WHERE type = 'action_item'
        AND (
          json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.source_meeting_id') = ?
          OR id IN (SELECT entity_id FROM meeting_entities WHERE meeting_id = ?)
        )
        AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.meeting_regeneration_retired_at') IS NULL
      ORDER BY created_at ASC, id ASC
    `,
    )
    .all(meetingId, meetingId) as PersistedEntityRow[];

  let actionsUpdated = 0;
  const claimedEntityIds = new Set<string>();

  // Gather all action indices from analysis, user edits, and existing entities
  const actionIndices = new Set<number>();
  for (let i = 0; i < actionItems.length; i++) actionIndices.add(i);
  for (const key of Object.keys(editsMap)) {
    const match = key.match(
      /^(?:completion:)?(?:all_action_items|v2:action):(\d+)$/,
    );
    if (match) actionIndices.add(Number(match[1]));
  }
  for (const entity of existingEntities) {
    const meta = parseActionMetadata(entity.metadata);
    if (typeof meta.source_index === 'number') {
      actionIndices.add(meta.source_index);
    } else if (typeof meta.source_path === 'string') {
      const match = meta.source_path.match(
        /^(?:all_action_items|v2:action):(\d+)$/,
      );
      if (match) actionIndices.add(Number(match[1]));
    }
  }

  // 1. Synchronize generated / extracted action items
  for (const index of Array.from(actionIndices).sort((a, b) => a - b)) {
    const item = actionItems[index] as
      | { text: string; assignee?: string | null; due?: string | null }
      | undefined;
    const v3Path = `all_action_items:${index}`;
    const v2Path = `v2:action:${index}`;

    // Find the matching entity for this action item
    let entity: PersistedEntityRow | undefined = existingEntities.find((e) => {
      if (claimedEntityIds.has(e.id)) return false;
      const meta = parseActionMetadata(e.metadata);
      return meta.source_path === v3Path || meta.source_path === v2Path;
    });

    if (!entity) {
      entity = existingEntities.find((e) => {
        if (claimedEntityIds.has(e.id)) return false;
        const meta = parseActionMetadata(e.metadata);
        return (
          meta.source_index === index &&
          (meta.origin === 'extraction' || !meta.origin)
        );
      });
    }

    if (!entity) {
      entity = existingEntities.find((e) => {
        if (claimedEntityIds.has(e.id)) return false;
        const meta = parseActionMetadata(e.metadata);
        const origDesc = meta.original_description || meta.full_description;
        return (
          (item && origDesc === item.text) ||
          origDesc === editsMap[v3Path]?.original ||
          origDesc === editsMap[v2Path]?.original
        );
      });
    }

    if (!entity) {
      // Positional fallback among unclaimed extraction entities
      entity = existingEntities.find((e) => {
        if (claimedEntityIds.has(e.id)) return false;
        const meta = parseActionMetadata(e.metadata);
        return meta.origin === 'extraction' || !meta.origin;
      });
    }

    if (!entity) continue;
    claimedEntityIds.add(entity.id);

    const meta = parseActionMetadata(entity.metadata);
    const baseText =
      (typeof meta.original_description === 'string' &&
        meta.original_description) ||
      item?.text ||
      editsMap[v3Path]?.original ||
      editsMap[v2Path]?.original ||
      (typeof meta.full_description === 'string' && meta.full_description) ||
      entity.name;

    const textEdit = editsMap[v3Path] ?? editsMap[v2Path];
    const effectiveText =
      textEdit && typeof textEdit.edited === 'string' && textEdit.edited.trim()
        ? textEdit.edited.trim()
        : baseText;
    const isUserEdited = Boolean(
      textEdit &&
        typeof textEdit.edited === 'string' &&
        textEdit.edited !== baseText,
    );

    const completionEdit =
      editsMap[`completion:${v3Path}`] ?? editsMap[`completion:${v2Path}`];
    let effectiveStatus = entity.status;
    if (completionEdit && typeof completionEdit.edited === 'string') {
      effectiveStatus =
        completionEdit.edited === 'true' ? 'completed' : 'active';
    } else if (meta.user_completed_edited) {
      effectiveStatus = 'active';
    }

    const assignee =
      typeof meta.assignee_name === 'string' ? meta.assignee_name : undefined;
    const canonical = canonicalizeActionText(effectiveText, assignee);
    const newName = truncateAtWordBoundary(canonical || effectiveText, 100);

    const needsUpdate =
      entity.name !== newName ||
      meta.full_description !== effectiveText ||
      entity.status !== effectiveStatus ||
      meta.source_path !== v3Path ||
      meta.source_index !== index ||
      Boolean(meta.user_edited) !== isUserEdited ||
      Boolean(meta.user_completed_edited) !== Boolean(completionEdit);

    if (needsUpdate) {
      const updatedMetadata: ActionCommitmentMetadata = {
        ...meta,
        commitment_state:
          meta.commitment_state === 'confirmed' ||
          meta.commitment_state === 'rejected'
            ? meta.commitment_state
            : 'possible',
        origin: meta.origin === 'user' ? 'user' : 'extraction',
        source_meeting_id: meetingId,
        full_description: effectiveText,
        original_description:
          typeof meta.original_description === 'string'
            ? meta.original_description
            : baseText,
        source_path: v3Path,
        source_index: index,
      };

      if (isUserEdited) {
        updatedMetadata.user_edited = true;
        updatedMetadata.user_edited_at =
          textEdit?.edited_at || new Date().toISOString();
      } else {
        updatedMetadata.user_edited = undefined;
        updatedMetadata.user_edited_at = undefined;
      }

      if (completionEdit) {
        updatedMetadata.user_completed_edited = true;
      } else {
        updatedMetadata.user_completed_edited = undefined;
      }

      sqlite
        .prepare(
          `
        UPDATE entities SET
          name = ?,
          status = ?,
          metadata = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
        )
        .run(
          newName,
          effectiveStatus,
          JSON.stringify(updatedMetadata),
          entity.id,
        );

      try {
        sqlite
          .prepare('DELETE FROM entities_fts WHERE entity_id = ?')
          .run(entity.id);
        sqlite
          .prepare('INSERT INTO entities_fts (name, entity_id) VALUES (?, ?)')
          .run(newName, entity.id);
      } catch {}

      try {
        sqlite
          .prepare(
            'UPDATE meeting_entities SET context = ? WHERE meeting_id = ? AND entity_id = ?',
          )
          .run(effectiveText, meetingId, entity.id);
      } catch {}

      actionsUpdated++;
    }
  }

  // 2. Synchronize native continuations (+ Add item in outcomes / action items)
  let continuationsCreated = 0;
  let continuationsUpdated = 0;
  let continuationsRemoved = 0;

  const continuationPaths = Object.keys(editsMap).filter(
    (key) => key.startsWith('continuation:') || key.includes(':continuation'),
  );

  const activeContinuationEntityIds = new Set<string>();

  for (const pathKey of continuationPaths) {
    const editEntry = editsMap[pathKey];
    if (!editEntry?.edited) continue;

    let parsedItems: NativeContinuationItem[] = [];
    try {
      const parsed = JSON.parse(editEntry.edited);
      if (Array.isArray(parsed)) {
        parsedItems = parsed.filter(
          (c): c is NativeContinuationItem =>
            Boolean(c) &&
            typeof c.id === 'string' &&
            typeof c.text === 'string',
        );
      }
    } catch {
      continue;
    }

    for (const item of parsedItems) {
      if (!item.text.trim()) continue;
      const continuationEntityId = `action-continuation-${meetingId}-${item.id}`;
      activeContinuationEntityIds.add(continuationEntityId);

      const canonical = canonicalizeActionText(item.text);
      const continuationName = truncateAtWordBoundary(
        canonical || item.text,
        100,
      );
      const continuationStatus = item.completed ? 'completed' : 'active';

      const existingContinuation = sqlite
        .prepare('SELECT * FROM entities WHERE id = ?')
        .get(continuationEntityId) as PersistedEntityRow | undefined;

      const metadata: ActionCommitmentMetadata = {
        commitment_state: 'confirmed',
        origin: 'user',
        source_meeting_id: meetingId,
        source_path: pathKey,
        continuation_id: item.id,
        full_description: item.text,
        original_description: item.text,
      };

      if (existingContinuation) {
        if (
          existingContinuation.name !== continuationName ||
          existingContinuation.status !== continuationStatus ||
          parseActionMetadata(existingContinuation.metadata)
            .full_description !== item.text
        ) {
          sqlite
            .prepare(
              `
            UPDATE entities SET
              name = ?,
              status = ?,
              metadata = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
            )
            .run(
              continuationName,
              continuationStatus,
              JSON.stringify(metadata),
              continuationEntityId,
            );

          try {
            sqlite
              .prepare('DELETE FROM entities_fts WHERE entity_id = ?')
              .run(continuationEntityId);
            sqlite
              .prepare(
                'INSERT INTO entities_fts (name, entity_id) VALUES (?, ?)',
              )
              .run(continuationName, continuationEntityId);
          } catch {}

          continuationsUpdated++;
        }
      } else {
        sqlite
          .prepare(
            `
          INSERT INTO entities (
            id, type, name, status, metadata, created_at, updated_at
          ) VALUES (?, 'action_item', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
          )
          .run(
            continuationEntityId,
            continuationName,
            continuationStatus,
            JSON.stringify(metadata),
          );

        try {
          sqlite
            .prepare('INSERT INTO entities_fts (name, entity_id) VALUES (?, ?)')
            .run(continuationName, continuationEntityId);
        } catch {}

        try {
          sqlite
            .prepare(
              `
            INSERT OR IGNORE INTO meeting_entities (meeting_id, entity_id, context, created_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          `,
            )
            .run(meetingId, continuationEntityId, item.text);
        } catch {}

        continuationsCreated++;
      }
    }
  }

  // Remove or retire any continuation entities for this meeting that were deleted
  const existingUserContinuations = sqlite
    .prepare(
      `
      SELECT id FROM entities
      WHERE type = 'action_item'
        AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.source_meeting_id') = ?
        AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.origin') = 'user'
        AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.continuation_id') IS NOT NULL
    `,
    )
    .all(meetingId) as Array<{ id: string }>;

  for (const row of existingUserContinuations) {
    if (!activeContinuationEntityIds.has(row.id)) {
      sqlite.prepare('DELETE FROM entities WHERE id = ?').run(row.id);
      try {
        sqlite
          .prepare('DELETE FROM entities_fts WHERE entity_id = ?')
          .run(row.id);
      } catch {}
      try {
        sqlite
          .prepare(
            'DELETE FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?',
          )
          .run(meetingId, row.id);
      } catch {}
      continuationsRemoved++;
    }
  }

  return {
    actionsUpdated,
    continuationsCreated,
    continuationsUpdated,
    continuationsRemoved,
  };
};

/**
 * Scan and synchronize all meetings that have user edits.
 * Used during startup recovery and migration.
 */
export const syncAllMeetingActionEntitiesFromUserEdits = (
  sqlite: Database.Database,
): { meetingsProcessed: number; totalActionsUpdated: number } => {
  const rows = sqlite
    .prepare(
      `
      SELECT id FROM meetings
      WHERE user_edits_json IS NOT NULL
        AND user_edits_json != ''
        AND user_edits_json != '{}'
    `,
    )
    .all() as Array<{ id: string }>;

  let totalActionsUpdated = 0;
  sqlite.transaction(() => {
    for (const row of rows) {
      const result = syncMeetingActionEntitiesFromUserEdits(sqlite, row.id);
      totalActionsUpdated +=
        result.actionsUpdated +
        result.continuationsCreated +
        result.continuationsUpdated;
    }
  })();

  return {
    meetingsProcessed: rows.length,
    totalActionsUpdated,
  };
};

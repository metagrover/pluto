import type Database from 'better-sqlite3';
import {
  type ActionCommitmentMetadata,
  canonicalizeActionText,
  parseActionMetadata,
} from '../../src/utils/actionCommitment';
import { isContinuationEditPath } from '../../src/utils/meetingNotesEditRebase';
import { parseDueDate } from '../actionDueDate';

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
  started_at: string | null;
}

interface PersistedEntityRow {
  id: string;
  type: string;
  name: string;
  status: string | null;
  due_date: string | null;
  assigned_to: string | null;
  metadata: string | null;
}

interface NativeContinuationItem {
  kind?: 'action' | 'decision' | 'note' | 'paragraph' | 'review';
  assignee?: string | null;
  id: string;
  text: string;
  completed?: boolean;
}

const matchesActionSource = (
  action: { assignee?: unknown; evidence?: unknown },
  metadata: ReturnType<typeof parseActionMetadata>,
): boolean => {
  const evidence =
    typeof metadata.source_evidence === 'string'
      ? metadata.source_evidence.trim()
      : '';
  const owner =
    typeof metadata.assignee_name === 'string'
      ? metadata.assignee_name.trim()
      : '';
  return Boolean(
    (evidence || owner) &&
      (!evidence ||
        (typeof action.evidence === 'string' &&
          action.evidence.trim() === evidence)) &&
      (!owner ||
        (typeof action.assignee === 'string' &&
          action.assignee.trim() === owner)),
  );
};

/** Mirror an explicit entity completion into its exact source note block. */
export const syncActionCompletionToMeetingNotes = (
  sqlite: Database.Database,
  entityId: string,
  completed: boolean,
): void => {
  const entity = sqlite
    .prepare('SELECT * FROM entities WHERE id = ?')
    .get(entityId) as PersistedEntityRow | undefined;
  if (!entity || entity.type !== 'action_item') return;
  const meta = parseActionMetadata(entity.metadata);
  if (meta.meeting_regeneration_retired_at) return;
  const meetingId = meta.source_meeting_id;
  const path = meta.source_path;
  if (typeof meetingId !== 'string' || typeof path !== 'string') return;
  const meeting = sqlite
    .prepare(
      'SELECT id, user_edits_json, analysis_json, started_at FROM meetings WHERE id = ?',
    )
    .get(meetingId) as PersistedMeetingRow | undefined;
  if (!meeting) return;
  // A corrupt edit document must never be replaced with a partial one.
  const edits = JSON.parse(meeting.user_edits_json || '{}');
  const editedAt = new Date().toISOString();
  if (typeof meta.continuation_id === 'string') {
    const entry = edits[path];
    if (!entry) return;
    const items = JSON.parse(entry.edited) as NativeContinuationItem[];
    const item = items.find((item) => item.id === meta.continuation_id);
    if (!item) return;
    item.completed = completed;
    edits[path] = {
      ...entry,
      edited: JSON.stringify(items),
      edited_at: editedAt,
    };
  } else {
    const match = path.match(/^(?:all_action_items|v2:action):(\d+)$/);
    if (!match) return;
    const analysis = JSON.parse(meeting.analysis_json || '{}');
    const actions = Array.isArray(analysis.all_action_items)
      ? analysis.all_action_items
      : Array.isArray(analysis.action_items)
        ? analysis.action_items
        : [];
    const original =
      typeof meta.original_description === 'string'
        ? meta.original_description
        : typeof meta.full_description === 'string'
          ? meta.full_description
          : entity.name;
    let matches: number[] = actions.flatMap(
      (action: { text?: unknown }, index: number) =>
        [
          action?.text,
          edits[`all_action_items:${index}`]?.original,
          edits[`v2:action:${index}`]?.original,
        ].some(
          (text) => typeof text === 'string' && text.trim() === original.trim(),
        )
          ? [index]
          : [],
    );
    if (matches.length > 1)
      matches = matches.filter((index) =>
        matchesActionSource(actions[index], meta),
      );
    if (matches.length !== 1) return;
    // Both note formats read the same completion, including after format changes.
    for (const prefix of ['all_action_items', 'v2:action']) {
      edits[`completion:${prefix}:${matches[0]}`] = {
        original: 'false',
        edited: String(completed),
        edited_at: editedAt,
      };
    }
  }
  sqlite
    .prepare('UPDATE meetings SET user_edits_json = ? WHERE id = ?')
    .run(JSON.stringify(edits), meetingId);
  syncMeetingActionEntitiesFromUserEdits(sqlite, meetingId);
};

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
      'SELECT id, user_edits_json, analysis_json, started_at FROM meetings WHERE id = ?',
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
      if (!editsMap || typeof editsMap !== 'object' || Array.isArray(editsMap))
        throw new Error('invalid_meeting_edits');
    } catch {
      // An unreadable edit document cannot clear a user's completion decision.
      return {
        actionsUpdated: 0,
        continuationsCreated: 0,
        continuationsUpdated: 0,
        continuationsRemoved: 0,
      };
    }
  }

  let analysisData: Record<string, unknown> = {};
  let actionItems: Array<{
    text: string;
    assignee?: string | null;
    due?: string | null;
    evidence?: string;
  }> = [];
  if (meeting.analysis_json) {
    try {
      const parsed = JSON.parse(meeting.analysis_json) as Record<
        string,
        unknown
      >;
      analysisData = parsed;
      if (Array.isArray(parsed.all_action_items)) {
        actionItems = parsed.all_action_items as typeof actionItems;
      } else if (Array.isArray(parsed.action_items)) {
        actionItems = parsed.action_items.map((item) =>
          typeof item === 'string' ? { text: item } : item,
        ) as typeof actionItems;
      }
    } catch {
      actionItems = [];
    }
  }

  // Retrieve unretired action item entities for this meeting
  const existingEntities = sqlite
    .prepare(
      `
      SELECT id, type, name, status, due_date, assigned_to, metadata FROM entities
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
      | {
          text: string;
          assignee?: string | null;
          due?: string | null;
          evidence?: string | null;
        }
      | undefined;
    const v3Path = `all_action_items:${index}`;
    const v2Path = `v2:action:${index}`;

    // Positions can change after regeneration; only task identity may carry state.
    const originals = [
      item?.text,
      editsMap[v3Path]?.original,
      editsMap[v2Path]?.original,
    ].filter(
      (text): text is string => typeof text === 'string' && !!text.trim(),
    );
    const evidence =
      typeof item?.evidence === 'string' ? item.evidence.trim() : '';
    const uniqueEvidence =
      Boolean(evidence) &&
      actionItems.filter(
        (candidate) =>
          typeof candidate.evidence === 'string' &&
          candidate.evidence.trim() === evidence,
      ).length === 1;
    let matches = existingEntities.filter((entity) => {
      if (claimedEntityIds.has(entity.id)) return false;
      const metadata = parseActionMetadata(entity.metadata);
      if (metadata.continuation_id || metadata.origin === 'user') return false;
      const text =
        typeof metadata.original_description === 'string'
          ? metadata.original_description
          : typeof metadata.full_description === 'string'
            ? metadata.full_description
            : entity.name;
      if (originals.some((original) => text.trim() === original.trim()))
        return true;
      // Only an unreviewed suggestion may follow a wording correction. Saved
      // evidence and its slot must both match; explicit task state never moves.
      return (
        uniqueEvidence &&
        metadata.origin === 'extraction' &&
        metadata.commitment_state === 'possible' &&
        !metadata.reviewed_at &&
        !metadata.user_edited &&
        !metadata.user_completed_edited &&
        (entity.status === null || entity.status === 'active') &&
        !editsMap[`completion:${v3Path}`] &&
        !editsMap[`completion:${v2Path}`] &&
        (metadata.source_path === v3Path || metadata.source_path === v2Path) &&
        typeof metadata.source_evidence === 'string' &&
        metadata.source_evidence.trim() === evidence
      );
    });
    if (
      matches.length > 1 ||
      actionItems.filter(
        (candidate) => candidate.text?.trim() === item?.text?.trim(),
      ).length > 1
    )
      matches = matches.filter(
        (entity) =>
          item &&
          matchesActionSource(item, parseActionMetadata(entity.metadata)),
      );
    // Ambiguous legacy duplicates must not inherit another action's completion.
    const entity = matches.length === 1 ? matches[0] : undefined;

    if (!entity) continue;
    claimedEntityIds.add(entity.id);

    const meta = parseActionMetadata(entity.metadata);
    const priorTask =
      typeof meta.original_description === 'string'
        ? meta.original_description
        : typeof meta.full_description === 'string'
          ? meta.full_description
          : entity.name;
    const uniqueTask =
      actionItems.filter(
        (candidate) =>
          typeof candidate.text === 'string' &&
          candidate.text.trim() === priorTask.trim(),
      ).length === 1;
    // Expanded citations may refresh an unchanged unique task; they cannot rebind different wording.
    const evidenceMatches =
      typeof meta.source_evidence === 'string' && meta.source_evidence.trim()
        ? actionItems.filter(
            (candidate) =>
              typeof candidate.evidence === 'string' &&
              (candidate.evidence.trim() ===
                (meta.source_evidence as string).trim() ||
                (uniqueTask &&
                  typeof candidate.text === 'string' &&
                  candidate.text.trim() === priorTask.trim() &&
                  candidate.evidence.includes(
                    (meta.source_evidence as string).trim(),
                  ))),
          )
        : [];
    const correctedItem =
      evidenceMatches.length === 1 &&
      evidenceMatches[0] === item &&
      typeof evidenceMatches[0].text === 'string' &&
      evidenceMatches[0].text.trim() &&
      meta.origin === 'extraction' &&
      meta.commitment_state !== 'confirmed' &&
      meta.commitment_state !== 'rejected' &&
      !meta.reviewed_at &&
      !meta.user_edited &&
      entity.status !== 'completed'
        ? evidenceMatches[0]
        : undefined;
    const baseText =
      correctedItem?.text ||
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
    }

    const assignee =
      correctedItem && meta.owner_source !== 'user'
        ? (correctedItem.assignee ?? undefined)
        : typeof meta.assignee_name === 'string'
          ? meta.assignee_name
          : undefined;
    const dueDate = correctedItem
      ? parseDueDate(correctedItem.due ?? '', meeting.started_at)
      : entity.due_date;
    const assignedTo =
      correctedItem &&
      meta.owner_source !== 'user' &&
      assignee !== meta.assignee_name
        ? null
        : entity.assigned_to;
    const canonical = canonicalizeActionText(effectiveText, assignee);
    const newName = truncateAtWordBoundary(canonical || effectiveText, 100);

    const needsUpdate =
      entity.name !== newName ||
      meta.full_description !== effectiveText ||
      entity.status !== effectiveStatus ||
      meta.source_path !== v3Path ||
      meta.source_index !== index ||
      (correctedItem &&
        (meta.original_description !== correctedItem.text ||
          meta.assignee_name !== assignee ||
          meta.source_due_date !== correctedItem.due ||
          meta.source_evidence !== correctedItem.evidence ||
          entity.due_date !== dueDate ||
          entity.assigned_to !== assignedTo)) ||
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
          correctedItem?.text ||
          (typeof meta.original_description === 'string'
            ? meta.original_description
            : baseText),
        source_path: v3Path,
        source_index: index,
        ...(correctedItem
          ? {
              assignee_name: assignee,
              source_due_date: correctedItem.due,
              source_evidence: correctedItem.evidence,
            }
          : {}),
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
          normalized_name = ?,
          status = ?,
          due_date = ?,
          assigned_to = ?,
          metadata = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
        )
        .run(
          newName,
          newName.toLowerCase().trim(),
          effectiveStatus,
          dueDate,
          assignedTo,
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

  const legacyActionLists = new Set([
    'continuation:all_action_items',
    'continuation:action_items',
    'continuation:v2:action',
  ]);
  const parentAction = (
    path: string,
  ): { assignee: string | null } | undefined => {
    const parent = path.startsWith('native_continuations:')
      ? path.slice('native_continuations:'.length)
      : path.startsWith('continuation:')
        ? path.slice('continuation:'.length)
        : '';
    const parts = parent.split(':');
    const at = (list: unknown, key: string | undefined): unknown => {
      const index = Number(key);
      return key !== undefined &&
        Number.isInteger(index) &&
        index >= 0 &&
        Array.isArray(list)
        ? list[index]
        : undefined;
    };
    let item: unknown;
    if (parts.length === 2 && parts[0] === 'all_action_items')
      item = at(analysisData.all_action_items, parts[1]);
    else if (parts.length === 3 && parts[0] === 'v2' && parts[1] === 'action')
      item = at(analysisData.action_items, parts[2]);
    else if (
      parts.length === 4 &&
      parts[0] === 'topic' &&
      parts[2] === 'action'
    ) {
      const topic = at(analysisData.topics, parts[1]);
      if (topic && typeof topic === 'object')
        item = at((topic as Record<string, unknown>).action_items, parts[3]);
    }
    if (typeof item === 'string') return { assignee: null };
    if (!item || typeof item !== 'object') return undefined;
    const owner = (item as Record<string, unknown>).assignee;
    return {
      assignee: typeof owner === 'string' && owner.trim() ? owner : null,
    };
  };
  const continuationPaths = Object.keys(editsMap).filter(
    isContinuationEditPath,
  );
  const evaluatedContinuationPaths = new Set<string>();

  const activeContinuationEntityIds = new Set<string>();

  for (const pathKey of continuationPaths) {
    const editEntry = editsMap[pathKey];
    if (!editEntry?.edited) continue;

    let parsedItems: NativeContinuationItem[] = [];
    try {
      const parsed = JSON.parse(editEntry.edited);
      if (
        !Array.isArray(parsed) ||
        !parsed.every(
          (c) =>
            Boolean(c) &&
            typeof c.id === 'string' &&
            typeof c.text === 'string' &&
            (c.kind === undefined ||
              ['action', 'decision', 'note', 'paragraph', 'review'].includes(
                c.kind,
              )) &&
            (c.assignee === undefined ||
              c.assignee === null ||
              typeof c.assignee === 'string') &&
            (c.completed === undefined || typeof c.completed === 'boolean'),
        )
      )
        continue;
      evaluatedContinuationPaths.add(pathKey);
      parsedItems = parsed;
    } catch {
      continue;
    }

    for (const item of parsedItems) {
      if (!item.text.trim()) continue;
      const continuationEntityId = `action-continuation-${meetingId}-${item.id}`;
      const existingContinuation = sqlite
        .prepare('SELECT * FROM entities WHERE id = ?')
        .get(continuationEntityId) as PersistedEntityRow | undefined;
      const existingMetadata = parseActionMetadata(
        existingContinuation?.metadata ?? null,
      );
      const parent = parentAction(pathKey);
      const legacyList = legacyActionLists.has(pathKey);
      const isAction = item.kind
        ? item.kind === 'action'
        : Boolean(parent || legacyList);
      if (!isAction) {
        if (
          item.kind === undefined &&
          (existingMetadata.reviewed_at ||
            existingMetadata.owner_source === 'user')
        )
          activeContinuationEntityIds.add(continuationEntityId);
        continue;
      }
      activeContinuationEntityIds.add(continuationEntityId);
      const owner =
        existingMetadata.owner_source === 'user'
          ? existingMetadata.assignee_name
          : Object.hasOwn(item, 'assignee')
            ? item.assignee
            : parent?.assignee;
      const ownerSource =
        existingMetadata.owner_source === 'user' || legacyList
          ? 'user'
          : 'notes_parent';

      const canonical = canonicalizeActionText(item.text);
      const continuationName = truncateAtWordBoundary(
        canonical || item.text,
        100,
      );
      const continuationStatus =
        typeof item.completed === 'boolean'
          ? item.completed
            ? 'completed'
            : 'active'
          : (existingContinuation?.status ?? 'active');

      const metadata: ActionCommitmentMetadata = {
        ...existingMetadata,
        commitment_state:
          existingMetadata.commitment_state === 'confirmed' ||
          existingMetadata.commitment_state === 'rejected'
            ? existingMetadata.commitment_state
            : ownerSource === 'user' || owner
              ? 'confirmed'
              : 'possible',
        owner_source: ownerSource,
        assignee_name: typeof owner === 'string' ? owner : undefined,
        continuation_kind: 'action',
        origin: 'user',
        source_meeting_id: meetingId,
        source_path: pathKey,
        continuation_id: item.id,
        full_description: item.text,
        original_description: item.text,
      };

      if (existingContinuation) {
        if (
          JSON.stringify(existingMetadata) !== JSON.stringify(metadata) ||
          existingContinuation.name !== continuationName ||
          existingContinuation.status !== continuationStatus ||
          parseActionMetadata(existingContinuation.metadata).source_path !==
            pathKey ||
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
      SELECT id, metadata FROM entities
      WHERE type = 'action_item'
        AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.source_meeting_id') = ?
        AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.origin') = 'user'
        AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.continuation_id') IS NOT NULL
    `,
    )
    .all(meetingId) as Array<{ id: string; metadata: string | null }>;

  for (const row of existingUserContinuations) {
    const sourcePath = parseActionMetadata(row.metadata).source_path;
    if (
      !activeContinuationEntityIds.has(row.id) &&
      typeof sourcePath === 'string' &&
      evaluatedContinuationPaths.has(sourcePath)
    ) {
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
 * Synchronize edited notes and pending extractions from their saved evidence.
 * Used during startup recovery and migration.
 */
export const syncAllMeetingActionEntitiesFromUserEdits = (
  sqlite: Database.Database,
): { meetingsProcessed: number; totalActionsUpdated: number } => {
  const rows = sqlite
    .prepare(
      `
      SELECT id FROM meetings
      WHERE (user_edits_json IS NOT NULL
        AND user_edits_json != ''
        AND user_edits_json != '{}')
        OR (analysis_json IS NOT NULL AND id IN (
          SELECT json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.source_meeting_id') FROM entities
          WHERE type = 'action_item'
            AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
              '$.origin') = 'extraction'
            AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
              '$.commitment_state') = 'possible'
        ))
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

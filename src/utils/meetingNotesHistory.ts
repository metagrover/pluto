import type { Meeting, UserEditsMap } from '../types';
import { parseUserEditsJson } from './analysisDocument';

export const ANALYSIS_SNAPSHOT_PATH = '__previous_generated_notes__';

type AnalysisSnapshotPayload = {
  schema_version: 1;
  analysis_json: string;
  user_edits_json: string;
  analysis_edit_conflicts_json: string;
  generation_metadata: unknown | null;
};

type AnalysisSnapshotMeeting = {
  enhanced_notes?: string | null;
  analysis_json?: string | null;
  analysis_schema_version?: number | null;
  user_edits_json?: string | null;
  analysis_edit_conflicts_json?: string | null;
};

export type RestoredAnalysisSnapshot = Pick<
  Meeting,
  | 'enhanced_notes'
  | 'analysis_json'
  | 'analysis_schema_version'
  | 'user_edits_json'
  | 'analysis_edit_conflicts_json'
>;

const readGenerationMetadata = (
  analysisJson?: string | null,
): unknown | null => {
  if (!analysisJson) return null;
  try {
    const parsed = JSON.parse(analysisJson) as Record<string, unknown>;
    return parsed.generation_metadata ?? null;
  } catch {
    return null;
  }
};

const parseSnapshotPayload = (raw: string): AnalysisSnapshotPayload | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<AnalysisSnapshotPayload>;
    if (
      parsed.schema_version !== 1 ||
      typeof parsed.analysis_json !== 'string' ||
      typeof parsed.user_edits_json !== 'string' ||
      typeof parsed.analysis_edit_conflicts_json !== 'string'
    ) {
      return null;
    }
    return parsed as AnalysisSnapshotPayload;
  } catch {
    return null;
  }
};

export const createAnalysisSnapshot = (
  meeting: AnalysisSnapshotMeeting,
  createdAt = new Date().toISOString(),
): UserEditsMap => {
  const edits = parseUserEditsJson(meeting.user_edits_json);
  delete edits[ANALYSIS_SNAPSHOT_PATH];
  const payload: AnalysisSnapshotPayload = {
    schema_version: 1,
    analysis_json: meeting.analysis_json || '',
    user_edits_json: JSON.stringify(edits),
    analysis_edit_conflicts_json: meeting.analysis_edit_conflicts_json || '[]',
    generation_metadata: readGenerationMetadata(meeting.analysis_json),
  };
  return {
    ...edits,
    [ANALYSIS_SNAPSHOT_PATH]: {
      original: meeting.enhanced_notes || '',
      edited: JSON.stringify(payload),
      edited_at: createdAt,
    },
  };
};

export const restoreAnalysisSnapshot = (
  meeting: AnalysisSnapshotMeeting,
): RestoredAnalysisSnapshot | null => {
  const edits = parseUserEditsJson(meeting.user_edits_json);
  const snapshot = edits[ANALYSIS_SNAPSHOT_PATH];
  if (!snapshot) return null;

  const remainingEdits = { ...edits };
  delete remainingEdits[ANALYSIS_SNAPSHOT_PATH];
  const payload = parseSnapshotPayload(snapshot.edited);
  const analysisJson = payload?.analysis_json ?? snapshot.edited;

  let schemaVersion: number | undefined;
  try {
    const parsed = JSON.parse(analysisJson) as {
      analysis_schema_version?: unknown;
    };
    if (typeof parsed.analysis_schema_version === 'number') {
      schemaVersion = parsed.analysis_schema_version;
    }
  } catch {
    schemaVersion = undefined;
  }

  return {
    enhanced_notes: snapshot.original,
    analysis_json: analysisJson,
    analysis_schema_version: schemaVersion,
    user_edits_json: payload?.user_edits_json ?? JSON.stringify(remainingEdits),
    analysis_edit_conflicts_json:
      payload?.analysis_edit_conflicts_json ??
      meeting.analysis_edit_conflicts_json ??
      '[]',
  };
};

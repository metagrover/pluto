import type { Meeting, UserEditsMap } from '../types';
import { parseUserEditsJson } from './analysisDocument';

export const ANALYSIS_SNAPSHOT_PATH = '__previous_generated_notes__';

export const createAnalysisSnapshot = (
  meeting: Meeting,
  createdAt = new Date().toISOString(),
): UserEditsMap => ({
  ...parseUserEditsJson(meeting.user_edits_json),
  [ANALYSIS_SNAPSHOT_PATH]: {
    original: meeting.enhanced_notes || '',
    edited: meeting.analysis_json || '',
    edited_at: createdAt,
  },
});

export const restoreAnalysisSnapshot = (meeting: Meeting): Meeting | null => {
  const edits = parseUserEditsJson(meeting.user_edits_json);
  const snapshot = edits[ANALYSIS_SNAPSHOT_PATH];
  if (!snapshot) return null;

  const remainingEdits = { ...edits };
  delete remainingEdits[ANALYSIS_SNAPSHOT_PATH];

  let schemaVersion: number | undefined;
  try {
    const parsed = JSON.parse(snapshot.edited) as {
      analysis_schema_version?: unknown;
    };
    if (typeof parsed.analysis_schema_version === 'number') {
      schemaVersion = parsed.analysis_schema_version;
    }
  } catch {
    schemaVersion = undefined;
  }

  return {
    ...meeting,
    enhanced_notes: snapshot.original,
    analysis_json: snapshot.edited,
    analysis_schema_version: schemaVersion,
    user_edits_json: JSON.stringify(remainingEdits),
  };
};

export type ReadonlyMeetingSource = {
  id: string;
  transcript_json: string | null;
  transcript_status: string | null;
  finalization_status: string | null;
  transcript_integrity_json: string | null;
  duration_seconds: number | null;
};
export function readReadonlyMeetingSources(
  databasePath: string,
  query?: (uri: string, statement: string) => string,
  options?: { latestTen?: boolean },
): {
  source: string;
  databaseSha256: string;
  rows: ReadonlyMeetingSource[];
};

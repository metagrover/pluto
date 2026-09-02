const STATUS_FIELDS = [
  'title',
  'meeting_type',
  'started_at',
  'ended_at',
  'duration_seconds',
  'folder_id',
  'is_favorite',
  'end_reason',
  'transcript_status',
  'transcript_validated_at',
  'finalization_status',
  'finalization_error_category',
  'downstream_processing_json',
  'capture_journal_generation',
  'analysis_run_json',
] as const;

export const loadSelectedMeetingDetail = async <T>(input: {
  meetingId: string | number;
  load(): Promise<T | null>;
  isCurrent(meetingId: string | number): boolean;
}): Promise<T | null> => {
  const detail = await input.load();
  return detail && input.isCurrent(input.meetingId) ? detail : null;
};

export const mergeMeetingStatus = <T extends Record<string, unknown>>(
  detail: T,
  status: Record<string, unknown> | null | undefined,
): T => {
  if (!status || String(status.id) !== String(detail.id)) return detail;
  const patch: Record<string, unknown> = {};
  for (const field of STATUS_FIELDS) {
    if (Object.hasOwn(status, field)) patch[field] = status[field];
  }
  return { ...detail, ...patch };
};

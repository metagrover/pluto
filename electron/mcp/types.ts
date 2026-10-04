export type PlutoMcpSnapshot = {
  enabled: boolean;
  running: boolean;
  pluginReady: boolean;
  pluginName: string | null;
  marketplaceName: string | null;
  error: string | null;
};

export type MeetingListInput = { limit?: number; offset?: number };
export type MeetingSearchInput = MeetingListInput & { query: string };
export type MeetingReadInput = {
  meetingId: string;
  offset?: number;
  limit?: number;
};

export type PlutoMcpDataSource = {
  listMeetings(
    input: MeetingListInput,
    signal?: AbortSignal,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  searchMeetings(
    input: MeetingSearchInput,
    signal?: AbortSignal,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  getMeeting(
    input: MeetingReadInput,
    signal?: AbortSignal,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
};

export type AskPlutoQueryPhase =
  | 'scope_resolved'
  | 'retrieving'
  | 'generating'
  | 'cancelling';

export type AskPlutoCurrentMeeting =
  | { kind: 'active_recording'; meetingId: string; title?: string }
  | { kind: 'persisted'; meetingId: string; title?: string }
  | { kind: 'none'; meetingId: null };

export interface AskPlutoQueryRequest {
  requestId: string;
  query: string;
  activeMeetingSnapshot?: AskPlutoActiveMeetingSnapshot;
  modeOverride?: 'auto' | 'fast' | 'deep';
  priorTurns?: AskPlutoConversationTurn[];
}

export interface AskPlutoConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  meetingIds?: string[];
}

export interface AskPlutoActiveMeetingSnapshot {
  meetingId: string;
  title: string;
  participants: string[];
  notes: string;
  transcript: Array<{
    id: string;
    speaker: string;
    text: string;
    timestampMs: number;
    confirmed: boolean;
  }>;
  interimText: string;
  capturedAt: string;
}

export interface AskPlutoQueryStatus {
  requestId: string;
  phase: AskPlutoQueryPhase;
  currentMeeting?: AskPlutoCurrentMeeting;
  reasoningMode?: 'fast' | 'deep';
  comparisonMeetingCount?: number;
}

export interface AskPlutoAnswerDelta {
  requestId: string;
  delta: string;
}

export interface AskPlutoQueryResponse<Citation = unknown> {
  status?: 'answered' | 'cancelled' | 'unavailable';
  answer: string;
  citations: Citation[];
  currentMeeting?: AskPlutoCurrentMeeting;
  failureReason?: 'timeout' | 'provider_unavailable';
}

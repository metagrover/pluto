export type AskPlutoQueryPhase =
  | 'scope_resolved'
  | 'retrieving'
  | 'waiting'
  | 'writing'
  | 'generating'
  | 'citations_ready'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'unavailable'
  | 'failed';

export type AskPlutoEvidenceState =
  | 'provisional'
  | 'processing'
  | 'failed'
  | 'completed';

export type AskPlutoOutcome =
  | 'answered'
  | 'partial'
  | 'no_evidence'
  | 'unavailable'
  | 'cancelled'
  | 'failed';

export interface AskPlutoTemporalRange {
  fromInclusive: string;
  toExclusive: string;
  label: string;
  timeZone: string;
}

export interface ResolvedAskPlutoScope {
  kind: 'current' | 'meeting_ids' | 'temporal' | 'global';
  meetingIds: string[];
  temporalRange?: AskPlutoTemporalRange;
  resolvedAt: string;
  source: 'explicit' | 'inherited';
}

export interface AskPlutoRetrievalSummary {
  matchedMeetingCount: number;
  includedMeetingCount: number;
  preparedEvidenceCount: number;
  transcriptOnlyCount: number;
  omittedMeetingCount: number;
}

export type AskPlutoCurrentMeeting =
  | {
      kind: 'active_recording';
      meetingId: string;
      title?: string;
      evidenceState: 'provisional';
    }
  | {
      kind: 'persisted';
      meetingId: string;
      title?: string;
      evidenceState: Exclude<AskPlutoEvidenceState, 'provisional'>;
    }
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
  outcome?: AskPlutoOutcome;
  resolvedScope?: ResolvedAskPlutoScope;
  retrievalSummary?: AskPlutoRetrievalSummary;
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
  scopeLabel?: string;
  scopeMeetingCount?: number;
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
  failureReason?:
    | 'timeout'
    | 'provider_unavailable'
    | 'invalid_response'
    | 'generation_failed';
  trustStatus?: 'grounded' | 'inferred' | 'needs_review';
  unsupportedClaimCount?: number;
  outcome?: AskPlutoOutcome;
  resolvedScope?: ResolvedAskPlutoScope;
  retrievalSummary?: AskPlutoRetrievalSummary;
}

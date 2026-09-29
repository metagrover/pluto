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
  matchedSectionCount?: number;
  includedSectionCount?: number;
  transcriptPassageCount?: number;
  commitmentCount?: number;
  artifactCount?: number;
  retrievalLevel?:
    | 'overview'
    | 'section'
    | 'commitment'
    | 'note'
    | 'transcript';
}

export interface AskPlutoRetrievedSection {
  meetingId: string;
  meetingTitle: string;
  sectionId: string;
  heading: string;
  kind: string;
  sourceRevision: string;
}

export interface AskPlutoTranscriptPassage {
  meetingId: string;
  meetingTitle: string;
  quote: string;
  speaker: string;
  startMs?: number;
  endMs?: number;
  sourceRevision?: string;
  trustStatus?: 'grounded' | 'inferred' | 'weak_evidence' | 'needs_review';
}

export interface AskPlutoRetrievalTrace {
  level: 'overview' | 'section' | 'commitment' | 'note' | 'transcript';
  searchedMeetingCount: number;
  meetings?: Array<{ meetingId: string; meetingTitle: string }>;
  sections: AskPlutoRetrievedSection[];
  transcriptPassages: AskPlutoTranscriptPassage[];
  commitmentCount: number;
  omittedResultCount: number;
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
  conversationMemory?: AskPlutoConversationMemory;
}

export interface AskPlutoConversationContext {
  anchor: string;
  meetingIds: string[];
  topic?: {
    kind: 'workspace' | 'project' | 'person' | 'meeting_set' | 'general';
    id?: string;
    label?: string;
  };
}

export interface AskPlutoConversationMemory {
  activeTopic?: AskPlutoConversationContext['topic'];
  currentGoal?: string;
  lastAnswerSummary?: string;
  corrections: string[];
  unresolvedQuestions: string[];
}

export interface AskPlutoConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  turnMode?: AskPlutoQueryResponse['turnMode'];
  retrievalPolicy?: AskPlutoQueryResponse['retrievalPolicy'];
  meetingIds?: string[];
  outcome?: AskPlutoOutcome;
  resolvedScope?: ResolvedAskPlutoScope;
  retrievalSummary?: AskPlutoRetrievalSummary;
  retrievalTrace?: AskPlutoRetrievalTrace;
  unsupportedClaimCount?: number;
  omissionRef?: string;
  conversationAnchor?: string;
  conversationContext?: AskPlutoConversationContext;
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

export interface AskPlutoPerformanceDiagnostics {
  provider: string;
  model: string;
  reasoningMode?: 'fast' | 'deep';
  contextCount: number;
  promptCharacters: number;
  outputCharacters: number;
  settingsMs: number | null;
  setupMs: number | null;
  conversationResolutionMs: number | null;
  recallMs: number | null;
  retrievalMs: number | null;
  promptConstructionMs: number | null;
  providerAcquisitionMs: number | null;
  providerQueueMs: number | null;
  providerRequestToFirstTokenMs: number | null;
  rawFirstTokenMs: number | null;
  visibleFirstTokenMs: number | null;
  generationMs: number | null;
  finalizationMs: number | null;
  totalMs: number;
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
  omissionRef?: string;
  conversationAnchor?: string;
  conversationContext?: AskPlutoConversationContext;
  outcome?: AskPlutoOutcome;
  resolvedScope?: ResolvedAskPlutoScope;
  retrievalSummary?: AskPlutoRetrievalSummary;
  retrievalTrace?: AskPlutoRetrievalTrace;
  performance?: AskPlutoPerformanceDiagnostics;
  turnMode?:
    | 'social'
    | 'clarify'
    | 'challenge'
    | 'expand'
    | 'draft'
    | 'act'
    | 'topic_switch'
    | 'lookup';
  retrievalPolicy?: 'none' | 'reuse' | 'fresh';
  actionProposal?: {
    kind: 'create_commitment';
    text: string;
    label: string;
  };
}

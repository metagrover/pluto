export type MeetingContextAttributeValue = string | number | boolean | null;

export interface MeetingContextEvidenceReference {
  segmentId: string;
  timestampMs: number;
  quote?: string;
}

export type MeetingContextEventKind =
  | 'topic'
  | 'proposal'
  | 'decision'
  | 'action'
  | 'open_question'
  | 'fact'
  | 'correction';

export interface MeetingContextEventInput {
  meetingId: string;
  eventKey: string;
  kind: MeetingContextEventKind;
  summary: string;
  evidence: MeetingContextEvidenceReference[];
  attributes?: Record<string, MeetingContextAttributeValue>;
  supersedesEventId?: string | null;
  observedAtMs: number;
}

export interface MeetingContextEvent extends MeetingContextEventInput {
  id: string;
  attributes: Record<string, MeetingContextAttributeValue>;
  supersedesEventId: string | null;
  createdAt: string;
}

export interface MeetingContextStateItem {
  id: string;
  text: string;
  sourceEventIds: string[];
  sourceSegmentIds: string[];
}

export interface MeetingContextActionItem extends MeetingContextStateItem {
  owner: string | null;
  deadline: string | null;
}

export interface MeetingContextRollingStateV1 {
  schemaVersion: 1;
  meetingId: string;
  updatedThrough: {
    segmentId: string | null;
    timestampMs: number | null;
  };
  summary: string;
  currentTopics: MeetingContextStateItem[];
  proposals: MeetingContextStateItem[];
  decisions: MeetingContextStateItem[];
  actions: MeetingContextActionItem[];
  openQuestions: MeetingContextStateItem[];
  importantFacts: MeetingContextStateItem[];
}

export interface MeetingContextSnapshot {
  id: string;
  meetingId: string;
  revision: number;
  state: MeetingContextRollingStateV1;
  lastSegmentId: string | null;
  lastSegmentTimestampMs: number | null;
  generatedAt: string;
  createdAt: string;
}

export interface MeetingContextIngestionSegment {
  id: string;
  speaker: string;
  source?: 'mic' | 'system';
  text: string;
  timestampMs: number;
  confirmed: boolean;
}

export interface MeetingContextIngestionRequest {
  meetingId: string;
  segments: MeetingContextIngestionSegment[];
}

export interface MeetingContextIngestionResult {
  acceptedSegmentCount: number;
  extractedEventCount: number;
  createdEventCount: number;
  reusedEventCount: number;
  snapshotRevision: number | null;
  snapshotChanged: boolean;
}

export interface LiveMeetingContextCheckpointV1 {
  schemaVersion: 1;
  meetingId: string;
  updatedThrough: {
    segmentId: string | null;
    timestampMs: number | null;
  };
  segments: MeetingContextIngestionSegment[];
  generatedAt: string;
}

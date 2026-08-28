import type { TrustStatus } from '../utils/trustStatus';

export interface MeetingAskPlutoScope {
  type: 'meeting' | 'live_meeting';
  meetingId: string;
  title?: string;
}

export interface MeetingAskPlutoLiveTranscriptSegment {
  id: string;
  speaker: string;
  text: string;
  timestampMs: number;
  confirmed: boolean;
}

export interface MeetingAskPlutoLiveContext {
  title: string;
  participants: string[];
  notes: string;
  transcript: MeetingAskPlutoLiveTranscriptSegment[];
  interimText?: string;
}

export interface MeetingAskPlutoTurn {
  role: 'user' | 'assistant';
  content: string;
  citationIds?: string[];
}

export type MeetingAskPlutoAnswerMode = 'quick' | 'deep';

export interface MeetingAskPlutoRequest {
  requestId: string;
  query: string;
  answerMode?: MeetingAskPlutoAnswerMode;
  scope:
    | {
        type: 'meeting';
        meetingId: string;
      }
    | ({
        type: 'live_meeting';
      } & MeetingAskPlutoLiveContext);
  turns?: MeetingAskPlutoTurn[];
}

export interface MeetingAskPlutoAnswerDelta {
  requestId: string;
  delta: string;
}

export interface MeetingAskPlutoClaim {
  text: string;
  trustStatus: TrustStatus;
  citationIds: string[];
}

export interface MeetingAskPlutoCitation {
  id: string;
  claim: string;
  meeting_id: string;
  meeting_title: string;
  entity_id?: string;
  evidence_span?: string;
  evidence_valid: boolean;
  trust_status: TrustStatus;
}

export interface MeetingAskPlutoResponse {
  status: 'answered' | 'unavailable';
  answer: string;
  scope: MeetingAskPlutoScope;
  trustStatus: TrustStatus;
  claims: MeetingAskPlutoClaim[];
  citations: MeetingAskPlutoCitation[];
  rationale?: string;
}

export type MeetingAskPlutoConversationMessage =
  | {
      id: string;
      role: 'user';
      content: string;
    }
  | {
      id: string;
      role: 'assistant';
      content: string;
      packet: MeetingAskPlutoResponse;
    };

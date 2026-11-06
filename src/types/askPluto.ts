import type { TrustStatus } from '../utils/trustStatus';

export interface MeetingAskPlutoScope {
  type: 'meeting' | 'live_meeting';
  meetingId: string;
  title?: string;
}

export interface MeetingAskPlutoLiveTranscriptSegment {
  id: string;
  speaker: string;
  source?: 'mic' | 'system';
  text: string;
  timestampMs: number;
  confirmed: boolean;
}

export interface MeetingAskPlutoLiveContext {
  meetingId?: string;
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
  evidenceHints?: string[];
}

export interface MeetingAskPlutoRequest {
  requestId: string;
  query: string;
  scope:
    | {
        type: 'meeting';
        meetingId: string;
      }
    | ({
        type: 'live_meeting';
      } & MeetingAskPlutoLiveContext);
  turns?: MeetingAskPlutoTurn[];
  /** The person chose ChatGPT for this question after a memory refusal. */
  answerWith?: 'chatgpt';
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
  /** Local memory refused the answer and ChatGPT is ready to answer instead. */
  chatGPTFallback?: 'available';
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
      packet?: MeetingAskPlutoResponse;
      interrupted?: boolean;
      /** The person sent this question to ChatGPT after a memory refusal. */
      answeredBy?: 'chatgpt';
    };

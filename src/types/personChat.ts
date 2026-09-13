export type PersonChatMessageStatus = 'complete' | 'interrupted';

export interface PersonChatThread {
  id: string;
  personId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type PersonChatCitation =
  | {
      id: string;
      type: 'meeting';
      meetingId: string;
      title: string;
      date: string | null;
      evidenceClass: 'confirmed' | 'scheduled' | 'mentioned' | 'commitment';
      excerpt: string;
      answerUsage: 'used_during_generation';
    }
  | {
      id: string;
      type: 'web';
      title: string;
      url: string;
      domain: string;
      snippet: string;
      publishedAt?: string;
      answerUsage: 'used_during_generation' | 'attached_afterward';
    };

export interface PersonChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  status: PersonChatMessageStatus;
  citations: PersonChatCitation[];
  createdAt: string;
}

export interface PersonChatSendRequest {
  requestId: string;
  threadId: string;
  personId: string;
  query: string;
}

export interface PersonChatResponse {
  status: 'answered' | 'unavailable' | 'cancelled';
  message: PersonChatMessage | null;
  webStatus:
    | 'not_needed'
    | 'searching'
    | 'completed'
    | 'timed_out'
    | 'unavailable';
  sanitizedQuery?: string;
  rationale?: string;
}

export interface PersonChatDelta {
  requestId: string;
  delta: string;
}

export interface PersonChatStatusUpdate {
  requestId: string;
  status: 'reading_person' | 'searching_web' | 'answering' | 'web_unavailable';
  sanitizedQuery?: string;
}

export interface PersonChatSourcesUpdate {
  requestId: string;
  messageId: string;
  citations: PersonChatCitation[];
  webStatus: 'completed' | 'unavailable';
  sanitizedQuery?: string;
}

export interface PersonChatWebPreference {
  automaticSearch: boolean;
  disclosureSeen: boolean;
}

export type PersonChatMessageStatus = 'complete' | 'interrupted';

export interface PersonChatThread {
  id: string;
  personId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface PersonChatCitation {
  id: string;
  type: 'meeting';
  meetingId: string;
  title: string;
  date: string | null;
  evidenceClass: 'confirmed' | 'scheduled' | 'mentioned' | 'commitment';
  excerpt: string;
  answerUsage: 'used_during_generation';
}

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
  rationale?: string;
}

export interface PersonChatDelta {
  requestId: string;
  delta: string;
}

export interface PersonChatStatusUpdate {
  requestId: string;
  status: 'reading_person' | 'answering';
}

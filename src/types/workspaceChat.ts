import type {
  AskPlutoConversationContext,
  AskPlutoConversationMemory,
  AskPlutoOutcome,
  AskPlutoQueryResponse,
  AskPlutoRetrievalSummary,
  AskPlutoRetrievalTrace,
  ResolvedAskPlutoScope,
} from './askPlutoQuery';

export type WorkspaceChatMemory = AskPlutoConversationMemory;

export interface WorkspaceChatThread {
  id: string;
  title: string;
  memory: WorkspaceChatMemory;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface WorkspaceChatMessagePayload {
  citations?: unknown[];
  trustStatus?: 'grounded' | 'inferred' | 'needs_review';
  unsupportedClaimCount?: number;
  omissionRef?: string;
  conversationAnchor?: string;
  conversationContext?: AskPlutoConversationContext;
  retryQuery?: string;
  evidenceState?: 'provisional' | 'processing' | 'failed' | 'completed';
  outcome?: AskPlutoOutcome;
  resolvedScope?: ResolvedAskPlutoScope;
  retrievalSummary?: AskPlutoRetrievalSummary;
  retrievalTrace?: AskPlutoRetrievalTrace;
  turnMode?: AskPlutoQueryResponse['turnMode'];
  retrievalPolicy?: AskPlutoQueryResponse['retrievalPolicy'];
  actionProposal?: AskPlutoQueryResponse['actionProposal'];
  actionState?: 'saving' | 'completed' | 'failed';
}

export interface WorkspaceChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  payload: WorkspaceChatMessagePayload;
  createdAt: string;
}

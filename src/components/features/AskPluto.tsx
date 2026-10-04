import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  ChevronDown,
  MessageSquarePlus,
  PanelRight,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type React from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { upsertEntity } from '../../api/knowledgeGraph';
import {
  appendWorkspaceChatMessage,
  archiveWorkspaceChatThread,
  createWorkspaceChatThread,
  listWorkspaceChatMessages,
  listWorkspaceChatThreads,
  updateWorkspaceChatMemory,
  updateWorkspaceChatMessagePayload,
} from '../../api/workspaceChat';
import { useChatTurnAnchor } from '../../hooks/useChatTurnAnchor';
import type {
  AskPlutoActiveMeetingSnapshot,
  AskPlutoAnswerDelta,
  AskPlutoConversationContext,
  AskPlutoConversationTurn,
  AskPlutoCurrentMeeting,
  AskPlutoOutcome,
  AskPlutoQueryPhase,
  AskPlutoQueryResponse,
  AskPlutoQueryStatus,
  AskPlutoRetrievalSummary,
  AskPlutoRetrievalTrace,
  ResolvedAskPlutoScope,
} from '../../types/askPlutoQuery';
import type {
  WorkspaceChatMemory,
  WorkspaceChatMessagePayload,
  WorkspaceChatThread,
} from '../../types/workspaceChat';
import { Logo } from '../Brand/Logo';
import type { CitationChain } from './CitationCard';

interface AskPlutoProps {
  onOpenMeeting: (
    id: string,
    target?: { sectionId?: string; timestampMs?: number },
  ) => void;
  onOpenArtifact: (id: string) => void;
  visible: boolean;
  onClose: () => void;
  activeMeetingSnapshot?: AskPlutoActiveMeetingSnapshot;
  messages?: AskPlutoMessage[];
  setMessages?: React.Dispatch<React.SetStateAction<AskPlutoMessage[]>>;
}

export interface AskPlutoMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationChain[];
  isLoading?: boolean;
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

const groupCitationsByMeeting = (citations: CitationChain[]) => {
  const groups = new Map<
    string,
    {
      meetingId: string;
      meetingTitle: string;
      sourceType: 'meeting' | 'artifact';
      citations: CitationChain[];
    }
  >();

  for (const citation of citations) {
    const existing = groups.get(citation.meeting_id);
    if (existing) {
      existing.citations.push(citation);
      continue;
    }
    groups.set(citation.meeting_id, {
      meetingId: citation.meeting_id,
      meetingTitle: citation.meeting_title || 'Untitled meeting',
      sourceType: citation.source_type || 'meeting',
      citations: [citation],
    });
  }

  return [...groups.values()];
};

const ASSISTANT_MARKDOWN_CLASS_NAME =
  'prose prose-invert prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:text-pro-text-main [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-pro-text-main';

const toWorkspacePayload = (
  message: AskPlutoMessage,
): WorkspaceChatMessagePayload => ({
  ...(message.citations ? { citations: message.citations } : {}),
  ...(message.trustStatus ? { trustStatus: message.trustStatus } : {}),
  ...(message.unsupportedClaimCount
    ? { unsupportedClaimCount: message.unsupportedClaimCount }
    : {}),
  ...(message.omissionRef ? { omissionRef: message.omissionRef } : {}),
  ...(message.conversationAnchor
    ? { conversationAnchor: message.conversationAnchor }
    : {}),
  ...(message.conversationContext
    ? { conversationContext: message.conversationContext }
    : {}),
  ...(message.retryQuery ? { retryQuery: message.retryQuery } : {}),
  ...(message.evidenceState ? { evidenceState: message.evidenceState } : {}),
  ...(message.outcome ? { outcome: message.outcome } : {}),
  ...(message.resolvedScope ? { resolvedScope: message.resolvedScope } : {}),
  ...(message.retrievalSummary
    ? { retrievalSummary: message.retrievalSummary }
    : {}),
  ...(message.retrievalTrace ? { retrievalTrace: message.retrievalTrace } : {}),
  ...(message.turnMode ? { turnMode: message.turnMode } : {}),
  ...(message.retrievalPolicy
    ? { retrievalPolicy: message.retrievalPolicy }
    : {}),
  ...(message.actionProposal ? { actionProposal: message.actionProposal } : {}),
  ...(message.actionState ? { actionState: message.actionState } : {}),
});

const summarizeAnswer = (content: string): string =>
  content.replace(/\s+/g, ' ').trim().slice(0, 600);

const formatConversationDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
};

export const AskPluto: React.FC<AskPlutoProps> = ({
  onOpenMeeting,
  onOpenArtifact,
  visible,
  activeMeetingSnapshot,
  messages: controlledMessages,
  setMessages: setControlledMessages,
}) => {
  const [query, setQuery] = useState('');
  const [localMessages, setLocalMessages] = useState<AskPlutoMessage[]>([]);
  const messages = Array.isArray(controlledMessages)
    ? controlledMessages
    : Array.isArray(localMessages)
      ? localMessages
      : [];
  const rawSetMessages = setControlledMessages ?? setLocalMessages;
  const setMessages: React.Dispatch<React.SetStateAction<AskPlutoMessage[]>> = (
    next,
  ) => {
    rawSetMessages((current) => {
      const safeCurrent = Array.isArray(current) ? current : [];
      return typeof next === 'function' ? next(safeCurrent) : next;
    });
  };
  const [isProcessing, setIsProcessing] = useState(false);
  const [requestPhase, setRequestPhase] =
    useState<AskPlutoQueryPhase>('retrieving');
  const [currentMeeting, setCurrentMeeting] =
    useState<AskPlutoCurrentMeeting | null>(null);
  const [currentMeetingRequested, setCurrentMeetingRequested] = useState(false);
  const [comparisonMeetingCount, setComparisonMeetingCount] = useState(0);
  const [scopeLabel, setScopeLabel] = useState<string | null>(null);
  const [scopeMeetingCount, setScopeMeetingCount] = useState(0);
  const [modeOverride, setModeOverride] = useState<'auto' | 'deep'>('auto');
  const [dynamicQueries, setDynamicQueries] = useState<string[]>([]);
  const [isLoadingQueries, setIsLoadingQueries] = useState(false);
  const [workspaceThreads, setWorkspaceThreads] = useState<
    WorkspaceChatThread[]
  >([]);
  const [workspaceThreadId, setWorkspaceThreadId] = useState<string | null>(
    null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null);
  const [anchoredUserMessageId, setAnchoredUserMessageId] = useState<
    string | null
  >(null);

  const queryCacheRef = useRef<{ queries: string[]; fetchedAt: number } | null>(
    null,
  );
  const messageCounterRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const workspaceThreadIdRef = useRef<string | null>(null);
  const workspaceThreadPromiseRef = useRef<Promise<string> | null>(null);
  const workspaceHydratedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const historyCloseRef = useRef<HTMLButtonElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const pendingRestoredScrollRef = useRef(false);
  const { anchorTurn, conversationRef } = useChatTurnAnchor<HTMLDivElement>(
    messages.length,
  );

  useLayoutEffect(() => {
    if (!pendingRestoredScrollRef.current) return;
    pendingRestoredScrollRef.current = false;
    conversationEndRef.current?.scrollIntoView({
      behavior: 'instant',
      block: 'end',
    });
  }, [messages]);

  const nextMessageId = () =>
    `msg-${Date.now()}-${messageCounterRef.current++}`;

  const refreshWorkspaceThreads = useCallback(async () => {
    if (!window.ipcRenderer) return [];
    const result = await listWorkspaceChatThreads();
    const threads = Array.isArray(result) ? result : [];
    setWorkspaceThreads(threads);
    return threads;
  }, []);

  const loadWorkspaceThread = useCallback(
    async (threadId: string) => {
      const result = await listWorkspaceChatMessages(threadId);
      const persisted = Array.isArray(result) ? result : [];
      const restored: AskPlutoMessage[] = persisted.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        ...(message.payload as WorkspaceChatMessagePayload),
        citations: message.payload.citations as CitationChain[] | undefined,
      }));
      workspaceThreadIdRef.current = threadId;
      setWorkspaceThreadId(threadId);
      setAnchoredUserMessageId(null);
      pendingRestoredScrollRef.current = restored.length > 0;
      setMessages(restored);
      setHistoryOpen(false);
    },
    [setMessages],
  );

  const ensureWorkspaceThread = useCallback(async (): Promise<string> => {
    if (workspaceThreadIdRef.current) return workspaceThreadIdRef.current;
    if (workspaceThreadPromiseRef.current)
      return workspaceThreadPromiseRef.current;
    workspaceThreadPromiseRef.current = createWorkspaceChatThread()
      .then((thread) => {
        workspaceThreadIdRef.current = thread.id;
        setWorkspaceThreadId(thread.id);
        setWorkspaceThreads((current) => [
          thread,
          ...current.filter((candidate) => candidate.id !== thread.id),
        ]);
        return thread.id;
      })
      .finally(() => {
        workspaceThreadPromiseRef.current = null;
      });
    return workspaceThreadPromiseRef.current;
  }, []);

  useEffect(() => {
    if (
      !visible ||
      !window.ipcRenderer ||
      workspaceHydratedRef.current ||
      messages.length > 0
    ) {
      return;
    }
    workspaceHydratedRef.current = true;
    void refreshWorkspaceThreads()
      .then(async (threads) => {
        const latest = threads.find((thread) => thread.archivedAt === null);
        if (latest) await loadWorkspaceThread(latest.id);
      })
      .catch(() => {
        // Persistence is additive. Chat remains available if an older preview
        // runtime does not expose the workspace-thread channels yet.
      });
  }, [loadWorkspaceThread, messages.length, refreshWorkspaceThreads, visible]);

  useEffect(() => {
    if (!window.ipcRenderer) return;
    void window.ipcRenderer
      .invoke('intelligence:query:session-active', visible)
      .catch(() => undefined);
    return () => {
      if (visible) {
        void window.ipcRenderer
          ?.invoke('intelligence:query:session-active', false)
          .catch(() => undefined);
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!window.ipcRenderer) return;
    return window.ipcRenderer.on(
      'intelligence:query:status',
      (_event, status: AskPlutoQueryStatus) => {
        if (status.requestId === activeRequestIdRef.current) {
          setRequestPhase(status.phase);
          if (status.currentMeeting) setCurrentMeeting(status.currentMeeting);
          setComparisonMeetingCount(status.comparisonMeetingCount || 0);
          setScopeLabel(status.scopeLabel || null);
          setScopeMeetingCount(status.scopeMeetingCount || 0);
        }
      },
    );
  }, []);

  useEffect(() => {
    if (!window.ipcRenderer) return;
    return window.ipcRenderer.on(
      'intelligence:query:delta',
      (_event, packet: AskPlutoAnswerDelta) => {
        if (packet.requestId !== activeRequestIdRef.current || !packet.delta) {
          return;
        }
        setMessages((current) => {
          const next = [...current];
          const pending = next.at(-1);
          if (!pending?.isLoading || pending.role !== 'assistant')
            return current;
          next[next.length - 1] = {
            ...pending,
            content: `${pending.content}${packet.delta}`,
          };
          return next;
        });
      },
    );
  }, []);

  // Restore focus whenever the input becomes enabled (after send) or on mount
  useEffect(() => {
    if (visible && !isProcessing) inputRef.current?.focus();
  }, [visible, isProcessing]);

  useEffect(() => {
    if (visible) {
      const cache = queryCacheRef.current;
      if (cache && Date.now() - cache.fetchedAt < 30_000) {
        setDynamicQueries(cache.queries);
        return;
      }
      if (window.ipcRenderer) {
        setIsLoadingQueries(true);
        window.ipcRenderer
          .invoke('intelligence:suggested-queries')
          .then((queries: unknown) => {
            const safeQueries = Array.isArray(queries)
              ? queries.filter(
                  (candidate): candidate is string =>
                    typeof candidate === 'string' &&
                    candidate.trim().length > 0,
                )
              : [];
            setDynamicQueries(safeQueries);
            queryCacheRef.current = {
              queries: safeQueries,
              fetchedAt: Date.now(),
            };
          })
          .catch((e: unknown) => {
            console.error('Failed to load dynamic queries', e);
            setDynamicQueries([]);
          })
          .finally(() => setIsLoadingQueries(false));
      } else {
        setDynamicQueries(['What decisions were made about API Migration?']);
      }
    }
  }, [visible]);

  const handleSubmit = async (
    e?: React.FormEvent,
    presetQuery?: string,
    retryMessageId?: string,
  ) => {
    e?.preventDefault();
    const submitQuery = presetQuery || query;
    if (!submitQuery.trim()) return;
    const retryIndex = retryMessageId
      ? messages.findIndex((message) => message.id === retryMessageId)
      : -1;
    const history =
      retryIndex >= 0
        ? messages.slice(
            0,
            messages[retryIndex - 1]?.role === 'user'
              ? retryIndex - 1
              : retryIndex,
          )
        : messages;
    const failedTurnIndexes = new Set<number>();
    history.forEach((message, index) => {
      if (
        message.role === 'assistant' &&
        (message.isLoading ||
          message.retryQuery ||
          message.outcome === 'unavailable' ||
          message.outcome === 'failed' ||
          message.outcome === 'cancelled')
      ) {
        failedTurnIndexes.add(index);
        if (history[index - 1]?.role === 'user')
          failedTurnIndexes.add(index - 1);
      }
    });
    const validHistory = history.filter(
      (_message, index) => !failedTurnIndexes.has(index),
    );

    if (isProcessing && activeRequestIdRef.current && window.ipcRenderer) {
      void window.ipcRenderer
        .invoke('intelligence:query:cancel', activeRequestIdRef.current)
        .catch(() => undefined);
    }

    setQuery('');
    setIsProcessing(true);
    setRequestPhase('waiting');
    setCurrentMeeting(null);
    setComparisonMeetingCount(0);
    setScopeLabel(null);
    setScopeMeetingCount(0);
    setCurrentMeetingRequested(
      /\b(current|latest|this)\s+meeting\b|\bcurrent recording\b|\blatest one\b/i.test(
        submitQuery,
      ),
    );
    const userMessageId = nextMessageId();
    const assistantMessageId = nextMessageId();
    const workspaceThreadPromise = window.ipcRenderer
      ? ensureWorkspaceThread().catch(() => null)
      : Promise.resolve(null);
    anchorTurn(userMessageId);
    setAnchoredUserMessageId(userMessageId);
    setMessages((prev) => {
      const cleaned = prev.map((m) =>
        m.isLoading
          ? {
              ...m,
              isLoading: false,
              content: m.content || 'Stopped.',
              outcome: 'cancelled' as const,
            }
          : m,
      );
      return [
        ...cleaned,
        { id: userMessageId, role: 'user', content: submitQuery.trim() },
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          isLoading: true,
        },
      ];
    });

    const requestId = window.ipcRenderer
      ? `ask-pluto-${Date.now()}-${messageCounterRef.current}`
      : null;
    activeRequestIdRef.current = requestId;

    try {
      if (window.ipcRenderer && requestId) {
        const targetWorkspaceThreadId = await workspaceThreadPromise;
        if (targetWorkspaceThreadId) {
          await appendWorkspaceChatMessage({
            id: userMessageId,
            threadId: targetWorkspaceThreadId,
            role: 'user',
            content: submitQuery.trim(),
          }).catch(() => undefined);
        }
        const priorTurns: AskPlutoConversationTurn[] = validHistory
          .slice(-6)
          .map((message) => ({
            role: message.role,
            content: message.content.slice(0, 1200),
            ...(message.conversationContext?.meetingIds.length ||
            message.citations?.length
              ? {
                  meetingIds: message.conversationContext?.meetingIds.length
                    ? message.conversationContext.meetingIds.slice(0, 8)
                    : [
                        ...new Set(
                          message.citations?.map(
                            (citation) => citation.meeting_id,
                          ) || [],
                        ),
                      ].slice(0, 8),
                }
              : {}),
            ...(message.outcome ? { outcome: message.outcome } : {}),
            ...(message.unsupportedClaimCount
              ? { unsupportedClaimCount: message.unsupportedClaimCount }
              : {}),
            ...(message.omissionRef
              ? { omissionRef: message.omissionRef }
              : {}),
            ...(message.conversationAnchor
              ? { conversationAnchor: message.conversationAnchor }
              : {}),
            ...(message.conversationContext
              ? { conversationContext: message.conversationContext }
              : {}),
            ...(message.resolvedScope
              ? { resolvedScope: message.resolvedScope }
              : {}),
            ...(message.retrievalSummary
              ? { retrievalSummary: message.retrievalSummary }
              : {}),
            ...(message.retrievalTrace
              ? { retrievalTrace: message.retrievalTrace }
              : {}),
            ...(message.turnMode ? { turnMode: message.turnMode } : {}),
            ...(message.retrievalPolicy
              ? { retrievalPolicy: message.retrievalPolicy }
              : {}),
          }));
        const response = await window.ipcRenderer.invoke<
          string | AskPlutoQueryResponse<CitationChain>
        >('intelligence:query', {
          requestId,
          query: submitQuery.trim(),
          modeOverride,
          priorTurns,
          ...(!retryMessageId &&
          failedTurnIndexes.size === 0 &&
          workspaceThreads.find(
            (thread) => thread.id === targetWorkspaceThreadId,
          )?.memory
            ? {
                conversationMemory: workspaceThreads.find(
                  (thread) => thread.id === targetWorkspaceThreadId,
                )?.memory,
              }
            : {}),
          ...(activeMeetingSnapshot ? { activeMeetingSnapshot } : {}),
        });

        if (activeRequestIdRef.current !== requestId) return;
        const assistantMessage: AskPlutoMessage =
          typeof response !== 'string' && response.status === 'cancelled'
            ? {
                id: nextMessageId(),
                role: 'assistant',
                content: 'Stopped.',
                outcome: 'cancelled',
              }
            : {
                id: nextMessageId(),
                role: 'assistant',
                content:
                  typeof response === 'string'
                    ? response
                    : (response.answer ?? ''),
                citations:
                  typeof response === 'string' ? undefined : response.citations,
                trustStatus:
                  typeof response === 'string'
                    ? undefined
                    : response.trustStatus,
                unsupportedClaimCount:
                  typeof response === 'string'
                    ? undefined
                    : response.unsupportedClaimCount,
                omissionRef:
                  typeof response === 'string'
                    ? undefined
                    : response.omissionRef,
                conversationAnchor:
                  typeof response === 'string'
                    ? undefined
                    : response.conversationAnchor,
                conversationContext:
                  typeof response === 'string'
                    ? undefined
                    : response.conversationContext,
                retryQuery:
                  typeof response !== 'string' &&
                  response.status === 'unavailable'
                    ? submitQuery.trim()
                    : undefined,
                evidenceState:
                  typeof response === 'string' || !response.currentMeeting
                    ? undefined
                    : 'evidenceState' in response.currentMeeting
                      ? response.currentMeeting.evidenceState
                      : undefined,
                outcome:
                  typeof response === 'string'
                    ? undefined
                    : response.status === 'unavailable'
                      ? 'unavailable'
                      : response.outcome,
                resolvedScope:
                  typeof response === 'string'
                    ? undefined
                    : response.resolvedScope,
                retrievalSummary:
                  typeof response === 'string'
                    ? undefined
                    : response.retrievalSummary,
                retrievalTrace:
                  typeof response === 'string'
                    ? undefined
                    : response.retrievalTrace,
                turnMode:
                  typeof response === 'string' ? undefined : response.turnMode,
                retrievalPolicy:
                  typeof response === 'string'
                    ? undefined
                    : response.retrievalPolicy,
                actionProposal:
                  typeof response === 'string'
                    ? undefined
                    : response.actionProposal,
              };
        setMessages((prev) => {
          const newMsg = [...prev];
          newMsg.pop();
          newMsg.push(assistantMessage);
          return newMsg;
        });
        if (targetWorkspaceThreadId) {
          await appendWorkspaceChatMessage({
            id: assistantMessage.id,
            threadId: targetWorkspaceThreadId,
            role: 'assistant',
            content: assistantMessage.content,
            payload: toWorkspacePayload(assistantMessage),
          }).catch(() => undefined);
          const currentThread = workspaceThreads.find(
            (thread) => thread.id === targetWorkspaceThreadId,
          );
          const previousMemory: WorkspaceChatMemory = currentThread?.memory ?? {
            corrections: [],
            unresolvedQuestions: [],
          };
          if (
            !assistantMessage.retryQuery &&
            assistantMessage.outcome !== 'cancelled' &&
            assistantMessage.outcome !== 'failed' &&
            assistantMessage.outcome !== 'unavailable'
          )
            await updateWorkspaceChatMemory({
              threadId: targetWorkspaceThreadId,
              memory: {
                ...previousMemory,
                activeTopic:
                  assistantMessage.conversationContext?.topic ??
                  previousMemory.activeTopic,
                currentGoal:
                  assistantMessage.retrievalPolicy === 'fresh'
                    ? submitQuery.trim().slice(0, 500)
                    : previousMemory.currentGoal ||
                      submitQuery.trim().slice(0, 500),
                lastAnswerSummary: summarizeAnswer(assistantMessage.content),
                corrections:
                  assistantMessage.turnMode === 'challenge'
                    ? [
                        ...previousMemory.corrections.slice(-4),
                        submitQuery.trim().slice(0, 500),
                      ]
                    : previousMemory.corrections,
                unresolvedQuestions: previousMemory.unresolvedQuestions,
              },
            }).catch(() => undefined);
          void refreshWorkspaceThreads().catch(() => undefined);
        }
      } else {
        setMessages((prev) => {
          const newMsg = [...prev];
          newMsg.pop();
          newMsg.push({
            id: nextMessageId(),
            role: 'assistant',
            content:
              'Ask Pluto is unavailable because the desktop connection is not active. Your question was not sent.',
            outcome: 'unavailable',
          });
          return newMsg;
        });
      }
    } catch (e: unknown) {
      if (activeRequestIdRef.current !== requestId) return;
      console.error('Ask Pluto error:', e);
      const cancelled =
        (e instanceof Error && e.name === 'AbortError') ||
        (e instanceof Error && /cancelled|aborted/i.test(e.message));
      let errorMsg = "I'm sorry, there was an error processing your request.";
      if (cancelled) errorMsg = 'Stopped.';
      if (e instanceof Error && e.message) {
        let msg = e.message.replace(/^Error:\s*/, '');
        if (
          msg.includes('SqliteError') ||
          msg.includes('invoking remote method')
        ) {
          msg =
            'An internal system error occurred while searching your knowledge base.';
        }
        if (!cancelled) errorMsg += `\n\nDetails: ${msg}`;
      } else if (typeof e === 'string') {
        errorMsg += `\n\nDetails: ${e}`;
      }
      setMessages((prev) => {
        const newMsg = [...prev];
        newMsg.pop();
        newMsg.push({
          id: nextMessageId(),
          role: 'assistant',
          content: errorMsg,
          retryQuery: cancelled ? undefined : submitQuery.trim(),
          outcome: cancelled ? 'cancelled' : 'failed',
        });
        return newMsg;
      });
    } finally {
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
        setIsProcessing(false);
      }
    }
  };

  const handleCancel = async () => {
    const requestId = activeRequestIdRef.current;
    if (!requestId || !window.ipcRenderer) return;
    setRequestPhase('cancelling');
    await window.ipcRenderer.invoke('intelligence:query:cancel', requestId);
  };

  const confirmAction = async (message: AskPlutoMessage) => {
    const proposal = message.actionProposal;
    if (!proposal || message.actionState === 'saving') return;
    setMessages((current) =>
      current.map((candidate) =>
        candidate.id === message.id
          ? { ...candidate, actionState: 'saving' }
          : candidate,
      ),
    );
    try {
      await upsertEntity({
        type: 'action_item',
        name: proposal.text,
        status: 'active',
        due_date: null,
        dedupe_by_name: true,
        metadata: {
          commitment_state: 'confirmed',
          origin: 'user',
          created_from: 'ask_pluto',
          created_at: new Date().toISOString(),
        },
      });
      setMessages((current) =>
        current.map((candidate) =>
          candidate.id === message.id
            ? { ...candidate, actionState: 'completed' }
            : candidate,
        ),
      );
      const threadId = workspaceThreadIdRef.current;
      if (threadId) {
        await updateWorkspaceChatMessagePayload({
          threadId,
          messageId: message.id,
          payload: toWorkspacePayload({
            ...message,
            actionState: 'completed',
          }),
        }).catch(() => undefined);
      }
    } catch {
      setMessages((current) =>
        current.map((candidate) =>
          candidate.id === message.id
            ? { ...candidate, actionState: 'failed' }
            : candidate,
        ),
      );
    }
  };

  const handleNewConversation = () => {
    if (isProcessing) return;
    void window.ipcRenderer
      ?.invoke('intelligence:query:new-conversation')
      .catch(() => undefined);
    workspaceThreadIdRef.current = null;
    setWorkspaceThreadId(null);
    setAnchoredUserMessageId(null);
    setHistoryOpen(false);
    setMessages([]);
    setQuery('');
    setCurrentMeeting(null);
    setCurrentMeetingRequested(false);
    setComparisonMeetingCount(0);
    setScopeLabel(null);
    setScopeMeetingCount(0);
    if (window.ipcRenderer) {
      void ensureWorkspaceThread().catch(() => undefined);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const resolvedScopeLabel =
    currentMeetingRequested && currentMeeting?.kind === 'active_recording'
      ? 'Reading the current recording · live evidence'
      : currentMeetingRequested && currentMeeting?.kind === 'persisted'
        ? currentMeeting.evidenceState === 'processing'
          ? `${currentMeeting.title || 'The latest meeting'} is still processing`
          : currentMeeting.evidenceState === 'failed'
            ? `${currentMeeting.title || 'The latest meeting'} needs recovery`
            : `Reading ${currentMeeting.title || 'the latest meeting'}`
        : currentMeetingRequested && currentMeeting?.kind === 'none'
          ? 'No current meeting yet'
          : 'Searching meeting notes';
  const requestPhaseLabel = (hasVisibleAnswer: boolean) => {
    if (requestPhase === 'cancelling') return 'Stopping';
    if (requestPhase === 'writing' || requestPhase === 'generating') {
      return hasVisibleAnswer ? 'Writing' : 'Starting the answer';
    }
    if (requestPhase === 'waiting') {
      return scopeLabel && scopeMeetingCount > 0
        ? `Preparing an answer from ${scopeMeetingCount} ${scopeMeetingCount === 1 ? 'meeting' : 'meetings'}`
        : comparisonMeetingCount > 0
          ? `Preparing a comparison across ${comparisonMeetingCount + 1} meetings`
          : 'Preparing an answer';
    }
    if (scopeLabel && scopeMeetingCount > 0) {
      return `Searching ${scopeMeetingCount} ${scopeMeetingCount === 1 ? 'meeting' : 'meetings'} from ${scopeLabel}`;
    }
    return resolvedScopeLabel;
  };

  useEffect(() => {
    if (historyOpen) historyCloseRef.current?.focus({ preventScroll: true });
  }, [historyOpen]);

  if (!visible) return null;

  const activeWorkspaceThread = workspaceThreads.find(
    (thread) => thread.id === workspaceThreadId,
  );

  const closeHistory = () => {
    setHistoryOpen(false);
    requestAnimationFrame(() =>
      historyButtonRef.current?.focus({ preventScroll: true }),
    );
  };

  const deleteConversation = async (threadId: string) => {
    if (historyBusyId || isProcessing) return;
    setHistoryBusyId(threadId);
    setHistoryError(null);
    try {
      await archiveWorkspaceChatThread(threadId);
      await refreshWorkspaceThreads();
      if (threadId === workspaceThreadIdRef.current) {
        workspaceThreadIdRef.current = null;
        setWorkspaceThreadId(null);
        setAnchoredUserMessageId(null);
        setMessages([]);
        setQuery('');
        void window.ipcRenderer
          ?.invoke('intelligence:query:new-conversation')
          .catch(() => undefined);
      }
    } catch {
      setHistoryError('Could not delete this conversation. Try again.');
    } finally {
      setHistoryBusyId(null);
    }
  };

  const activeThreads = workspaceThreads.filter((thread) => !thread.archivedAt);

  return (
    <div className="relative flex min-h-full w-full flex-none flex-col bg-pro-bg">
      <div className="sticky top-0 z-20 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-pro-border/40 bg-pro-bg px-4 sm:px-8">
        <span className="min-w-0 truncate text-[13px] font-medium text-pro-text-muted">
          {activeWorkspaceThread?.title || 'Chat with Pluto'}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleNewConversation}
            disabled={isProcessing}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageSquarePlus aria-hidden="true" className="h-3.5 w-3.5" />
            New conversation
          </button>
          <button
            ref={historyButtonRef}
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            aria-label="Conversation history"
            aria-controls="ask-pluto-history"
            aria-expanded={historyOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40"
          >
            <PanelRight aria-hidden="true" className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
      {createPortal(
        <div
          className={`fixed inset-x-0 bottom-0 top-10 z-[70] flex justify-end overflow-hidden ${historyOpen ? '' : 'pointer-events-none'}`}
          aria-hidden={!historyOpen}
          ref={(element) => {
            if (!element) return;
            if (historyOpen) element.removeAttribute('inert');
            else element.setAttribute('inert', '');
          }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={closeHistory}
            className={`absolute inset-0 bg-black/10 transition-opacity duration-150 ease-linear motion-reduce:transition-none dark:bg-black/40 ${historyOpen ? 'opacity-100' : 'opacity-0'}`}
          />
          <aside
            id="ask-pluto-history"
            role="dialog"
            aria-modal="true"
            aria-label="Conversation history"
            className={`relative flex h-full w-[min(24rem,calc(100vw-3rem))] flex-col bg-pro-bg shadow-[-16px_0_40px_rgba(0,0,0,0.1)] transition-transform duration-[180ms] ease-[cubic-bezier(0.2,0,0,1)] will-change-transform motion-reduce:transition-none dark:shadow-[-16px_0_40px_rgba(0,0,0,0.35)] ${historyOpen ? 'translate-x-0' : 'translate-x-full'}`}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeHistory();
              if (event.key !== 'Tab') return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled)',
                ),
              );
              const first = buttons[0];
              const last = buttons.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="flex min-h-[72px] items-center justify-between gap-3 border-b border-pro-border/50 px-6">
              <h2 className="font-serif text-[22px] font-medium leading-tight tracking-[-0.02em] text-pro-text-main">
                Conversations
              </h2>
              <button
                ref={historyCloseRef}
                type="button"
                onClick={closeHistory}
                aria-label="Close conversation history"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-pro-text-main transition-colors hover:bg-pro-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40"
              >
                <X aria-hidden="true" className="h-[18px] w-[18px]" />
              </button>
            </div>
            <nav
              aria-label="Saved conversations"
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
            >
              {historyError ? (
                <p role="alert" className="px-2 py-2 text-[12px] text-red-600">
                  {historyError}
                </p>
              ) : null}
              {activeThreads.length === 0 ? (
                <div className="mx-2 mt-6 border-t border-pro-border/60 pt-7">
                  <h3 className="font-serif text-[19px] font-medium text-pro-text-main">
                    No conversations yet
                  </h3>
                  <p className="mt-2 max-w-[26ch] text-[13px] leading-6 text-pro-text-muted">
                    Your conversations will appear here after you start
                    chatting.
                  </p>
                  <button
                    type="button"
                    onClick={handleNewConversation}
                    disabled={isProcessing}
                    className="mt-5 inline-flex min-h-10 items-center gap-2 text-[13px] font-medium text-pro-text-main underline decoration-pro-border underline-offset-4 transition-colors hover:decoration-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40 disabled:opacity-40"
                  >
                    Start a conversation
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                activeThreads.map((thread) => (
                  <div
                    key={thread.id}
                    className={`group flex items-center gap-1 border-b border-pro-border/40 px-2 transition-colors last:border-b-0 hover:bg-pro-surface/50 ${thread.id === workspaceThreadId ? 'bg-pro-surface/60' : ''}`}
                  >
                    <button
                      type="button"
                      aria-current={
                        thread.id === workspaceThreadId ? 'page' : undefined
                      }
                      onClick={() => void loadWorkspaceThread(thread.id)}
                      className={`min-h-16 min-w-0 flex-1 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40 ${thread.id === workspaceThreadId ? 'text-pro-text-main' : 'text-pro-text-muted hover:text-pro-text-main'}`}
                    >
                      <span
                        className={`block truncate text-[13px] leading-5 ${thread.id === workspaceThreadId ? 'font-semibold' : 'font-medium'}`}
                      >
                        {thread.title}
                      </span>
                      <time
                        dateTime={thread.updatedAt}
                        className="mt-1 block text-[11px] tabular-nums text-pro-text-muted/80"
                      >
                        {formatConversationDate(thread.updatedAt)}
                      </time>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete conversation ${thread.title}`}
                      title="Delete conversation"
                      disabled={Boolean(historyBusyId) || isProcessing}
                      onClick={() => void deleteConversation(thread.id)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-pro-text-muted/70 opacity-0 transition-[color,opacity] hover:text-red-600 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-30 [@media(hover:none)]:opacity-100"
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </nav>
          </aside>
        </div>,
        document.body,
      )}
      {/* Scrollable message area — same width as the input */}
      <div className="flex-1 relative flex flex-col w-full max-w-3xl mx-auto px-4 sm:px-8">
        <div
          ref={conversationRef}
          role="log"
          aria-label="Conversation with Pluto"
          aria-live="polite"
          className={`flex-1 space-y-10 flex flex-col w-full pb-6 ${messages.length > 0 ? 'pt-4' : 'pt-8'}`}
        >
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-start justify-center space-y-8">
              {/* Greeting — serif, left-aligned to match input */}
              <div>
                <h1 className="font-serif text-[36px] font-medium tracking-[-0.01em] text-pro-text-main leading-tight">
                  Hello, I'm Pluto.
                </h1>
                <p className="text-[16px] text-pro-text-muted/70 font-medium mt-2 leading-relaxed">
                  Ask me about your past meetings, decisions, or action items.
                </p>
              </div>

              {/* Suggested queries */}
              <div className="flex flex-wrap items-center gap-2.5 w-full">
                {isLoadingQueries ? (
                  <>
                    <div className="h-9 w-48 rounded-full bg-black/5 dark:bg-white/5 animate-pulse" />
                    <div className="h-9 w-56 rounded-full bg-black/5 dark:bg-white/5 animate-pulse" />
                    <div className="h-9 w-40 rounded-full bg-black/5 dark:bg-white/5 animate-pulse" />
                  </>
                ) : dynamicQueries.length === 0 ? (
                  <p className="text-pro-text-muted/50 text-[13px] font-medium">
                    Record a meeting to get personalized suggestions.
                  </p>
                ) : (
                  dynamicQueries.map((sq) => (
                    <button
                      key={sq}
                      type="button"
                      onClick={() => handleSubmit(undefined, sq)}
                      className="min-h-11 px-4 py-2 rounded-full bg-transparent border border-pro-border/50 hover:bg-pro-surface hover:border-pro-border text-pro-text-muted hover:text-pro-text-main text-[13px] font-medium transition-all duration-200"
                    >
                      {sq}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            messages.map((msg, index) => {
              const citationGroups = groupCitationsByMeeting(
                msg.citations ?? [],
              );
              const isAnchoredReply =
                msg.role === 'assistant' &&
                index === messages.length - 1 &&
                messages[index - 1]?.id === anchoredUserMessageId;
              return (
                <div
                  key={msg.id}
                  data-chat-turn-id={msg.id}
                  role="article"
                  aria-label={msg.role === 'user' ? 'You' : 'Pluto'}
                  className={`scroll-mt-20 flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${isAnchoredReply ? 'min-h-[calc(100dvh-13rem)]' : ''}`}
                >
                  {msg.role === 'assistant' && (
                    <div
                      aria-hidden="true"
                      className="relative top-1 w-8 h-8 rounded-full bg-[oklch(0.965_0.018_82)] dark:bg-[oklch(0.38_0.025_82)] flex items-center justify-center shrink-0"
                    >
                      <Logo size={22} variant="default" />
                    </div>
                  )}
                  <div
                    className={`flex flex-col gap-2 ${
                      msg.role === 'user'
                        ? 'max-w-[82%] items-end'
                        : 'max-w-[92%] sm:max-w-[88%] items-start'
                    }`}
                  >
                    <div
                      className={`text-[15px] relative ${
                        msg.role === 'user'
                          ? 'px-5 py-3.5 leading-relaxed bg-black/5 dark:bg-white/10 text-pro-text-main rounded-2xl rounded-tr-sm'
                          : 'px-1 py-1 leading-7 text-pro-text-main'
                      }`}
                    >
                      {msg.isLoading && !msg.content ? (
                        <div
                          data-testid="ask-pluto-loading-shell"
                          className="w-full max-w-[34rem] py-0.5 animate-in fade-in duration-300"
                        >
                          <output aria-live="polite" className="block">
                            <div className="flex min-h-7 items-center gap-2">
                              <Sparkles className="h-3.5 w-3.5 shrink-0 text-pro-accent/75" />
                              <span className="truncate text-[13px] font-medium text-pro-text-main/80">
                                {requestPhaseLabel(Boolean(msg.content))}
                              </span>
                            </div>
                          </output>

                          <div
                            data-testid="ask-pluto-loading-lines"
                            aria-hidden="true"
                            className="mt-2.5 max-w-sm space-y-2"
                          >
                            <div className="pluto-skeleton-line h-1.5 w-[72%] rounded-full" />
                            <div className="pluto-skeleton-line h-1.5 w-[46%] rounded-full" />
                          </div>
                        </div>
                      ) : (
                        <div
                          data-testid="ask-pluto-answer-content"
                          className={ASSISTANT_MARKDOWN_CLASS_NAME}
                        >
                          {msg.isLoading ? (
                            <output aria-live="polite" className="sr-only">
                              {requestPhaseLabel(true)}
                            </output>
                          ) : null}
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.isLoading
                              ? msg.content.replace(/\[Source\s+\d+\]/gi, '')
                              : msg.content}
                          </ReactMarkdown>
                          {msg.isLoading ? (
                            <span
                              data-testid="ask-pluto-stream-caret"
                              aria-hidden="true"
                              className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.15em] rounded-full bg-pro-accent/80 animate-pulse motion-reduce:animate-none"
                            />
                          ) : null}
                        </div>
                      )}
                    </div>

                    {msg.role === 'assistant' &&
                      !msg.isLoading &&
                      (msg.outcome === 'no_evidence' ||
                        msg.outcome === 'partial' ||
                        msg.evidenceState === 'provisional' ||
                        msg.trustStatus === 'needs_review') && (
                        <div
                          className={`px-1 text-[11px] font-medium ${
                            msg.outcome === 'no_evidence'
                              ? 'text-pro-text-muted'
                              : msg.outcome === 'partial' ||
                                  msg.trustStatus === 'needs_review'
                                ? 'text-amber-600'
                                : msg.trustStatus === 'inferred'
                                  ? 'text-pro-accent'
                                  : 'text-emerald-600'
                          }`}
                        >
                          {msg.outcome === 'no_evidence'
                            ? "I couldn't verify an answer"
                            : msg.outcome === 'partial'
                              ? `Partial answer${msg.unsupportedClaimCount ? ` · ${msg.unsupportedClaimCount} draft ${msg.unsupportedClaimCount === 1 ? 'statement needs' : 'statements need'} a closer check` : ''}`
                              : msg.evidenceState === 'provisional'
                                ? 'Provisional live answer'
                                : msg.trustStatus === 'needs_review'
                                  ? `Needs review${msg.unsupportedClaimCount ? ` · ${msg.unsupportedClaimCount} ${msg.unsupportedClaimCount === 1 ? 'detail could' : 'details could'} not be verified` : ''}`
                                  : ''}
                        </div>
                      )}

                    {msg.role === 'assistant' &&
                      !msg.isLoading &&
                      msg.actionProposal && (
                        <div className="ml-1 flex w-full max-w-md items-center justify-between gap-4 rounded-xl border border-pro-border/60 bg-pro-surface/55 px-3.5 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-pro-text-main">
                              {msg.actionProposal.text}
                            </p>
                            <p className="mt-0.5 text-[11px] text-pro-text-muted">
                              {msg.actionState === 'completed'
                                ? 'Saved to your commitments'
                                : msg.actionState === 'failed'
                                  ? 'Could not save it. Try again.'
                                  : 'Nothing changes until you confirm'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void confirmAction(msg)}
                            disabled={
                              msg.actionState === 'saving' ||
                              msg.actionState === 'completed'
                            }
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-pro-accent px-3 text-[12px] font-semibold text-white transition-colors hover:bg-pro-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40 disabled:cursor-default disabled:opacity-60"
                          >
                            {msg.actionState === 'saving'
                              ? 'Saving…'
                              : msg.actionState === 'completed'
                                ? 'Saved'
                                : msg.actionProposal.label}
                            {msg.actionState !== 'completed' ? (
                              <ArrowRight
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                            ) : null}
                          </button>
                        </div>
                      )}

                    {msg.role === 'assistant' &&
                      !msg.isLoading &&
                      msg.retrievalTrace &&
                      ((msg.retrievalTrace.meetings?.length || 0) > 0 ||
                        msg.retrievalTrace.sections.length > 0 ||
                        msg.retrievalTrace.commitmentCount > 0) && (
                        <div className="px-1 text-[11px] text-pro-text-muted/75">
                          {[
                            msg.retrievalTrace.sections.length > 0
                              ? `${msg.retrievalTrace.sections.length} synthesized note ${msg.retrievalTrace.sections.length === 1 ? 'section' : 'sections'}`
                              : (msg.retrievalTrace.meetings?.length || 0) > 0
                                ? `${msg.retrievalTrace.meetings?.length} synthesized ${msg.retrievalTrace.meetings?.length === 1 ? 'note' : 'notes'}`
                                : '',
                            msg.retrievalTrace.commitmentCount > 0
                              ? `${msg.retrievalTrace.commitmentCount} ${msg.retrievalTrace.commitmentCount === 1 ? 'commitment' : 'commitments'}`
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}

                    {msg.role === 'assistant' &&
                      !msg.isLoading &&
                      msg.retryQuery && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleSubmit(undefined, msg.retryQuery, msg.id)
                          }
                          className="px-1 text-[12px] font-medium text-pro-accent hover:text-pro-text-main"
                        >
                          Retry
                        </button>
                      )}

                    {msg.role === 'assistant' &&
                      !msg.isLoading &&
                      msg.citations &&
                      msg.citations.length > 0 && (
                        <details className="group/source w-full pl-1">
                          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-[12px] font-medium text-pro-text-muted transition-colors hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40 [&::-webkit-details-marker]:hidden">
                            <span>
                              {msg.citations.length}{' '}
                              {msg.citations.length === 1
                                ? 'reference'
                                : 'references'}
                            </span>
                            <span className="text-pro-text-muted/50">·</span>
                            <span className="font-normal">
                              {citationGroups.length}{' '}
                              {citationGroups.length === 1
                                ? 'source'
                                : 'sources'}
                            </span>
                            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open/source:rotate-180" />
                          </summary>

                          <div className="mt-2 overflow-hidden rounded-xl border border-pro-border/50 bg-black/[0.015] dark:bg-white/[0.02] divide-y divide-pro-border/40">
                            {citationGroups.map((group) => {
                              const navigationCitation =
                                group.citations.find(
                                  (citation) =>
                                    citation.timestamp_ms !== undefined,
                                ) ||
                                group.citations.find((citation) =>
                                  Boolean(citation.section_id),
                                );
                              const evidence = [
                                ...new Set(
                                  group.citations
                                    .map((citation) => citation.evidence_span)
                                    .filter((span): span is string =>
                                      Boolean(span),
                                    ),
                                ),
                              ].slice(0, 2);
                              return (
                                <div
                                  key={group.meetingId}
                                  className="px-3.5 py-3"
                                >
                                  <button
                                    type="button"
                                    aria-label={
                                      group.sourceType === 'artifact'
                                        ? `Open local source ${group.meetingTitle}`
                                        : `Open ${group.meetingTitle}`
                                    }
                                    onClick={() => {
                                      if (group.sourceType === 'artifact') {
                                        onOpenArtifact(group.meetingId);
                                        return;
                                      }
                                      if (!navigationCitation) {
                                        onOpenMeeting(group.meetingId);
                                        return;
                                      }
                                      onOpenMeeting(group.meetingId, {
                                        ...(navigationCitation.section_id
                                          ? {
                                              sectionId:
                                                navigationCitation.section_id,
                                            }
                                          : {}),
                                        ...(navigationCitation.timestamp_ms !==
                                        undefined
                                          ? {
                                              timestampMs:
                                                navigationCitation.timestamp_ms,
                                            }
                                          : {}),
                                      });
                                    }}
                                    className="group/meeting flex w-full items-start justify-between gap-3 text-left"
                                  >
                                    <span className="min-w-0">
                                      <span className="block truncate text-[12px] font-semibold text-pro-text-main">
                                        {group.meetingTitle}
                                      </span>
                                      <span className="mt-0.5 block text-[11px] text-pro-text-muted">
                                        {group.sourceType === 'artifact'
                                          ? 'Local source'
                                          : navigationCitation?.section_heading ||
                                            (navigationCitation?.timestamp_ms !==
                                            undefined
                                              ? `Transcript · ${Math.floor(
                                                  navigationCitation.timestamp_ms /
                                                    60000,
                                                )}:${Math.floor(
                                                  (navigationCitation.timestamp_ms /
                                                    1000) %
                                                    60,
                                                )
                                                  .toString()
                                                  .padStart(2, '0')}`
                                              : `${group.citations.length} ${
                                                  group.citations.length === 1
                                                    ? 'reference'
                                                    : 'references'
                                                }`)}
                                      </span>
                                    </span>
                                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pro-text-muted/60 transition-colors group-hover/meeting:text-pro-accent" />
                                  </button>
                                  {evidence.length > 0 && (
                                    <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-pro-text-muted">
                                      {evidence.map((span) => (
                                        <p key={span} className="line-clamp-2">
                                          “{span}”
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Keep the composer visible while the full chat view scrolls. */}
        <div className="sticky bottom-0 z-10 flex shrink-0 justify-center bg-pro-bg pb-6 pt-4">
          <form
            onSubmit={handleSubmit}
            className="relative flex items-center w-full pointer-events-auto bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-full shadow-[0_4px_16px_-4px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.2)] transition-all duration-300 focus-within:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.08)] dark:focus-within:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.3)] hover:border-black/20 dark:hover:border-white/20"
          >
            <input
              ref={inputRef}
              aria-label="Ask Pluto"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent min-h-[56px] py-4 pl-6 pr-28 text-[15px] text-pro-text-main outline-none placeholder:text-pro-text-muted/60 rounded-full"
              placeholder="Ask Pluto…"
            />
            <button
              type="button"
              aria-label="Analyze deeply"
              aria-pressed={modeOverride === 'deep'}
              title="Use deeper reasoning for the next question"
              disabled={isProcessing}
              onClick={() =>
                setModeOverride((current) =>
                  current === 'deep' ? 'auto' : 'deep',
                )
              }
              className={`absolute right-12 inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                modeOverride === 'deep'
                  ? 'bg-pro-accent/10 text-pro-accent'
                  : 'text-pro-text-muted hover:bg-black/5 hover:text-pro-text-main dark:hover:bg-white/5'
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
              Deep
            </button>
            {isProcessing && !query.trim() ? (
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={requestPhase === 'cancelling'}
                title="Stop"
                aria-label="Stop"
                className="absolute right-3 w-8 h-8 rounded-full bg-black dark:bg-white text-white dark:text-black flex items-center justify-center hover:opacity-90 transition-all active:scale-95 disabled:opacity-40 shadow-xs"
              >
                <Square className="w-2.5 h-2.5 fill-current rounded-[0.5px]" />
                <span className="sr-only">Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send message"
                disabled={!query.trim()}
                className="absolute right-3 w-8 h-8 rounded-full bg-black dark:bg-white text-white dark:text-black flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition-all active:scale-95 group/submit shadow-xs"
              >
                <ArrowRight
                  className="w-4 h-4 opacity-90 transition-transform group-hover/submit:translate-x-0.5"
                  strokeWidth={2}
                />
              </button>
            )}
          </form>
        </div>
        <div ref={conversationEndRef} aria-hidden="true" />
      </div>
    </div>
  );
};

import { ArrowRight, Brain, Square } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AskPlutoActiveMeetingSnapshot,
  AskPlutoAnswerDelta,
  AskPlutoConversationTurn,
  AskPlutoCurrentMeeting,
  AskPlutoQueryPhase,
  AskPlutoQueryResponse,
  AskPlutoQueryStatus,
} from '../../types/askPlutoQuery';
import { Logo } from '../Brand/Logo';
import { CitationCard, type CitationChain } from './CitationCard';

interface AskPlutoProps {
  onOpenMeeting: (id: string) => void;
  visible: boolean;
  onClose: () => void;
  activeMeetingSnapshot?: AskPlutoActiveMeetingSnapshot;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationChain[];
  isLoading?: boolean;
  trustStatus?: 'grounded' | 'inferred' | 'needs_review';
  unsupportedClaimCount?: number;
  retryQuery?: string;
  evidenceState?: 'provisional' | 'processing' | 'failed' | 'completed';
}

export const AskPluto: React.FC<AskPlutoProps> = ({
  onOpenMeeting,
  visible,
  activeMeetingSnapshot,
}) => {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [requestPhase, setRequestPhase] =
    useState<AskPlutoQueryPhase>('retrieving');
  const [currentMeeting, setCurrentMeeting] =
    useState<AskPlutoCurrentMeeting | null>(null);
  const [currentMeetingRequested, setCurrentMeetingRequested] = useState(false);
  const [comparisonMeetingCount, setComparisonMeetingCount] = useState(0);
  const [modeOverride, setModeOverride] = useState<'auto' | 'deep'>('auto');
  const [activeCitationKey, setActiveCitationKey] = useState<string | null>(
    null,
  );
  const [dynamicQueries, setDynamicQueries] = useState<string[]>([]);
  const [isLoadingQueries, setIsLoadingQueries] = useState(false);

  const queryCacheRef = useRef<{ queries: string[]; fetchedAt: number } | null>(
    null,
  );
  const messageCounterRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const nextMessageId = () =>
    `msg-${Date.now()}-${messageCounterRef.current++}`;

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  useEffect(() => {
    if (!window.ipcRenderer) return;
    return window.ipcRenderer.on(
      'intelligence:query:status',
      (_event, status: AskPlutoQueryStatus) => {
        if (status.requestId === activeRequestIdRef.current) {
          setRequestPhase(status.phase);
          if (status.currentMeeting) setCurrentMeeting(status.currentMeeting);
          setComparisonMeetingCount(status.comparisonMeetingCount || 0);
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
          .then((queries: string[]) => {
            setDynamicQueries(queries);
            queryCacheRef.current = { queries, fetchedAt: Date.now() };
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

  const handleSubmit = async (e?: React.FormEvent, presetQuery?: string) => {
    e?.preventDefault();
    const submitQuery = presetQuery || query;
    if (!submitQuery.trim() || isProcessing) return;

    setQuery('');
    setMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: 'user', content: submitQuery.trim() },
    ]);
    setIsProcessing(true);
    setRequestPhase('retrieving');
    setCurrentMeeting(null);
    setComparisonMeetingCount(0);
    setCurrentMeetingRequested(
      /\b(current|latest|this)\s+meeting\b|\bcurrent recording\b|\blatest one\b/i.test(
        submitQuery,
      ),
    );
    setActiveCitationKey(null);
    setMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: 'assistant', content: '', isLoading: true },
    ]);

    try {
      if (window.ipcRenderer) {
        const requestId = `ask-pluto-${Date.now()}-${messageCounterRef.current}`;
        activeRequestIdRef.current = requestId;
        const priorTurns: AskPlutoConversationTurn[] = messages
          .slice(-6)
          .map((message) => ({
            role: message.role,
            content: message.content.slice(0, 1200),
            ...(message.citations?.length
              ? {
                  meetingIds: [
                    ...new Set(
                      message.citations.map((citation) => citation.meeting_id),
                    ),
                  ].slice(0, 8),
                }
              : {}),
          }));
        const response = await window.ipcRenderer.invoke<
          string | AskPlutoQueryResponse<CitationChain>
        >('intelligence:query', {
          requestId,
          query: submitQuery.trim(),
          modeOverride,
          priorTurns,
          ...(activeMeetingSnapshot ? { activeMeetingSnapshot } : {}),
        });

        setMessages((prev) => {
          const newMsg = [...prev];
          newMsg.pop();
          if (typeof response !== 'string' && response.status === 'cancelled') {
            newMsg.push({
              id: nextMessageId(),
              role: 'assistant',
              content: 'Stopped.',
            });
            return newMsg;
          }
          const content =
            typeof response === 'string' ? response : (response.answer ?? '');
          newMsg.push({
            id: nextMessageId(),
            role: 'assistant',
            content,
            citations:
              typeof response === 'string' ? undefined : response.citations,
            trustStatus:
              typeof response === 'string' ? undefined : response.trustStatus,
            unsupportedClaimCount:
              typeof response === 'string'
                ? undefined
                : response.unsupportedClaimCount,
            retryQuery:
              typeof response !== 'string' && response.status === 'unavailable'
                ? submitQuery.trim()
                : undefined,
            evidenceState:
              typeof response === 'string' || !response.currentMeeting
                ? undefined
                : 'evidenceState' in response.currentMeeting
                  ? response.currentMeeting.evidenceState
                  : undefined,
          });
          return newMsg;
        });
      } else {
        setMessages((prev) => {
          const newMsg = [...prev];
          newMsg.pop();
          newMsg.push({
            id: nextMessageId(),
            role: 'assistant',
            content:
              'Ask Pluto is unavailable because the desktop connection is not active. Your question was not sent.',
          });
          return newMsg;
        });
      }
    } catch (e: unknown) {
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
        });
        return newMsg;
      });
    } finally {
      activeRequestIdRef.current = null;
      setIsProcessing(false);
    }
  };

  const handleCancel = async () => {
    const requestId = activeRequestIdRef.current;
    if (!requestId || !window.ipcRenderer) return;
    setRequestPhase('cancelling');
    await window.ipcRenderer.invoke('intelligence:query:cancel', requestId);
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
          : 'Finding relevant meetings';
  const requestPhaseLabel =
    requestPhase === 'generating'
      ? comparisonMeetingCount > 0
        ? `Comparing with ${comparisonMeetingCount} earlier ${comparisonMeetingCount === 1 ? 'meeting' : 'meetings'}`
        : 'Analyzing evidence'
      : requestPhase === 'cancelling'
        ? 'Stopping'
        : resolvedScopeLabel;

  if (!visible) return null;

  return (
    <div className="flex flex-col flex-1 w-full relative animate-in fade-in duration-300 bg-pro-bg">
      {/* Scrollable message area — same width as the input */}
      <div className="flex-1 relative flex flex-col w-full max-w-3xl mx-auto px-4 sm:px-8">
        <div className="flex-1 space-y-10 pb-32 flex flex-col pt-16 w-full">
          {messages.length === 0 ? (
            <div className="flex flex-col items-start justify-center h-full space-y-8 pb-20 mt-4 animate-in fade-in zoom-in-95 duration-700">
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
                      className="px-4 py-2 rounded-full bg-transparent border border-pro-border/50 hover:bg-pro-surface hover:border-pro-border text-pro-text-muted hover:text-pro-text-main text-[13px] font-medium transition-all duration-200"
                    >
                      {sq}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 flex items-center justify-center shrink-0 mt-0.5">
                    <Logo size={18} variant="default" />
                  </div>
                )}
                <div
                  className={`flex flex-col gap-2 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`px-5 py-3.5 text-[15px] leading-relaxed relative ${
                      msg.role === 'user'
                        ? 'bg-black/5 dark:bg-white/10 text-pro-text-main rounded-2xl rounded-tr-sm'
                        : 'bg-white dark:bg-[#202020] border border-black/5 dark:border-white/5 shadow-sm text-pro-text-main rounded-2xl rounded-tl-sm'
                    }`}
                  >
                    {msg.isLoading ? (
                      <div className="space-y-3 px-1">
                        {msg.content ? (
                          <div className="prose prose-invert prose-sm max-w-none [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content.replace(/\[Source\s+\d+\]/gi, '')}
                            </ReactMarkdown>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-3 min-h-[22px]">
                          {!msg.content ? (
                            <div className="flex gap-1.5 opacity-60">
                              <div className="w-1.5 h-1.5 rounded-full bg-pro-text-muted animate-bounce" />
                              <div className="w-1.5 h-1.5 rounded-full bg-pro-text-muted animate-bounce [animation-delay:-.2s]" />
                              <div className="w-1.5 h-1.5 rounded-full bg-pro-text-muted animate-bounce [animation-delay:-.4s]" />
                            </div>
                          ) : null}
                          <span className="text-[13px] text-pro-text-muted">
                            {requestPhaseLabel}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCancel()}
                            disabled={requestPhase === 'cancelling'}
                            className="inline-flex items-center gap-1 text-[12px] text-pro-text-muted hover:text-pro-text-main disabled:opacity-50"
                          >
                            <Square className="h-2.5 w-2.5 fill-current" />
                            Stop
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:text-pro-text-main [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-pro-text-main [&_h3]:mt-3 [&_h3]:mb-1">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>

                  {msg.role === 'assistant' &&
                    !msg.isLoading &&
                    msg.trustStatus && (
                      <div
                        className={`px-1 text-[11px] font-medium ${
                          msg.trustStatus === 'needs_review'
                            ? 'text-amber-600'
                            : msg.trustStatus === 'inferred'
                              ? 'text-pro-accent'
                              : 'text-emerald-600'
                        }`}
                      >
                        {msg.evidenceState === 'provisional'
                          ? 'Provisional live answer'
                          : msg.trustStatus === 'needs_review'
                            ? `Needs review${msg.unsupportedClaimCount ? ` · ${msg.unsupportedClaimCount} unsupported ${msg.unsupportedClaimCount === 1 ? 'claim' : 'claims'}` : ''}`
                            : msg.trustStatus === 'inferred'
                              ? 'Supported synthesis'
                              : 'Grounded answer'}
                      </div>
                    )}

                  {msg.role === 'assistant' &&
                    !msg.isLoading &&
                    msg.retryQuery && (
                      <button
                        type="button"
                        onClick={() =>
                          void handleSubmit(undefined, msg.retryQuery)
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
                      <div className="w-full space-y-3 pl-1">
                        <div className="flex items-center gap-3 text-[10px] font-medium text-pro-text-muted/50">
                          <span>Evidence</span>
                          <span className="h-px flex-1 bg-pro-border/30" />
                          <span className="text-[#10B981]">
                            {msg.citations.length} Found
                          </span>
                        </div>
                        <div className="space-y-3">
                          {msg.citations.map((cit) => {
                            const citationKey = `${msg.id}-${cit.meeting_id}-${cit.claim}`;
                            return (
                              <CitationCard
                                key={citationKey}
                                citation={cit}
                                isActive={activeCitationKey === citationKey}
                                onClick={() =>
                                  setActiveCitationKey(citationKey)
                                }
                                onNavigateToMeeting={() =>
                                  onOpenMeeting(cit.meeting_id)
                                }
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} className="h-4 shrink-0" />
        </div>

        {/* Input bar — sticky at the bottom */}
        <div className="pb-8 pt-6 sticky bottom-0 left-0 right-0 z-10 flex justify-center bg-gradient-to-t from-pro-bg via-pro-bg/95 to-transparent pointer-events-none mt-auto">
          <form
            onSubmit={handleSubmit}
            className="relative flex items-center w-full pointer-events-auto bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-full shadow-[0_4px_16px_-4px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.2)] transition-all duration-300 focus-within:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.08)] dark:focus-within:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.3)] hover:border-black/20 dark:hover:border-white/20"
          >
            <input
              ref={inputRef}
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
            <button
              type="submit"
              disabled={!query.trim() || isProcessing}
              className="absolute right-3 w-8 h-8 rounded-full bg-black dark:bg-white text-white dark:text-black flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition-all active:scale-95 group/submit"
            >
              <ArrowRight
                className="w-4 h-4 opacity-90 transition-transform group-hover/submit:translate-x-0.5"
                strokeWidth={2}
              />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

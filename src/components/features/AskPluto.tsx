import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  ChevronDown,
  Sparkles,
  Square,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AskPlutoActiveMeetingSnapshot,
  AskPlutoAnswerDelta,
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
  outcome?: AskPlutoOutcome;
  resolvedScope?: ResolvedAskPlutoScope;
  retrievalSummary?: AskPlutoRetrievalSummary;
  retrievalTrace?: AskPlutoRetrievalTrace;
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

export const AskPluto: React.FC<AskPlutoProps> = ({
  onOpenMeeting,
  onOpenArtifact,
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
  const [scopeLabel, setScopeLabel] = useState<string | null>(null);
  const [scopeMeetingCount, setScopeMeetingCount] = useState(0);
  const [modeOverride, setModeOverride] = useState<'auto' | 'deep'>('auto');
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
    if (!submitQuery.trim()) return;

    if (isProcessing && activeRequestIdRef.current && window.ipcRenderer) {
      void window.ipcRenderer
        .invoke('intelligence:query:cancel', activeRequestIdRef.current)
        .catch(() => undefined);
    }

    setQuery('');
    setIsProcessing(true);
    setRequestPhase('retrieving');
    setCurrentMeeting(null);
    setComparisonMeetingCount(0);
    setScopeLabel(null);
    setScopeMeetingCount(0);
    setCurrentMeetingRequested(
      /\b(current|latest|this)\s+meeting\b|\bcurrent recording\b|\blatest one\b/i.test(
        submitQuery,
      ),
    );
    setMessages((prev) => {
      const cleaned = prev.map((m) =>
        m.isLoading
          ? {
              ...m,
              isLoading: false,
              content: m.content || 'Stopped.',
            }
          : m,
      );
      return [
        ...cleaned,
        { id: nextMessageId(), role: 'user', content: submitQuery.trim() },
        {
          id: nextMessageId(),
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
            ...(message.outcome ? { outcome: message.outcome } : {}),
            ...(message.resolvedScope
              ? { resolvedScope: message.resolvedScope }
              : {}),
            ...(message.retrievalSummary
              ? { retrievalSummary: message.retrievalSummary }
              : {}),
            ...(message.retrievalTrace
              ? { retrievalTrace: message.retrievalTrace }
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

        if (activeRequestIdRef.current !== requestId) return;
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
            outcome:
              typeof response === 'string' ? undefined : response.outcome,
            resolvedScope:
              typeof response === 'string' ? undefined : response.resolvedScope,
            retrievalSummary:
              typeof response === 'string'
                ? undefined
                : response.retrievalSummary,
            retrievalTrace:
              typeof response === 'string'
                ? undefined
                : response.retrievalTrace,
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
      return hasVisibleAnswer
        ? 'Checking each claim against your sources'
        : 'Writing a grounded answer';
    }
    if (requestPhase === 'waiting') {
      return scopeLabel && scopeMeetingCount > 0
        ? `Preparing an answer from ${scopeMeetingCount} ${scopeMeetingCount === 1 ? 'meeting' : 'meetings'}`
        : comparisonMeetingCount > 0
          ? `Preparing a comparison across ${comparisonMeetingCount + 1} meetings`
          : 'Preparing a grounded answer';
    }
    if (scopeLabel && scopeMeetingCount > 0) {
      return `Searching ${scopeMeetingCount} ${scopeMeetingCount === 1 ? 'meeting' : 'meetings'} from ${scopeLabel}`;
    }
    return resolvedScopeLabel;
  };

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
            messages.map((msg) => {
              const citationGroups = groupCitationsByMeeting(
                msg.citations ?? [],
              );
              const loadingPhaseIndex = msg.content
                ? 3
                : requestPhase === 'waiting'
                  ? 1
                  : requestPhase === 'writing' || requestPhase === 'generating'
                    ? 2
                    : 0;
              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="relative top-1 w-8 h-8 rounded-full bg-[oklch(0.965_0.018_82)] dark:bg-[oklch(0.38_0.025_82)] flex items-center justify-center shrink-0">
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
                      {msg.isLoading ? (
                        <div
                          data-testid="ask-pluto-loading-shell"
                          className="w-full max-w-[34rem] space-y-2.5 py-0.5 animate-in fade-in duration-300"
                        >
                          <output aria-live="polite" className="block">
                            <div className="flex min-h-7 items-center gap-2">
                              <Sparkles className="h-3.5 w-3.5 text-pro-accent/75 shrink-0 animate-pulse [animation-duration:2.4s]" />
                              <span className="truncate text-[13px] font-medium text-pro-text-main/80">
                                {requestPhaseLabel(Boolean(msg.content))}
                              </span>
                              <div
                                aria-hidden="true"
                                className="flex items-center gap-1.5 ml-1 shrink-0"
                              >
                                {[0, 1, 2, 3].map((step) => {
                                  const state =
                                    step < loadingPhaseIndex
                                      ? 'complete'
                                      : step === loadingPhaseIndex
                                        ? 'active'
                                        : 'pending';
                                  return (
                                    <span
                                      key={step}
                                      data-testid="ask-pluto-phase-step"
                                      data-state={state}
                                      className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                                        state === 'complete'
                                          ? 'bg-pro-accent/70'
                                          : state === 'active'
                                            ? 'bg-pro-accent scale-110 shadow-[0_0_4px_rgba(21,93,177,0.5)]'
                                            : 'bg-pro-border dark:bg-white/15'
                                      }`}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          </output>

                          {/* Streaming Content */}
                          {msg.content ? (
                            <div className="prose prose-invert prose-sm mt-2 max-w-none [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content.replace(/\[Source\s+\d+\]/gi, '')}
                              </ReactMarkdown>
                              <span
                                data-testid="ask-pluto-stream-caret"
                                aria-hidden="true"
                                className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.15em] rounded-full bg-pro-accent/80 animate-pulse motion-reduce:animate-none"
                              />
                            </div>
                          ) : (
                            <div
                              data-testid="ask-pluto-loading-lines"
                              aria-hidden="true"
                              className="space-y-2 pt-1 max-w-sm"
                            >
                              <div className="pluto-skeleton-line h-2 w-[72%] rounded-full opacity-35" />
                              <div className="pluto-skeleton-line h-2 w-[46%] rounded-full opacity-20" />
                            </div>
                          )}
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
                      (msg.trustStatus ||
                        msg.outcome === 'no_evidence' ||
                        msg.outcome === 'partial') && (
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
                            ? 'No matching evidence'
                            : msg.outcome === 'partial'
                              ? `Partial answer${msg.unsupportedClaimCount ? ` · ${msg.unsupportedClaimCount} unsupported ${msg.unsupportedClaimCount === 1 ? 'claim omitted' : 'claims omitted'}` : ''}`
                              : msg.evidenceState === 'provisional'
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
                      msg.retrievalTrace &&
                      (msg.retrievalTrace.searchedMeetingCount > 0 ||
                        msg.retrievalTrace.sections.length > 0 ||
                        msg.retrievalTrace.transcriptPassages.length > 0 ||
                        msg.retrievalTrace.commitmentCount > 0) && (
                        <div className="px-1 text-[11px] text-pro-text-muted/75">
                          {[
                            msg.retrievalTrace.searchedMeetingCount > 0
                              ? `${msg.retrievalTrace.searchedMeetingCount} ${msg.retrievalTrace.searchedMeetingCount === 1 ? 'meeting' : 'meetings'} searched`
                              : '',
                            msg.retrievalTrace.sections.length > 0
                              ? `${msg.retrievalTrace.sections.length} ${msg.retrievalTrace.sections.length === 1 ? 'section' : 'sections'} matched`
                              : '',
                            msg.retrievalTrace.commitmentCount > 0
                              ? `${msg.retrievalTrace.commitmentCount} ${msg.retrievalTrace.commitmentCount === 1 ? 'commitment' : 'commitments'}`
                              : '',
                            msg.retrievalTrace.transcriptPassages.length > 0
                              ? `${msg.retrievalTrace.transcriptPassages.length} transcript ${msg.retrievalTrace.transcriptPassages.length === 1 ? 'passage' : 'passages'} used`
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
      </div>
    </div>
  );
};

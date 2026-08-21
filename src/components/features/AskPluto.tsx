import { ArrowRight } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Logo } from '../Brand/Logo';
import { CitationCard, type CitationChain } from './CitationCard';

interface AskPlutoProps {
  onOpenMeeting: (id: string) => void;
  visible: boolean;
  onClose: () => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationChain[];
  isLoading?: boolean;
}

export const AskPluto: React.FC<AskPlutoProps> = ({
  onOpenMeeting,
  visible,
  
}) => {
  if (!visible) return null;
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeCitationKey, setActiveCitationKey] = useState<string | null>(
    null,
  );
  const [dynamicQueries, setDynamicQueries] = useState<string[]>([]);
  const [isLoadingQueries, setIsLoadingQueries] = useState(false);

  const queryCacheRef = useRef<{ queries: string[]; fetchedAt: number } | null>(
    null,
  );
  const messageCounterRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const nextMessageId = () =>
    `msg-${Date.now()}-${messageCounterRef.current++}`;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

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
    setActiveCitationKey(null);
    setMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: 'assistant', content: '', isLoading: true },
    ]);

    try {
      if (window.ipcRenderer) {
        const response = await window.ipcRenderer.invoke<
          string | { answer?: string; citations?: CitationChain[] }
        >('intelligence:query', submitQuery.trim());

        setMessages((prev) => {
          const newMsg = [...prev];
          newMsg.pop();
          const content =
            typeof response === 'string' ? response : (response.answer ?? '');
          newMsg.push({
            id: nextMessageId(),
            role: 'assistant',
            content,
            citations:
              typeof response === 'string' ? undefined : response.citations,
          });
          return newMsg;
        });
      } else {
        setTimeout(() => {
          setMessages((prev) => {
            const newMsg = [...prev];
            newMsg.pop();
            newMsg.push({
              id: nextMessageId(),
              role: 'assistant',
              content:
                'Based on the recent standup, the **API migration** was delayed by 2 days. The engineering team decided to use GraphQL over REST for the new endpoints.',
              citations: [
                {
                  claim: 'API Migration delayed',
                  meeting_id: '1',
                  meeting_title: 'Monday Tech Sync',
                  evidence_valid: true,
                  trust_status: 'grounded',
                  evidence_span:
                    'We need to push the api migration by 2 days due to integration testing issues.',
                },
                {
                  claim: 'GraphQL chosen for new endpoints',
                  meeting_id: '2',
                  meeting_title: 'Architecture Review',
                  evidence_valid: false,
                  trust_status: 'needs_review',
                  evidence_span:
                    "I'm thinking we should probably use GraphQL for that new service.",
                },
              ],
            });
            return newMsg;
          });
          setIsProcessing(false);
        }, 2000);
      }
    } catch (e: unknown) {
      console.error('Ask Pluto error:', e);
      let errorMsg = "I'm sorry, there was an error processing your request.";
      if (e instanceof Error && e.message) {
        let msg = e.message.replace(/^Error:\s*/, '');
        if (
          msg.includes('SqliteError') ||
          msg.includes('invoking remote method')
        ) {
          msg =
            'An internal system error occurred while searching your knowledge base.';
        }
        errorMsg += `\n\nDetails: ${msg}`;
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
        });
        return newMsg;
      });
    } finally {
      setIsProcessing(false);
    }
  };

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
                      <div className="flex items-center gap-2 h-[22px] px-1">
                        <div className="flex gap-1.5 opacity-60">
                          <div className="w-1.5 h-1.5 rounded-full bg-pro-text-muted animate-bounce" />
                          <div className="w-1.5 h-1.5 rounded-full bg-pro-text-muted animate-bounce [animation-delay:-.2s]" />
                          <div className="w-1.5 h-1.5 rounded-full bg-pro-text-muted animate-bounce [animation-delay:-.4s]" />
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
              className="w-full bg-transparent min-h-[56px] py-4 pl-6 pr-14 text-[15px] text-pro-text-main outline-none placeholder:text-pro-text-muted/60 rounded-full"
              placeholder="Ask Pluto…"
              disabled={isProcessing}
            />
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

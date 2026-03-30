import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '../Brand/Logo';
import { CitationCard, type CitationChain } from './CitationCard';

interface AskPlutoProps {
  onOpenMeeting: (id: string) => void;
  suggestedQueries?: string[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationChain[];
  isLoading?: boolean;
}

export const AskPluto: React.FC<AskPlutoProps> = ({
  onOpenMeeting,
  suggestedQueries = [
    'What decisions were made about API Migration?',
    'Summarize key points from the Tech Sync.',
    'Did Sarah mention Neptune timeline?',
  ],
}) => {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(
    null,
  );

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent, presetQuery?: string) => {
    e?.preventDefault();
    const submitQuery = presetQuery || query;
    if (!submitQuery.trim() || isProcessing) return;

    setQuery('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: submitQuery.trim() },
    ]);
    setIsProcessing(true);
    setActiveCitationIndex(null);

    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', isLoading: true },
    ]);

    try {
      if ((window as any).ipcRenderer) {
        const response = await (window as any).ipcRenderer.invoke(
          'intelligence:query',
          submitQuery.trim(),
        );

        setMessages((prev) => {
          const newMsg = [...prev];
          newMsg.pop();
          newMsg.push({
            role: 'assistant',
            content: response.answer || response,
            citations: response.citations,
          });
          return newMsg;
        });
      } else {
        setTimeout(() => {
          setMessages((prev) => {
            const newMsg = [...prev];
            newMsg.pop();
            newMsg.push({
              role: 'assistant',
              content:
                'Based on the recent standup, the **API migration** was delayed by 2 days. The engineering team decided to use GraphQL over REST for the new endpoints.',
              citations: [
                {
                  claim: 'API Migration delayed',
                  meeting_id: '1',
                  meeting_title: 'Monday Tech Sync',
                  evidence_valid: true,
                  evidence_span:
                    'We need to push the api migration by 2 days due to integration testing issues.',
                },
                {
                  claim: 'GraphQL chosen for new endpoints',
                  meeting_id: '2',
                  meeting_title: 'Architecture Review',
                  evidence_valid: false,
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
    } catch (e) {
      console.error('Ask Pluto error:', e);
      setMessages((prev) => {
        const newMsg = [...prev];
        newMsg.pop();
        newMsg.push({
          role: 'assistant',
          content:
            "I'm sorry, there was an error retrieving intelligence. Ensure Phase 2 is complete.",
        });
        return newMsg;
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const activeCitations = messages[messages.length - 1]?.citations || [];

  return (
    <div className="flex h-[calc(100vh-140px)] w-full bg-pro-bg relative overflow-hidden gap-6 animate-in fade-in duration-500 rounded-2xl shadow-premium border border-pro-border/30">
      <div className="flex-[3] relative flex flex-col pt-8 pl-8 overflow-hidden h-full">
        <div className="mb-6 flex items-center gap-3 shrink-0">
          <Logo size={28} variant="gold" />
          <h2 className="text-xl font-black text-pro-text-main heading-premium tracking-tight">
            Ask Pluto
          </h2>
          <span className="text-[10px] bg-pro-accent/10 border border-pro-accent/20 text-pro-accent font-black uppercase px-2 py-0.5 rounded-full tracking-widest ml-2">
            Beta
          </span>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-4 space-y-8 pb-8 flex flex-col pt-2">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-8 pb-10">
              <div className="w-24 h-24 rounded-[2.5rem] bg-pro-accent/5 border border-pro-accent/20 flex items-center justify-center shadow-[0_0_100px_rgba(198,170,121,0.05)] relative group">
                <span className="text-4xl relative z-10 group-hover:scale-110 transition-transform">
                  🧠
                </span>
              </div>
              <h3 className="text-2xl font-black text-pro-text-main tracking-tight">
                How can I assist your intelligence?
              </h3>
              <div className="flex flex-wrap items-center justify-center gap-3 w-full max-w-xl mx-auto px-4">
                {suggestedQueries.map((sq) => (
                  <button
                    key={sq}
                    onClick={() => handleSubmit(undefined, sq)}
                    className="px-5 py-3 rounded-2xl bg-pro-surface/40 hover:bg-pro-surface hover:scale-[1.02] border border-pro-border text-pro-text-muted hover:text-pro-text-main hover:border-pro-accent/40 text-[13px] font-semibold transition-all shadow-sm flex items-center gap-2 group/btn"
                  >
                    {sq}
                    <span className="text-[10px] opacity-0 group-hover/btn:opacity-100 transition-opacity translate-x-[-10px] group-hover/btn:translate-x-0 tracking-widest uppercase font-black text-pro-accent">
                      →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-10 h-10 rounded-2xl bg-[#163758]/50 border border-pro-accent/20 flex items-center justify-center shrink-0 shadow-sm mt-1">
                    <Logo size={18} variant="gold" />
                  </div>
                )}
                <div
                  className={`p-5 rounded-3xl max-w-[85%] text-[14px] leading-relaxed relative ${
                    msg.role === 'user'
                      ? 'bg-pro-text-main text-[#161A23] font-semibold shadow-md rounded-tr-lg border border-transparent'
                      : 'bg-pro-surface/60 border border-pro-border/70 text-pro-text-main shadow-sm rounded-tl-lg'
                  }`}
                >
                  {msg.isLoading ? (
                    <div className="flex items-center gap-2 py-1 px-1">
                      <div className="flex gap-1.5 opacity-70">
                        <div className="w-1.5 h-1.5 rounded-full bg-pro-accent animate-bounce" />
                        <div className="w-1.5 h-1.5 rounded-full bg-pro-accent animate-bounce [animation-delay:-.2s]" />
                        <div className="w-1.5 h-1.5 rounded-full bg-pro-accent animate-bounce [animation-delay:-.4s]" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-pro-accent/80 pl-2">
                        Retrieving Intel
                      </span>
                    </div>
                  ) : (
                    <div className="prose prose-invert prose-sm">
                      {msg.content}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} className="h-4 shrink-0" />
        </div>

        <div className="pb-8 pr-8 relative shrink-0">
          <form onSubmit={handleSubmit} className="relative mt-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-pro-surface/80 border border-pro-border focus:border-pro-accent/50 rounded-2xl p-4 pl-5 pr-16 text-sm font-medium text-pro-text-main focus:bg-pro-surface hover:border-pro-border/80 outline-none transition-all shadow-premium"
              placeholder="Search recent meetings or ask a question..."
              disabled={isProcessing}
            />
            <button
              type="submit"
              disabled={!query.trim() || isProcessing}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-pro-accent/10 border border-pro-accent/20 text-pro-accent flex items-center justify-center disabled:opacity-30 disabled:hover:scale-100 hover:bg-pro-accent hover:text-[#163758] hover:scale-105 transition-all shadow-sm"
            >
              <svg
                aria-hidden="true"
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </form>
        </div>
      </div>

      <div className="w-80 border-l border-pro-border/30 bg-pro-surface/30 flex flex-col p-6 h-full border-t border-t-transparent shadow-inner relative z-10 shrink-0">
        <div className="mb-4 flex items-center justify-between pb-4 border-b border-pro-border/20">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-pro-text-muted/50">
            Source Evidence
          </h3>
          {activeCitations.length > 0 && (
            <div className="bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 text-[9px] font-black px-2 py-0.5 rounded-full shadow-sm">
              {activeCitations.length} Found
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2 pb-6">
          {activeCitations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center space-y-3 opacity-30 mt-20">
              <span className="text-3xl filter grayscale opacity-50">🗂️</span>
              <p className="text-[9px] uppercase tracking-[0.25em] font-black">
                No Evidence Linked
              </p>
            </div>
          ) : (
            activeCitations.map((cit, idx) => (
              <CitationCard
                key={idx}
                citation={cit}
                isActive={activeCitationIndex === idx}
                onClick={() => setActiveCitationIndex(idx)}
                onNavigateToMeeting={() => onOpenMeeting(cit.meeting_id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

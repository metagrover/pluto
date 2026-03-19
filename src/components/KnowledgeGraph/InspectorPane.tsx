import { Clock, ExternalLink, Lightbulb, MessageSquare, X } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import type { KnowledgeGraphNode } from '../../api/knowledgeWorkspace';

interface InspectorPaneProps {
  nodes: KnowledgeGraphNode[];
  selectedEntityId: string | null;
  onClose: () => void;
  onOpenMeeting?: (meetingId: string | number) => void;
}

export const InspectorPane: React.FC<InspectorPaneProps> = ({
  nodes,
  selectedEntityId,
  onClose,
}) => {
  const [chatQuery, setChatQuery] = useState('');
  const [chatHistory, setChatHistory] = useState<
    { role: 'user' | 'ai'; text: string }[]
  >([]);
  const [isTyping, setIsTyping] = useState(false);

  const entity = nodes.find((n) => n.id === selectedEntityId);

  if (!selectedEntityId || !entity) {
    return (
      <div className="w-96 flex-shrink-0 flex flex-col bg-pro-surface/40 backdrop-blur-3xl border-l border-pro-border/30 overflow-hidden relative z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.03)] selection:bg-pro-accent/20">
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
          <div className="w-20 h-20 rounded-[1.5rem] bg-gradient-to-br from-pro-bg to-pro-surface shadow-premium border border-pro-border/50 flex items-center justify-center text-4xl mb-6 hover:rotate-12 transition-transform duration-500 text-pro-text-muted/40">
            🪄
          </div>
          <h3 className="text-xl font-black text-pro-text-main tracking-tight">
            Inspector
          </h3>
          <p className="text-sm font-medium text-pro-text-muted mt-3 leading-relaxed max-w-xs">
            Select an entity from the Navigator or click a card on the Canvas to
            inspect its deeper intelligence and dependencies.
          </p>
        </div>
      </div>
    );
  }

  const handleAskPluto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuery.trim()) return;

    const query = chatQuery;
    setChatQuery('');
    setChatHistory((prev) => [...prev, { role: 'user', text: query }]);
    setIsTyping(true);

    // Mock AI response delay
    setTimeout(() => {
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'ai',
          text: `Looking at ${entity.label}'s context across ${entity.mention_count} recent meetings, the most pressing blocker appears to be budget sign-off from Dave.`,
        },
      ]);
      setIsTyping(false);
    }, 1200);
  };

  return (
    <div className="w-96 flex-shrink-0 flex flex-col bg-pro-surface/40 backdrop-blur-3xl border-l border-pro-border/30 overflow-hidden relative z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.03)] selection:bg-pro-accent/20">
      {/* Header */}
      <div className="p-5 border-b border-pro-border/30 flex items-start justify-between bg-pro-surface/60 backdrop-blur-xl z-20 shadow-sm relative">
        <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-pro-accent/30 to-transparent" />
        <div>
          <span className="text-[10px] font-black uppercase text-white bg-pro-accent shadow-md shadow-pro-accent/30 px-2.5 py-1 rounded-[6px] tracking-widest inline-flex.">
            {entity.type.replace('_', ' ')}
          </span>
          <h2 className="text-2xl font-black text-pro-text-main mt-3 leading-tight tracking-tight">
            {entity.label}
          </h2>
          <p className="text-[13px] text-pro-text-muted mt-2 font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Active across {entity.mention_count} discussions
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md bg-transparent hover:bg-pro-border/40 text-pro-text-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto w-full custom-scrollbar p-5 space-y-6 bg-gradient-to-b from-pro-bg/10 to-transparent">
        {/* Synthetic Summary */}
        <section className="space-y-4">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-pro-text-main/70 flex items-center gap-2.5">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            Synthetic Summary
          </h3>
          <div className="text-[13.5px] text-pro-text-main/80 space-y-3 leading-relaxed p-5 bg-gradient-to-br from-pro-bg to-pro-surface rounded-2xl border border-pro-border/50 shadow-inner-soft hover:shadow-sm transition-shadow">
            <p>
              <strong>{entity.label}</strong> is currently highly active. The
              primary stakeholders mapped are Sarah and Dave. The most recent
              strategic decision extracted was to optimize the Q3 timeline to
              account for backend constraints.
            </p>
          </div>
        </section>

        {/* Temporal / Timeline */}
        <section className="space-y-4 pt-2">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-pro-text-main/70 flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-blue-500" />
            Temporal Traversal
          </h3>
          <div className="space-y-3 relative before:absolute before:inset-y-3 before:left-[11px] before:w-0.5 before:bg-gradient-to-b before:from-pro-border/60 before:to-transparent">
            {[1, 2].map((i) => (
              <div key={i} className="pl-8 relative cursor-pointer group">
                <div className="absolute left-1.5 top-1.5 w-[10px] h-[10px] rounded-full border-2 border-pro-surface bg-pro-text-muted/40 group-hover:bg-pro-accent group-hover:scale-125 transition-all shadow-sm" />
                <div className="p-4 rounded-xl border border-pro-border/40 bg-white/40 hover:bg-white/80 group-hover:shadow-premium transition-all">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[13px] font-bold text-pro-text-main">
                      Weekly Sync {i}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 text-pro-text-muted/50 opacity-0 group-hover:opacity-100 transition-opacity group-hover:text-pro-accent" />
                  </div>
                  <p className="text-xs text-pro-text-muted/80 italic border-l-[3px] border-pro-border/60 pl-3 my-2.5 leading-relaxed bg-pro-bg/30 p-2 rounded-r-md">
                    "So for {entity.label}, I think we need to push forward the
                    dependency..."
                  </p>
                  <div className="text-[10px] font-black uppercase tracking-[0.15em] text-pro-text-muted/60">
                    Oct {15 + i}, 2025
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Ask Pluto Contextual AI Chat */}
      <div className="border-t border-pro-border/30 bg-pro-bg/30 p-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-pro-accent flex items-center gap-2 mb-3">
          <MessageSquare className="w-3 h-3" />
          Ask Pluto Intelligence
        </h3>

        <div className="space-y-3 mb-4 max-h-48 overflow-y-auto custom-scrollbar">
          {chatHistory.map((msg, i) => (
            <div
              key={`${msg.role}-${i}`}
              className={`text-[13px] leading-relaxed p-3 rounded-xl max-w-[90%] ${msg.role === 'user' ? 'bg-pro-text-main dark:bg-pro-accent text-white dark:text-[#1A2340] ml-auto rounded-br-sm' : 'bg-pro-surface border border-pro-border/40 text-pro-text-main mr-auto rounded-bl-sm'}`}
            >
              {msg.text}
            </div>
          ))}
          {isTyping && (
            <div className="text-[13px] p-3 rounded-xl max-w-[90%] bg-pro-surface border border-pro-border/40 text-pro-text-muted mr-auto rounded-bl-sm flex gap-1 items-center">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
              <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-.15s]" />
              <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-.3s]" />
            </div>
          )}
        </div>

        <form onSubmit={handleAskPluto} className="relative">
          <input
            type="text"
            value={chatQuery}
            onChange={(e) => setChatQuery(e.target.value)}
            placeholder={`Ask about ${entity.label}...`}
            className="w-full h-11 pl-4 pr-10 rounded-xl bg-pro-surface border border-pro-border/60 text-sm font-medium text-pro-text-main placeholder-pro-text-muted/50 shadow-sm focus:outline-none focus:border-pro-accent/50 focus:ring-2 focus:ring-pro-accent/20 transition-all"
          />
          <button
            type="submit"
            disabled={!chatQuery.trim() || isTyping}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg bg-pro-text-main dark:bg-pro-accent text-white dark:text-[#1A2340] disabled:opacity-50 hover:bg-pro-accent transition-colors"
          >
            <span className="text-xs">↑</span>
          </button>
        </form>
      </div>
    </div>
  );
};

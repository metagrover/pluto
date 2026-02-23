import type React from 'react';
import { useEffect, useState } from 'react';
import { type Entity, getEntitiesByType } from '../../api/knowledgeGraph';

export const KnowledgeTab: React.FC = () => {
  const [topics, setTopics] = useState<Entity[]>([]);
  const [decisions, setDecisions] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [topicsData, decisionsData] = await Promise.all([
          getEntitiesByType('topic'),
          getEntitiesByType('decision'),
        ]);
        setTopics(topicsData);
        setDecisions(decisionsData);
      } catch (error) {
        console.error('Failed to fetch knowledge items:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-12">
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 bg-pro-bg rounded-[2rem]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-20 max-w-5xl mx-auto">
      {/* Decisions Section */}
      <section className="space-y-8">
        <div className="flex items-center justify-between px-4">
          <div>
            <h3 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] mb-1">
              Institutional Memory
            </h3>
            <h2 className="text-2xl font-black text-pro-text-main tracking-tight">
              Key Decisions
            </h2>
          </div>
          <div className="px-3 py-1 rounded-full bg-pro-accent/10 text-pro-accent text-[9px] font-bold uppercase tracking-widest border border-pro-accent/20">
            {decisions.length} Decisions
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {decisions.length === 0 ? (
            <div className="col-span-full p-12 bg-pro-bg/20 border border-dashed border-pro-border rounded-3xl text-center">
              <p className="text-sm font-medium text-pro-text-muted/50 uppercase tracking-widest">
                No decisions recorded yet
              </p>
            </div>
          ) : (
            decisions.map((decision) => {
              const metadata = JSON.parse(decision.metadata || '{}');
              return (
                <div
                  key={decision.id}
                  className="p-7 bg-white border border-pro-border rounded-[2rem] shadow-sm hover:shadow-premium transition-all group flex flex-col justify-between h-full"
                >
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">⚖️</span>
                      <span className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                        Decision Log
                      </span>
                    </div>
                    <h4 className="text-[16px] font-black leading-snug text-pro-text-main group-hover:text-pro-accent transition-colors">
                      {metadata.full_description || decision.name}
                    </h4>
                    {metadata.rationale && (
                      <div className="p-4 bg-pro-bg rounded-2xl text-[13px] font-medium text-pro-text-muted leading-relaxed italic border border-pro-border/20">
                        "{metadata.rationale}"
                      </div>
                    )}
                  </div>
                  <div className="mt-6 pt-6 border-t border-pro-border/40 flex items-center justify-between">
                    <span className="text-[9px] font-black text-pro-text-muted/30 uppercase tracking-widest">
                      {new Date(decision.created_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    <button type="button" className="text-xs font-bold text-pro-accent hover:underline">
                      View Source
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Topics / Wiki Section */}
      <section className="space-y-8">
        <div className="flex items-center justify-between px-4">
          <div>
            <h3 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] mb-1">
              Knowledge Base
            </h3>
            <h2 className="text-2xl font-black text-pro-text-main tracking-tight">
              Recurring Topics
            </h2>
          </div>
          <div className="px-3 py-1 rounded-full bg-pro-bg text-pro-text-muted text-[9px] font-bold uppercase tracking-widest border border-pro-border">
            {topics.length} Concepts
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          {topics.length === 0 ? (
            <div className="w-full p-12 bg-pro-bg/20 border border-dashed border-pro-border rounded-3xl text-center">
              <p className="text-sm font-medium text-pro-text-muted/50 uppercase tracking-widest">
                No recurring topics identified
              </p>
            </div>
          ) : (
            topics.map((topic) => {
              const metadata = JSON.parse(topic.metadata || '{}');
              const importance = metadata.importance || 'medium';
              const colorClass =
                importance === 'high'
                  ? 'bg-red-500/10 text-red-600 border-red-200'
                  : importance === 'medium'
                    ? 'bg-blue-500/10 text-blue-600 border-blue-200'
                    : 'bg-slate-500/10 text-slate-600 border-slate-200';

              return (
                <div
                  key={topic.id}
                  className={
                    'px-6 py-4 rounded-[1.5rem] bg-white border border-pro-border shadow-sm hover:shadow-md transition-all cursor-pointer group flex flex-col gap-2'
                  }
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">💡</span>
                    <h4 className="text-sm font-black text-pro-text-main tracking-tight">
                      {topic.name}
                    </h4>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${colorClass}`}
                    >
                      {importance}
                    </span>
                    <span className="text-[9px] font-black text-pro-text-muted/30 uppercase tracking-widest">
                      8 Mentions
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};

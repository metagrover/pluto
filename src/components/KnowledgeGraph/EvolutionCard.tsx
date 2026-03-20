import type React from 'react';
import { useEffect, useState } from 'react';
import {
  type EntityMeeting,
  getEntityMeetings,
} from '../../api/knowledgeGraph';
import type { KnowledgeGraphNode } from '../../api/knowledgeWorkspace';

interface EvolutionCardProps {
  entity: KnowledgeGraphNode;
}

export const EvolutionCard: React.FC<EvolutionCardProps> = ({ entity }) => {
  const [meetings, setMeetings] = useState<EntityMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const fetchEvolution = async () => {
      setLoading(true);
      try {
        const data = await getEntityMeetings(entity.id);
        // Sort chronologically (most recent first)
        const sorted = [...data].sort((a, b) => {
          const dateA = a.started_at ? new Date(a.started_at).getTime() : 0;
          const dateB = b.started_at ? new Date(b.started_at).getTime() : 0;
          return dateB - dateA;
        });
        setMeetings(sorted);
      } catch (e) {
        console.error('Failed to fetch entity evolution:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchEvolution();
  }, [entity.id]);

  if (loading) {
    return (
      <div className="bg-pro-surface border border-pro-border rounded-xl p-5 animate-pulse">
        <div className="h-4 w-32 bg-pro-bg rounded mb-4" />
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 bg-pro-bg rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const meetingsWithContext = meetings.filter((m) => m.context);
  if (meetingsWithContext.length === 0) return null;

  const displayMeetings = expanded
    ? meetingsWithContext
    : meetingsWithContext.slice(0, 3);

  return (
    <div className="bg-pro-surface border border-pro-border rounded-xl p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm">📈</span>
        <h4 className="text-[10px] font-black text-pro-text-muted/50 uppercase tracking-[0.15em]">
          Evolution
        </h4>
        <span className="text-[10px] text-pro-text-muted/40 ml-auto">
          {meetingsWithContext.length} mention
          {meetingsWithContext.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Timeline */}
      <div className="flex flex-col gap-1 border-l-2 border-pro-border/40 ml-2 pl-4">
        {displayMeetings.map((meeting) => (
          <div key={meeting.id} className="relative py-2">
            <div className="absolute -left-[21px] top-3 w-2 h-2 rounded-full bg-pro-accent/60" />
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-widest">
                {meeting.started_at
                  ? new Date(meeting.started_at).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'Unknown'}
              </span>
              <span className="text-[10px] text-pro-text-muted/30">·</span>
              <span className="text-[10px] font-bold text-pro-text-muted/60 truncate">
                {meeting.title || 'Untitled Meeting'}
              </span>
            </div>
            <p className="text-[12px] text-pro-text-main/80 leading-relaxed line-clamp-2">
              {meeting.context}
            </p>
          </div>
        ))}
      </div>

      {/* Show more */}
      {meetingsWithContext.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-[10px] font-black uppercase tracking-widest text-pro-accent hover:text-pro-accent/80 transition-colors"
        >
          {expanded
            ? '↑ Show less'
            : `+ ${meetingsWithContext.length - 3} more`}
        </button>
      )}
    </div>
  );
};

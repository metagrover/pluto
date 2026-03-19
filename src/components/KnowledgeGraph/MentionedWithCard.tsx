import type React from 'react';
import { useEffect, useState } from 'react';
import {
  ENTITY_ICONS,
  type EntityType,
  getRelatedEntities,
} from '../../api/knowledgeGraph';
import type { KnowledgeGraphNode } from '../../api/knowledgeWorkspace';
import { useKnowledgeStore } from '../../store/knowledgeStore';

interface MentionedWithCardProps {
  entity: KnowledgeGraphNode;
}

interface CoMention {
  id: string;
  name: string;
  type: EntityType;
  count: number;
}

export const MentionedWithCard: React.FC<MentionedWithCardProps> = ({
  entity,
}) => {
  const [coMentions, setCoMentions] = useState<CoMention[]>([]);
  const [loading, setLoading] = useState(true);
  const { setSelectedEntity } = useKnowledgeStore();

  useEffect(() => {
    const fetchCoMentions = async () => {
      setLoading(true);
      try {
        const related = await getRelatedEntities(entity.id);
        const mentions: CoMention[] = related
          .filter((r) => r.state === 'confirmed' || r.state === 'suggested')
          .map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            count: r.confidence > 0.8 ? 3 : r.confidence > 0.5 ? 2 : 1,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12);
        setCoMentions(mentions);
      } catch (e) {
        console.error('Failed to fetch co-mentions:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchCoMentions();
  }, [entity.id]);

  if (loading) {
    return (
      <div className="bg-pro-surface border border-pro-border rounded-xl p-5 animate-pulse">
        <div className="h-4 w-32 bg-pro-bg rounded mb-4" />
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-24 bg-pro-bg rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  if (coMentions.length === 0) return null;

  return (
    <div className="bg-pro-surface border border-pro-border rounded-xl p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm">🔗</span>
        <h4 className="text-[10px] font-black text-pro-text-muted/50 uppercase tracking-[0.15em]">
          Mentioned With
        </h4>
      </div>
      <div className="flex flex-wrap gap-2">
        {coMentions.map((cm) => {
          const isHighSaliency = cm.count >= 3;
          const isLowSaliency = cm.count === 1;
          return (
            <button
              key={cm.id}
              type="button"
              onClick={() =>
                setSelectedEntity(cm.id, {
                  id: cm.id,
                  label: cm.name,
                  type: cm.type,
                  status: 'active',
                  mention_count: cm.count,
                  metadata: null,
                  saliency_score: 0.8,
                  domain_tag: 'work',
                })
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pro-bg border transition-all group ${
                isHighSaliency
                  ? 'text-[13px] border-pro-accent/30 font-black shadow-sm'
                  : isLowSaliency
                    ? 'text-[11px] border-pro-border/40 font-medium'
                    : 'text-[12px] border-pro-border/60 font-bold'
              } hover:border-pro-accent/40 hover:shadow-md`}
            >
              <span className="opacity-60 group-hover:opacity-100 transition-opacity">
                {ENTITY_ICONS[cm.type] || '📍'}
              </span>
              <span className="truncate max-w-[140px] tracking-tight">
                {cm.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

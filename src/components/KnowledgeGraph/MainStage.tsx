import type React from 'react';
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeProjectHealthCard,
  KnowledgeTimelineItem,
} from '../../api/knowledgeWorkspace';
import { useKnowledgeStore } from '../../store/knowledgeStore';

interface MainStageProps {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  timeline: KnowledgeTimelineItem[];
  projectCards: KnowledgeProjectHealthCard[];
  onOpenProjectsTab?: () => void;
}

const isTrashEntity = (node: KnowledgeGraphNode): boolean => {
  const name = node.label.toLowerCase().trim();
  const trashTerms = [
    'none',
    'omit',
    'unknown',
    'none specified',
    'unnamed',
    'unknown project',
  ];

  // 1. Hard Exclusion List
  if (trashTerms.includes(name)) return true;
  if (name.includes('(unknown)')) return true;

  // 2. Minimum Confidence Rule (90%)
  if (node.saliency_score < 0.9) return true;

  // 3. Simple Noise Filter
  if (name.length <= 2) return true;
  if (
    [
      'me',
      'them',
      'you',
      'they',
      'we',
      'us',
      'our',
      'speaker',
      'participant',
    ].includes(name)
  )
    return true;

  return false;
};

export const MainStage: React.FC<MainStageProps> = ({
  nodes,
  edges,
  timeline,
  projectCards,
  onOpenProjectsTab,
}) => {
  const { setSelectedEntity, domainFilter, setDomainFilter } =
    useKnowledgeStore();

  // Filter out trash and low-confidence nodes
  const visibleNodes = nodes.filter(
    (node) => node.domain_tag === domainFilter && !isTrashEntity(node),
  );

  const projectNodes = visibleNodes.filter((n) => n.type === 'project');
  const decisionNodes = visibleNodes.filter((n) => n.type === 'decision');
  const peopleNodes = visibleNodes.filter((n) => n.type === 'person');

  // Tier 1 Gate: Mentions > 2 and High Saliency (Proxy for Confidence)
  const tier1Nodes = [...projectNodes, ...decisionNodes]
    .filter((n) => n.mention_count > 2)
    .sort((a, b) => b.mention_count - a.mention_count)
    .slice(0, 8);

  const tier2Nodes = peopleNodes
    .sort((a, b) => b.mention_count - a.mention_count)
    .slice(0, 16);

  const riskEdges = edges
    .filter((e) =>
      ['blocked_by', 'depends_on', 'impacts'].includes(e.relationship),
    )
    .filter((e) => e.confidence >= 0.9)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6);

  // Filter Project Cards: Hide if 0 blockers AND 0 dependencies
  const activeProjectCards = projectCards
    .filter((c) => c.open_blockers > 0 || c.dependency_count > 0)
    .slice(0, 4);

  return (
    <div className="w-full h-full flex justify-center bg-pro-bg overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-[1000px] flex flex-col gap-8 p-8 pb-32">
        {/* ── Dashboard Header ── */}
        <div className="flex items-center justify-between py-1 no-drag">
          <div className="flex items-center gap-2 text-[11px] font-medium text-pro-text-muted">
            <span className="cursor-default">Knowledge</span>
            <span className="opacity-30 flex items-center mb-[1px]">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <title>Breadcrumb</title>
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
            <span className="text-pro-text-main font-semibold cursor-default">
              Dashboard
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() =>
                setDomainFilter(domainFilter === 'work' ? 'personal' : 'work')
              }
              className="px-3 py-1.5 rounded-full bg-white dark:bg-pro-surface border border-pro-accent/40 hover:border-pro-accent text-[10px] font-bold text-pro-text-main transition-all flex items-center gap-2 shadow-sm active-push"
            >
              <span className="text-pro-text-muted font-medium">Domain:</span>
              <span className="capitalize">{domainFilter}</span>
            </button>
            <div className="h-3 w-[1px] bg-pro-border" />
            <div className="flex items-center gap-2 text-[10px] font-medium text-pro-text-muted cursor-default">
              <span className="px-2 py-0.5 bg-white dark:bg-pro-surface border border-pro-border rounded-md text-pro-text-main shadow-sm font-bold">
                Cmd + K
              </span>
              <span className="opacity-60">to search</span>
            </div>
          </div>
        </div>

        <div className="h-[1px] w-full bg-pro-border/40 -mt-6 mb-1" />

        {/* Knowledge Dashboard Card */}
        <section className="relative">
          <div className="bg-white dark:bg-pro-surface border border-pro-border rounded-[1.5rem] p-8 shadow-premium flex flex-col gap-6">
            <div className="flex items-start justify-between gap-8">
              <div className="space-y-3 max-w-2xl">
                <h2 className="text-2xl font-black text-pro-text-main tracking-tight">
                  Knowledge Dashboard
                </h2>
                <p className="text-[13px] text-pro-text-muted font-medium leading-relaxed max-w-lg">
                  Use this page for cross-meeting synthesis and trends. Use
                  Projects when you want task lists, owners, and execution.
                </p>
              </div>
              {onOpenProjectsTab && (
                <button
                  type="button"
                  onClick={onOpenProjectsTab}
                  className="px-6 py-2.5 rounded-xl bg-pro-accent text-white text-[10px] font-black uppercase tracking-[0.1em] hover:bg-pro-accent/90 transition-all active:scale-[0.98] shadow-lg shadow-pro-accent/10 whitespace-nowrap mt-1"
                >
                  Go to Projects
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {['DECISIONS', 'STRATEGIC THEMES', 'STAKEHOLDERS', 'RISKS'].map(
                (pill) => (
                  <div
                    key={pill}
                    className="px-4 py-1.5 rounded-full bg-pro-bg dark:bg-pro-bg/10 border border-pro-border text-[9px] font-black tracking-widest text-pro-text-muted/60 hover:text-pro-accent hover:border-pro-accent/30 transition-all cursor-default"
                  >
                    {pill}
                  </div>
                ),
              )}
            </div>
          </div>
        </section>

        {/* Strategic Entities */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-pro-text-primary">
            Strategic Anchors
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tier1Nodes.map((node) => {
              const isHighSignal = node.mention_count >= 3;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedEntity(node.id, node)}
                  className={`bg-pro-surface hover:bg-pro-surface-hover border border-pro-border rounded-xl p-4 cursor-pointer transition-all text-left group ${
                    isHighSignal
                      ? 'ring-1 ring-pro-accent/20 border-pro-accent/30'
                      : ''
                  }`}
                >
                  <div className="font-medium text-pro-text-primary flex items-center justify-between">
                    <span>{node.label}</span>
                    <div className="flex items-center gap-2">
                      {node.status === 'merge_pending' && (
                        <span title="Merge Pending" className="text-xs">
                          🔄
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-pro-text-muted mt-2 capitalize flex items-center gap-2">
                    <span>{node.type}</span>
                    <span>·</span>
                    <span>{node.mention_count} mentions</span>
                  </div>
                </button>
              );
            })}
            {tier1Nodes.length === 0 && (
              <div className="text-sm text-pro-text-muted italic text-center py-8">
                Awaiting high-confidence context.
              </div>
            )}
          </div>
        </section>

        {/* People & Stakeholders */}
        <section className="flex flex-col gap-4 mt-4">
          <h2 className="text-lg font-bold text-pro-text-primary">
            Stakeholders
          </h2>
          <div className="flex flex-wrap gap-3">
            {tier2Nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelectedEntity(node.id, node)}
                className="relative group bg-pro-surface hover:bg-pro-surface-hover border border-pro-border rounded-full px-4 py-2 cursor-pointer transition-colors flex items-center gap-2 text-left"
              >
                <div className="w-6 h-6 rounded-full bg-pro-bg overflow-hidden flex items-center justify-center">
                  👤
                </div>
                <span className="text-sm font-medium flex-1">{node.label}</span>
                <span className="text-[10px] text-pro-text-muted">
                  {node.mention_count}
                </span>
              </button>
            ))}
            {tier2Nodes.length === 0 && (
              <div className="text-sm text-pro-text-muted italic w-full text-center py-4">
                No actors detected.
              </div>
            )}
          </div>
        </section>

        {/* Decisions & Directions */}
        <section className="flex flex-col gap-4 mt-6">
          <h2 className="text-lg font-bold text-pro-text-primary">
            Latest Decisions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {decisionNodes.slice(0, 6).map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelectedEntity(node.id, node)}
                className="bg-pro-surface hover:bg-pro-surface-hover border border-pro-border rounded-xl p-4 cursor-pointer transition-colors text-left"
              >
                <div className="font-medium text-pro-text-primary">
                  {node.label || 'Decision'}
                </div>
                <div className="text-xs text-pro-text-muted mt-2">
                  {node.mention_count} mentions
                </div>
              </button>
            ))}
            {decisionNodes.length === 0 && (
              <div className="text-sm text-pro-text-muted italic w-full text-center py-8 col-span-2">
                No high-confidence decisions archived.
              </div>
            )}
          </div>
        </section>

        {/* Risks & Blockers */}
        <section className="flex flex-col gap-4 mt-6">
          <h2 className="text-lg font-bold text-pro-text-primary">
            Critical Risks
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {riskEdges.map((edge) => (
              <div
                key={edge.id}
                className="bg-pro-surface border border-pro-border rounded-xl p-4 transition-all hover:bg-pro-surface-hover group"
              >
                <div className="text-sm font-semibold text-pro-text-primary">
                  {edge.source_label} {edge.relationship.replace(/_/g, ' ')}{' '}
                  {edge.target_label}
                </div>
                <div className="text-xs text-pro-text-muted mt-2">
                  {(edge.confidence * 100).toFixed(0)}% extraction confidence
                </div>
              </div>
            ))}
            {riskEdges.length === 0 && (
              <div className="text-sm text-pro-text-muted italic w-full text-center py-8 col-span-2">
                No active blockers detected.
              </div>
            )}
          </div>
        </section>

        {/* Project Health */}
        <section className="flex flex-col gap-4 mt-6">
          <h2 className="text-lg font-bold text-pro-text-primary">
            Stream Health
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeProjectCards.map((card: KnowledgeProjectHealthCard) => (
              <div
                key={card.doc_id}
                className="bg-pro-surface border border-pro-border rounded-xl p-4 hover:bg-pro-surface-hover transition-all"
              >
                <div className="font-medium text-pro-text-primary text-sm uppercase italic tracking-tight">
                  {card.title}
                </div>
                <div className="text-xs text-pro-text-muted mt-3 flex flex-wrap gap-2">
                  <span>{card.open_blockers} blockers</span>
                  <span>·</span>
                  <span>{card.dependency_count} deps</span>
                  <span>·</span>
                  <span>{card.recent_changes} deltas</span>
                </div>
              </div>
            ))}
            {activeProjectCards.length === 0 && (
              <div className="text-sm text-pro-text-muted italic w-full text-center py-8 col-span-2">
                No project streams indexed.
              </div>
            )}
          </div>
        </section>

        {/* Topic Evolution */}
        <section className="flex flex-col gap-4 mt-6">
          <h2 className="text-lg font-bold text-pro-text-primary">
            Topic Evolution
          </h2>
          <div className="flex flex-col gap-3">
            {timeline.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className="bg-pro-surface border border-pro-border rounded-xl p-4 flex items-start justify-between gap-4 hover:bg-pro-surface-hover transition-all"
              >
                <div>
                  <div className="text-sm font-semibold text-pro-text-primary">
                    {item.title}
                  </div>
                  <div className="text-xs text-pro-text-muted mt-1 leading-relaxed">
                    {item.detail}
                  </div>
                </div>
                <div className="text-[10px] text-pro-text-muted shrink-0 mt-1 uppercase font-bold tracking-tighter">
                  {new Date(item.timestamp).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
              </div>
            ))}
            {timeline.length === 0 && (
              <div className="text-sm text-pro-text-muted italic w-full text-center py-8">
                No evolution data yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

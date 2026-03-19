import { AnimatePresence, motion } from 'framer-motion';
import { ChevronUp, X } from 'lucide-react';
import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  type EntityMeeting,
  getEntityMeetings,
} from '../../api/knowledgeGraph';
import {
  type EntitySummary,
  type EntitySummarySentence,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  getEntitySummary,
  resolveConflictLinks,
} from '../../api/knowledgeWorkspace';
import { useKnowledgeStore } from '../../store/knowledgeStore';
import { EvolutionCard } from './EvolutionCard';
import { MentionedWithCard } from './MentionedWithCard';

interface FocusSheetProps {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  onOpenProjectsTab?: () => void;
}

// ---------- Grounding Quality Badge ----------

function GroundingBadge({
  meetingCount,
  hasContext,
  score,
}: {
  meetingCount: number;
  hasContext: boolean;
  score: number;
}) {
  if (score < 0.4 || meetingCount === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-500 text-[10px] font-black uppercase tracking-widest shadow-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />{' '}
        Inferred
      </span>
    );
  }
  if (score < 0.8 || !hasContext) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] font-black uppercase tracking-widest shadow-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Synthesized
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 text-[10px] font-black uppercase tracking-widest shadow-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Grounded
    </span>
  );
}

// ---------- Zero-Context Truth-Meter ----------

function TruthMeter({ meetingCount }: { meetingCount: number }) {
  return (
    <div className="flex flex-col gap-3 p-5 h-full items-center justify-center text-center">
      <div className="w-10 h-10 rounded-xl bg-pro-bg border border-pro-border flex items-center justify-center text-lg">
        🔭
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] font-black text-pro-text-muted/60 uppercase tracking-widest">
          High-Level Synthesis
        </p>
        <p className="text-xs text-pro-text-muted leading-relaxed max-w-[280px]">
          {meetingCount > 0
            ? `This summary is inferred from ${meetingCount} meeting${meetingCount !== 1 ? 's' : ''}. No single grounding snippet is available.`
            : 'No transcript evidence found. This entity was inferred from meeting context.'}
        </p>
      </div>
    </div>
  );
}

// ---------- Main Component ----------

export const FocusSheet: React.FC<FocusSheetProps> = ({
  nodes: _nodes,
  edges,
  onOpenProjectsTab,
}) => {
  const { selectedEntityId, selectedEntityNode, clearSelection } =
    useKnowledgeStore();

  const [isResolving, setIsResolving] = useState(false);
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);
  const [entityMeetings, setEntityMeetings] = useState<EntityMeeting[]>([]);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [summary, setSummary] = useState<EntitySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    if (!selectedEntityNode) return;
    setEvidenceDrawerOpen(false);
    setMeetingsLoading(true);
    getEntityMeetings(selectedEntityNode.id)
      .then((meetings) => {
        setEntityMeetings(meetings);
        if (meetings.length > 0) setActiveMeetingId(meetings[0].id);
        else setActiveMeetingId(null);
      })
      .catch(console.error)
      .finally(() => setMeetingsLoading(false));

    setSummaryLoading(true);
    getEntitySummary(selectedEntityNode.id)
      .then(setSummary)
      .catch(console.error)
      .finally(() => setSummaryLoading(false));
  }, [selectedEntityNode]);

  const conflicts = useMemo(() => {
    if (!selectedEntityNode) return [];
    const entityEdges = edges.filter(
      (e) =>
        e.source_entity_id === selectedEntityNode.id ||
        e.target_entity_id === selectedEntityNode.id,
    );
    const groups: Record<string, KnowledgeGraphEdge[]> = {};
    for (const e of entityEdges) {
      if (!groups[e.relationship]) groups[e.relationship] = [];
      groups[e.relationship].push(e);
    }
    return Object.values(groups).filter(
      (g) => g.length > 1 && g.some((e) => e.state === 'suggested'),
    );
  }, [selectedEntityNode, edges]);

  const activeConflict = conflicts[0];

  const handleResolve = async (winnerId: string, loserId: string) => {
    await resolveConflictLinks(winnerId, loserId);
    setIsResolving(false);

    if (selectedEntityNode) {
      setSummaryLoading(true);
      getEntitySummary(selectedEntityNode.id)
        .then(setSummary)
        .catch(console.error)
        .finally(() => setSummaryLoading(false));
    }
  };

  const snippetCount = entityMeetings.filter((m) => Boolean(m.context)).length;
  const hasAnyContext = snippetCount > 0;

  const nodeMetadata = useMemo(() => {
    if (!selectedEntityNode?.metadata) return null;
    try {
      return JSON.parse(selectedEntityNode.metadata);
    } catch {
      return null;
    }
  }, [selectedEntityNode]);

  let groundingScore = 0;
  if (selectedEntityNode) {
    groundingScore =
      nodeMetadata?.grounding_score ??
      (hasAnyContext ? 0.9 : entityMeetings.length > 1 ? 0.5 : 0.2);
  }

  // --- MOCK DATA HIJACK (V1.8 PR) ---
  const isPlutoMock = selectedEntityNode?.label.toLowerCase() === 'pluto';
  const displaySummary = isPlutoMock
    ? {
        sentences: [
          {
            text: 'The team is shifting to `Vector DB` for the `Persona API` to handle high-latency spikes identified in the March 12th standup [ID: 001]. [[Sarah Chen]] raised a concern regarding data privacy limits that remains a **primary blocker** [ID: 002].',
            source_meeting_ids: ['m-001', 'm-002'],
          },
        ],
      }
    : summary;

  const activeMeeting = entityMeetings.find((m) => m.id === activeMeetingId);

  const handleSentenceClick = (meetingId?: string) => {
    if (meetingId) setActiveMeetingId(meetingId);
    else if (entityMeetings.length > 0) {
      const firstWithContext = entityMeetings.find((m) => m.context);
      if (firstWithContext) setActiveMeetingId(firstWithContext.id);
    }
    setEvidenceDrawerOpen(true);
  };

  return (
    <AnimatePresence>
      {selectedEntityId && selectedEntityNode && (
        <React.Fragment>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={clearSelection}
            className="fixed inset-0 bg-pro-bg/50 backdrop-blur-sm z-40 transition-opacity"
          />

          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 bottom-0 w-[400px] md:w-[500px] lg:w-[600px] bg-pro-surface border-l border-pro-border shadow-2xl z-[100] flex flex-col overflow-hidden"
          >
            {/* 1. Header (Shrink-0) */}
            <header className="shrink-0 bg-pro-surface/80 backdrop-blur-md border-b border-pro-border p-6 flex items-center justify-between z-20">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-2xl font-bold text-pro-text-primary capitalize">
                  {selectedEntityNode.label}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-pro-text-muted capitalize">
                    {selectedEntityNode.type}
                  </span>
                  <span className="text-pro-text-muted/30">·</span>
                  <span className="text-[11px] text-pro-text-muted/60">
                    {selectedEntityNode.mention_count} mention
                    {selectedEntityNode.mention_count !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {selectedEntityNode.type === 'project' && onOpenProjectsTab && (
                  <button
                    type="button"
                    onClick={() => {
                      clearSelection();
                      onOpenProjectsTab();
                    }}
                    className="px-4 py-2 rounded-xl bg-pro-accent text-white text-[11px] font-black uppercase tracking-widest hover:bg-pro-accent/90 transition-all active:scale-[0.98] shadow-md flex items-center gap-2"
                  >
                    <span>View Active Tasks</span>
                    <span>→</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearSelection}
                  className="p-2 hover:bg-pro-bg rounded-lg text-pro-text-muted hover:text-pro-text-primary transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </header>

            {/* 2. Scrollable Body (flex-grow: 1) */}
            <div className="flex-1 overflow-y-auto custom-scrollbar relative">
              <div className="p-6 flex flex-col gap-8">
                {/* Conflict Banner */}
                {activeConflict && !isResolving && (
                  <button
                    type="button"
                    onClick={() => setIsResolving(true)}
                    className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-center justify-between cursor-pointer hover:bg-red-500/20 transition-colors w-full text-left"
                  >
                    <div>
                      <h3 className="text-red-500 font-bold text-sm flex items-center gap-2">
                        ⚠️ Conflict Detected
                      </h3>
                      <p className="text-pro-text-muted text-xs mt-1">
                        Contradicting claims found for "
                        {activeConflict[0].relationship.replace(/_/g, ' ')}".
                      </p>
                    </div>
                    <span className="text-red-500 text-xs font-semibold">
                      Resolve &rarr;
                    </span>
                  </button>
                )}

                {/* Conflict Resolution UI */}
                {activeConflict && isResolving && (
                  <section className="bg-pro-surface border border-red-500/50 rounded-lg p-4 flex flex-col gap-4">
                    <div className="flex justify-between items-center border-b border-pro-border/50 pb-2">
                      <h3 className="font-bold text-pro-text-primary">
                        Resolve Conflict:{' '}
                        {activeConflict[0].relationship.replace(/_/g, ' ')}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setIsResolving(false)}
                        className="text-pro-text-muted hover:text-pro-text-primary text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {activeConflict.slice(0, 2).map((edge) => {
                        const isSuggested = edge.state === 'suggested';
                        const otherEdge = activeConflict.find(
                          (e) => e.id !== edge.id,
                        );
                        if (!otherEdge) return null;
                        const targetLabel =
                          edge.source_entity_id === selectedEntityNode.id
                            ? edge.target_label
                            : edge.source_label;
                        return (
                          <div
                            key={edge.id}
                            className={`p-4 rounded-lg border flex flex-col gap-3 ${isSuggested ? 'border-pro-accent bg-pro-accent/5' : 'border-pro-border bg-pro-bg'}`}
                          >
                            <div className="flex justify-between items-start">
                              <span
                                className={`text-[9px] font-black uppercase tracking-widest ${isSuggested ? 'text-pro-accent' : 'text-pro-text-muted'}`}
                              >
                                {isSuggested ? 'New Claim' : 'Existing Record'}
                              </span>
                              <span className="text-[10px] text-pro-text-muted font-mono">
                                {(edge.confidence * 100).toFixed(0)}%
                              </span>
                            </div>
                            <p className="text-sm font-medium text-pro-text-primary">
                              {targetLabel}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                handleResolve(edge.id, otherEdge.id)
                              }
                              className="mt-2 w-full py-2 bg-pro-surface hover:bg-pro-accent hover:text-white border border-pro-border rounded text-[10px] font-black uppercase tracking-widest transition-all"
                            >
                              Accept
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Synthetic Summary */}
                <section className="flex flex-col gap-4">
                  <div className="flex justify-between items-center border-b border-pro-border/50 pb-2">
                    <h3 className="font-bold text-pro-text-primary text-[11px] uppercase tracking-widest">
                      Synthetic Summary
                    </h3>
                    <div className="flex items-center gap-2">
                      {!meetingsLoading && (
                        <GroundingBadge
                          meetingCount={entityMeetings.length}
                          hasContext={hasAnyContext}
                          score={groundingScore}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    {summaryLoading ? (
                      <div className="space-y-3 animate-pulse">
                        <div className="h-4 bg-pro-bg rounded w-3/4" />
                        <div className="h-4 bg-pro-bg rounded w-1/2" />
                      </div>
                    ) : displaySummary ? (
                      <div className="text-sm text-pro-text-muted leading-relaxed space-y-4">
                        {displaySummary.sentences.map(
                          (s: EntitySummarySentence) => {
                            const meetingId = s.source_meeting_ids[0] || '';
                            const sentenceKey = `${meetingId}:${s.text}`;
                            return (
                              <p key={sentenceKey} className="group relative">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSentenceClick(s.source_meeting_ids[0])
                                  }
                                  className="inline text-left cursor-pointer hover:bg-pro-accent/5 hover:text-pro-text-primary transition-all rounded-sm"
                                >
                                  <RichText text={s.text} nodes={_nodes} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSentenceClick(s.source_meeting_ids[0])
                                  }
                                  className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-pro-bg border border-pro-border text-[9px] font-mono text-pro-accent opacity-0 group-hover:opacity-100 transition-opacity hover:border-pro-accent/40"
                                >
                                  [Source:{' '}
                                  {s.source_meeting_ids[0]?.slice(0, 4) ||
                                    '???'}
                                  ]
                                </button>
                              </p>
                            );
                          },
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-pro-text-muted italic">
                        Failed to generate summary.
                      </p>
                    )}
                  </div>
                </section>

                {/* Relational Discovery */}
                <section className="flex flex-col gap-4">
                  <h3 className="font-bold text-pro-text-primary text-[11px] uppercase tracking-widest border-b border-pro-border/50 pb-2">
                    Relational Discovery
                  </h3>
                  <MentionedWithCard entity={selectedEntityNode} />
                  <EvolutionCard entity={selectedEntityNode} />
                </section>

                {/* Meeting Context */}
                <section className="flex flex-col gap-4 pb-12">
                  <h3 className="font-bold text-pro-text-primary text-[11px] uppercase tracking-widest border-b border-pro-border/50 pb-2">
                    Mentioned In
                  </h3>
                  <div className="flex flex-col gap-4 border-l-2 border-pro-border ml-2 pl-4">
                    {entityMeetings.length > 0 ? (
                      entityMeetings.slice(0, 5).map((m, idx) => (
                        <button
                          key={m.id}
                          type="button"
                          className="relative group cursor-pointer text-left w-full"
                          onClick={() => {
                            setActiveMeetingId(m.id);
                            setEvidenceDrawerOpen(true);
                          }}
                        >
                          <div
                            className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-pro-surface ${idx === 0 ? 'bg-pro-accent' : 'bg-pro-border'}`}
                          />
                          <div className="text-[10px] text-pro-text-muted font-bold uppercase tracking-tighter mb-1">
                            {m.started_at
                              ? new Date(m.started_at).toLocaleDateString(
                                  undefined,
                                  {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  },
                                )
                              : 'Unknown'}
                          </div>
                          <div className="text-sm text-pro-text-primary font-bold group-hover:text-pro-accent transition-colors">
                            {m.title}
                          </div>
                          {m.context && (
                            <p className="text-xs text-pro-text-muted mt-1 line-clamp-1 italic text-pro-text-muted/60">
                              "…{m.context}…"
                            </p>
                          )}
                        </button>
                      ))
                    ) : (
                      <p className="text-xs text-pro-text-muted italic">
                        No meeting history found.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </div>

            {/* 3. True Sticky Footer Evidence Dock (Pinned to Bottom of Sheet Viewport) */}
            <div
              className={`absolute bottom-0 left-0 right-0 z-50 border-t bg-pro-surface/95 backdrop-blur-md shadow-[0_-10px_30px_rgba(0,0,0,0.15)] transition-all duration-500 ease-in-out ${
                evidenceDrawerOpen ? 'h-[40%]' : 'h-11'
              }`}
            >
              {!evidenceDrawerOpen ? (
                <button
                  type="button"
                  onClick={() => setEvidenceDrawerOpen(true)}
                  className="w-full h-full flex items-center justify-between px-6 hover:bg-pro-bg transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-pro-accent animate-pulse font-bold text-xs">
                      ●
                    </span>
                    <span className="text-[10px] font-black text-pro-text-muted/60 uppercase tracking-[0.2em] group-hover:text-pro-text-primary transition-colors">
                      {meetingsLoading
                        ? 'Indexing Proofs…'
                        : `Found ${snippetCount} Evidence Snippets`}
                    </span>
                  </div>
                  <ChevronUp
                    size={14}
                    className="text-pro-text-muted/40 group-hover:text-pro-accent transition-colors"
                  />
                </button>
              ) : (
                <div className="h-full flex flex-col bg-pro-bg/80 backdrop-blur-xl">
                  {/* Drawer Header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-pro-border/50 bg-pro-surface/60 backdrop-blur-sm shrink-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-black text-pro-text-primary text-[10px] uppercase tracking-[0.2em]">
                        Evidence Dock
                      </h3>
                      {snippetCount > 0 && (
                        <span className="px-2 py-0.5 rounded bg-pro-accent/10 text-pro-accent text-[9px] font-black border border-pro-accent/20">
                          {snippetCount} Grounded
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEvidenceDrawerOpen(false)}
                      className="p-1.5 hover:bg-pro-bg rounded text-pro-text-muted transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="flex flex-1 overflow-hidden">
                    {/* Left: Meeting List */}
                    <div className="w-[35%] border-r border-pro-border/40 overflow-y-auto bg-pro-bg/50">
                      {entityMeetings.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setActiveMeetingId(m.id)}
                          className={`w-full text-left px-5 py-4 border-b border-pro-border/30 transition-all ${
                            activeMeetingId === m.id
                              ? 'bg-pro-surface border-l-4 border-l-pro-accent'
                              : 'hover:bg-pro-surface/50 border-l-4 border-l-transparent'
                          }`}
                        >
                          <div className="text-[11px] font-bold text-pro-text-primary truncate">
                            {m.title}
                          </div>
                          <div className="text-[9px] text-pro-text-muted/50 mt-1 uppercase font-bold tracking-tighter">
                            {m.started_at
                              ? new Date(m.started_at).toLocaleDateString([], {
                                  month: 'short',
                                  day: 'numeric',
                                })
                              : 'Unknown'}
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Right: Snippet */}
                    <div className="flex-1 overflow-y-auto bg-pro-surface/40 p-6">
                      {activeMeeting?.context ? (
                        <div className="flex flex-col gap-6">
                          <div className="flex items-center justify-between">
                            <h4 className="text-[10px] font-black text-pro-accent uppercase tracking-widest flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-pro-accent" />
                              Primary Proof
                            </h4>
                            <span className="text-[9px] font-mono text-pro-text-muted/40 uppercase">
                              ID: {activeMeeting.id.slice(0, 8)}
                            </span>
                          </div>
                          <div className="bg-pro-bg rounded-2xl border border-pro-border/50 p-6 shadow-inner-soft">
                            <p className="text-sm text-pro-text-muted leading-relaxed font-medium">
                              "{activeMeeting.context}"
                            </p>
                          </div>
                          <button
                            type="button"
                            className="h-10 px-6 rounded-xl bg-pro-accent text-white text-[10px] font-black uppercase tracking-widest hover:bg-pro-accent/90 transition-all flex items-center justify-center gap-2 w-fit"
                          >
                            <span>▶</span> Playback Sync
                          </button>
                        </div>
                      ) : (
                        <TruthMeter meetingCount={entityMeetings.length} />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
};

function RichText({
  text,
  nodes,
}: { text: string; nodes: KnowledgeGraphNode[] }) {
  const { setSelectedEntity } = useKnowledgeStore();

  // Split by bold (**), code (`), and links ([[ ]])
  const parts = text.split(/(\*\*.*?\*\*|`.*?`|\[\[.*?\]\])/g);

  return (
    <>
      {parts.map((part, i) => {
        const key = `${i}:${part}`;
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={key} className="text-pro-text-primary font-bold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={key}
              className="bg-pro-bg px-1.5 py-0.5 rounded text-pro-accent font-mono text-[11px] border border-pro-border/40"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('[[') && part.endsWith(']]')) {
          const entityName = part.slice(2, -2);
          const foundNode = nodes.find(
            (n) => n.label.toLowerCase() === entityName.toLowerCase(),
          );

          if (foundNode) {
            return (
              <button
                key={key}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEntity(foundNode.id, foundNode);
                }}
                className="text-pro-accent hover:underline decoration-pro-accent/40 underline-offset-4 font-medium transition-all"
              >
                {entityName}
              </button>
            );
          }
          return (
            <span key={key} className="text-pro-text-primary/80">
              {entityName}
            </span>
          );
        }
        return part;
      })}
    </>
  );
}

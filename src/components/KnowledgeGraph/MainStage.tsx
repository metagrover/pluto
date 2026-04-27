import {
  AlertTriangle,
  GitBranch,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import type {
  KnowledgeDoc,
  KnowledgeDocSource,
  KnowledgeDocStatus,
} from '../../api/knowledgeDocs';
import type {
  KnowledgeBacklink,
  KnowledgeGraphNode,
  KnowledgeProjectHealthCard,
  KnowledgeTimelineItem,
} from '../../api/knowledgeWorkspace';
import { useKnowledgeStore } from '../../store/knowledgeStore';
import {
  type KnowledgeBriefLane,
  type KnowledgeStatement,
  type ProjectRadarSeverity,
  compileActiveProjectRadar,
  compileKnowledgeBrief,
  formatDocStatus,
  formatRelativeKnowledgeTime,
  groupKnowledgeDocs,
  parseStructuredKnowledgeDoc,
} from './knowledgeDocument';

interface MainStageProps {
  docs: KnowledgeDoc[];
  selectedDoc: KnowledgeDoc | null;
  nodes: KnowledgeGraphNode[];
  timeline: KnowledgeTimelineItem[];
  backlinks: KnowledgeBacklink[];
  projectCards: KnowledgeProjectHealthCard[];
  sources: KnowledgeDocSource[];
  sourcesLoading: boolean;
  onSelectDoc: (docId: string) => void;
}

const STATUS_STYLES: Record<KnowledgeDocStatus, string> = {
  up_to_date: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  synthesizing: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  stale: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  failed: 'bg-red-500/10 text-red-600 border-red-500/20',
  inactive: 'bg-pro-bg text-pro-text-muted border-pro-border',
};

const LANE_ICONS: Record<KnowledgeBriefLane['id'], React.ElementType> = {
  priorities: Sparkles,
  risks: AlertTriangle,
  patterns: TrendingUp,
  dependencies: GitBranch,
};

const LANE_ACCENTS: Record<KnowledgeBriefLane['id'], string> = {
  priorities: 'border-pro-accent/30 bg-pro-accent/5',
  risks: 'border-red-500/20 bg-red-500/5',
  patterns: 'border-blue-500/20 bg-blue-500/5',
  dependencies: 'border-amber-500/20 bg-amber-500/5',
};

const RADAR_STYLES: Record<
  ProjectRadarSeverity,
  { border: string; badge: string }
> = {
  critical: {
    border: 'border-red-500/25',
    badge: 'border-red-500/20 bg-red-500/10 text-red-500',
  },
  watch: {
    border: 'border-amber-500/25',
    badge: 'border-amber-500/20 bg-amber-500/10 text-amber-600',
  },
  steady: {
    border: 'border-emerald-500/20',
    badge: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600',
  },
};

const trimText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trim()}...`;
};

const StatusBadge = ({ status }: { status: KnowledgeDocStatus }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_STYLES[status]}`}
  >
    {formatDocStatus(status)}
  </span>
);

const EmptyState = () => (
  <div className="flex h-full items-center justify-center bg-pro-bg">
    <div className="max-w-md rounded-xl border border-pro-border bg-pro-surface p-8 text-center shadow-sm">
      <Layers3 className="mx-auto h-7 w-7 text-pro-text-muted" />
      <h2 className="mt-4 text-2xl font-black tracking-tight text-pro-text-main">
        No compiled memory yet
      </h2>
      <p className="mt-3 text-sm leading-6 text-pro-text-muted">
        Record meetings and Pluto will compile active project signals, risks,
        and context here.
      </p>
    </div>
  </div>
);

const ContextSelector = ({
  docs,
  selectedDoc,
  onSelectDoc,
}: {
  docs: KnowledgeDoc[];
  selectedDoc: KnowledgeDoc;
  onSelectDoc: (docId: string) => void;
}) => {
  const groups = useMemo(() => groupKnowledgeDocs(docs), [docs]);
  const totalDocs = groups.reduce(
    (count, group) => count + group.docs.length,
    0,
  );

  return (
    <section className="rounded-xl border border-pro-border bg-pro-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-pro-text-muted">
            Memory scope
          </p>
          <p className="mt-1 truncate text-sm font-bold text-pro-text-main">
            {selectedDoc.title}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={selectedDoc.status} />
          {totalDocs > 1 && (
            <select
              value={selectedDoc.id}
              onChange={(event) => onSelectDoc(event.target.value)}
              className="h-9 max-w-[260px] rounded-lg border border-pro-border bg-pro-bg px-3 text-xs font-bold text-pro-text-main outline-none"
            >
              {groups.map((group) => (
                <optgroup key={group.scopeType} label={group.label}>
                  {group.docs.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
      </div>
    </section>
  );
};

const CitationList = ({ statement }: { statement: KnowledgeStatement }) => {
  if (statement.citations.length === 0) return null;

  return (
    <details className="mt-3 rounded-lg border border-pro-border bg-pro-surface/70 px-3 py-2">
      <summary className="cursor-pointer list-none text-[11px] font-bold text-pro-text-muted">
        Evidence ({statement.citations.length})
      </summary>
      <div className="mt-2 space-y-2">
        {statement.citations.map((citation, index) => (
          <p
            key={`${citation.meeting_id}-${index}`}
            className="text-[11px] leading-5 text-pro-text-muted"
          >
            {citation.quote
              ? trimText(citation.quote, 220)
              : citation.meeting_id || 'Source'}
          </p>
        ))}
      </div>
    </details>
  );
};

const CompiledHero = ({
  selectedDoc,
  sources,
  headline,
  freshnessDate,
  isCompiled,
}: {
  selectedDoc: KnowledgeDoc;
  sources: KnowledgeDocSource[];
  headline: string;
  freshnessDate: string;
  isCompiled: boolean;
}) => (
  <section className="rounded-xl border border-pro-border bg-pro-surface p-5 shadow-sm md:p-6">
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={selectedDoc.status} />
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-pro-text-muted">
        <RefreshCw className="h-3.5 w-3.5" />
        {formatRelativeKnowledgeTime(freshnessDate)}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-pro-text-muted">
        <ShieldCheck className="h-3.5 w-3.5" />
        {sources.length} source{sources.length === 1 ? '' : 's'}
      </span>
    </div>

    <p className="mt-5 text-[11px] font-black uppercase tracking-[0.2em] text-pro-text-muted">
      Compiled view
    </p>
    <h1 className="mt-3 max-w-3xl text-2xl font-black leading-tight tracking-tight text-pro-text-main md:text-3xl">
      {headline}
    </h1>
    <p className="mt-4 max-w-2xl text-sm font-medium leading-6 text-pro-text-muted">
      {isCompiled
        ? 'Pluto is reading across your synthesized memory for active project signals, risks, pattern shifts, and cross-context dependencies.'
        : 'Pluto needs structured, citation-backed memory before it can make a compiled claim here.'}
    </p>

    {selectedDoc.status === 'failed' && (
      <p className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500">
        Latest synthesis failed. Pluto is not making new claims from this memory
        until synthesis succeeds.
      </p>
    )}

    {selectedDoc.status === 'synthesizing' && (
      <p className="mt-5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-500">
        Refreshing memory. Existing context remains readable while Pluto
        compiles the next version.
      </p>
    )}
  </section>
);

const BriefLane = ({ lane }: { lane: KnowledgeBriefLane }) => {
  const Icon = LANE_ICONS[lane.id];
  const visibleItems = lane.items.slice(0, 4);

  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${LANE_ACCENTS[lane.id]}`}
        >
          <Icon className="h-4 w-4 text-pro-text-main" />
        </div>
        <div>
          <h2 className="text-lg font-black tracking-tight text-pro-text-main">
            {lane.label}
          </h2>
          <p className="mt-1 text-xs leading-5 text-pro-text-muted">
            {lane.description}
          </p>
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <p className="rounded-xl border border-dashed border-pro-border bg-pro-surface px-4 py-4 text-sm text-pro-text-muted">
          Nothing strong enough to surface here yet.
        </p>
      ) : (
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-pro-border bg-pro-surface p-4 shadow-sm"
            >
              <p className="text-sm font-bold leading-6 text-pro-text-main">
                {item.text}
              </p>
              {item.why_it_matters && (
                <p className="mt-2 text-xs leading-5 text-pro-text-muted">
                  {item.why_it_matters}
                </p>
              )}
              <CitationList statement={item} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

const ActiveProjectRadar = ({
  docs,
  projectCards,
}: {
  docs: KnowledgeDoc[];
  projectCards: KnowledgeProjectHealthCard[];
}) => {
  const radar = useMemo(
    () => compileActiveProjectRadar(docs, projectCards),
    [docs, projectCards],
  );

  if (radar.length === 0) return null;

  return (
    <section className="rounded-xl border border-pro-border bg-pro-surface p-5 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-pro-text-muted">
            Active project radar
          </p>
          <h2 className="mt-2 text-xl font-black tracking-tight text-pro-text-main">
            What needs attention from your current project memory
          </h2>
        </div>
        <span className="rounded-lg border border-pro-border bg-pro-bg px-3 py-1 text-[11px] font-bold text-pro-text-muted">
          {radar.length} project{radar.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-5 grid gap-3">
        {radar.slice(0, 5).map((item) => {
          const style = RADAR_STYLES[item.severity];
          return (
            <article
              key={item.id}
              className={`rounded-xl border bg-pro-bg p-4 ${style.border}`}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-black text-pro-text-main">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-pro-text-muted">
                    {item.reasons.join(' · ')}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black ${style.badge}`}
                >
                  {item.label}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

const UncompiledState = ({
  selectedDoc,
  sources,
  relatedCount,
}: {
  selectedDoc: KnowledgeDoc;
  sources: KnowledgeDocSource[];
  relatedCount: number;
}) => (
  <section className="rounded-xl border border-pro-border bg-pro-surface p-5 shadow-sm">
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-pro-text-muted">
          Why this is empty
        </p>
        <h2 className="mt-2 text-lg font-black tracking-tight text-pro-text-main">
          Pluto does not have a trustworthy compiled signal for this scope.
        </h2>
      </div>
      <StatusBadge status={selectedDoc.status} />
    </div>

    <div className="mt-5 grid gap-3 md:grid-cols-3">
      <div className="rounded-lg border border-pro-border bg-pro-bg p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-pro-text-muted">
          Source meetings
        </p>
        <p className="mt-2 text-xl font-black text-pro-text-main">
          {sources.length}
        </p>
      </div>
      <div className="rounded-lg border border-pro-border bg-pro-bg p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-pro-text-muted">
          Related context
        </p>
        <p className="mt-2 text-xl font-black text-pro-text-main">
          {relatedCount}
        </p>
      </div>
      <div className="rounded-lg border border-pro-border bg-pro-bg p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-pro-text-muted">
          Structured memory
        </p>
        <p className="mt-2 text-sm font-black capitalize text-pro-text-main">
          Not ready
        </p>
      </div>
    </div>

    <p className="mt-4 text-sm leading-6 text-pro-text-muted">
      The right next version should compile active project risks, dependencies,
      and repeated patterns only after synthesis has produced structured,
      citation-backed sections.
    </p>
  </section>
);

const EvidenceSummary = ({
  nodes,
  timeline,
  backlinks,
  sources,
  sourcesLoading,
}: {
  nodes: KnowledgeGraphNode[];
  timeline: KnowledgeTimelineItem[];
  backlinks: KnowledgeBacklink[];
  sources: KnowledgeDocSource[];
  sourcesLoading: boolean;
}) => {
  const { setSelectedEntity } = useKnowledgeStore();
  const [expanded, setExpanded] = useState(false);
  const relatedNodes = nodes.slice(0, 8);

  return (
    <section className="rounded-xl border border-pro-border bg-pro-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-pro-text-main">
            Supporting context
          </h2>
          <p className="mt-1 text-xs leading-5 text-pro-text-muted">
            {sources.length} source{sources.length === 1 ? '' : 's'} ·{' '}
            {relatedNodes.length} related item
            {relatedNodes.length === 1 ? '' : 's'} · {timeline.length} recent
            update{timeline.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-lg border border-pro-border bg-pro-bg px-3 py-1.5 text-[11px] font-bold text-pro-text-muted hover:text-pro-text-main"
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>

      {!expanded ? null : (
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-pro-text-muted">
              Source meetings
            </h3>
            <div className="mt-3 space-y-2">
              {sourcesLoading ? (
                <p className="text-xs text-pro-text-muted">
                  Loading sources...
                </p>
              ) : sources.length === 0 ? (
                <p className="text-xs leading-5 text-pro-text-muted">
                  No source meetings are linked yet.
                </p>
              ) : (
                sources.slice(0, 5).map((source) => (
                  <div
                    key={`${source.doc_id}-${source.meeting_id}`}
                    className="rounded-lg border border-pro-border bg-pro-bg p-3"
                  >
                    <p className="truncate text-xs font-bold text-pro-text-main">
                      {source.meeting_title}
                    </p>
                    <p className="mt-1 text-[11px] text-pro-text-muted">
                      {source.mention_count} mentions
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-pro-text-muted">
              Related context
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {relatedNodes.length === 0 ? (
                <p className="text-xs leading-5 text-pro-text-muted">
                  Related entities will appear as Pluto links this brief to your
                  meetings.
                </p>
              ) : (
                relatedNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedEntity(node.id, node)}
                    className="rounded-lg border border-pro-border bg-pro-bg px-3 py-1.5 text-xs font-bold text-pro-text-main hover:border-pro-accent/50 hover:text-pro-accent"
                  >
                    {node.label}
                  </button>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-pro-text-muted">
              Recent movement
            </h3>
            <div className="mt-3 space-y-3">
              {timeline.length === 0 ? (
                <p className="text-xs leading-5 text-pro-text-muted">
                  No synthesis timeline is available yet.
                </p>
              ) : (
                timeline.slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    className="border-l border-pro-border pl-3"
                  >
                    <p className="text-xs font-bold text-pro-text-main">
                      {item.title}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-pro-text-muted">
                      {item.detail}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {backlinks.length > 0 && (
            <div>
              <h3 className="text-xs font-black uppercase tracking-[0.16em] text-pro-text-muted">
                Backlinks
              </h3>
              <div className="mt-3 space-y-2">
                {backlinks.slice(0, 4).map((link) => (
                  <div key={link.id} className="rounded-lg bg-pro-bg p-3">
                    <p className="text-xs font-bold text-pro-text-main">
                      {link.label}
                    </p>
                    {link.snippet && (
                      <p className="mt-1 text-[11px] leading-4 text-pro-text-muted">
                        {trimText(link.snippet, 120)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export const MainStage: React.FC<MainStageProps> = ({
  docs,
  selectedDoc,
  nodes,
  timeline,
  backlinks,
  projectCards,
  sources,
  sourcesLoading,
  onSelectDoc,
}) => {
  const structuredDoc = useMemo(
    () => parseStructuredKnowledgeDoc(selectedDoc),
    [selectedDoc],
  );
  const brief = useMemo(
    () => compileKnowledgeBrief(selectedDoc),
    [selectedDoc],
  );

  if (!selectedDoc) return <EmptyState />;

  const freshnessDate =
    selectedDoc.last_synthesized_at || selectedDoc.updated_at;
  const hasStructuredDoc = Boolean(structuredDoc);

  return (
    <div className="h-full w-full overflow-y-auto bg-pro-bg">
      <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 px-4 py-5 md:px-6 md:py-6">
        <CompiledHero
          selectedDoc={selectedDoc}
          sources={sources}
          headline={brief.headline}
          freshnessDate={freshnessDate}
          isCompiled={brief.isCompiled}
        />

        <ActiveProjectRadar docs={docs} projectCards={projectCards} />

        {brief.isCompiled ? (
          <div className="space-y-8">
            {brief.lanes.map((lane) => (
              <BriefLane key={lane.id} lane={lane} />
            ))}
          </div>
        ) : hasStructuredDoc ? (
          <p className="rounded-xl border border-dashed border-pro-border bg-pro-surface p-5 text-sm text-pro-text-muted">
            Pluto has a structured memory for this scope, but no priority
            signals are strong enough to surface yet.
          </p>
        ) : (
          <UncompiledState
            selectedDoc={selectedDoc}
            sources={sources}
            relatedCount={nodes.length}
          />
        )}

        <EvidenceSummary
          nodes={nodes}
          timeline={timeline}
          backlinks={backlinks}
          sources={sources}
          sourcesLoading={sourcesLoading}
        />

        <ContextSelector
          docs={docs}
          selectedDoc={selectedDoc}
          onSelectDoc={onSelectDoc}
        />
      </div>
    </div>
  );
};

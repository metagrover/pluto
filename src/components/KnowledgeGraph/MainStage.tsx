import {
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { WorkingMemorySnapshot } from '../../../electron/db';
import type { AttentionItem } from '../../../electron/intelligence/intelligenceTypes';
import { getAttentionAlerts } from '../../api/intelligence';
import type {
  KnowledgeDoc,
  KnowledgeDocSource,
  KnowledgeDocStatus,
} from '../../api/knowledgeDocs';
import type { KnowledgeProjectHealthCard } from '../../api/knowledgeWorkspace';
import { getWorkingMemorySnapshot } from '../../api/workingMemory';
import type { TrustStatus } from '../../utils/trustStatus';
import { getTrustStatusMeta } from '../../utils/trustStatus';
import {
  type KnowledgeBriefCoverage,
  type KnowledgeCitation,
  type KnowledgeStatement,
  type KnowledgeV2EvidenceEntry,
  type KnowledgeV2EvidenceQuality,
  type KnowledgeV2Item,
  type KnowledgeV2SourceQualitySummary,
  type KnowledgeV2Stream,
  type NeedsAttentionItem,
  compileKnowledgeBrief,
  compileNeedsAttention,
  formatDocStatus,
  formatRelativeKnowledgeTime,
  supportsLiveAttentionQueueScope,
  supportsWorkingMemorySnapshotScope,
} from './knowledgeDocument';

interface MainStageProps {
  docs: KnowledgeDoc[];
  selectedDoc: KnowledgeDoc | null;
  projectCards: KnowledgeProjectHealthCard[];
  sources: KnowledgeDocSource[];
  sourcesLoading: boolean;
  onRetrySynthesis: (docId: string) => Promise<void>;
  onSaveCorrection: (params: {
    targetKind: 'source' | 'stream' | 'item';
    targetId: string;
    action:
      | 'exclude_source'
      | 'rename_stream'
      | 'merge_stream'
      | 'split_stream'
      | 'pin_stream'
      | 'promote_item'
      | 'demote_item'
      | 'correct_classification';
    payload?: Record<string, unknown> | null;
  }) => Promise<void>;
}

interface WhyItem {
  id: string;
  title: string;
  summary: string;
  reasons: string[];
  citations: KnowledgeCitation[];
  streamIds?: string[];
  evidenceEntries?: KnowledgeV2EvidenceEntry[];
  evidenceQuality?: {
    mode: 'direct' | 'inferred';
    confidence: number;
  };
}

const STATUS_STYLES: Record<KnowledgeDocStatus, string> = {
  up_to_date: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  synthesizing: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  stale: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  failed: 'bg-red-500/10 text-red-600 border-red-500/20',
  inactive: 'bg-pro-bg text-pro-text-muted border-pro-border',
};

const TRUST_STYLES: Record<
  ReturnType<typeof getTrustStatusMeta>['tone'],
  string
> = {
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600',
  accent: 'border-pro-accent/20 bg-pro-accent/10 text-pro-accent',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-600',
  danger: 'border-red-500/20 bg-red-500/10 text-red-500',
  muted: 'border-pro-border bg-pro-bg text-pro-text-muted',
};

const ATTENTION_STYLES: Record<
  NeedsAttentionItem['severity'],
  { badge: string; rail: string }
> = {
  critical: {
    badge: 'border-red-500/20 bg-red-500/10 text-red-500',
    rail: 'border-l-red-500/60',
  },
  watch: {
    badge: 'border-amber-500/20 bg-amber-500/10 text-amber-600',
    rail: 'border-l-amber-500/60',
  },
  steady: {
    badge: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600',
    rail: 'border-l-emerald-500/50',
  },
};

const trimText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trim()}...`;
};

const normalizeMatchText = (value: string): string =>
  value.trim().toLowerCase();

const citationMatchKey = (citations: KnowledgeCitation[]): string =>
  citations
    .map((citation) => {
      const meetingId = normalizeMatchText(citation.meeting_id);
      const quote = normalizeMatchText(citation.quote);
      return meetingId || quote ? `${meetingId}::${quote}` : '';
    })
    .filter(Boolean)
    .sort()
    .join('|');

const buildAttentionMatchers = (items: NeedsAttentionItem[]) => ({
  titles: new Set(
    items.map((item) => normalizeMatchText(item.title)).filter(Boolean),
  ),
  citations: new Set(
    items.map((item) => citationMatchKey(item.citations)).filter(Boolean),
  ),
});

const matchesPromotedAttention = (
  title: string,
  citations: KnowledgeCitation[],
  attentionMatchers: ReturnType<typeof buildAttentionMatchers>,
) => {
  const citationKey = citationMatchKey(citations);
  if (citationKey) {
    return attentionMatchers.citations.has(citationKey);
  }

  return attentionMatchers.titles.has(normalizeMatchText(title));
};

const filterDuplicateKnowledgeStatements = (
  items: KnowledgeStatement[],
  attentionMatchers: ReturnType<typeof buildAttentionMatchers>,
) =>
  items.filter(
    (item) =>
      !matchesPromotedAttention(item.text, item.citations, attentionMatchers),
  );

const filterDuplicateV2Items = (
  items: KnowledgeV2Item[],
  attentionMatchers: ReturnType<typeof buildAttentionMatchers>,
) =>
  items.filter(
    (item) =>
      !matchesPromotedAttention(item.title, item.citations, attentionMatchers),
  );

const getEvidenceEntriesForCitations = (
  citations: KnowledgeCitation[],
  evidenceIndex: KnowledgeV2EvidenceEntry[],
) => {
  const citationIds = new Set(
    citations.map((citation) => citation.meeting_id).filter(Boolean),
  );
  const citationKeys = new Set(
    citations
      .map((citation) => citationMatchKey([citation]))
      .filter((key) => key.length > 0),
  );

  return evidenceIndex.filter((entry) => {
    if (citationIds.has(entry.meeting_id)) return true;
    return citationKeys.has(
      citationMatchKey([
        {
          meeting_id: entry.meeting_id,
          quote: entry.quote,
        },
      ]),
    );
  });
};

export const buildCurrentReadWhyItem = ({
  item,
  evidenceIndex,
}: {
  item: KnowledgeStatement;
  evidenceIndex: KnowledgeV2EvidenceEntry[];
}): WhyItem => ({
  id: item.id,
  title: item.text,
  summary: item.why_it_matters,
  reasons: [
    item.why_it_matters,
    'Surfaced under Current Read because it supports the compiled headline.',
  ].filter(Boolean),
  citations: item.citations,
  evidenceEntries: getEvidenceEntriesForCitations(
    item.citations,
    evidenceIndex,
  ),
});

const labelForSeverity = (severity: NeedsAttentionItem['severity']) => {
  if (severity === 'critical') return 'Needs attention';
  if (severity === 'watch') return 'Watch';
  return 'Steady';
};

const labelForAttentionKind = (kind: NeedsAttentionItem['kind']) => {
  if (kind === 'follow_up') return 'Follow-up';
  if (kind === 'blocker') return 'Blocker';
  return kind;
};

const SYNTHESIS_STUCK_AFTER_MS = 4 * 60 * 1000;

const isLongRunningSynthesis = (doc: KnowledgeDoc): boolean => {
  if (doc.status !== 'synthesizing') return false;
  const startedAt = new Date(doc.updated_at).getTime();
  if (Number.isNaN(startedAt)) return false;
  return Date.now() - startedAt > SYNTHESIS_STUCK_AFTER_MS;
};

export const resolveCurrentReadHeadline = ({
  selectedDoc,
  headline,
  coverage,
  isCompiled,
  backingSource,
}: {
  selectedDoc: KnowledgeDoc;
  headline: string;
  coverage: KnowledgeBriefCoverage;
  isCompiled: boolean;
  backingSource: 'snapshot' | 'doc' | 'none';
}): string => {
  const synthesisIsLongRunning = isLongRunningSynthesis(selectedDoc);
  const hasPartialContext = !isCompiled && coverage.statementCount > 0;

  if (isCompiled || (backingSource !== 'none' && coverage.statementCount > 0)) {
    return headline;
  }
  if (selectedDoc.status === 'failed') {
    return 'No current read is available because synthesis failed.';
  }
  if (synthesisIsLongRunning) {
    return 'Synthesis is taking longer than expected.';
  }
  if (hasPartialContext) {
    return headline;
  }
  if (selectedDoc.status === 'synthesizing') {
    return 'Pluto is compiling the current read.';
  }
  return 'No current read is available yet.';
};

export const formatCurrentReadHeadline = (headline: string): string => {
  const firstThought = headline.split(';')[0]?.trim() || headline.trim();
  return firstThought.replace(/^[A-Z][\w -]{0,40}:\s*/, '').trim();
};

const StatusBadge = ({ status }: { status: KnowledgeDocStatus }) => (
  <span
    className={`inline-flex items-center rounded border px-2.5 py-1 text-[10px] font-semibold capitalize ${STATUS_STYLES[status]}`}
  >
    {formatDocStatus(status)}
  </span>
);

const EmptyState = () => (
  <div className="flex h-full items-center justify-center px-6">
    <div className="max-w-md rounded-lg border border-pro-border bg-pro-surface p-8 text-center shadow-sm">
      <Sparkles className="mx-auto h-7 w-7 text-pro-text-muted" />
      <h2 className="mt-4 text-2xl font-semibold text-pro-text-main">
        No Knowledge yet
      </h2>
      <p className="mt-3 text-sm leading-6 text-pro-text-muted">
        Record meetings and Pluto will compile current reads, attention items,
        and risks from your work context.
      </p>
    </div>
  </div>
);

const WhyButton = ({
  item,
  onOpen,
}: {
  item: WhyItem;
  onOpen: (item: WhyItem) => void;
}) => (
  <button
    type="button"
    onClick={() => onOpen(item)}
    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-pro-border bg-pro-bg px-2.5 text-[11px] font-bold text-pro-text-muted hover:border-pro-accent/50 hover:text-pro-text-main"
  >
    <HelpCircle className="h-3.5 w-3.5" />
    Why?
  </button>
);

const SectionShell = ({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <section className="border-b border-pro-border py-7 last:border-b-0">
    <p className="text-[10px] font-medium text-pro-text-muted">{eyebrow}</p>
    <h2 className="mt-2 text-xl font-semibold text-pro-text-main">{title}</h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-pro-text-muted">
      {description}
    </p>
    <div className="mt-6">{children}</div>
  </section>
);

const CurrentRead = ({
  selectedDoc,
  sources,
  sourcesLoading,
  headline,
  freshnessAt,
  supportingItems,
  coverage,
  evidenceQuality,
  trustMessage,
  trustStatus,
  trustDescription,
  sourceQuality,
  evidenceIndex,
  isCompiled,
  backingSource,
  isRetrying,
  onRetrySynthesis,
  onOpenWhy,
}: {
  selectedDoc: KnowledgeDoc;
  sources: KnowledgeDocSource[];
  sourcesLoading: boolean;
  headline: string;
  freshnessAt: string | null;
  supportingItems: KnowledgeStatement[];
  coverage: KnowledgeBriefCoverage;
  evidenceQuality: KnowledgeV2EvidenceQuality | null;
  trustMessage: string | null;
  trustStatus: TrustStatus | null;
  trustDescription: string | null;
  sourceQuality: KnowledgeV2SourceQualitySummary | null;
  evidenceIndex: KnowledgeV2EvidenceEntry[];
  isCompiled: boolean;
  backingSource: 'snapshot' | 'doc' | 'none';
  isRetrying: boolean;
  onRetrySynthesis: (docId: string) => Promise<void>;
  onOpenWhy: (item: WhyItem) => void;
}) => {
  const freshnessDate =
    freshnessAt || selectedDoc.last_synthesized_at || selectedDoc.updated_at;
  const synthesisIsLongRunning = isLongRunningSynthesis(selectedDoc);
  const needsRetry = selectedDoc.status === 'failed' || synthesisIsLongRunning;
  const hasReliableRead =
    isCompiled || (backingSource !== 'none' && coverage.statementCount > 0);
  const hasPartialContext = !isCompiled && coverage.statementCount > 0;
  const currentRead = formatCurrentReadHeadline(
    resolveCurrentReadHeadline({
      selectedDoc,
      headline,
      coverage,
      isCompiled,
      backingSource,
    }),
  );
  const citedMeetingLabel = `${coverage.citedMeetingCount} cited meeting${
    coverage.citedMeetingCount === 1 ? '' : 's'
  }`;
  const statementLabel = `${coverage.statementCount} cited item${
    coverage.statementCount === 1 ? '' : 's'
  }`;
  const sourceCount = coverage.sourceCount ?? sources.length;
  const evidenceIsThin =
    selectedDoc.status === 'up_to_date' &&
    coverage.statementCount > 0 &&
    !isCompiled;

  return (
    <SectionShell
      eyebrow="Knowledge"
      title="Current Read"
      description="The shortest trustworthy read across the selected knowledge scope."
    >
      <div className="flex flex-col gap-4 border-b border-pro-border pb-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {needsRetry && hasReliableRead ? (
            <span className="inline-flex items-center rounded border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-500">
              Last reliable read
            </span>
          ) : (
            <StatusBadge status={selectedDoc.status} />
          )}
          {needsRetry && hasReliableRead && (
            <span className="text-[11px] font-bold text-pro-text-muted">
              Update failed
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-pro-text-muted">
            <RefreshCw className="h-3.5 w-3.5" />
            {formatRelativeKnowledgeTime(freshnessDate)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-pro-text-muted">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {sourcesLoading
              ? 'Loading sources'
              : `${sourceCount} source${sourceCount === 1 ? '' : 's'}`}
          </span>
          {coverage.statementCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-pro-text-muted">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {statementLabel}
            </span>
          )}
          {coverage.citedMeetingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-pro-text-muted">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {citedMeetingLabel}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {needsRetry && (
            <button
              type="button"
              disabled={isRetrying}
              onClick={() => onRetrySynthesis(selectedDoc.id)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-pro-border px-3 text-xs font-bold text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRetrying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Retry synthesis
            </button>
          )}
        </div>
      </div>

      <div className="pt-5">
        <h1 className="max-w-3xl text-[40px] font-serif font-medium leading-[1.2] tracking-[-0.01em] text-pro-text-main">
          {currentRead}
        </h1>

        {selectedDoc.status === 'failed' && !hasReliableRead && (
          <p className="mt-4 text-xs font-semibold text-red-500">
            Pluto could not compile a reliable current read. Retry synthesis to
            rebuild it.
          </p>
        )}

        {selectedDoc.status === 'synthesizing' && (
          <p className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-500">
            {synthesisIsLongRunning
              ? 'The local model has been working for a while. You can wait, or retry synthesis if this looks stale.'
              : hasPartialContext
                ? 'Updating synthesis in the background. Pluto is showing the best compiled context captured so far.'
                : 'Local synthesis is in progress. Larger knowledge docs can take several minutes because Pluto now processes them in chunks.'}
          </p>
        )}

        {evidenceIsThin && (
          <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-600">
            Pluto indexed this scope, but the synthesized evidence is still too
            thin to call it a complete current read.
          </p>
        )}

        {(trustStatus || trustMessage) && (
          <details className="mt-5 border-y border-pro-border py-3 text-pro-text-muted">
            <summary className="cursor-pointer text-xs font-semibold text-pro-text-main">
              Evidence and sources
            </summary>
            <div className="pt-3">
              {trustStatus && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded border px-2 py-1 text-[9px] font-medium ${
                      TRUST_STYLES[getTrustStatusMeta(trustStatus).tone]
                    }`}
                    title={
                      trustDescription ??
                      getTrustStatusMeta(trustStatus).description
                    }
                  >
                    {getTrustStatusMeta(trustStatus).label}
                  </span>
                  <span className="text-[11px] font-semibold text-pro-text-muted">
                    {trustDescription ??
                      getTrustStatusMeta(trustStatus).description}
                  </span>
                </div>
              )}
              <p className="text-xs font-semibold text-pro-text-muted">
                {trustMessage}
                {sourceQuality
                  ? ` Included ${sourceQuality.included_count}, excluded ${sourceQuality.excluded_count}, weak ${sourceQuality.weak_count}.`
                  : ''}
              </p>
              {evidenceQuality && (
                <p className="mt-2 text-[11px] font-semibold text-pro-text-muted">
                  Evidence quality: {evidenceQuality.freshness}{' '}
                  {evidenceQuality.mode} support.
                </p>
              )}
            </div>
          </details>
        )}

        {supportingItems.length > 0 && (
          <div className="mt-5 space-y-2">
            {!isCompiled && (
              <p className="text-[10px] font-medium text-pro-text-muted">
                Captured so far
              </p>
            )}
            {supportingItems.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3"
              >
                <p className="flex gap-2 text-sm leading-6 text-pro-text-muted">
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-pro-accent" />
                  <span>{item.text}</span>
                </p>
                <WhyButton
                  item={buildCurrentReadWhyItem({
                    item,
                    evidenceIndex,
                  })}
                  onOpen={onOpenWhy}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionShell>
  );
};

const NeedsAttention = ({
  items,
  onOpenWhy,
}: {
  items: NeedsAttentionItem[];
  onOpenWhy: (item: WhyItem) => void;
}) => {
  if (items.length === 0) return null;

  return (
    <SectionShell
      eyebrow="Priority"
      title="Needs Attention"
      description="The few items most likely to affect active work, pulled from risks, dependencies, and project health."
    >
      <div className="space-y-3">
        {items.slice(0, 5).map((item) => {
          const style = ATTENTION_STYLES[item.severity];
          return (
            <article
              key={item.id}
              className="border-b border-pro-border py-4 last:border-b-0"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-2.5 py-1 text-[10px] font-semibold ${style.badge}`}
                    >
                      {labelForSeverity(item.severity)}
                    </span>
                    <span className="text-[10px] font-medium text-pro-text-muted">
                      {labelForAttentionKind(item.kind)}
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold leading-6 text-pro-text-main">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-pro-text-muted">
                    {item.summary}
                  </p>
                </div>
                <WhyButton item={item} onOpen={onOpenWhy} />
              </div>
            </article>
          );
        })}
      </div>
    </SectionShell>
  );
};

const ActiveStreams = ({
  streams,
  onOpenWhy,
}: {
  streams: KnowledgeV2Stream[];
  onOpenWhy: (item: WhyItem) => void;
}) => {
  if (streams.length === 0) return null;

  return (
    <SectionShell
      eyebrow="Streams"
      title="Active Streams"
      description="The major threads Pluto sees across work, personal, travel, research, and routine context."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {streams.slice(0, 6).map((stream) => (
          <article
            key={stream.id}
            className="rounded-lg border border-pro-border bg-pro-bg p-4"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-pro-border px-2 py-0.5 text-[10px] font-medium text-pro-text-muted">
                    {stream.domain}
                  </span>
                  <span className="text-[10px] font-medium text-pro-text-muted">
                    {stream.source_count} source
                    {stream.source_count === 1 ? '' : 's'}
                  </span>
                </div>
                <h3 className="mt-3 text-base font-semibold text-pro-text-main">
                  {stream.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-pro-text-muted">
                  {stream.current_read}
                </p>
              </div>
              <WhyButton
                item={{
                  id: stream.id,
                  title: stream.title,
                  summary: stream.current_read,
                  reasons: [
                    stream.status,
                    `${stream.open_follow_up_count} active follow-up${
                      stream.open_follow_up_count === 1 ? '' : 's'
                    }`,
                    `${stream.decision_count} recorded decision${
                      stream.decision_count === 1 ? '' : 's'
                    }`,
                    `${stream.unresolved_question_count} unresolved question${
                      stream.unresolved_question_count === 1 ? '' : 's'
                    }`,
                  ].filter(Boolean),
                  citations: [],
                  streamIds: [stream.id],
                  evidenceQuality: {
                    mode: stream.evidence_quality.mode,
                    confidence: stream.evidence_quality.confidence,
                  },
                }}
                onOpen={onOpenWhy}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-pro-text-muted">
              <span>{stream.open_follow_up_count} follow-ups</span>
              <span>{stream.decision_count} decisions</span>
              <span>{stream.evidence_quality.freshness}</span>
            </div>
          </article>
        ))}
      </div>
    </SectionShell>
  );
};

const V2ItemList = ({
  title,
  description,
  items,
  onOpenWhy,
}: {
  title: string;
  description: string;
  items: KnowledgeV2Item[];
  onOpenWhy: (item: WhyItem) => void;
}) => {
  if (items.length === 0) return null;

  return (
    <SectionShell eyebrow="Analysis" title={title} description={description}>
      <div className="divide-y divide-pro-border rounded-lg border border-pro-border bg-pro-bg">
        {items.slice(0, 6).map((item) => (
          <article
            key={item.id}
            className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-pro-border px-2 py-0.5 text-[10px] font-medium text-pro-text-muted">
                  {item.kind.replace(/_/g, ' ')}
                </span>
                <span className="text-[10px] font-medium text-pro-text-muted">
                  {item.evidence_quality.mode} ·{' '}
                  {Math.round(item.evidence_quality.confidence * 100)}%
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold leading-6 text-pro-text-main">
                {item.title}
              </p>
              <p className="mt-2 text-sm leading-6 text-pro-text-muted">
                {item.summary || item.why_now}
              </p>
            </div>
            <WhyButton
              item={{
                id: item.id,
                title: item.title,
                summary: item.summary,
                reasons: [item.why_now].filter(Boolean),
                citations: item.citations,
                evidenceQuality: {
                  mode: item.evidence_quality.mode,
                  confidence: item.evidence_quality.confidence,
                },
              }}
              onOpen={onOpenWhy}
            />
          </article>
        ))}
      </div>
    </SectionShell>
  );
};

const SourceQualitySummary = ({
  sourceQuality,
}: {
  sourceQuality: KnowledgeV2SourceQualitySummary | null;
}) => {
  const records = sourceQuality?.records || [];
  if (records.length === 0) return null;

  return (
    <SectionShell
      eyebrow="Trust"
      title="Source Quality"
      description="Usable, weak, and excluded sources that shape the current brief."
    >
      <div className="divide-y divide-pro-border rounded-lg border border-pro-border bg-pro-bg">
        {records.slice(0, 6).map((record) => (
          <article
            key={record.meeting_id}
            className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-pro-border px-2 py-0.5 text-[10px] font-medium text-pro-text-muted">
                  {record.domain}
                </span>
                <span className="text-[10px] font-medium text-pro-text-muted">
                  {record.usable ? 'included' : 'excluded'} · score{' '}
                  {record.score}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-pro-text-main">
                {record.title}
              </p>
              {record.reasons.length > 0 && (
                <p className="mt-1 text-xs font-semibold text-pro-text-muted">
                  {record.reasons.join(', ')}
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </SectionShell>
  );
};

const RisksAndUnknowns = ({
  risks,
  dependencies,
  v2Items,
  onOpenWhy,
}: {
  risks: KnowledgeStatement[];
  dependencies: KnowledgeStatement[];
  v2Items: KnowledgeV2Item[];
  onOpenWhy: (item: WhyItem) => void;
}) => {
  const items = [...risks, ...dependencies].slice(0, 5);
  if (items.length === 0 && v2Items.length === 0) return null;

  return (
    <SectionShell
      eyebrow="Analysis"
      title="Risks and Unknowns"
      description="Failure modes, unresolved commitments, and cross-context dependencies worth keeping visible."
    >
      <div className="divide-y divide-pro-border">
        {items.map((item) => (
          <article
            key={item.id}
            className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between"
          >
            <div>
              <p className="text-sm font-semibold leading-6 text-pro-text-main">
                {item.text}
              </p>
              {item.why_it_matters && (
                <p className="mt-2 text-sm leading-6 text-pro-text-muted">
                  {item.why_it_matters}
                </p>
              )}
            </div>
            <WhyButton
              item={{
                id: item.id,
                title: item.text,
                summary: item.why_it_matters,
                reasons: item.why_it_matters ? [item.why_it_matters] : [],
                citations: item.citations,
              }}
              onOpen={onOpenWhy}
            />
          </article>
        ))}
        {v2Items.slice(0, Math.max(0, 5 - items.length)).map((item) => (
          <article
            key={item.id}
            className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between"
          >
            <div>
              <p className="text-sm font-semibold leading-6 text-pro-text-main">
                {item.title}
              </p>
              <p className="mt-2 text-sm leading-6 text-pro-text-muted">
                {item.summary || item.why_now}
              </p>
            </div>
            <WhyButton
              item={{
                id: item.id,
                title: item.title,
                summary: item.summary,
                reasons: [item.why_now].filter(Boolean),
                citations: item.citations,
                evidenceQuality: {
                  mode: item.evidence_quality.mode,
                  confidence: item.evidence_quality.confidence,
                },
              }}
              onOpen={onOpenWhy}
            />
          </article>
        ))}
      </div>
    </SectionShell>
  );
};

const BrowseMemory = ({ children }: { children: React.ReactNode }) => (
  <details className="knowledge-library">
    <summary>
      <span>
        <strong>Browse memory</strong>
        <small>Inspect streams, patterns, and source quality</small>
      </span>
      <ChevronRight aria-hidden="true" className="h-4 w-4" />
    </summary>
    <div className="knowledge-library__content">{children}</div>
  </details>
);

const QuietUnavailableState = ({
  selectedDoc,
}: { selectedDoc: KnowledgeDoc }) => (
  <section className="rounded-lg border border-dashed border-pro-border bg-pro-surface p-5 text-sm leading-6 text-pro-text-muted">
    {selectedDoc.status === 'failed'
      ? 'A compiled Knowledge view will appear after synthesis succeeds. Retry synthesis from Current Read when you are ready.'
      : selectedDoc.status === 'inactive' && window.__PLUTO_BROWSER_PREVIEW__
        ? 'The browser preview cannot access Electron memory data. Open Pluto in Electron to see the live global Knowledge view.'
        : 'Pluto has this knowledge scope, but it does not have enough structured signal to summarize it yet.'}
  </section>
);

const WhySheet = ({
  item,
  onClose,
}: {
  item: WhyItem | null;
  onClose: () => void;
}) => {
  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <button
        type="button"
        aria-label="Close evidence panel"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-[420px] overflow-y-auto border-l border-pro-border bg-pro-surface p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium text-pro-text-muted">
              Why this appears
            </p>
            <h2 className="mt-2 text-xl font-semibold leading-7 text-pro-text-main">
              {item.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-pro-border bg-pro-bg text-pro-text-muted hover:text-pro-text-main"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {item.summary && (
          <p className="mt-4 text-sm leading-6 text-pro-text-muted">
            {item.summary}
          </p>
        )}

        {item.evidenceQuality && (
          <p className="mt-4 rounded-lg border border-pro-border bg-pro-bg p-3 text-xs font-bold text-pro-text-muted">
            Evidence is {item.evidenceQuality.mode}; confidence{' '}
            {Math.round(item.evidenceQuality.confidence * 100)}%.
          </p>
        )}

        {item.reasons.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-medium text-pro-text-muted">
              Reasoning
            </h3>
            <div className="mt-3 space-y-2">
              {item.reasons.map((reason) => (
                <p
                  key={reason}
                  className="rounded-lg border border-pro-border bg-pro-bg p-3 text-sm leading-6 text-pro-text-main"
                >
                  {reason}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-xs font-medium text-pro-text-muted">Evidence</h3>
          {item.evidenceEntries?.length ? (
            <div className="mt-3 space-y-3">
              {item.evidenceEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-pro-border bg-pro-bg p-3"
                >
                  <p className="text-[11px] font-medium text-pro-text-muted">
                    {entry.meeting_title || entry.meeting_id}
                  </p>
                  <p className="mt-1 text-[11px] font-bold text-pro-text-muted">
                    {entry.mode} · {Math.round(entry.confidence * 100)}%
                  </p>
                  <p className="mt-2 text-sm leading-6 text-pro-text-main">
                    {trimText(entry.quote, 260)}
                  </p>
                </div>
              ))}
            </div>
          ) : item.citations.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-pro-border bg-pro-bg p-3 text-sm leading-6 text-pro-text-muted">
              No linked citation is attached to this item yet.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {item.citations.map((citation, index) => (
                <div
                  key={`${citation.meeting_id}-${index}`}
                  className="rounded-lg border border-pro-border bg-pro-bg p-3"
                >
                  {citation.meeting_id && (
                    <p className="text-[11px] font-medium text-pro-text-muted">
                      {citation.meeting_id}
                    </p>
                  )}
                  <p className="mt-2 text-sm leading-6 text-pro-text-main">
                    {citation.quote
                      ? trimText(citation.quote, 260)
                      : 'Citation available'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

export const MainStage: React.FC<MainStageProps> = ({
  docs,
  selectedDoc,
  projectCards,
  sources,
  sourcesLoading,
  onRetrySynthesis,
  onSaveCorrection,
}) => {
  void onSaveCorrection;
  const [whyItem, setWhyItem] = useState<WhyItem | null>(null);
  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);
  const [workingMemorySnapshot, setWorkingMemorySnapshot] =
    useState<WorkingMemorySnapshot | null>(null);
  const [attentionAlerts, setAttentionAlerts] = useState<AttentionItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (
      !selectedDoc ||
      !supportsWorkingMemorySnapshotScope(selectedDoc.scope_type)
    ) {
      setWorkingMemorySnapshot(null);
      return () => {
        cancelled = true;
      };
    }

    void getWorkingMemorySnapshot(selectedDoc.scope_type, selectedDoc.scope_key)
      .then((snapshot) => {
        if (!cancelled) {
          setWorkingMemorySnapshot(snapshot ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkingMemorySnapshot(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDoc]);

  useEffect(() => {
    let cancelled = false;

    if (
      !selectedDoc ||
      !supportsLiveAttentionQueueScope(selectedDoc.scope_type)
    ) {
      setAttentionAlerts([]);
      return () => {
        cancelled = true;
      };
    }

    void getAttentionAlerts()
      .then((items) => {
        if (!cancelled) {
          setAttentionAlerts(items.filter((item) => item.status === 'active'));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAttentionAlerts([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDoc]);

  const brief = useMemo(
    () => compileKnowledgeBrief(selectedDoc, workingMemorySnapshot),
    [selectedDoc, workingMemorySnapshot],
  );
  const attentionItems = useMemo(
    () =>
      compileNeedsAttention(
        selectedDoc,
        docs,
        projectCards,
        attentionAlerts,
        workingMemorySnapshot,
      ),
    [selectedDoc, docs, projectCards, attentionAlerts, workingMemorySnapshot],
  );

  if (!selectedDoc) return <EmptyState />;

  const attentionMatchers = buildAttentionMatchers(attentionItems);
  const priorities = filterDuplicateKnowledgeStatements(
    brief.lanes.find((lane) => lane.id === 'priorities')?.items || [],
    attentionMatchers,
  );
  const risks = filterDuplicateKnowledgeStatements(
    brief.lanes.find((lane) => lane.id === 'risks')?.items || [],
    attentionMatchers,
  );
  const dependencies = filterDuplicateKnowledgeStatements(
    brief.lanes.find((lane) => lane.id === 'dependencies')?.items || [],
    attentionMatchers,
  );
  const dedupedV2Risks = filterDuplicateV2Items(
    brief.risksAndUnknowns,
    attentionMatchers,
  );
  const allBriefItems = [...priorities, ...risks, ...dependencies];
  const v2SupportingBullets: KnowledgeStatement[] = brief.supportingBullets.map(
    (text, index) => ({
      id: `current-read-bullet-${index}`,
      text,
      why_it_matters: brief.trustMessage || '',
      citations: [],
    }),
  );
  const v2SupportingItems: KnowledgeStatement[] =
    brief.activeStreams.length > 0
      ? brief.activeStreams.slice(0, 4).map((stream) => ({
          id: stream.id,
          text: `${stream.title}: ${stream.current_read}`,
          why_it_matters: stream.status,
          citations: [],
        }))
      : [];
  const supportingItems = (
    v2SupportingBullets.length > 0
      ? v2SupportingBullets
      : v2SupportingItems.length > 0
        ? v2SupportingItems
        : brief.isCompiled
          ? priorities
          : allBriefItems
  )
    .filter(
      (item, index, items) =>
        item.text !== brief.headline &&
        items.findIndex((candidate) => candidate.text === item.text) === index,
    )
    .slice(0, 4);
  const handleRetry = async (docId: string) => {
    setRetryingDocId(docId);
    try {
      await onRetrySynthesis(docId);
    } finally {
      setRetryingDocId(null);
    }
  };
  const enrichWhyItem = (item: WhyItem): WhyItem => {
    const citationIds = new Set(
      item.citations.map((citation) => citation.meeting_id).filter(Boolean),
    );
    const streamIds = new Set(item.streamIds?.filter(Boolean) || []);
    const entries = brief.evidenceIndex.filter((entry) => {
      if (entry.item_ids.includes(item.id)) return true;
      if (entry.stream_ids.some((streamId) => streamIds.has(streamId))) {
        return true;
      }
      if (citationIds.has(entry.meeting_id)) return true;
      return getEvidenceEntriesForCitations(item.citations, [entry]).length > 0;
    });
    return entries.length > 0 ? { ...item, evidenceEntries: entries } : item;
  };

  return (
    <div className="h-full w-full overflow-y-scroll">
      <div
        data-testid="knowledge-operating-picture"
        className="mx-auto flex w-full max-w-[1120px] flex-col px-5 py-6 md:px-8 lg:py-8"
      >
        <CurrentRead
          selectedDoc={selectedDoc}
          sources={sources}
          sourcesLoading={sourcesLoading}
          headline={brief.headline}
          freshnessAt={brief.freshnessAt}
          supportingItems={supportingItems}
          coverage={brief.coverage}
          evidenceQuality={brief.evidenceQuality}
          trustMessage={brief.trustMessage}
          trustStatus={brief.trustStatus}
          trustDescription={brief.trustDescription}
          sourceQuality={brief.sourceQuality}
          evidenceIndex={brief.evidenceIndex}
          isCompiled={brief.isCompiled}
          backingSource={brief.backingSource}
          isRetrying={retryingDocId === selectedDoc.id}
          onRetrySynthesis={handleRetry}
          onOpenWhy={(item) => setWhyItem(item)}
        />

        <NeedsAttention
          items={attentionItems}
          onOpenWhy={(item) => setWhyItem(enrichWhyItem(item))}
        />

        <RisksAndUnknowns
          risks={risks}
          dependencies={dependencies}
          v2Items={dedupedV2Risks}
          onOpenWhy={(item) => setWhyItem(enrichWhyItem(item))}
        />

        <BrowseMemory>
          <ActiveStreams
            streams={brief.activeStreams}
            onOpenWhy={(item) => setWhyItem(enrichWhyItem(item))}
          />
          <V2ItemList
            title="Patterns and Signals"
            description="Repeated or emerging context Pluto can support with cited evidence."
            items={brief.patterns}
            onOpenWhy={(item) => setWhyItem(enrichWhyItem(item))}
          />
          <SourceQualitySummary sourceQuality={brief.sourceQuality} />
        </BrowseMemory>

        {!brief.isCompiled && attentionItems.length === 0 && (
          <QuietUnavailableState selectedDoc={selectedDoc} />
        )}
      </div>

      <WhySheet item={whyItem} onClose={() => setWhyItem(null)} />
    </div>
  );
};

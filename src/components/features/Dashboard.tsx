import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  Loader2,
  Mic,
  Sparkles,
} from 'lucide-react';

import { getTrustStatusMeta } from '../../utils/trustStatus';
import type {
  DashboardAction,
  DashboardActionInsightItem,
  DashboardHomeModel,
} from './dashboardModel';

interface DashboardProps {
  model: DashboardHomeModel;
  loading: boolean;
  isRecording: boolean;
  setSelectedMeetingId: (id: string | number | null) => void;
  setActiveTab: (tab: 'hub' | 'people' | 'projects' | 'wiki') => void;
  setAskPlutoVisible: (visible: boolean) => void;
  updatingTaskIds: Set<string>;
  actionError: string | null;
  handleCompleteTask: (id: string) => Promise<void>;
  handleUpdateAttentionStatus: (
    attentionItemId: string,
    nextStatus: 'active' | 'dismissed' | 'snoozed',
  ) => Promise<void>;
}

const isTabTarget = (
  target: DashboardAction['target'],
): target is 'projects' | 'wiki' => target === 'projects' || target === 'wiki';

const getActionInsightStatusLabel = (item: DashboardActionInsightItem) =>
  item.attentionLabel ?? item.status;

const getActionInsightStatusTone = (item: DashboardActionInsightItem) => {
  if (item.attentionLabel === 'Blocker' || item.status === 'overdue') {
    return 'bg-pro-urgent/10 text-pro-urgent';
  }
  if (item.status === 'stale') {
    return 'bg-pro-warning/10 text-pro-warning';
  }
  return 'bg-pro-accent/10 text-pro-accent';
};

const getHeroTone = (
  severity: DashboardHomeModel['hero']['severity'],
  loading: boolean,
) => {
  if (loading) return 'border-pro-border text-pro-text-muted';
  if (severity === 'urgent') return 'border-pro-urgent/25 text-pro-urgent';
  if (severity === 'watch') return 'border-pro-warning/25 text-pro-warning';
  if (severity === 'live') return 'border-pro-success/25 text-pro-success';
  return 'border-pro-accent/25 text-pro-accent';
};

const formatMeetingDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
};

export const Dashboard = ({
  model,
  loading,
  isRecording,
  setSelectedMeetingId,
  setActiveTab,
  setAskPlutoVisible,
  updatingTaskIds,
  actionError,
  handleCompleteTask,
  handleUpdateAttentionStatus,
}: DashboardProps) => {
  const runAction = (action: DashboardAction) => {
    if (action.target === 'ask') return setAskPlutoVisible(true);
    if (action.target === 'meeting')
      return setSelectedMeetingId(action.meetingId);
    setActiveTab(action.target);
  };

  const visibleActions =
    model.actionInsights.state === 'populated'
      ? model.actionInsights.items.slice(0, 3)
      : [];
  const hiddenActionCount =
    model.actionInsights.state === 'populated'
      ? Math.max(0, model.actionInsights.items.length - visibleActions.length)
      : 0;
  const memoryCards =
    model.knowledgeDocuments.state === 'populated'
      ? model.knowledgeDocuments.cards.slice(0, 4)
      : [];
  const leadMemory = memoryCards[0] ?? null;
  const trustMeta = leadMemory?.trustStatus
    ? getTrustStatusMeta(leadMemory.trustStatus)
    : null;
  const currentRead = leadMemory?.description || model.hero.title;
  const currentReadDetail = leadMemory
    ? `Synthesized from ${leadMemory.sourceCountLabel.toLowerCase()} in ${leadMemory.title}.`
    : model.hero.detail;

  return (
    <main className="mx-auto w-full max-w-[1180px] animate-in pb-20">
      <section
        aria-labelledby="current-read-title"
        className="border-b border-pro-border/70 pb-7"
      >
        <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:items-end lg:gap-12">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-pro-accent/80">
                Current read
              </p>
              <span
                className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${getHeroTone(model.hero.severity, loading)}`}
              >
                {loading ? 'Refreshing' : model.hero.label}
              </span>
              {isRecording ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-pro-success">
                  <CircleDot className="h-3 w-3" /> Recording
                </span>
              ) : null}
            </div>
            <h1
              id="current-read-title"
              className="max-w-[24ch] text-[32px] font-black leading-[1.12] tracking-[-0.035em] text-pro-text-main md:text-[38px]"
            >
              {currentRead}
            </h1>
            <p className="mt-4 max-w-[68ch] text-[15px] font-medium leading-7 text-pro-text-main/65">
              {currentReadDetail}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  leadMemory
                    ? setActiveTab('wiki')
                    : runAction(model.briefingFocus.action)
                }
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-pro-accent px-4 text-[12px] font-black text-[#1A2340] transition-colors hover:bg-pro-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
              >
                {leadMemory
                  ? 'Open knowledge'
                  : model.briefingFocus.action.label}
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setAskPlutoVisible(true)}
                className="inline-flex h-11 items-center gap-2 rounded-xl px-3 text-[12px] font-bold text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
              >
                <Sparkles className="h-4 w-4" /> Ask Pluto
              </button>
            </div>
          </div>

          <aside
            aria-label="Why Pluto believes this"
            className="border-t border-pro-border/70 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-pro-text-muted/60">
              Why Pluto believes this
            </p>
            {leadMemory ? (
              <>
                <p className="mt-3 text-[12px] font-bold leading-5 text-pro-text-main">
                  {leadMemory.sourceCountLabel}
                </p>
                <p className="mt-1 text-[11px] font-medium leading-5 text-pro-text-muted">
                  {trustMeta?.label ?? 'Source-backed memory'}
                  {leadMemory.trustDescription
                    ? `: ${leadMemory.trustDescription}`
                    : ''}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('wiki')}
                  className="mt-3 inline-flex min-h-11 items-center gap-1 text-[11px] font-bold text-pro-accent hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                >
                  Open knowledge <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <p className="mt-3 text-[11px] font-medium leading-5 text-pro-text-muted">
                Pluto is using the latest available meeting and action context.
                More sources will strengthen this read.
              </p>
            )}
          </aside>
        </div>
      </section>

      <div className="grid gap-10 pt-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.7fr)] lg:gap-12">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="attention-title">
            <div className="flex items-end justify-between gap-4 border-b border-pro-border/70 pb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-pro-text-muted/55">
                  May need you
                </p>
                <h2
                  id="attention-title"
                  className="mt-1 text-[22px] font-black tracking-[-0.025em] text-pro-text-main"
                >
                  Attention
                </h2>
              </div>
              <p className="text-right text-[11px] font-semibold text-pro-text-main/55">
                Only the highest-value signals
              </p>
            </div>

            {visibleActions.length ? (
              <div className="divide-y divide-pro-border/60">
                {visibleActions.map((item) => {
                  const isUpdating =
                    updatingTaskIds.has(item.id) ||
                    Boolean(
                      item.attentionItemId &&
                        updatingTaskIds.has(item.attentionItemId),
                    );
                  return (
                    <article
                      key={item.id}
                      data-testid="dashboard-attention-row"
                      aria-busy={isUpdating}
                      className="group py-4"
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          aria-label={`Mark ${item.title} complete`}
                          disabled={isUpdating}
                          onClick={() => handleCompleteTask(item.id)}
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-pro-border text-pro-text-muted transition-colors hover:border-pro-accent hover:text-pro-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-60"
                        >
                          {isUpdating ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-[14px] font-bold leading-5 text-pro-text-main">
                              {item.title}
                            </h3>
                            <span
                              className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${getActionInsightStatusTone(item)}`}
                            >
                              {getActionInsightStatusLabel(item)}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] font-medium leading-5 text-pro-text-muted">
                            {item.dueLabel} ·{' '}
                            {item.contextLabel ?? item.sourceLabel}
                          </p>
                          {item.attentionReason &&
                          item.attentionReason !== item.contextLabel ? (
                            <p className="mt-1 text-[11px] font-semibold leading-5 text-pro-urgent/85">
                              {item.attentionReason}
                            </p>
                          ) : null}
                          <div className="mt-2 flex min-h-8 flex-wrap items-center gap-1 text-[10px] font-bold">
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => handleCompleteTask(item.id)}
                              className="min-h-8 rounded-lg px-2 text-pro-accent hover:bg-pro-accent/10 hover:text-pro-text-main disabled:opacity-50"
                            >
                              Mark complete
                            </button>
                            {item.attentionItemId && item.dismissLabel ? (
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() =>
                                  handleUpdateAttentionStatus(
                                    item.attentionItemId!,
                                    item.dismissLabel === 'Reopen'
                                      ? 'active'
                                      : 'dismissed',
                                  )
                                }
                                className="min-h-8 rounded-lg px-2 text-pro-text-main/60 hover:bg-pro-surface hover:text-pro-text-main disabled:opacity-50"
                              >
                                {item.dismissLabel}
                              </button>
                            ) : null}
                            {item.attentionItemId && item.snoozeLabel ? (
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() =>
                                  handleUpdateAttentionStatus(
                                    item.attentionItemId!,
                                    item.snoozeLabel === 'Reopen'
                                      ? 'active'
                                      : 'snoozed',
                                  )
                                }
                                className="min-h-8 rounded-lg px-2 text-pro-text-main/60 hover:bg-pro-warning/10 hover:text-pro-warning disabled:opacity-50"
                              >
                                {item.snoozeLabel}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="py-7">
                <p className="text-[14px] font-bold text-pro-text-main">
                  Nothing is asking for intervention.
                </p>
                <p className="mt-1 text-[12px] font-medium text-pro-text-muted">
                  Pluto will surface blockers, aging commitments, and important
                  changes here.
                </p>
              </div>
            )}
            {actionError ? (
              <p
                role="alert"
                className="mt-2 text-[12px] font-semibold text-pro-urgent"
              >
                {actionError}
              </p>
            ) : null}
            {hiddenActionCount > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTab('projects')}
                className="mt-2 inline-flex min-h-11 items-center gap-1 text-[11px] font-bold text-pro-text-muted hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
              >
                Review {hiddenActionCount} more{' '}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </section>

          <section aria-labelledby="memory-title">
            <div className="flex items-end justify-between border-b border-pro-border/70 pb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-pro-text-muted/55">
                  Across your context
                </p>
                <h2
                  id="memory-title"
                  className="mt-1 text-[22px] font-black tracking-[-0.025em] text-pro-text-main"
                >
                  Memory in motion
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('wiki')}
                className="min-h-11 text-[11px] font-bold text-pro-text-muted hover:text-pro-text-main"
              >
                Open knowledge
              </button>
            </div>
            {memoryCards.length ? (
              <div className="divide-y divide-pro-border/60">
                {memoryCards.map((doc) => {
                  const meta = doc.trustStatus
                    ? getTrustStatusMeta(doc.trustStatus)
                    : null;
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => setActiveTab('wiki')}
                      className="group flex w-full items-start gap-3 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                    >
                      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-pro-accent/75" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[13px] font-bold text-pro-text-main group-hover:text-pro-accent">
                            {doc.title}
                          </span>
                          <span className="text-[9px] font-black uppercase tracking-[0.1em] text-pro-text-muted/60">
                            {meta?.label ?? doc.status}
                          </span>
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[12px] font-medium leading-5 text-pro-text-muted">
                          {doc.description}
                        </span>
                        <span className="mt-1 block text-[10px] font-semibold text-pro-text-muted/65">
                          {doc.countLabel}
                        </span>
                      </span>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-pro-text-muted/35 transition-transform group-hover:translate-x-0.5 group-hover:text-pro-accent" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="py-7 text-[12px] font-medium leading-6 text-pro-text-muted">
                Record a conversation to begin connecting decisions, people, and
                recurring themes.
              </p>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-8">
          <section aria-labelledby="continue-title">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-pro-text-muted/55">
              Continue where you left off
            </p>
            <h2 id="continue-title" className="sr-only">
              Continue where you left off
            </h2>
            <button
              type="button"
              disabled={model.latestMeeting.state !== 'populated'}
              onClick={() =>
                model.latestMeeting.state === 'populated' &&
                setSelectedMeetingId(model.latestMeeting.meetingId)
              }
              className="group mt-3 w-full border-t border-pro-border/70 pt-4 text-left disabled:cursor-default"
            >
              <span className="flex items-center gap-2 text-[10px] font-bold text-pro-text-muted/65">
                <Mic className="h-3.5 w-3.5" /> Latest meeting{' '}
                {model.latestMeeting.state === 'populated'
                  ? `· ${formatMeetingDate(model.latestMeeting.occurredAt)}`
                  : ''}
              </span>
              <span className="mt-2 block text-[16px] font-black leading-6 text-pro-text-main group-enabled:group-hover:text-pro-accent">
                {loading && model.latestMeeting.state === 'empty'
                  ? 'Refreshing meeting memory'
                  : model.latestMeeting.title}
              </span>
              <span className="mt-2 line-clamp-4 block text-[12px] font-medium leading-5 text-pro-text-muted">
                {loading && model.latestMeeting.state === 'empty'
                  ? 'Pluto is checking recent conversations.'
                  : model.latestMeeting.detail}
              </span>
              {model.latestMeeting.state === 'populated' ? (
                <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-pro-accent">
                  Open brief <ChevronRight className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </button>
          </section>

          {isRecording ? (
            <section className="border-t border-pro-success/25 pt-4">
              <p className="flex items-center gap-2 text-[11px] font-black text-pro-success">
                <CircleDot className="h-3.5 w-3.5" /> Recording now
              </p>
              <p className="mt-2 text-[12px] font-medium leading-5 text-pro-text-muted">
                This conversation will join the next memory brief automatically.
              </p>
            </section>
          ) : null}

          {model.spotlight ? (
            <section className="border-t border-pro-border/70 pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-pro-text-muted/55">
                  {model.spotlight.hasBlockers
                    ? 'Blocked project signal'
                    : 'Project signal'}
                </p>
                <span
                  className={`rounded-full px-2 py-1 text-[9px] font-black ${model.spotlight.hasBlockers ? 'bg-pro-urgent/10 text-pro-urgent' : 'bg-pro-accent/10 text-pro-accent'}`}
                >
                  {model.spotlight.badgeLabel}
                </span>
              </div>
              <h3 className="mt-3 text-[15px] font-black leading-5 text-pro-text-main">
                {model.spotlight.title}
              </h3>
              <p className="mt-1 text-[11px] font-bold text-pro-text-muted/65">
                {model.spotlight.subtitle}
              </p>
              <p className="mt-2 text-[12px] font-medium leading-5 text-pro-text-muted">
                {model.spotlight.detail}
              </p>
              <button
                type="button"
                onClick={() =>
                  isTabTarget(model.spotlight!.target) &&
                  setActiveTab(model.spotlight!.target)
                }
                className="mt-3 inline-flex min-h-11 items-center gap-1 text-[11px] font-bold text-pro-accent hover:text-pro-text-main"
              >
                {model.spotlight.hasBlockers
                  ? 'Review blockers'
                  : 'Open project'}{' '}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
};

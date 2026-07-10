import { Loader2 } from 'lucide-react';

import { getTrustStatusMeta } from '../../utils/trustStatus';
import type { DashboardAction, DashboardHomeModel } from './dashboardModel';

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

const getDocumentScopeIcon = (
  scopeType: DashboardHomeModel['knowledgeDocuments']['cards'][number]['scopeType'],
) => {
  switch (scopeType) {
    case 'global':
      return 'W';
    case 'project':
      return 'P';
    case 'team_tracker':
      return 'T';
    case 'person_context':
      return 'U';
  }
};

const TRUST_BADGE_TONES: Record<
  ReturnType<typeof getTrustStatusMeta>['tone'],
  string
> = {
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600',
  accent: 'border-pro-accent/20 bg-pro-accent/10 text-pro-accent',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-600',
  danger: 'border-red-500/20 bg-red-500/10 text-red-500',
  muted: 'border-pro-border bg-pro-bg text-pro-text-muted',
};

const getHeroTone = (
  severity: DashboardHomeModel['hero']['severity'],
  loading: boolean,
) => {
  if (loading) return 'text-pro-text-muted/60 border-pro-border bg-pro-surface';
  if (severity === 'urgent') {
    return 'text-pro-urgent border-pro-urgent/20 bg-pro-urgent/5';
  }
  if (severity === 'watch') {
    return 'text-pro-warning border-pro-warning/20 bg-pro-warning/5';
  }
  if (severity === 'live') {
    return 'text-pro-success border-pro-success/20 bg-pro-success/5';
  }
  return 'text-pro-accent border-pro-accent/20 bg-pro-accent/5';
};

const getHeroLabel = (
  kind: DashboardHomeModel['hero']['kind'],
  loading: boolean,
) => {
  if (loading) return 'Syncing';
  switch (kind) {
    case 'recording':
      return 'Live capture';
    case 'overdue_action':
    case 'active_action':
      return 'Needs attention';
    case 'stale_action':
      return 'Watch';
    case 'latest_meeting':
      return 'Latest meeting';
    case 'knowledge_doc':
      return 'Recent memory';
    case 'default':
      return 'Ready';
  }
};

const getBriefingTone = (kind: DashboardHomeModel['briefingFocus']['kind']) => {
  if (kind === 'attention') {
    return 'border-pro-accent/30 bg-pro-surface dark:border-pro-border dark:bg-pro-surface/55';
  }
  if (kind === 'latest_meeting') {
    return 'border-pro-accent/25 bg-pro-surface dark:bg-pro-surface/55';
  }
  if (kind === 'knowledge_doc') {
    return 'border-pro-border bg-pro-surface dark:bg-pro-surface/55';
  }
  return 'border-pro-border bg-pro-surface dark:bg-pro-surface/55';
};

const isSameAction = (left: DashboardAction, right: DashboardAction): boolean =>
  left.target === right.target &&
  (left.target !== 'meeting' ||
    right.target !== 'meeting' ||
    left.meetingId === right.meetingId);

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
    if (action.target === 'ask') {
      setAskPlutoVisible(true);
      return;
    }

    if (action.target === 'meeting') {
      setSelectedMeetingId(action.meetingId);
      return;
    }

    setActiveTab(action.target);
  };

  const openSpotlightTarget = () => {
    if (model.spotlight && isTabTarget(model.spotlight.target)) {
      setActiveTab(model.spotlight.target);
    }
  };

  const visibleActionItems =
    model.briefingFocus.kind === 'attention' &&
    model.actionInsights.state === 'populated'
      ? model.actionInsights.items.slice(0, 3)
      : [];

  const visibleDocuments =
    model.knowledgeDocuments.state === 'populated'
      ? model.knowledgeDocuments.cards.slice(0, 3)
      : [];
  const heroQuickActions = model.quickActions.filter(
    (action) => !isSameAction(action, model.briefingFocus.action),
  );
  const hiddenActionCount =
    model.actionInsights.state === 'populated'
      ? Math.max(
          0,
          model.actionInsights.items.length - visibleActionItems.length,
        )
      : 0;

  const isLoadingLatestMeeting =
    loading && model.latestMeeting.state === 'empty';
  const memoryTitle = visibleDocuments.length > 0 ? 'Recent memory' : 'Memory';

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-5 animate-in pb-20">
      <header className="rounded-[1.5rem] border border-pro-border bg-pro-surface/75 px-5 py-5 shadow-sm md:px-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[11px] font-black tracking-[0.18em] text-pro-accent/80">
                  Daily briefing
                </p>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[9px] font-black tracking-[0.14em] ${getHeroTone(
                    model.hero.severity,
                    loading,
                  )}`}
                >
                  {getHeroLabel(model.hero.kind, loading)}
                </span>
              </div>
              <h1 className="max-w-3xl text-[29px] font-black leading-tight tracking-[-0.03em] text-pro-text-main">
                {model.hero.title}
              </h1>
            </div>
            <p className="max-w-xl text-[14px] font-semibold leading-relaxed text-pro-text-muted xl:text-right">
              {model.hero.detail}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runAction(model.briefingFocus.action)}
              className="h-10 rounded-xl bg-pro-text-main px-4 text-[11px] font-black text-white shadow-premium transition-all hover:bg-pro-accent active-push dark:bg-pro-accent dark:text-[#1A2340]"
            >
              {model.briefingFocus.action.label}
            </button>
            {heroQuickActions.map((action) => (
              <button
                type="button"
                key={
                  action.target === 'meeting'
                    ? `${action.target}-${action.meetingId}`
                    : action.target
                }
                onClick={() => runAction(action)}
                className="h-10 rounded-xl border border-pro-border bg-pro-bg/70 px-4 text-[11px] font-bold text-pro-text-main/75 transition-all hover:border-pro-accent/35 hover:text-pro-text-main active-push"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-12 gap-4 items-stretch">
        <div
          className={`col-span-12 xl:col-span-7 rounded-[1.5rem] border p-5 shadow-sm md:p-6 ${getBriefingTone(
            model.briefingFocus.kind,
          )}`}
        >
          <div className="flex h-full flex-col gap-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <p className="text-[11px] font-black tracking-[0.16em] text-pro-text-muted/55">
                  Focus now
                </p>
                <h2 className="text-[24px] font-black tracking-[-0.02em] text-pro-text-main">
                  {model.briefingFocus.title}
                </h2>
                <p className="max-w-2xl text-[14px] font-semibold leading-relaxed text-pro-text-muted">
                  {model.briefingFocus.detail}
                </p>
              </div>
              <button
                type="button"
                onClick={() => runAction(model.briefingFocus.action)}
                className="h-10 shrink-0 rounded-xl border border-pro-border bg-pro-bg px-4 text-[11px] font-black text-pro-text-main transition-all hover:border-pro-accent/35 hover:bg-pro-surface active-push"
              >
                {model.briefingFocus.action.label}
              </button>
            </div>

            {visibleActionItems.length > 0 ? (
              <div className="grid gap-2.5">
                {visibleActionItems.map((item) => {
                  const isUpdating =
                    updatingTaskIds.has(item.id) ||
                    (item.attentionItemId != null &&
                      updatingTaskIds.has(item.attentionItemId));
                  return (
                    <div
                      key={item.id}
                      aria-busy={isUpdating}
                      className={`group/item flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all ${
                        isUpdating
                          ? 'border-pro-accent/20 bg-pro-accent/5 opacity-80'
                          : 'border-pro-border/60 bg-pro-bg/35 hover:border-pro-accent/30 hover:bg-pro-bg/55'
                      }`}
                    >
                      <div
                        className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-md border-2 transition-all ${
                          isUpdating
                            ? 'border-pro-accent bg-pro-accent/10 text-pro-accent'
                            : 'border-pro-border group-hover/item:border-pro-accent'
                        }`}
                      >
                        {isUpdating ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-[13px] font-bold leading-snug text-pro-text-main">
                            {item.title}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${
                              item.status === 'overdue'
                                ? 'bg-pro-urgent/10 text-pro-urgent'
                                : item.status === 'stale'
                                  ? 'bg-pro-warning/10 text-pro-warning'
                                  : 'bg-pro-accent/10 text-pro-accent'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {item.attentionLabel ? (
                            <span className="rounded-full bg-pro-urgent/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-pro-urgent">
                              {item.attentionLabel}
                            </span>
                          ) : null}
                          <p className="text-[11px] font-semibold text-pro-text-muted/70">
                            {item.dueLabel} ·{' '}
                            {item.contextLabel ?? item.sourceLabel}
                          </p>
                        </div>
                        {item.attentionReason ? (
                          <p className="mt-1 text-[11px] font-semibold text-pro-urgent/80">
                            {item.attentionReason}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={async () => {
                              await handleCompleteTask(item.id);
                            }}
                            className="h-8 rounded-lg border border-pro-accent/25 bg-pro-accent/8 px-3 text-[10px] font-black uppercase tracking-[0.14em] text-pro-accent transition-all hover:border-pro-accent/40 hover:bg-pro-accent/14 disabled:cursor-wait disabled:opacity-60"
                          >
                            Mark complete
                          </button>
                          {item.attentionItemId && item.dismissLabel ? (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={async () => {
                                await handleUpdateAttentionStatus(
                                  item.attentionItemId!,
                                  item.dismissLabel === 'Reopen'
                                    ? 'active'
                                    : 'dismissed',
                                );
                              }}
                              className="h-8 rounded-lg border border-pro-border bg-pro-surface/70 px-3 text-[10px] font-black uppercase tracking-[0.14em] text-pro-text-main transition-all hover:border-pro-accent/30 hover:text-pro-accent disabled:cursor-wait disabled:opacity-60"
                            >
                              {item.dismissLabel}
                            </button>
                          ) : null}
                          {item.attentionItemId && item.snoozeLabel ? (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={async () => {
                                await handleUpdateAttentionStatus(
                                  item.attentionItemId!,
                                  item.snoozeLabel === 'Reopen'
                                    ? 'active'
                                    : 'snoozed',
                                );
                              }}
                              className="h-8 rounded-lg border border-pro-border bg-pro-surface/70 px-3 text-[10px] font-black uppercase tracking-[0.14em] text-pro-text-main transition-all hover:border-pro-warning/30 hover:text-pro-warning disabled:cursor-wait disabled:opacity-60"
                            >
                              {item.snoozeLabel}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {actionError ? (
                  <p className="text-[12px] font-semibold text-red-500">
                    {actionError}
                  </p>
                ) : null}
                {hiddenActionCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('projects')}
                    className="h-9 rounded-xl border border-dashed border-pro-border bg-transparent px-4 text-[11px] font-bold text-pro-text-muted/70 transition-all hover:border-pro-accent/35 hover:text-pro-text-main"
                  >
                    See {hiddenActionCount} more in projects
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-pro-border/60 bg-pro-bg/35 p-4">
                  <p className="text-[11px] font-black tracking-[0.14em] text-pro-text-muted/55">
                    Latest meeting
                  </p>
                  <p className="mt-2 text-[15px] font-black leading-snug text-pro-text-main">
                    {model.latestMeeting.title}
                  </p>
                  <p className="mt-2 line-clamp-3 text-[12px] font-semibold leading-relaxed text-pro-text-muted">
                    {model.latestMeeting.detail}
                  </p>
                </div>
                <div className="rounded-2xl border border-pro-border/60 bg-pro-bg/35 p-4">
                  <p className="text-[11px] font-black tracking-[0.14em] text-pro-text-muted/55">
                    Memory
                  </p>
                  <p className="mt-2 text-[15px] font-black leading-snug text-pro-text-main">
                    {visibleDocuments[0]?.title || 'Waiting for context'}
                  </p>
                  <p className="mt-2 line-clamp-3 text-[12px] font-semibold leading-relaxed text-pro-text-muted">
                    {visibleDocuments[0]?.description ||
                      'Recent meetings will surface the most relevant project and knowledge context here.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5 rounded-[1.5rem] border border-pro-border bg-pro-surface/80 p-5 shadow-sm md:p-6 dark:bg-pro-surface/55">
          <div className="flex h-full flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-black tracking-[0.16em] text-pro-text-muted/55">
                  Latest meeting
                </p>
                {model.latestMeeting.state === 'populated' && (
                  <p className="mt-1 text-[11px] font-semibold text-pro-text-muted/65">
                    {model.latestMeeting.occurredAt}
                  </p>
                )}
              </div>
              {model.latestMeeting.state === 'populated' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (model.latestMeeting.state === 'populated') {
                      setSelectedMeetingId(model.latestMeeting.meetingId);
                    }
                  }}
                  className="h-9 rounded-xl border border-pro-border bg-pro-bg px-4 text-[11px] font-bold text-pro-text-main/75 transition-all hover:border-pro-accent/35 hover:text-pro-text-main active-push"
                >
                  Open brief
                </button>
              ) : (
                <span className="rounded-full border border-pro-border bg-pro-bg px-3 py-1.5 text-[10px] font-bold text-pro-text-muted/55">
                  Waiting
                </span>
              )}
            </div>
            <div className="space-y-3">
              <h3 className="text-[23px] font-black tracking-[-0.02em] leading-tight text-pro-text-main">
                {isLoadingLatestMeeting
                  ? 'Syncing meeting memory'
                  : model.latestMeeting.title}
              </h3>
              <p className="text-[13px] font-semibold leading-relaxed text-pro-text-muted line-clamp-6">
                {isLoadingLatestMeeting
                  ? 'Pluto is checking recent meetings and notes.'
                  : model.latestMeeting.detail}
              </p>
            </div>

            {isRecording && (
              <div className="rounded-2xl border border-pro-success/20 bg-pro-success/5 p-4">
                <p className="text-[11px] font-black tracking-[0.14em] text-pro-success">
                  Recording now
                </p>
                <p className="mt-1 text-[12px] font-semibold text-pro-text-muted">
                  Pluto will fold this conversation into the next briefing
                  automatically.
                </p>
              </div>
            )}

            {model.spotlight && (
              <button
                type="button"
                onClick={openSpotlightTarget}
                className="mt-auto rounded-2xl border border-pro-border/70 bg-pro-bg/45 p-4 text-left transition-all hover:border-pro-accent/30 hover:bg-pro-bg/65"
              >
                <p className="text-[11px] font-black tracking-[0.14em] text-pro-text-muted/55">
                  Project signal
                </p>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-black leading-snug text-pro-text-main">
                      {model.spotlight.title}
                    </p>
                    <p className="mt-1 text-[12px] font-semibold leading-relaxed text-pro-text-muted">
                      {model.spotlight.detail}
                    </p>
                  </div>
                  <span className="rounded-full bg-pro-accent/10 px-2.5 py-1 text-[10px] font-black text-pro-accent">
                    Projects
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-pro-border bg-pro-surface/80 p-5 shadow-sm md:p-6 dark:bg-pro-surface/55">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <p className="text-[11px] font-black tracking-[0.16em] text-pro-text-muted/55">
              {memoryTitle}
            </p>
            <h2 className="mt-1 text-[22px] font-black tracking-[-0.02em] text-pro-text-main">
              {visibleDocuments.length > 0
                ? 'Recent knowledge'
                : 'Memory status'}
            </h2>
          </div>
          {visibleDocuments.length > 0 ? (
            <button
              type="button"
              className="h-9 rounded-xl border border-pro-border bg-pro-bg px-4 text-[11px] font-bold text-pro-text-main/75 transition-all hover:border-pro-accent/35 hover:text-pro-text-main active-push"
              onClick={() => setActiveTab('wiki')}
            >
              Open knowledge
            </button>
          ) : (
            <span className="rounded-full border border-pro-border bg-pro-bg px-3 py-1.5 text-[10px] font-bold text-pro-text-muted/55">
              No sources
            </span>
          )}
        </div>

        {visibleDocuments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-pro-border bg-pro-bg/50 p-6">
            <p className="text-[14px] font-black text-pro-text-main">
              {loading ? 'Syncing live documents' : 'No live documents yet'}
            </p>
            <p className="mt-2 text-[13px] font-semibold leading-relaxed text-pro-text-muted/70">
              {loading
                ? 'Pluto is loading synthesized workspace memory.'
                : 'Recorded meetings will populate the knowledge base.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {visibleDocuments.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setActiveTab('wiki')}
                className="group rounded-2xl border border-pro-border/60 bg-pro-bg/55 p-4 text-left transition-all hover:border-pro-accent/30 hover:bg-pro-bg"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-pro-border bg-pro-surface text-sm font-black text-pro-text-main/70 shadow-soft transition-colors group-hover:text-pro-accent">
                    {getDocumentScopeIcon(item.scopeType)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[14px] font-black tracking-tight text-pro-text-main">
                        {item.title}
                      </h3>
                      <span className="text-[10px] font-bold text-pro-accent/70">
                        {item.countLabel}
                      </span>
                    </div>
                    {item.trustStatus && (
                      <div className="mt-2 space-y-1">
                        <span
                          className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${
                            TRUST_BADGE_TONES[
                              getTrustStatusMeta(item.trustStatus).tone
                            ]
                          }`}
                          title={
                            item.trustDescription ??
                            getTrustStatusMeta(item.trustStatus).description
                          }
                        >
                          {getTrustStatusMeta(item.trustStatus).label}
                        </span>
                        <p className="text-[11px] font-semibold leading-relaxed text-pro-text-muted/70">
                          {item.trustDescription ??
                            getTrustStatusMeta(item.trustStatus).description}
                        </p>
                      </div>
                    )}
                    <p className="mt-1 text-[12px] font-semibold leading-relaxed text-pro-text-muted/70 line-clamp-3">
                      {item.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

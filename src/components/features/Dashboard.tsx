import type { DashboardAction, DashboardHomeModel } from './dashboardModel';

interface DashboardProps {
  model: DashboardHomeModel;
  loading: boolean;
  isRecording: boolean;
  setSelectedMeetingId: (id: string | number | null) => void;
  setActiveTab: (tab: 'hub' | 'people' | 'projects' | 'wiki') => void;
  setAskPlutoVisible: (visible: boolean) => void;
  completedTasks: Set<string>;
  handleCompleteTask: (id: string) => void;
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

export const Dashboard = ({
  model,
  loading,
  isRecording,
  setSelectedMeetingId,
  setActiveTab,
  setAskPlutoVisible,
  completedTasks,
  handleCompleteTask,
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
  const hiddenActionCount =
    model.actionInsights.state === 'populated'
      ? Math.max(
          0,
          model.actionInsights.items.length - visibleActionItems.length,
        )
      : 0;

  const isLoadingLatestMeeting =
    loading && model.latestMeeting.state === 'empty';
  const memoryTitle =
    visibleDocuments.length > 0 ? 'Knowledge documents' : 'Memory status';

  return (
    <div className="max-w-[1360px] mx-auto w-full space-y-6 animate-in relative pb-20">
      <header className="rounded-[1.25rem] border border-pro-border bg-pro-surface/65 dark:bg-pro-surface/35 px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[10px] font-black text-pro-accent uppercase tracking-[0.24em]">
                Pluto Intelligence
              </p>
              <span
                className={`text-[9px] font-black uppercase tracking-[0.16em] px-2.5 py-1 rounded-full border ${getHeroTone(
                  model.hero.severity,
                  loading,
                )}`}
              >
                {getHeroLabel(model.hero.kind, loading)}
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-pro-text-main leading-tight">
              {model.hero.title}
            </h1>
          </div>
          <p className="max-w-xl text-[14px] text-pro-text-muted font-semibold leading-relaxed xl:text-right">
            {model.hero.detail}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-12 gap-4 items-stretch">
        <div
          className={`col-span-12 xl:col-span-8 rounded-[1.25rem] border p-5 shadow-sm ${getBriefingTone(
            model.briefingFocus.kind,
          )}`}
        >
          <div className="flex flex-col h-full gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-black text-pro-text-muted/50 uppercase tracking-[0.2em]">
                  Briefing
                </p>
                <h2 className="text-[22px] font-black tracking-tight text-pro-text-main">
                  {model.briefingFocus.title}
                </h2>
                <p className="text-sm font-semibold text-pro-text-muted leading-relaxed max-w-2xl">
                  {model.briefingFocus.detail}
                </p>
              </div>
              <button
                type="button"
                onClick={() => runAction(model.briefingFocus.action)}
                className="shrink-0 h-10 px-4 rounded-xl bg-pro-text-main dark:bg-pro-accent text-white dark:text-[#1A2340] font-black text-[10px] uppercase tracking-[0.16em] shadow-premium hover:bg-pro-accent transition-all active-push"
              >
                {model.briefingFocus.action.label}
              </button>
            </div>

            {visibleActionItems.length > 0 && (
              <div className="grid gap-2">
                {visibleActionItems.map((item) => {
                  const isDone = completedTasks.has(item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={isDone}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCompleteTask(item.id);
                      }}
                      className={`group/item w-full text-left px-3.5 py-2.5 rounded-xl border transition-all flex items-start gap-3 ${
                        isDone
                          ? 'bg-pro-success/5 border-pro-success/20 opacity-60'
                          : 'bg-pro-bg/35 border-pro-border/60 hover:border-pro-accent/30 hover:bg-pro-bg/55'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-md border-2 mt-0.5 flex items-center justify-center transition-all ${
                          isDone
                            ? 'bg-pro-success border-pro-success'
                            : 'border-pro-border group-hover/item:border-pro-accent'
                        }`}
                      >
                        {isDone && (
                          <span className="text-white text-[10px]">✓</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <span
                            className={`text-[13px] font-bold leading-snug line-clamp-2 ${
                              isDone
                                ? 'line-through text-pro-text-muted'
                                : 'text-pro-text-main'
                            }`}
                          >
                            {item.title}
                          </span>
                          <span
                            className={`px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest shrink-0 ${
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
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-[9px] font-bold text-pro-text-muted/45 uppercase tracking-widest">
                            {item.dueLabel}
                          </span>
                          <span className="text-[9px] font-bold text-pro-accent/55 uppercase tracking-widest">
                            {item.sourceLabel}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {hiddenActionCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('projects')}
                    className="h-8 rounded-xl border border-dashed border-pro-border/70 bg-transparent text-[9px] font-black uppercase tracking-widest text-pro-text-muted/60 hover:text-pro-text-main hover:border-pro-accent/30 transition-all"
                  >
                    {hiddenActionCount} more in projects
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 xl:col-span-4 rounded-[1.25rem] border border-pro-border bg-pro-surface/80 dark:bg-pro-surface/55 p-5 md:p-6 shadow-sm">
          <div className="flex h-full flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] font-black text-pro-text-muted/50 uppercase tracking-[0.2em]">
                Latest Meeting
              </p>
              {model.latestMeeting.state === 'populated' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (model.latestMeeting.state === 'populated') {
                      setSelectedMeetingId(model.latestMeeting.meetingId);
                    }
                  }}
                  className="h-9 px-4 rounded-xl border border-pro-border bg-pro-bg text-[9px] font-black text-pro-text-main/70 uppercase tracking-widest hover:border-pro-accent/40 hover:text-pro-text-main transition-all active-push"
                >
                  Open
                </button>
              ) : (
                <span className="rounded-full border border-pro-border bg-pro-bg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-pro-text-muted/45">
                  Waiting
                </span>
              )}
            </div>
            <div className="space-y-3">
              <h3 className="text-lg font-black tracking-tight leading-tight text-pro-text-main">
                {isLoadingLatestMeeting
                  ? 'Syncing meeting memory'
                  : model.latestMeeting.title}
              </h3>
              {(model.latestMeeting.state === 'populated' || loading) && (
                <p className="text-[11px] text-pro-text-muted/50 font-bold uppercase tracking-widest">
                  {model.latestMeeting.state === 'populated'
                    ? model.latestMeeting.occurredAt
                    : 'Syncing'}
                </p>
              )}
              <p className="text-[13px] font-semibold text-pro-text-muted leading-relaxed line-clamp-5">
                {isLoadingLatestMeeting
                  ? 'Pluto is checking recent meetings and notes.'
                  : model.latestMeeting.detail}
              </p>
            </div>
            {isRecording && (
              <div className="mt-auto rounded-2xl border border-pro-success/20 bg-pro-success/5 p-4">
                <p className="text-[11px] font-black text-pro-success uppercase tracking-widest">
                  Recording now
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        className={`grid grid-cols-12 gap-4 ${
          model.spotlight ? 'items-stretch' : 'items-start'
        }`}
      >
        <div
          className={`col-span-12 ${
            model.spotlight ? 'xl:col-span-7' : ''
          } rounded-[1.25rem] border border-pro-border bg-pro-surface/80 dark:bg-pro-surface/55 p-5 md:p-6 shadow-sm`}
        >
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <p className="text-[10px] font-black text-pro-text-muted/50 uppercase tracking-[0.2em]">
                Recent Memory
              </p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-pro-text-main">
                {memoryTitle}
              </h2>
            </div>
            {visibleDocuments.length > 0 ? (
              <button
                type="button"
                className="h-9 px-4 rounded-xl border border-pro-border bg-pro-bg text-[9px] font-black text-pro-accent uppercase tracking-widest hover:border-pro-accent/40 transition-all active-push"
                onClick={() => setActiveTab('wiki')}
              >
                Library
              </button>
            ) : (
              <span className="rounded-full border border-pro-border bg-pro-bg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-pro-text-muted/45">
                No sources
              </span>
            )}
          </div>

          {visibleDocuments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-pro-border bg-pro-bg/50 p-6">
              <p className="text-[13px] font-black text-pro-text-main">
                {loading ? 'Syncing live documents' : 'No live documents yet'}
              </p>
              <p className="mt-2 text-[12px] font-semibold text-pro-text-muted/60 leading-relaxed">
                {loading
                  ? 'Pluto is loading synthesized workspace memory.'
                  : 'Recorded meetings will populate the knowledge base.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {visibleDocuments.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setActiveTab('wiki')}
                  className="group text-left rounded-2xl border border-pro-border/60 bg-pro-bg/55 p-4 hover:border-pro-accent/30 hover:bg-pro-bg transition-all"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-pro-surface border border-pro-border flex items-center justify-center text-sm font-black text-pro-text-main/70 shadow-soft group-hover:text-pro-accent transition-colors">
                      {getDocumentScopeIcon(item.scopeType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-[14px] font-black tracking-tight text-pro-text-main">
                          {item.title}
                        </h3>
                        <span className="text-[9px] font-black text-pro-accent/70 uppercase tracking-widest">
                          {item.countLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] font-semibold text-pro-text-muted/65 leading-relaxed line-clamp-2">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {model.spotlight && (
          <div className="col-span-12 xl:col-span-5 rounded-3xl border border-pro-border bg-pro-bg p-6 md:p-7 shadow-sm">
            <div className="flex h-full flex-col gap-5">
              <div>
                <p className="text-[10px] font-black text-pro-text-muted/50 uppercase tracking-[0.2em]">
                  Project Signal
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-pro-text-main">
                  {model.spotlight.title}
                </h2>
                <p className="mt-1 text-[11px] font-bold text-pro-accent uppercase tracking-[0.2em]">
                  {model.spotlight.subtitle}
                </p>
              </div>

              <p className="text-sm font-semibold text-pro-text-muted leading-relaxed">
                {model.spotlight.detail}
              </p>

              <div className="flex flex-wrap gap-2">
                {model.spotlight.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1.5 bg-pro-surface border border-pro-border rounded-lg text-[9px] font-black text-pro-text-main/60 uppercase tracking-tight"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-auto flex gap-3">
                <button
                  type="button"
                  onClick={openSpotlightTarget}
                  className="flex-1 h-11 rounded-xl bg-pro-surface border border-pro-border text-pro-text-main font-black text-[10px] uppercase tracking-[0.16em] shadow-soft hover:bg-pro-bg transition-all active-push"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => setAskPlutoVisible(true)}
                  className="flex-1 h-11 rounded-xl bg-white dark:bg-pro-surface text-pro-text-main dark:text-pro-text-main font-black text-[10px] uppercase tracking-[0.16em] shadow-premium hover:bg-white/90 dark:hover:bg-pro-surface/80 transition-all active-push border border-pro-border/40"
                >
                  Ask Pluto
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

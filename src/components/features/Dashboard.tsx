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

  const getActionKey = (action: DashboardAction) =>
    `${action.target}-${action.label}-${
      action.target === 'meeting' ? action.meetingId : ''
    }`;

  return (
    <div className="max-w-5xl mx-auto w-full space-y-16 animate-in relative pb-32">
      <div className="space-y-10 relative">
        <div className="space-y-4 max-w-2xl">
          <p className="text-[10px] font-black text-pro-accent uppercase tracking-[0.3em] mb-2">
            Pluto Intelligence
          </p>
          <h1 className="text-4xl font-black heading-premium tracking-tight text-pro-text-main leading-tight">
            {model.hero.title}
          </h1>
          <p className="text-xl text-pro-text-muted font-medium leading-relaxed">
            {model.hero.detail}
          </p>
          <div className="pt-1 flex items-center gap-3">
            <span
              className={`text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-full border ${
                loading
                  ? 'text-pro-text-muted/50 border-pro-border bg-pro-surface'
                  : model.hero.severity === 'urgent'
                    ? 'text-pro-urgent border-pro-urgent/20 bg-pro-urgent/5'
                    : model.hero.severity === 'watch'
                      ? 'text-pro-warning border-pro-warning/20 bg-pro-warning/5'
                      : model.hero.severity === 'live'
                        ? 'text-pro-success border-pro-success/20 bg-pro-success/5'
                        : 'text-pro-accent border-pro-accent/20 bg-pro-accent/5'
              }`}
            >
              {loading ? 'Syncing' : model.hero.kind.replace(/_/g, ' ')}
            </span>
          </div>
          {model.hero.action && (
            <div className="pt-4 flex items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  if (model.hero.action) {
                    runAction(model.hero.action);
                  }
                }}
                className="px-8 py-3.5 rounded-full bg-white dark:bg-pro-surface text-pro-text-main dark:text-pro-text-main font-black text-[11px] uppercase tracking-[.15em] shadow-premium hover:bg-white/90 dark:hover:bg-pro-surface/80 hover:scale-[1.02] transition-all active-push border border-pro-border/40 dark:border-pro-border/50"
              >
                {model.hero.action.label}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2.5">
          {model.quickActions.map((action) => (
            <button
              type="button"
              key={getActionKey(action)}
              onClick={() => runAction(action)}
              className="px-5 py-2.5 rounded-full bg-pro-surface border border-pro-border shadow-sm hover:border-pro-accent/40 hover:scale-[1.02] transition-all active-push flex items-center gap-2 group"
            >
              <span className="w-2 h-2 rounded-full bg-pro-accent/40 group-hover:bg-pro-accent transition-colors" />
              <span className="text-[10px] font-black uppercase tracking-widest text-pro-text-main opacity-60 group-hover:opacity-100">
                {action.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 items-start">
        <div className="grid grid-cols-12 gap-6 col-span-12">
          <div
            className={`${!isRecording ? 'col-span-12 xl:col-span-8' : 'col-span-6'} bg-pro-surface border border-pro-border rounded-[2.5rem] p-10 flex flex-col justify-between min-h-[420px] shadow-sm relative overflow-hidden group hover:border-pro-accent/40 card-hover-effect`}
          >
            <div className="z-10 space-y-8">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-pro-bg border border-pro-border flex items-center justify-center text-xl shadow-soft group-hover:bg-pro-accent group-hover:text-white transition-all duration-700">
                  M
                </div>
                <span className="text-[10px] font-black text-pro-accent uppercase tracking-[0.2em] bg-pro-accent/5 px-3 py-1.5 rounded-full">
                  Latest Meeting Brief
                </span>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="text-2xl md:text-3xl font-black tracking-tight leading-tight">
                    {model.latestMeeting.title}
                  </h3>
                  <p className="text-[12px] text-pro-text-muted font-bold opacity-40 mt-1 uppercase tracking-widest">
                    {model.latestMeeting.state === 'populated'
                      ? model.latestMeeting.occurredAt
                      : 'No meeting memory yet'}
                  </p>
                </div>
                <div className="p-6 bg-pro-bg/50 rounded-3xl border border-pro-border/40 space-y-4">
                  <p className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-[.2em]">
                    Brief
                  </p>
                  <p className="text-[14px] font-bold text-pro-text-main leading-relaxed italic line-height-extra">
                    {model.latestMeeting.detail}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-3 relative z-10 pt-8">
              <button
                type="button"
                disabled={model.latestMeeting.state !== 'populated'}
                onClick={() => {
                  if (model.latestMeeting.state === 'populated') {
                    setSelectedMeetingId(model.latestMeeting.meetingId);
                  }
                }}
                className="flex-1 py-4 rounded-xl bg-[#1E1F24] text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl hover:bg-pro-accent transition-all active-push disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#1E1F24]"
              >
                Open Brief
              </button>
              <button
                type="button"
                disabled={model.latestMeeting.state !== 'populated'}
                onClick={() => {
                  if (model.latestMeeting.state === 'populated') {
                    setSelectedMeetingId(model.latestMeeting.meetingId);
                  }
                }}
                className="w-14 h-14 rounded-xl bg-pro-surface border border-pro-border flex items-center justify-center hover:bg-pro-bg transition-all active-push shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-xs font-black">GO</span>
              </button>
            </div>
            <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-pro-accent/5 rounded-full blur-[100px] group-hover:bg-pro-accent/10 transition-colors pointer-events-none" />
          </div>

          <div
            className={`${!isRecording ? 'col-span-12 xl:col-span-4' : 'col-span-6'} glass-card border border-pro-border rounded-[2.5rem] p-10 min-h-[420px] shadow-sm flex flex-col space-y-8 card-hover-effect overflow-hidden relative`}
          >
            <div className="flex items-center justify-between relative z-10">
              <h3 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
                Action Insights
              </h3>
              <button
                type="button"
                className="h-8 px-4 rounded-lg bg-pro-bg border border-pro-border text-[9px] font-black text-pro-accent uppercase tracking-widest hover:bg-pro-accent hover:text-white transition-all active-push shadow-sm"
                onClick={() => setActiveTab('projects')}
              >
                View all
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-2 custom-scrollbar relative z-10">
              {model.actionInsights.state === 'empty' ? (
                <div className="h-full min-h-[220px] flex flex-col justify-center rounded-3xl border border-dashed border-pro-border bg-pro-bg/40 p-6 text-center">
                  <p className="text-[13px] font-black text-pro-text-main uppercase tracking-widest">
                    No open action signals
                  </p>
                  <p className="mt-3 text-[11px] font-bold text-pro-text-muted/50 leading-relaxed">
                    Tasks from meetings and project memory will appear here when
                    Pluto finds something that needs attention.
                  </p>
                </div>
              ) : (
                model.actionInsights.items.map((item) => {
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
                      className={`group/item w-full text-left p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-4 ${isDone ? 'bg-pro-success/5 border-pro-success/20 opacity-60 scale-[0.98] success-ring' : 'hover:border-pro-border/20 hover:bg-pro-surface border-transparent'}`}
                    >
                      <div
                        className={`w-6 h-6 rounded-lg border-2 mt-0.5 flex items-center justify-center transition-all ${isDone ? 'bg-pro-success border-pro-success' : 'border-pro-border group-hover/item:border-pro-accent'}`}
                      >
                        {isDone && (
                          <span className="text-white text-[10px]">✓</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <span
                            className={`text-[13px] font-bold leading-tight truncate transition-all ${isDone ? 'line-through text-pro-text-muted' : 'text-pro-text-main'}`}
                          >
                            {item.title}
                          </span>
                          {!isDone && (
                            <div
                              className={`w-2 h-2 rounded-full mt-1.5 shrink-0 shadow-sm ${item.status === 'overdue' ? 'bg-pro-urgent pulse-urgent' : item.status === 'stale' ? 'bg-pro-warning' : 'bg-pro-accent/20'}`}
                            />
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[9px] font-bold text-pro-text-muted/30 uppercase tracking-widest">
                            {item.dueLabel}
                          </span>
                          <span className="text-[9px] font-bold text-pro-accent/40 uppercase tracking-widest truncate">
                            {item.sourceLabel}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-pro-urgent/5 rounded-full blur-3xl pointer-events-none" />
          </div>
        </div>

        {model.spotlight && (
          <div className="col-span-12 bg-pro-bg border border-pro-border rounded-[2.5rem] p-10 relative overflow-hidden group hover:border-pro-accent/40 card-hover-effect">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-pro-accent/5 rounded-full blur-[120px] -mr-40 -mt-40 pointer-events-none opacity-50" />
            <div className="absolute -left-20 -bottom-20 w-80 h-80 bg-pro-success/5 rounded-full blur-[100px] pointer-events-none" />

            <div className="flex xl:hidden flex-col justify-between h-full relative z-10 gap-8">
              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-2xl bg-pro-surface border border-pro-border flex items-center justify-center text-xl font-black shadow-soft">
                    S
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                      Contextual Spotlight
                    </span>
                    <div className="w-1.5 h-1.5 rounded-full bg-pro-success shadow-status-ok" />
                  </div>
                </div>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-3xl font-black tracking-tighter leading-none mb-2 uppercase text-pro-text-main">
                      {model.spotlight.title}
                    </h4>
                    <p className="text-[11px] font-bold text-pro-accent uppercase tracking-[.25em]">
                      {model.spotlight.subtitle}
                    </p>
                  </div>
                  <div className="p-8 bg-pro-bg/50 rounded-3xl border border-pro-border/40 space-y-6">
                    <div className="flex items-center justify-between border-b border-pro-border/20 pb-4">
                      <span className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-widest">
                        Smart Insight
                      </span>
                      <span className="text-[9px] font-black text-pro-accent uppercase tracking-widest">
                        Project Signal
                      </span>
                    </div>
                    <p className="text-[16px] font-medium text-pro-text-main leading-relaxed italic">
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
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-4 mt-auto">
                <button
                  type="button"
                  onClick={openSpotlightTarget}
                  className="flex-1 py-4 rounded-xl bg-pro-surface border border-pro-border text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] shadow-soft hover:bg-pro-bg transition-all active-push"
                >
                  Open Spotlight
                </button>
                <button
                  type="button"
                  onClick={() => setAskPlutoVisible(true)}
                  className="flex-1 py-4 rounded-xl bg-white dark:bg-pro-surface text-pro-text-main dark:text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] shadow-premium hover:bg-white/90 dark:hover:bg-pro-surface/80 transition-all active-push border border-pro-border/40 dark:border-pro-border/50"
                >
                  Ask Pluto
                </button>
              </div>
            </div>

            <div className="hidden xl:flex relative z-10 w-full h-full items-center justify-between gap-12">
              <div className="flex flex-col gap-6 w-[280px] shrink-0">
                <span className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] px-1">
                  Contextual Spotlight
                </span>
                <div className="flex items-center gap-6">
                  <div className="w-24 h-24 rounded-[1.5rem] bg-pro-surface border border-pro-border/10 flex items-center justify-center text-pro-accent shadow-sm relative overflow-hidden group-hover:scale-105 transition-transform duration-500 shrink-0">
                    <span className="text-4xl font-black">
                      {model.spotlight.title.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <h4 className="text-2xl font-black text-pro-text-main tracking-tight uppercase leading-none break-words">
                      {model.spotlight.title}
                    </h4>
                    <p className="text-[10px] font-bold text-pro-accent uppercase tracking-[0.25em] leading-relaxed">
                      {model.spotlight.subtitle}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 bg-pro-bg rounded-[2.5rem] border border-pro-border/10 p-8 space-y-6 self-stretch flex flex-col justify-center max-w-2xl shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                    Smart Insight
                  </span>
                  <span className="text-[9px] font-black text-pro-accent uppercase tracking-[0.2em]">
                    Project Signal
                  </span>
                </div>
                <p className="text-[13px] font-bold text-pro-text-main/80 leading-relaxed italic">
                  {model.spotlight.detail}
                </p>
                <div className="flex gap-2">
                  {model.spotlight.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1.5 bg-pro-surface border border-pro-border/10 rounded-lg text-[9px] font-bold text-pro-text-muted uppercase tracking-wider shadow-sm"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-4 w-[200px] shrink-0">
                <button
                  type="button"
                  onClick={openSpotlightTarget}
                  className="w-full py-4 rounded-xl bg-pro-surface border border-pro-border/10 text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] shadow-sm hover:bg-pro-bg transition-all active-push"
                >
                  Open Spotlight
                </button>
                <button
                  type="button"
                  onClick={() => setAskPlutoVisible(true)}
                  className="w-full py-4 rounded-xl bg-white dark:bg-pro-surface text-pro-text-main dark:text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] shadow-premium hover:bg-white/90 dark:hover:bg-pro-surface/80 transition-all active-push border border-pro-border/40 dark:border-pro-border/50"
                >
                  Ask Pluto
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-8">
        <div className="flex items-center justify-between border-b border-pro-border/40 pb-6">
          <h2 className="text-xl font-black tracking-tight">
            Live Intelligence Documents
          </h2>
          <button
            type="button"
            className="text-[10px] font-black text-pro-accent uppercase tracking-[0.15em] hover:underline"
            onClick={() => setActiveTab('wiki')}
          >
            Library Hub
          </button>
        </div>
        {model.knowledgeDocuments.state === 'empty' ? (
          <div className="rounded-[2rem] border border-dashed border-pro-border bg-pro-surface/60 p-10 text-center">
            <p className="text-[13px] font-black text-pro-text-main uppercase tracking-widest">
              No live documents yet
            </p>
            <p className="mt-3 text-[12px] font-bold text-pro-text-muted/50">
              Knowledge documents will appear here after Pluto synthesizes
              workspace memory.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {model.knowledgeDocuments.cards.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setActiveTab('wiki')}
                className="text-left glass-card border border-pro-border rounded-[2rem] p-8 space-y-6 hover:border-pro-accent/40 transition-all group card-hover-effect"
              >
                <div className="w-12 h-12 rounded-2xl bg-pro-surface border border-pro-border flex items-center justify-center text-lg font-black group-hover:scale-110 transition-transform shadow-soft">
                  {getDocumentScopeIcon(item.scopeType)}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[14px] font-black tracking-tight leading-loose uppercase break-words line-clamp-2">
                      {item.title}
                    </h4>
                  </div>
                  <p className="text-[11px] text-pro-text-muted font-bold leading-relaxed opacity-60 line-clamp-2">
                    {item.description}
                  </p>
                </div>
                <div className="pt-4 border-t border-pro-border/10 flex items-center justify-between">
                  <span className="text-[9px] font-black text-pro-accent uppercase tracking-widest">
                    {item.countLabel}
                  </span>
                  <span className="text-pro-text-muted/40 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

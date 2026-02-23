interface DashboardProps {
  intelligence: any;
  isRecording: boolean;
  setSelectedMeetingId: (id: any) => void;
  setActiveTab: (tab: any) => void;
  completedTasks: Set<string>;
  handleCompleteTask: (id: string) => void;
}

export const Dashboard = ({
  intelligence,
  isRecording,
  setSelectedMeetingId,
  setActiveTab,
  completedTasks,
  handleCompleteTask,
}: DashboardProps) => {
  return (
    <div className="max-w-5xl mx-auto w-full space-y-16 animate-in relative pb-32">
      {/* Phase 1: Dynamic Hero Section */}
      <div className="space-y-10 relative">
        <div className="space-y-4 max-w-2xl">
          <p className="text-[10px] font-black text-pro-accent uppercase tracking-[0.3em] mb-2">
            Pluto Intelligence
          </p>
          <h1 className="text-4xl font-black heading-premium tracking-tight text-pro-text-main leading-tight">
            {intelligence.greeting}
          </h1>
          <p className="text-xl text-pro-text-muted font-medium leading-relaxed">
            {intelligence.type === 'default'
              ? "You're all caught up."
              : intelligence.detail}
          </p>
          {intelligence.actionLabel && (
            <div className="pt-4 flex items-center gap-4">
              <button
                onClick={() =>
                  intelligence.meetingId &&
                  setSelectedMeetingId(intelligence.meetingId)
                }
                className="px-8 py-4 rounded-2xl bg-pro-text-main text-white font-black text-[11px] uppercase tracking-[.15em] shadow-premium hover:bg-pro-accent hover:scale-[1.02] transition-all active-push"
              >
                {intelligence.actionLabel}
              </button>
              <button className="px-6 py-4 rounded-2xl bg-white border border-pro-border text-pro-text-muted font-black text-[11px] uppercase tracking-[.15em] hover:bg-pro-bg transition-all active-push">
                Ignore for now
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2.5">
          {[
            {
              label: 'Summarize week',
              icon: '✨',
              active: intelligence.type === 'default',
            },
            { label: 'Check focus areas', icon: '🎯', active: false },
            { label: 'Prepare standup', icon: '🚀', active: true },
            { label: 'Ask Pluto...', icon: '🧠', active: false },
          ]
            .filter((cta) => cta.active || intelligence.type === 'default')
            .slice(0, 3)
            .map((action, i) => (
              <button
                key={i}
                className="px-5 py-2.5 rounded-full bg-white border border-pro-border shadow-sm hover:border-pro-accent/40 hover:scale-[1.02] transition-all active-push flex items-center gap-2 group"
              >
                <span className="text-sm group-hover:scale-110 transition-transform">
                  {action.icon}
                </span>
                <span className="text-[10px] font-black uppercase tracking-widest text-pro-text-main opacity-60 group-hover:opacity-100">
                  {action.label}
                </span>
              </button>
            ))}
        </div>
      </div>

      {/* Phase 2: Priority Card System */}
      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Main Intelligence Grid */}
        <div className="grid grid-cols-12 gap-6 col-span-12">
          {/* Next Meeting Intelligence - SECONDARY (or HERO if no recording) */}
          <div
            className={`${!isRecording ? 'col-span-12 xl:col-span-8' : 'col-span-6'} bg-white border border-pro-border rounded-[2.5rem] p-10 flex flex-col justify-between min-h-[420px] shadow-sm relative overflow-hidden group hover:border-pro-accent/40 card-hover-effect`}
          >
            <div className="z-10 space-y-8">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-pro-bg border border-pro-border flex items-center justify-center text-xl shadow-soft group-hover:bg-pro-accent group-hover:text-white transition-all duration-700">
                  📅
                </div>
                <span className="text-[10px] font-black text-pro-accent uppercase tracking-[0.2em] bg-pro-accent/5 px-3 py-1.5 rounded-full">
                  Coming Up Next
                </span>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="text-2xl md:text-3xl font-black tracking-tight leading-tight">
                    Product Alignment
                  </h3>
                  <p className="text-[12px] text-pro-text-muted font-bold opacity-40 mt-1 uppercase tracking-widest">
                    With Sarah Chen, Dave Miller + 2 others
                  </p>
                </div>
                <div className="p-6 bg-pro-bg/50 rounded-3xl border border-pro-border/40 space-y-4">
                  <p className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-[.2em]">
                    Last discussed (Jan 28)
                  </p>
                  <p className="text-[14px] font-bold text-pro-text-main leading-relaxed italic line-height-extra">
                    "We need to finalize the schema for the knowledge graph
                    before Friday's demo."
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-3 relative z-10 pt-8">
              <button className="flex-1 py-4 rounded-xl bg-[#1E1F24] text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl hover:bg-pro-accent transition-all active-push">
                Prep Intel Card
              </button>
              <button className="w-14 h-14 rounded-xl bg-white border border-pro-border flex items-center justify-center hover:bg-pro-bg transition-all active-push shadow-sm">
                🔗
              </button>
            </div>
            <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-pro-accent/5 rounded-full blur-[100px] group-hover:bg-pro-accent/10 transition-colors pointer-events-none" />
          </div>

          {/* Overdue / Pending Items - SECONDARY */}
          <div
            className={`${!isRecording ? 'col-span-12 xl:col-span-4' : 'col-span-6'} glass-card border border-pro-border rounded-[2.5rem] p-10 min-h-[420px] shadow-sm flex flex-col space-y-8 card-hover-effect overflow-hidden relative`}
          >
            <div className="flex items-center justify-between relative z-10">
              <h3 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
                ⚠️ Action Insights
              </h3>
              <button
                className="h-8 px-4 rounded-lg bg-pro-bg border border-pro-border text-[9px] font-black text-pro-accent uppercase tracking-widest hover:bg-pro-accent hover:text-white transition-all active-push shadow-sm"
                onClick={() => setActiveTab('tasks')}
              >
                View all
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-2 custom-scrollbar relative z-10">
              {[
                {
                  id: 't1',
                  task: 'Finalize Schema',
                  due: 'Yesterday',
                  status: 'overdue',
                  source: 'Project Alignment',
                },
                {
                  id: 't2',
                  task: 'API migration doc',
                  due: 'Today',
                  status: 'stale',
                  source: 'Team Standup',
                },
                {
                  id: 't3',
                  task: "Review Dave's PR",
                  due: 'Tomorrow',
                  status: 'active',
                  source: 'Technical Sync',
                },
              ].map((t) => {
                const isDone = completedTasks.has(t.id);
                return (
                  <div
                    key={t.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCompleteTask(t.id);
                    }}
                    className={`group/item p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-4 ${isDone ? 'bg-pro-success/5 border-pro-success/20 opacity-60 scale-[0.98] success-ring' : 'hover:border-pro-border/20 hover:bg-white border-transparent'}`}
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
                          {t.task}
                        </span>
                        {!isDone && (
                          <div
                            className={`w-2 h-2 rounded-full mt-1.5 shrink-0 shadow-sm ${t.status === 'overdue' ? 'bg-pro-urgent pulse-urgent' : t.status === 'stale' ? 'bg-pro-warning' : 'bg-pro-accent/20'}`}
                          />
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-pro-text-muted/30 uppercase tracking-widest">
                          Due {t.due}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            console.log('Snooze');
                          }}
                          className="text-[9px] font-bold text-pro-accent/40 uppercase tracking-widest opacity-0 group-hover/item:opacity-100 transition-opacity hover:text-pro-accent"
                        >
                          Snooze
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="pt-4 text-center">
                <p className="text-[10px] font-bold text-pro-text-muted/20 uppercase tracking-widest cursor-pointer hover:text-pro-text-muted/40 transition-colors">
                  + 2 more items
                </p>
              </div>
            </div>
            <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-pro-urgent/5 rounded-full blur-3xl pointer-events-none" />
          </div>
        </div>

        <div className="col-span-12 bg-pro-bg border border-pro-border rounded-[2.5rem] p-10 relative overflow-hidden group hover:border-pro-accent/40 card-hover-effect">
          {/* Background Effects (Shared) */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-pro-accent/5 rounded-full blur-[120px] -mr-40 -mt-40 pointer-events-none opacity-50" />
          <div className="absolute -left-20 -bottom-20 w-80 h-80 bg-pro-success/5 rounded-full blur-[100px] pointer-events-none" />

          {/* Layout 1: Vertical (Mobile -> Laptop) */}
          <div className="flex xl:hidden flex-col justify-between h-full relative z-10 gap-8">
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-white border border-pro-border flex items-center justify-center text-3xl shadow-soft">
                  👤
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
                    Sarah Chen
                  </h4>
                  <p className="text-[11px] font-bold text-pro-accent uppercase tracking-[.25em]">
                    Principal Engineering Lead
                  </p>
                </div>
                <div className="p-8 bg-pro-bg/50 rounded-3xl border border-pro-border/40 space-y-6">
                  <div className="flex items-center justify-between border-b border-pro-border/20 pb-4">
                    <span className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-widest">
                      Smart Insight
                    </span>
                    <span className="text-[9px] font-black text-pro-accent uppercase tracking-widest">
                      Sprint 1 Target
                    </span>
                  </div>
                  <p className="text-[16px] font-medium text-pro-text-main leading-relaxed italic">
                    "You haven't followed up on the schema design with Sarah in
                    3 days. Sarah is attending today's Product Alignment."
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {['API Migration', 'Schema Design'].map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1.5 bg-white border border-pro-border rounded-lg text-[9px] font-black text-pro-text-main/60 uppercase tracking-tight"
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
                onClick={() => setActiveTab('people')}
                className="flex-1 py-4 rounded-xl bg-white border border-pro-border text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] shadow-soft hover:bg-pro-bg transition-all active-push"
              >
                View Biography
              </button>
              <button className="flex-1 py-4 rounded-xl bg-[#2A2B32] text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-premium hover:bg-pro-accent transition-all active-push">
                Draft Follow-up
              </button>
            </div>
          </div>

          {/* Layout 2: 3-Column Specific Layout (Desktop XL+) - MATCHES USER SCREENSHOT */}
          <div className="hidden xl:flex relative z-10 w-full h-full items-center justify-between gap-12">
            {/* Left: Identity */}
            <div className="flex flex-col gap-6 w-[280px] shrink-0">
              <span className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] px-1">
                Contextual Spotlight
              </span>
              <div className="flex items-center gap-6">
                <div className="w-24 h-24 rounded-[1.5rem] bg-white border border-pro-border/10 flex items-center justify-center text-pro-accent shadow-sm relative overflow-hidden group-hover:scale-105 transition-transform duration-500 shrink-0">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-12 h-12 text-[#5E82A3]"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <h4 className="text-2xl font-black text-pro-text-main tracking-tight uppercase leading-none break-words">
                    Sarah Chen
                  </h4>
                  <p className="text-[10px] font-bold text-pro-accent uppercase tracking-[0.25em] leading-relaxed">
                    Principal Engineering Lead
                  </p>
                </div>
              </div>
            </div>

            {/* Center: Insight Card */}
            <div className="flex-1 bg-pro-bg rounded-[2.5rem] border border-pro-border/10 p-8 space-y-6 self-stretch flex flex-col justify-center max-w-2xl shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                  Smart Insight
                </span>
                <span className="text-[9px] font-black text-pro-accent uppercase tracking-[0.2em]">
                  Sprint 1 Target
                </span>
              </div>
              <p className="text-[13px] font-bold text-pro-text-main/80 leading-relaxed italic">
                "You haven't followed up on the schema design with Sarah in 3
                days. Sarah is attending today's Product Alignment."
              </p>
              <div className="flex gap-2">
                {['API Migration', 'Schema Design'].map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1.5 bg-white border border-pro-border/10 rounded-lg text-[9px] font-bold text-pro-text-muted uppercase tracking-wider shadow-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex flex-col gap-4 w-[200px] shrink-0">
              <button
                onClick={() => setActiveTab('people')}
                className="w-full py-4 rounded-xl bg-white border border-pro-border/10 text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] shadow-sm hover:bg-pro-bg transition-all active-push"
              >
                View Biography
              </button>
              <button className="w-full py-4 rounded-xl bg-[#1A1D26] text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-premium hover:bg-pro-accent transition-all active-push">
                Draft Follow-up
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        <div className="flex items-center justify-between border-b border-pro-border/40 pb-6">
          <h2 className="text-xl font-black tracking-tight">
            Live Intelligence Documents
          </h2>
          <button
            className="text-[10px] font-black text-pro-accent uppercase tracking-[0.15em] hover:underline"
            onClick={() => setActiveTab('wiki')}
          >
            Library Hub
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {[
            {
              title: 'Engineering Standups',
              desc: 'Accumulated team context across 14 sessions.',
              icon: '👥',
              count: '14 Sessions',
            },
            {
              title: 'API Migration Space',
              desc: 'Consolidated decisions and technical schema logic.',
              icon: '🏗️',
              count: '8 Decisions',
            },
            {
              title: 'Sarah Chen Dossier',
              desc: 'Recurring themes and deliverables discussed with Sarah.',
              icon: '👤',
              count: '12 Mentions',
            },
            {
              title: 'Product Roadmap',
              desc: 'Evolving vision tracked through weekly syncs.',
              icon: '🚀',
              count: '5 Key Shifts',
            },
          ].map((item, i) => (
            <button
              key={i}
              className="text-left glass-card border border-pro-border rounded-[2rem] p-8 space-y-6 hover:border-pro-accent/40 transition-all group card-hover-effect"
            >
              <div className="w-12 h-12 rounded-2xl bg-white border border-pro-border flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-soft">
                {item.icon}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[14px] font-black tracking-tight leading-loose uppercase">
                    {item.title}
                  </h4>
                </div>
                <p className="text-[11px] text-pro-text-muted font-bold leading-relaxed opacity-60 line-clamp-2">
                  {item.desc}
                </p>
              </div>
              <div className="pt-4 border-t border-pro-border/10 flex items-center justify-between">
                <span className="text-[9px] font-black text-pro-accent uppercase tracking-widest">
                  {item.count}
                </span>
                <span className="text-pro-text-muted/40 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                  →
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

import { Logo } from '../Brand/Logo';
import { Meeting } from '../../types'; // I'll create this type file if it doesn't exist, or just define it here for now

interface SidebarProps {
  sidebarVisible: boolean;
  activeTab: string;
  setActiveTab: (tab: any) => void;
  selectedMeetingId: string | number | null;
  setSelectedMeetingId: (id: any) => void;
  safeMeetings: Meeting[];
  onStartRecording: () => void;
  handleDeleteMeeting: (id: string | number) => void;
  setSettingsVisible: (visible: boolean) => void;
}

export const Sidebar = ({
  sidebarVisible,
  activeTab,
  setActiveTab,
  selectedMeetingId,
  setSelectedMeetingId,
  safeMeetings,
  onStartRecording,
  handleDeleteMeeting,
  setSettingsVisible,
}: SidebarProps) => {
  return (
    <aside
      className={`
                app-sidebar w-[85vw] md:w-80 bg-pro-bg/95 backdrop-blur-xl border-r border-pro-border flex flex-col shrink-0 absolute lg:relative h-full z-40 transition-transform duration-300 ease-in-out shadow-2xl lg:shadow-none
                ${sidebarVisible ? 'translate-x-0' : '-translate-x-full lg:-translate-x-80'}
                ${sidebarVisible ? '' : 'lg:-mr-80'}
            `}
    >
      <div className="p-9 pb-8 flex items-center">
        <Logo size={40} showText variant="default" />
      </div>

      {/* Simplified Meeting Widget */}
      <div className="px-6 pb-6 pt-2">
        <div className="relative group">
          <div className="relative overflow-hidden rounded-2xl bg-white border border-pro-border shadow-sm p-5 flex flex-col items-center text-center gap-4 transition-all duration-300 hover:shadow-md hover:border-pro-accent/20">
            <div className="space-y-1">
              <h3 className="text-[15px] font-bold text-pro-text-main tracking-tight">
                New Meeting
              </h3>
              <p className="text-[11px] text-pro-text-muted font-medium px-2 leading-normal opacity-70">
                Capture every detail, effortlessly.
              </p>
            </div>

            <button
              onClick={onStartRecording}
              className="w-full h-10 rounded-xl bg-pro-text-main text-white text-[12px] font-bold hover:bg-pro-accent transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <span>Start Recording</span>
            </button>

            <div className="flex items-center gap-1.5 opacity-20 group-hover:opacity-40 transition-opacity">
              <span className="text-[9px] font-bold text-pro-text-muted uppercase tracking-widest flex items-center gap-1">
                <kbd className="font-sans">Cmd</kbd>
                <span className="w-0.5 h-0.5 rounded-full bg-stone-300" />
                <kbd className="font-sans">N</kbd>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-10 custom-scrollbar sidebar-mask">
        {/* Workspace Section */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-4 mb-3">
            <h3 className="text-[10px] font-bold text-pro-text-muted/50 uppercase tracking-[0.15em]">
              Overview
            </h3>
          </div>
          <button
            onClick={() => {
              setActiveTab('hub');
              setSelectedMeetingId(null);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group relative ${activeTab === 'hub' && !selectedMeetingId ? 'bg-pro-text-main text-white shadow-premium' : 'text-pro-text-muted hover:bg-pro-text-main/5 hover:text-pro-text-main'}`}
          >
            <span
              className={`text-base transition-transform group-hover:scale-110 ${activeTab === 'hub' && !selectedMeetingId ? 'opacity-100' : 'opacity-60'}`}
            >
              🏠
            </span>
            <span className="text-[13px] font-bold tracking-tight">
              Dashboard
            </span>
            {activeTab === 'hub' && !selectedMeetingId && (
              <div className="absolute left-[-12px] w-1 h-5 bg-pro-accent rounded-full" />
            )}
          </button>
          <button
            onClick={() => {
              setActiveTab('tasks');
              setSelectedMeetingId(null);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group relative ${activeTab === 'tasks' ? 'bg-pro-text-main text-white shadow-premium' : 'text-pro-text-muted hover:bg-pro-text-main/5 hover:text-pro-text-main'}`}
          >
            <span
              className={`text-base transition-transform group-hover:scale-110 ${activeTab === 'tasks' ? 'opacity-100' : 'opacity-60'}`}
            >
              ✅
            </span>
            <span className="text-[13px] font-bold tracking-tight">
              Action Items
            </span>
            {activeTab === 'tasks' && (
              <div className="absolute left-[-12px] w-1 h-5 bg-pro-accent rounded-full" />
            )}
          </button>
        </div>

        {/* Second Brain Section */}
        <div className="space-y-1 pt-4">
          <h3 className="px-4 text-[10px] font-bold text-pro-text-muted/30 uppercase tracking-[0.2em] mb-3">
            Library
          </h3>
          {[
            { id: 'projects', name: 'Projects', icon: '📁' },
            { id: 'people', name: 'People', icon: '👤' },
            { id: 'wiki', name: 'Knowledge', icon: '🧠' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id as any);
                setSelectedMeetingId(null);
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group relative ${activeTab === item.id && !selectedMeetingId ? 'bg-pro-text-main text-white shadow-premium' : 'text-pro-text-muted hover:bg-pro-text-main/5 hover:text-pro-text-main'}`}
            >
              <span
                className={`text-base transition-transform group-hover:scale-110 ${activeTab === item.id && !selectedMeetingId ? 'opacity-100' : 'opacity-60'}`}
              >
                {item.icon}
              </span>
              <span className="text-[13px] font-bold tracking-tight">
                {item.name}
              </span>
              {activeTab === item.id && !selectedMeetingId && (
                <div className="absolute left-[-12px] w-1 h-5 bg-pro-accent rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Archive Section */}
        <div className="space-y-1 pt-2">
          <div className="flex items-center justify-between px-4 mb-3">
            <h3 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
              Timeline
            </h3>
            <div className="w-1.5 h-1.5 rounded-full bg-pro-accent shadow-status-ok" />
          </div>
          <div className="space-y-1.5">
            {safeMeetings.slice(0, 10).map((m, i) => (
              <div key={m.id} className="relative group">
                <button
                  onClick={() => {
                    setSelectedMeetingId(m.id);
                    setActiveTab('hub');
                  }}
                  className={`
                                        w-full text-left px-4 py-3 rounded-xl transition-all border duration-300 relative
                                        ${
                                          selectedMeetingId === m.id
                                            ? 'bg-white border-pro-border shadow-premium'
                                            : 'border-transparent hover:bg-white/40 hover-lift'
                                        }
                                    `}
                >
                  <div className="flex items-center justify-between gap-3 pr-6">
                    <span
                      className={`text-[12px] font-bold block truncate ${selectedMeetingId === m.id ? 'text-pro-text-main' : 'text-pro-text-muted/70 group-hover:text-pro-text-main'}`}
                    >
                      {m.title || 'Untitled Session'}
                    </span>
                    {i === 0 && (
                      <span
                        className="recency-dot w-1.5 h-1.5 rounded-full bg-pro-accent shrink-0 shadow-status-ok"
                        title="Most Recent"
                      />
                    )}
                  </div>
                  <span className="text-[9px] font-black text-pro-text-muted/30 uppercase tracking-widest mt-1 block px-[1px]">
                    {new Date(
                      m.created_at || m.started_at || Date.now(),
                    ).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteMeeting(m.id);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-red-500/0 hover:bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center z-30"
                  title="Delete Session"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-8 border-t border-pro-border/20 flex flex-col gap-4">
        <button
          onClick={() => setSettingsVisible(true)}
          className="flex items-center gap-3 text-[11px] font-semibold text-pro-text-muted hover:text-pro-accent transition-all active-push group"
        >
          <div className="w-8 h-8 rounded-lg bg-white border border-pro-border/40 flex items-center justify-center text-sm group-hover:bg-pro-bg transition-colors shadow-sm">
            ⚙️
          </div>
          <span className="uppercase tracking-widest">Settings</span>
        </button>
        <div className="flex items-center gap-2 px-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] shadow-[0_0_12px_rgba(16,185,129,0.3)]" />
          <span className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest leading-none">
            Safe to Record
          </span>
        </div>
      </div>
    </aside>
  );
};

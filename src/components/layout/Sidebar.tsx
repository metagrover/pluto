import { Search } from 'lucide-react';
import type { Meeting } from '../../types'; // I'll create this type file if it doesn't exist, or just define it here for now
import { canDeleteMeeting } from '../../utils/recordingFinalization';
import { Logo } from '../Brand/Logo';

type ActiveTab = 'hub' | 'people' | 'projects' | 'wiki';

interface SidebarProps {
  sidebarVisible: boolean;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  selectedMeetingId: string | number | null;
  setSelectedMeetingId: (id: string | number | null) => void;
  safeMeetings: Meeting[];
  onStartRecording: () => void;
  onOpenSearch: () => void;
  handleDeleteMeeting: (id: string | number) => void;
  setSettingsVisible: (visible: boolean) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const Sidebar = ({
  sidebarVisible,
  activeTab,
  setActiveTab,
  selectedMeetingId,
  setSelectedMeetingId,
  safeMeetings,
  onStartRecording,
  onOpenSearch,
  handleDeleteMeeting,
  setSettingsVisible,
  theme,
  setTheme,
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

      <div className="px-6 pb-4 pt-1 space-y-3">
        <button
          type="button"
          data-sidebar-search
          onClick={onOpenSearch}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-pro-border/70 bg-pro-surface/35 px-4 text-pro-text-muted shadow-sm transition-all hover:border-pro-border hover:bg-pro-surface/60 hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
        >
          <Search aria-hidden="true" size={18} className="shrink-0" />
          <span className="flex-1 text-left text-[14px] font-bold tracking-tight">
            Search
          </span>
          <kbd className="font-sans text-[12px] font-bold text-pro-text-muted/60">
            ⌘P
          </kbd>
        </button>
        <button
          type="button"
          onClick={onStartRecording}
          className="flex min-h-11 w-full items-center justify-between rounded-xl bg-pro-accent px-4 text-[#1A2340] shadow-sm transition-colors hover:bg-pro-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent dark:bg-white dark:text-[#161A23] dark:hover:bg-white/90"
        >
          <span className="flex items-center gap-2 text-[12px] font-black">
            <span aria-hidden="true" className="text-[13px]">
              ●
            </span>
            Start recording
          </span>
          <kbd className="font-sans text-[9px] font-bold opacity-45">⌘ N</kbd>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-6 space-y-10 custom-scrollbar sidebar-mask no-drag">
        {/* Workspace Section */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-4 mb-3">
            <h3 className="text-[10px] font-bold text-pro-text-muted/50 uppercase tracking-[0.15em]">
              Overview
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveTab('hub');
              setSelectedMeetingId(null);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group relative ${activeTab === 'hub' && !selectedMeetingId ? 'bg-pro-surface text-pro-text-main shadow-premium border border-pro-border/50' : 'text-pro-text-muted hover:bg-pro-surface/50 hover:text-pro-text-main border border-transparent'}`}
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
        </div>

        {/* Execution Section */}
        <div className="space-y-1 pt-4">
          <h3 className="px-4 text-[10px] font-bold text-pro-text-muted/30 uppercase tracking-[0.2em] mb-3">
            Execution
          </h3>
          <button
            type="button"
            onClick={() => {
              setActiveTab('projects');
              setSelectedMeetingId(null);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group relative ${activeTab === 'projects' && !selectedMeetingId ? 'bg-pro-surface text-pro-text-main shadow-premium border border-pro-border/50' : 'text-pro-text-muted hover:bg-pro-surface/50 hover:text-pro-text-main border border-transparent'}`}
          >
            <span
              className={`text-base transition-transform group-hover:scale-110 ${activeTab === 'projects' && !selectedMeetingId ? 'opacity-100' : 'opacity-60'}`}
            >
              📁
            </span>
            <span className="text-[13px] font-bold tracking-tight">
              Projects
            </span>
            {activeTab === 'projects' && !selectedMeetingId && (
              <div className="absolute left-[-12px] w-1 h-5 bg-pro-accent rounded-full" />
            )}
          </button>
        </div>

        {/* Intelligence Section */}
        <div className="space-y-1 pt-4">
          <h3 className="px-4 text-[10px] font-bold text-pro-text-muted/30 uppercase tracking-[0.2em] mb-3">
            Intelligence
          </h3>
          {(
            [
              { id: 'wiki', name: 'Knowledge', icon: '🧠' },
              { id: 'people', name: 'People', icon: '👤' },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setSelectedMeetingId(null);
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group relative ${activeTab === item.id && !selectedMeetingId ? 'bg-pro-surface text-pro-text-main shadow-premium border border-pro-border/50' : 'text-pro-text-muted hover:bg-pro-surface/50 hover:text-pro-text-main border border-transparent'}`}
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
                  type="button"
                  onClick={() => {
                    setSelectedMeetingId(m.id);
                    setActiveTab('hub');
                  }}
                  className={`
                                        w-full text-left px-4 py-3 rounded-xl transition-all border duration-300 relative
                                        ${
                                          selectedMeetingId === m.id
                                            ? 'bg-pro-surface border-pro-border shadow-premium'
                                            : 'border-transparent hover:bg-pro-surface/40 hover-lift'
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
                {canDeleteMeeting(m.finalization_status) ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteMeeting(m.id);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-red-500/0 hover:bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center z-30"
                    title="Delete Session"
                  >
                    <svg
                      aria-hidden="true"
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
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-8 border-t border-pro-border/20 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSettingsVisible(true)}
            className="flex-1 flex items-center gap-3 text-[11px] font-semibold text-pro-text-muted hover:text-pro-accent transition-all active-push group"
          >
            <div className="w-8 h-8 rounded-lg bg-pro-surface border border-pro-border/40 flex items-center justify-center text-sm group-hover:bg-pro-bg transition-colors shadow-sm bg-transparent dark:bg-pro-surface/5">
              ⚙️
            </div>
            <span className="uppercase tracking-widest">Settings</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setTheme(
                theme === 'dark'
                  ? 'light'
                  : theme === 'light'
                    ? 'system'
                    : 'dark',
              )
            }
            className="w-8 h-8 rounded-lg bg-pro-surface border border-pro-border/40 flex items-center justify-center text-sm hover:bg-pro-bg transition-colors shadow-sm text-pro-text-muted hover:text-pro-accent active-push bg-transparent dark:bg-pro-surface/5"
            title={`Theme: ${theme}`}
          >
            {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '💻'}
          </button>
        </div>
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

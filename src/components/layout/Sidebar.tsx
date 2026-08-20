import {
  BookText,
  CheckCircle2,
  Clock,
  FolderKanban,
  Home,
  Library,
  Monitor,
  Moon,
  PlusCircle,
  Search,
  Settings,
  Sun,
  Trash2,
  Users,
} from 'lucide-react';
import type { Meeting } from '../../types';
import { canDeleteMeeting } from '../../utils/recordingFinalization';

type ActiveTab = 'hub' | 'people' | 'projects' | 'wiki' | 'meetings';

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
                app-sidebar w-[85vw] md:w-[260px] bg-pro-surface border-r border-pro-border flex flex-col shrink-0 absolute lg:relative h-full z-40 transition-transform duration-300 ease-in-out shadow-2xl lg:shadow-none
                ${sidebarVisible ? 'translate-x-0' : '-translate-x-full lg:-translate-x-[260px]'}
                ${sidebarVisible ? '' : 'lg:-mr-[260px]'}
            `}
    >
      <div className="pt-4 pb-2 px-4 flex items-center">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white cursor-pointer transition-colors w-full">
          <div className="w-[22px] h-[22px] rounded-[4px] bg-pro-text-main text-pro-surface flex items-center justify-center font-bold text-xs">
            P
          </div>
          <span className="text-[14px] font-medium text-pro-text-main truncate">
            Pluto Workspace
          </span>
        </div>
      </div>

      <div className="px-3 pb-3 space-y-0.5">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex min-h-[30px] w-full items-center gap-2 rounded-md px-3 text-pro-text-muted hover:bg-black/5 dark:hover:bg-white transition-colors focus-visible:outline-none group"
        >
          <Search aria-hidden="true" size={16} className="shrink-0" />
          <span className="flex-1 text-left text-[14px] font-medium">
            Search
          </span>
          <kbd className="font-sans text-[11px] font-medium text-pro-text-muted/60 opacity-0 group-hover:opacity-100 transition-opacity">
            ⌘P
          </kbd>
        </button>
        <button
          type="button"
          onClick={() => setSettingsVisible(true)}
          className="flex min-h-[30px] w-full items-center gap-2 rounded-md px-3 text-pro-text-muted hover:bg-black/5 dark:hover:bg-white transition-colors focus-visible:outline-none"
        >
          <Settings aria-hidden="true" size={16} className="shrink-0" />
          <span className="flex-1 text-left text-[14px] font-medium">
            Settings & members
          </span>
        </button>
        <button
          type="button"
          onClick={onStartRecording}
          className="flex min-h-[30px] w-full items-center gap-2 rounded-md px-3 text-pro-text-muted hover:bg-black/5 dark:hover:bg-white transition-colors focus-visible:outline-none group"
        >
          <PlusCircle
            aria-hidden="true"
            size={16}
            className="shrink-0 group-hover:text-pro-accent transition-colors"
          />
          <span className="flex-1 text-left text-[14px] font-medium">
            New meeting
          </span>
          <kbd className="font-sans text-[11px] font-medium text-pro-text-muted/60 opacity-0 group-hover:opacity-100 transition-opacity">
            ⌘N
          </kbd>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-6 custom-scrollbar">
        {/* Overview Section */}
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab('hub');
              setSelectedMeetingId(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${activeTab === 'hub' && !selectedMeetingId ? 'bg-black/5 dark:bg-white text-pro-text-main font-medium' : 'text-pro-text-muted hover:bg-black/5 dark:hover:bg-white font-medium'}`}
          >
            <Home
              size={16}
              className={
                activeTab === 'hub' && !selectedMeetingId
                  ? 'text-pro-text-main'
                  : ''
              }
            />
            <span className="text-[14px]">Dashboard</span>
          </button>
        </div>

        {/* Execution Section */}
        <div className="space-y-0.5">
          <h3 className="px-3 text-[11px] font-semibold text-pro-text-muted/70 hover:text-pro-text-muted cursor-default mb-1 transition-colors">
            Execution
          </h3>
          <button
            type="button"
            onClick={() => {
              setActiveTab('projects');
              setSelectedMeetingId(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${activeTab === 'projects' && !selectedMeetingId ? 'bg-black/5 dark:bg-white text-pro-text-main font-medium' : 'text-pro-text-muted hover:bg-black/5 dark:hover:bg-white font-medium'}`}
          >
            <FolderKanban
              size={16}
              className={
                activeTab === 'projects' && !selectedMeetingId
                  ? 'text-pro-text-main'
                  : ''
              }
            />
            <span className="text-[14px]">Projects</span>
          </button>
        </div>

        {/* Intelligence Section */}
        <div className="space-y-0.5">
          <h3 className="px-3 text-[11px] font-semibold text-pro-text-muted/70 hover:text-pro-text-muted cursor-default mb-1 transition-colors">
            Intelligence
          </h3>
          {(
            [
              { id: 'wiki', name: 'Knowledge', icon: BookText },
              { id: 'people', name: 'People', icon: Users },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setSelectedMeetingId(null);
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${activeTab === item.id && !selectedMeetingId ? 'bg-black/5 dark:bg-white text-pro-text-main font-medium' : 'text-pro-text-muted hover:bg-black/5 dark:hover:bg-white font-medium'}`}
            >
              <item.icon
                size={16}
                className={
                  activeTab === item.id && !selectedMeetingId
                    ? 'text-pro-text-main'
                    : ''
                }
              />
              <span className="text-[14px]">{item.name}</span>
            </button>
          ))}
        </div>

        {/* All Meetings Section */}
        <div className="space-y-0.5">
          <h3 className="px-3 text-[11px] font-semibold text-pro-text-muted/70 hover:text-pro-text-muted cursor-default mb-1 transition-colors">
            Meetings
          </h3>
          <button
            type="button"
            onClick={() => {
              setActiveTab('meetings');
              setSelectedMeetingId(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${activeTab === 'meetings' && !selectedMeetingId ? 'bg-black/5 dark:bg-white text-pro-text-main font-medium' : 'text-pro-text-muted hover:bg-black/5 dark:hover:bg-white font-medium'}`}
          >
            <Library
              size={16}
              className={
                activeTab === 'meetings' && !selectedMeetingId
                  ? 'text-pro-text-main'
                  : ''
              }
            />
            <span className="text-[14px]">All meetings</span>
          </button>
        </div>

        {/* Timeline / Private Section */}
        <div className="space-y-0.5">
          <div className="flex items-center justify-between px-3 mb-1 group cursor-pointer">
            <h3 className="text-[11px] font-semibold text-pro-text-muted/70 group-hover:text-pro-text-muted transition-colors">
              Recent Private
            </h3>
            <PlusCircle
              size={14}
              className="text-pro-text-muted/0 group-hover:text-pro-text-muted/70 transition-colors"
              onClick={onStartRecording}
            />
          </div>
          <div className="space-y-0.5">
            {safeMeetings.slice(0, 5).map((m) => (
              <div key={m.id} className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMeetingId(m.id);
                    setActiveTab('hub');
                  }}
                  className={`
                                        w-full flex items-center gap-2 text-left px-3 py-[7px] rounded-md transition-colors
                                        ${
                                          selectedMeetingId === m.id
                                            ? 'bg-black/5 dark:bg-white text-pro-text-main font-medium'
                                            : 'text-pro-text-muted hover:bg-black/5 dark:hover:bg-white font-medium'
                                        }
                                    `}
                >
                  <Clock size={16} className="shrink-0 opacity-70" />
                  <span className="text-[14px] truncate flex-1 leading-5">
                    {m.title || 'Untitled'}
                  </span>
                </button>
                {canDeleteMeeting(m.finalization_status) ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteMeeting(m.id);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md hover:bg-black/10 dark:hover:bg-white text-pro-text-muted opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center z-30"
                    title="Delete Session"
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-pro-border flex items-center justify-between">
        <div className="flex items-center gap-2 group cursor-pointer">
          <CheckCircle2
            size={14}
            className="text-[#10B981] group-hover:opacity-80 transition-opacity"
          />
          <span className="text-[11px] font-medium text-pro-text-muted group-hover:text-pro-text-main transition-colors">
            Safe to record
          </span>
        </div>

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
          className="w-6 h-6 rounded-md hover:bg-black/5 dark:hover:bg-white flex items-center justify-center text-pro-text-muted transition-colors"
          title={`Theme: ${theme}`}
        >
          {theme === 'dark' ? (
            <Moon size={14} />
          ) : theme === 'light' ? (
            <Sun size={14} />
          ) : (
            <Monitor size={14} />
          )}
        </button>
      </div>
    </aside>
  );
};

import {
  FolderKanban,
  Home,
  Library,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  PlusCircle,
  Search,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import {
  type CaptureLifecycleState,
  resolveCaptureAction,
} from '../../services/captureLifecycle';
import type { Meeting } from '../../types';
import { sortMeetingsByStartTime } from '../../utils/meetingOrdering';
import { Logo } from '../Brand/Logo';
import { SidebarUpdateBadge } from './SidebarUpdateBadge';

type ActiveTab =
  | 'hub'
  | 'people'
  | 'projects'
  | 'meetings'
  | 'chat'
  | 'settings';

interface SidebarProps {
  sidebarVisible: boolean;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  selectedMeetingId: string | number | null;
  setSelectedMeetingId: (id: string | number | null) => void;
  safeMeetings: Meeting[];
  onStartRecording: () => void;
  isRecordingActive?: boolean;
  recordingState?: CaptureLifecycleState;
  onReturnToRecording?: () => void;
  onOpenSearch: () => void;
  onOpenPeopleHome: () => void;
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
  isRecordingActive = false,
  recordingState,
  onReturnToRecording,
  onOpenSearch,
  onOpenPeopleHome,
  theme,
  setTheme,
}: SidebarProps) => {
  const resolvedRecordingState =
    recordingState ?? (isRecordingActive ? 'recording' : 'idle');
  const captureAction = resolveCaptureAction({ state: resolvedRecordingState });
  const recordingBusy = captureAction.command !== 'start';
  return (
    <aside
      className={`
                app-sidebar w-[85vw] md:w-[260px] bg-pro-surface border-r border-pro-border flex flex-col shrink-0 absolute lg:relative h-full z-40 transition-transform duration-300 ease-in-out shadow-2xl lg:shadow-none
                ${sidebarVisible ? 'translate-x-0' : '-translate-x-full lg:-translate-x-[260px]'}
                ${sidebarVisible ? '' : 'lg:-mr-[260px]'}
            `}
    >
      <div className="pt-[60px] pb-6 px-6 flex items-center">
        <Logo size={24} showText />
      </div>

      <div className="px-3 pb-3 space-y-0.5">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex min-h-[30px] w-full items-center gap-2 rounded-md px-3 text-pro-text-main/70 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus-visible:outline-none group"
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
          onClick={
            captureAction.command === 'start'
              ? onStartRecording
              : captureAction.command === 'return'
                ? (onReturnToRecording ?? onStartRecording)
                : undefined
          }
          disabled={!captureAction.enabled}
          className="flex min-h-[34px] w-full items-center gap-2 rounded-lg px-3 border border-black/5 dark:border-white/10 bg-white dark:bg-white/10 hover:border-black/15 dark:hover:border-white/20 hover:shadow-[0_0_12px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_0_12px_rgba(255,255,255,0.08)] text-pro-text-main transition-all duration-300 focus-visible:outline-none group shadow-[0_1px_2px_rgba(0,0,0,0.04)] mt-1"
        >
          {recordingBusy ? (
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${
                resolvedRecordingState === 'sealing'
                  ? 'bg-pro-warning shadow-[0_0_0_3px_hsl(var(--pro-warning)/0.14)]'
                  : resolvedRecordingState === 'starting'
                    ? 'animate-pulse bg-pro-accent shadow-[0_0_0_3px_hsl(var(--pro-accent)/0.14)]'
                    : 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.14)]'
              }`}
            />
          ) : (
            <Plus
              aria-hidden="true"
              size={16}
              className="shrink-0 text-pro-text-muted group-hover:text-pro-text-main transition-colors"
            />
          )}
          <span className="flex-1 text-left text-[13px] font-medium">
            {captureAction.label}
          </span>
          {!recordingBusy && (
            <kbd className="font-sans text-[11px] font-medium text-pro-text-muted/60 opacity-0 group-hover:opacity-100 transition-opacity">
              ⌘N
            </kbd>
          )}
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
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${activeTab === 'hub' && !selectedMeetingId ? 'bg-black/5 dark:bg-white/10 text-pro-text-main font-medium' : 'text-pro-text-main/70 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 font-medium'}`}
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
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${activeTab === 'projects' && !selectedMeetingId ? 'bg-black/5 dark:bg-white/10 text-pro-text-main font-medium' : 'text-pro-text-main/70 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 font-medium'}`}
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
          <button
            type="button"
            onClick={() => {
              setActiveTab('chat');
              setSelectedMeetingId(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${activeTab === 'chat' && !selectedMeetingId ? 'bg-black/5 dark:bg-white/10 text-pro-text-main font-medium' : 'text-pro-text-main/70 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 font-medium group focus-visible:outline-none'}`}
          >
            <MessageSquare
              size={16}
              className={
                activeTab === 'chat' && !selectedMeetingId
                  ? 'text-pro-text-main shrink-0'
                  : 'text-pro-text-muted group-hover:text-pro-text-main transition-colors shrink-0'
              }
            />
            <span className="text-[14px] flex-1 text-left">
              Chat with Pluto
            </span>
            <kbd className="font-sans text-[11px] font-medium text-pro-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            onClick={onOpenPeopleHome}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${activeTab === 'people' && !selectedMeetingId ? 'bg-black/5 dark:bg-white/10 text-pro-text-main font-medium' : 'text-pro-text-main/70 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 font-medium'}`}
          >
            <Users
              size={16}
              className={
                activeTab === 'people' && !selectedMeetingId
                  ? 'text-pro-text-main'
                  : ''
              }
            />
            <span className="text-[14px]">People</span>
          </button>
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
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${activeTab === 'meetings' && !selectedMeetingId ? 'bg-black/5 dark:bg-white/10 text-pro-text-main font-medium' : 'text-pro-text-main/70 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 font-medium'}`}
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
            <h3 className="text-[11px] font-semibold text-pro-text-muted/70 group-hover:text-pro-text-main/70 hover:text-pro-text-main transition-colors">
              Recent Meetings
            </h3>
            <PlusCircle
              size={14}
              className="text-pro-text-muted/0 group-hover:text-pro-text-muted/70 transition-colors"
              onClick={onStartRecording}
            />
          </div>
          <div className="space-y-0.5">
            {sortMeetingsByStartTime(safeMeetings)
              .slice(0, 5)
              .map((m) => {
                const date = new Date(m.started_at || m.created_at);
                const now = new Date();
                const timeString = date.toLocaleTimeString(undefined, {
                  timeStyle: 'short',
                });

                let dateLabel = '';
                if (date.toDateString() === now.toDateString()) {
                  dateLabel = 'Today';
                } else {
                  const yesterday = new Date(now);
                  yesterday.setDate(yesterday.getDate() - 1);
                  if (date.toDateString() === yesterday.toDateString()) {
                    dateLabel = 'Yesterday';
                  } else {
                    const daysDiff =
                      (now.getTime() - date.getTime()) / (1000 * 3600 * 24);
                    if (daysDiff < 7) {
                      dateLabel = date.toLocaleDateString(undefined, {
                        weekday: 'short',
                      });
                    } else {
                      dateLabel = date.toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      });
                    }
                  }
                }

                return (
                  <div key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMeetingId(m.id);
                        setActiveTab('hub');
                      }}
                      className={`
                                          w-full flex flex-col items-start gap-0.5 text-left px-3 py-2 rounded-md transition-colors
                                          ${
                                            selectedMeetingId === m.id
                                              ? 'bg-black/5 dark:bg-white/10'
                                              : 'hover:bg-black/5 dark:hover:bg-white/10'
                                          }
                                      `}
                    >
                      <span
                        className={`text-[14px] truncate w-full leading-tight ${selectedMeetingId === m.id ? 'text-pro-text-main font-medium' : 'text-pro-text-main/90 hover:text-pro-text-main font-medium'}`}
                      >
                        {m.title || 'Untitled'}
                      </span>
                      <span
                        className={`text-[12px] truncate w-full leading-tight ${selectedMeetingId === m.id ? 'text-pro-text-main/70' : 'text-pro-text-muted/80'}`}
                      >
                        {dateLabel}, {timeString}
                      </span>
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <SidebarUpdateBadge />

      <div className="px-3 py-3 border-t border-pro-border flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab('settings');
            setSelectedMeetingId(null);
          }}
          className={`flex-1 flex items-center gap-2 group cursor-pointer px-2 py-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none ${activeTab === 'settings' && !selectedMeetingId ? 'bg-black/5 dark:bg-white/10 text-pro-text-main font-medium' : ''}`}
        >
          <Settings
            size={15}
            className={`${activeTab === 'settings' && !selectedMeetingId ? 'text-pro-text-main' : 'text-pro-text-main/70 group-hover:text-pro-text-main'} transition-colors shrink-0`}
          />
          <span
            className={`text-[13px] ${activeTab === 'settings' && !selectedMeetingId ? 'font-medium text-pro-text-main' : 'font-medium text-pro-text-main/70 group-hover:text-pro-text-main'} transition-colors`}
          >
            Settings
          </span>
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
          className="w-6 h-6 rounded-md hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-pro-text-main/70 hover:text-pro-text-main transition-colors"
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

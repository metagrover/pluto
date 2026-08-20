import { useState, useMemo } from 'react';
import { 
  Clock, 
  Loader2, 
  Search, 
  Trash2, 
  X, 
  ArrowUpDown,
  ChevronRight,
} from 'lucide-react';
import type { Meeting } from '../../types';
import { canDeleteMeeting } from '../../utils/recordingFinalization';
import { PageHeader } from '../ui/PageHeader';

interface AllMeetingsTabProps {
  meetings: Meeting[];
  onOpenMeeting: (id: string | number) => void;
  handleDeleteMeeting: (id: string | number) => void;
}

export const AllMeetingsTab = ({
  meetings,
  onOpenMeeting,
  handleDeleteMeeting
}: AllMeetingsTabProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const processedMeetings = useMemo(() => {
    let filtered = meetings;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(m =>
        (m.title || 'Untitled Meeting').toLowerCase().includes(q)
      );
    }
    return filtered.sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });
  }, [meetings, searchQuery, sortOrder]);

  const groupedMeetings = useMemo(() => {
    const groups: { label: string; items: Meeting[] }[] = [];
    processedMeetings.forEach(meeting => {
      const date = new Date(meeting.created_at);
      const now = new Date();
      let label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      if (date.toDateString() === now.toDateString()) {
        label = 'Today';
      } else {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) label = 'Yesterday';
      }
      let group = groups.find(g => g.label === label);
      if (!group) { group = { label, items: [] }; groups.push(group); }
      group.items.push(meeting);
    });
    return groups;
  }, [processedMeetings]);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return '<1m';
  };

  if (meetings.length === 0) {
    return (
      <div className="max-w-4xl mx-auto w-full animate-in duration-1000 text-center py-40 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pro-accent/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="w-24 h-24 rounded-[2rem] bg-pro-surface border border-pro-border flex items-center justify-center text-4xl mx-auto mb-8 shadow-premium">
          📚
        </div>
        <h2 className="font-serif text-3xl font-medium text-pro-text-main mb-3">Your library is empty.</h2>
        <p className="text-[15px] text-pro-text-muted font-medium max-w-sm mx-auto leading-relaxed">
          Record a session to populate this space.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto w-full animate-in pb-32 px-4 md:px-0">

      {/* Title + Controls */}
      <PageHeader title="Meetings">
        <div className="flex items-center gap-2">

          {/* Search — expands on focus */}
          <div className="relative group">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pro-text-muted group-focus-within:text-pro-accent transition-colors duration-200"
            />
            <input
              type="text"
              placeholder="Search…"
              aria-label="Search meetings"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-[160px] focus:w-[230px] pl-8 pr-7 py-1.5 bg-pro-surface border border-pro-border hover:border-pro-text-muted/60 focus:border-pro-accent rounded-lg text-[13px] text-pro-text-main placeholder:text-pro-text-muted/80 outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-pro-bg transition-all duration-300"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-pro-text-muted/40 hover:text-pro-text-main transition-colors p-0.5 rounded"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Sort toggle — accent-tinted when active */}
          <button
            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-all duration-200 ${
              sortOrder === 'asc'
                ? 'bg-pro-accent/10 border-pro-accent/25 text-pro-accent'
                : 'bg-transparent border-pro-border/40 text-pro-text-muted hover:border-pro-border/70 hover:text-pro-text-main'
            }`}
            title={sortOrder === 'desc' ? 'Sort oldest first' : 'Sort newest first'}
          >
            <ArrowUpDown size={13} className={`transition-transform duration-300 ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
            <span className="hidden sm:inline">{sortOrder === 'desc' ? 'Newest' : 'Oldest'}</span>
          </button>
        </div>
      </PageHeader>

      {/* No search results */}
      {groupedMeetings.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-10 h-10 rounded-full bg-pro-surface border border-pro-border flex items-center justify-center mx-auto mb-4 text-pro-text-muted">
            <Search size={16} />
          </div>
          <p className="text-[14px] font-semibold text-pro-text-main mb-1">No results for "{searchQuery}"</p>
          <p className="text-[13px] text-pro-text-muted mb-6">Try a different search term.</p>
          <button
            onClick={() => setSearchQuery('')}
            className="text-[13px] font-medium text-pro-accent hover:text-pro-accent/80 transition-colors"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedMeetings.map((group) => (
            <div key={group.label}>

              {/* Date label — no background, blends with page */}
              <div className="flex items-center gap-3 mb-2 px-3 -mx-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-pro-text-muted/40">
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-pro-border/15" />
              </div>

              {/* Meeting rows */}
              <div className="flex flex-col">
                {group.items.map((meeting) => (
                  <div key={meeting.id} className="relative group/row">
                    <button
                      onClick={() => onOpenMeeting(meeting.id)}
                      className="w-full flex items-center justify-between py-2.5 px-3 -mx-3 rounded-xl hover:bg-pro-surface/60 transition-colors duration-150 text-left"
                    >
                      {/* Left: icon + title + duration */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-7 h-7 rounded-lg bg-pro-surface/80 border border-pro-border/40 flex items-center justify-center text-pro-text-muted/50 group-hover/row:border-pro-accent/30 group-hover/row:text-pro-accent group-hover/row:bg-pro-accent/5 transition-all duration-150 shrink-0">
                          <Clock size={12} strokeWidth={2} />
                        </div>
                        <div className="flex items-baseline gap-2.5 min-w-0">
                          <h3 className="text-[13.5px] font-medium text-pro-text-main truncate group-hover/row:text-pro-accent transition-colors duration-150 leading-none">
                            {meeting.title || 'Untitled Meeting'}
                          </h3>
                          {meeting.duration_seconds ? (
                            <span className="text-[11px] text-pro-text-muted/50 shrink-0 tabular-nums leading-none">
                              {formatDuration(meeting.duration_seconds)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Right: status badge + time + chevron */}
                      <div className="flex items-center gap-3 shrink-0 pl-4">
                        {meeting.finalization_status && meeting.finalization_status !== 'finalized' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-amber-500/90 bg-amber-500/8 border border-amber-500/15">
                            <Loader2 size={9} className="animate-spin" />
                            {meeting.finalization_status.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className="text-[12px] text-pro-text-muted/45 tabular-nums">
                          {new Date(meeting.created_at).toLocaleTimeString(undefined, { timeStyle: 'short' })}
                        </span>
                        <ChevronRight
                          size={13}
                          className={`text-pro-text-muted/20 group-hover/row:text-pro-accent/50 transition-opacity duration-150 -mr-1 ${canDeleteMeeting(meeting.finalization_status) ? 'group-hover/row:opacity-0' : ''}`}
                        />
                      </div>
                    </button>

                    {/* Delete — revealed on row hover */}
                    {canDeleteMeeting(meeting.finalization_status) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteMeeting(meeting.id); }}
                        title="Delete session"
                        aria-label={`Delete ${meeting.title || 'untitled meeting'}`}
                        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 transition-opacity duration-150 p-1.5 text-pro-text-muted/40 hover:text-red-500 hover:bg-red-500/10 rounded-md"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

import {
  ArrowUpDown,
  ChevronRight,
  Clock,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Meeting } from '../../types';
import {
  meetingTimestamp,
  sortMeetingsByStartTime,
} from '../../utils/meetingOrdering';
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
  handleDeleteMeeting,
}: AllMeetingsTabProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const processedMeetings = useMemo(() => {
    let filtered = meetings;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((m) =>
        (m.title || 'Untitled Meeting').toLowerCase().includes(q),
      );
    }
    const sorted = sortMeetingsByStartTime(filtered);
    return sortOrder === 'desc' ? sorted : sorted.reverse();
  }, [meetings, searchQuery, sortOrder]);

  const groupedMeetings = useMemo(() => {
    const groups: { label: string; items: Meeting[] }[] = [];
    processedMeetings.forEach((meeting) => {
      const date = new Date(meetingTimestamp(meeting));
      const now = new Date();
      let label = date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      if (date.toDateString() === now.toDateString()) {
        label = 'Today';
      } else {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString())
          label = 'Yesterday';
      }
      let group = groups.find((g) => g.label === label);
      if (!group) {
        group = { label, items: [] };
        groups.push(group);
      }
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
      <section
        data-meetings-index="true"
        className="meetings-index meetings-index--empty"
        aria-labelledby="meetings-empty-title"
      >
        <div className="meetings-index__empty">
          <span className="meetings-index__empty-icon" aria-hidden="true">
            <Clock size={22} strokeWidth={1.75} />
          </span>
          <h2 id="meetings-empty-title">Your meetings will appear here</h2>
          <p>Record a conversation to start building your meeting history.</p>
        </div>
      </section>
    );
  }

  return (
    <section data-meetings-index="true" className="meetings-index">
      <PageHeader title="Meetings" className="meetings-index__header">
        <div className="meetings-index__controls">
          <div className="meetings-index__search">
            <Search size={13} aria-hidden="true" />
            <input
              type="text"
              placeholder="Search…"
              aria-label="Search meetings"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear meeting search"
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
            }
            className="meetings-index__sort"
            data-active={sortOrder === 'asc'}
            title={
              sortOrder === 'desc' ? 'Sort oldest first' : 'Sort newest first'
            }
          >
            <ArrowUpDown
              size={13}
              aria-hidden="true"
              className={sortOrder === 'asc' ? 'rotate-180' : ''}
            />
            <span className="meetings-index__sort-label">
              {sortOrder === 'desc' ? 'Newest' : 'Oldest'}
            </span>
          </button>
        </div>
      </PageHeader>

      {/* No search results */}
      {groupedMeetings.length === 0 ? (
        <div className="meetings-index__no-results">
          <Search size={18} aria-hidden="true" />
          <p>No results for "{searchQuery}"</p>
          <span>Try a different search term.</span>
          <button type="button" onClick={() => setSearchQuery('')}>
            Clear search
          </button>
        </div>
      ) : (
        <div className="meetings-index__groups">
          {groupedMeetings.map((group, groupIndex) => (
            <section
              key={group.label}
              className="meetings-index__group"
              aria-labelledby={`meeting-group-${groupIndex}`}
            >
              <div className="meetings-index__group-heading">
                <h2
                  id={`meeting-group-${groupIndex}`}
                  className="meetings-index__group-label"
                >
                  {group.label}
                </h2>
                <div aria-hidden="true" />
              </div>

              <div className="meetings-index__rows">
                {group.items.map((meeting) => (
                  <div key={meeting.id} className="meetings-index__row">
                    <button
                      type="button"
                      onClick={() => onOpenMeeting(meeting.id)}
                      className={`meetings-index__row-open ${canDeleteMeeting(meeting.finalization_status) ? 'meetings-index__row-open--deletable' : ''}`}
                    >
                      <span
                        className="meetings-index__row-icon"
                        aria-hidden="true"
                      >
                        <Clock size={14} strokeWidth={1.9} />
                      </span>
                      <span className="meetings-index__row-summary">
                        <span className="meetings-index__row-heading">
                          <span className="meetings-index__row-title">
                            {meeting.title || 'Untitled Meeting'}
                          </span>
                          {meeting.duration_seconds ? (
                            <span className="meetings-index__row-duration">
                              {formatDuration(meeting.duration_seconds)}
                            </span>
                          ) : null}
                        </span>
                      </span>

                      <span className="meetings-index__row-meta">
                        {meeting.finalization_status &&
                          meeting.finalization_status !== 'finalized' && (
                            <span className="meetings-index__row-status">
                              <Loader2
                                size={10}
                                className="animate-spin motion-reduce:animate-none"
                                aria-hidden="true"
                              />
                              {meeting.finalization_status.replace(/_/g, ' ')}
                            </span>
                          )}
                        <span className="meetings-index__row-time">
                          {new Date(
                            meetingTimestamp(meeting),
                          ).toLocaleTimeString(undefined, {
                            timeStyle: 'short',
                          })}
                        </span>
                        <ChevronRight
                          size={13}
                          aria-hidden="true"
                          className={`meetings-index__row-chevron ${canDeleteMeeting(meeting.finalization_status) ? 'meetings-index__row-chevron--deletable' : ''}`}
                        />
                      </span>
                    </button>

                    {canDeleteMeeting(meeting.finalization_status) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMeeting(meeting.id);
                        }}
                        title="Delete session"
                        aria-label={`Delete ${meeting.title || 'untitled meeting'}`}
                        className="meetings-index__row-delete"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
};

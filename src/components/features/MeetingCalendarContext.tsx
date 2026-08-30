import { CalendarDays } from 'lucide-react';

import type { MeetingCalendarContext as MeetingCalendarContextValue } from '../../../electron/calendar/types';

export const MeetingCalendarContext = ({
  context,
  canSuggestTitle,
  onUseTitle,
}: {
  context: MeetingCalendarContextValue;
  canSuggestTitle: boolean;
  onUseTitle: (title: string) => void;
}) => {
  const people = [context.event.organizer, ...context.event.attendees]
    .map((person) => person?.name || person?.email)
    .filter((person): person is string => Boolean(person));
  const uniquePeople = [...new Set(people)];

  return (
    <aside
      aria-label="Calendar context"
      className="mt-4 flex flex-col gap-3 rounded-lg border border-pro-border/60 bg-pro-surface/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <CalendarDays
          className="mt-0.5 h-4 w-4 shrink-0 text-pro-accent"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-pro-text-muted/70">
            From Calendar · {context.calendarTitle}
          </p>
          <p className="mt-0.5 truncate text-[12px] font-medium text-pro-text-main">
            {context.event.title}
          </p>
          {uniquePeople.length ? (
            <p className="mt-0.5 truncate text-[10px] font-medium text-pro-text-muted">
              {uniquePeople.join(' · ')}
            </p>
          ) : null}
        </div>
      </div>
      {canSuggestTitle ? (
        <button
          type="button"
          onClick={() => onUseTitle(context.event.title)}
          className="inline-flex min-h-9 shrink-0 items-center text-[11px] font-semibold text-pro-accent transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
        >
          Use meeting title
        </button>
      ) : null}
    </aside>
  );
};

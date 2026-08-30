import { CheckCircle2, Plus, UserRound, X } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';
import type { CalendarEvent } from '../../../electron/calendar/types';

const MEETING_TITLE_MAX_LENGTH = 64;
export const RECORDING_SCRATCHPAD_STORAGE_KEY = 'pluto.recording-scratchpad';

type Props = {
  title: string;
  onTitleChange: (value: string) => void;
  participants: string[];
  participantInput: string;
  onParticipantInputChange: (value: string) => void;
  onAddParticipant: () => void;
  onRemoveParticipant: (index: number) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  calendarEvent?: CalendarEvent | null;
};

export const RecordingMeetingRail = forwardRef<HTMLElement, Props>(
  (
    {
      title,
      onTitleChange,
      participants,
      participantInput,
      onParticipantInputChange,
      onAddParticipant,
      onRemoveParticipant,
      notes,
      onNotesChange,
      calendarEvent = null,
    },
    ref,
  ) => {
    const [saveState, setSaveState] = useState<'saved' | 'dirty'>('saved');

    useEffect(() => {
      setSaveState('dirty');
      const timer = window.setTimeout(() => {
        if (notes) {
          window.localStorage.setItem(RECORDING_SCRATCHPAD_STORAGE_KEY, notes);
        } else {
          window.localStorage.removeItem(RECORDING_SCRATCHPAD_STORAGE_KEY);
        }
        setSaveState('saved');
      }, 400);
      return () => window.clearTimeout(timer);
    }, [notes]);

    return (
      <aside
        ref={ref}
        className="recording-rail"
        aria-label="Meeting notes"
        data-recording-scratchpad
        tabIndex={-1}
      >
        <div className="recording-rail-content">
          <header className="rail-heading">
            <div className="rail-heading__status">
              <p className="workspace-eyebrow">Live note</p>
              <span aria-live="polite">
                {saveState === 'saved' ? (
                  <>
                    <CheckCircle2 aria-hidden="true" size={13} /> Saved locally
                  </>
                ) : (
                  'Saving notes'
                )}
              </span>
            </div>
            <label className="sr-only" htmlFor="recording-title">
              Meeting title
            </label>
            <input
              id="recording-title"
              className="rail-title-input"
              value={title}
              maxLength={MEETING_TITLE_MAX_LENGTH}
              onChange={(event) =>
                onTitleChange(
                  event.target.value.slice(0, MEETING_TITLE_MAX_LENGTH),
                )
              }
              placeholder="Meeting"
            />
            {calendarEvent ? (
              <div className="mt-3 border-t border-pro-border/50 pt-3">
                <p className="text-[10px] font-semibold text-pro-text-muted/65">
                  From Calendar
                </p>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-pro-text-main">
                      {calendarEvent.title}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] font-medium text-pro-text-muted">
                      {[calendarEvent.organizer, ...calendarEvent.attendees]
                        .map((person) => person?.name || person?.email)
                        .filter(
                          (person, index, values): person is string =>
                            Boolean(person) && values.indexOf(person) === index,
                        )
                        .join(' · ')}
                    </p>
                  </div>
                  {!title.trim() ? (
                    <button
                      type="button"
                      aria-label={`Use ${calendarEvent.title} as meeting title`}
                      onClick={() => onTitleChange(calendarEvent.title)}
                      className="shrink-0 text-[10px] font-semibold text-pro-accent transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                    >
                      Use title
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </header>
          <section className="rail-notes" aria-labelledby="notes-heading">
            <h2 id="notes-heading" className="sr-only">
              Notes
            </h2>
            <label className="sr-only" htmlFor="recording-notes">
              Meeting notes
            </label>
            <textarea
              id="recording-notes"
              value={notes}
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Start typing. Pluto will preserve your words and enrich them after the meeting."
            />
          </section>
          <section
            className="rail-participants"
            aria-labelledby="participants-heading"
          >
            <h3 id="participants-heading">
              <UserRound aria-hidden="true" size={15} /> Participants
            </h3>
            <div className="participant-list">
              {participants.map((participant, index) => (
                <span
                  className="participant-chip"
                  key={`${participant}-${index}`}
                >
                  {participant}
                  <button
                    type="button"
                    aria-label={`Remove ${participant}`}
                    onClick={() => onRemoveParticipant(index)}
                  >
                    <X aria-hidden="true" size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="participant-add">
              <label className="sr-only" htmlFor="recording-participant">
                Add participant
              </label>
              <input
                id="recording-participant"
                value={participantInput}
                onChange={(event) =>
                  onParticipantInputChange(event.target.value)
                }
                onKeyDown={(event) =>
                  event.key === 'Enter' && onAddParticipant()
                }
                placeholder="Add a person"
              />
              <button
                type="button"
                onClick={onAddParticipant}
                aria-label="Add participant"
              >
                <Plus aria-hidden="true" size={15} />
              </button>
            </div>
          </section>
        </div>
      </aside>
    );
  },
);

RecordingMeetingRail.displayName = 'RecordingMeetingRail';

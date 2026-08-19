import { Plus, UserRound, X } from 'lucide-react';
import { forwardRef } from 'react';

const MEETING_TITLE_MAX_LENGTH = 64;

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
    },
    ref,
  ) => (
    <aside
      ref={ref}
      className="recording-rail"
      aria-label="Meeting notes"
      data-recording-scratchpad
      tabIndex={-1}
    >
      <div className="recording-rail-content">
        <header className="rail-heading">
          <p className="workspace-eyebrow">Notes</p>
          <h2>Capture what matters</h2>
          <p>Your notes guide Pluto&apos;s summary after the meeting.</p>
        </header>
        <section className="rail-meta" aria-label="Meeting details">
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
          <div className="rail-participants">
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
          </div>
        </section>
        <section className="rail-notes" aria-labelledby="notes-heading">
          <h3 id="notes-heading" className="sr-only">
            Notes
          </h3>
          <label className="sr-only" htmlFor="recording-notes">
            Meeting notes
          </label>
          <textarea
            id="recording-notes"
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Type notes here…"
          />
        </section>
        <details className="rail-diagnostics">
          <summary>Capture diagnostics</summary>
          <p>Input details appear here when capture needs attention.</p>
        </details>
      </div>
    </aside>
  ),
);

RecordingMeetingRail.displayName = 'RecordingMeetingRail';

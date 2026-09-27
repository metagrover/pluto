import { SavedMeetingPrep } from './MeetingPrepEditor';
import { CheckCircle2, UserRound, X } from 'lucide-react';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import type { CalendarEvent } from '../../../electron/calendar/types';
import {
  type IdentityPerson,
  getIdentityState,
  identityPersonLabel,
} from '../../api/identity';
import { getEntitiesByType, upsertEntity } from '../../api/knowledgeGraph';
import { isGenericSpeakerLabel } from '../../utils/speakerReview';
import { SearchSelect, type SearchSelectOption } from '../ui/SearchSelect';

const MEETING_TITLE_MAX_LENGTH = 64;
export const RECORDING_SCRATCHPAD_STORAGE_KEY = 'pluto.recording-scratchpad';

type Props = {
  title: string;
  onTitleChange: (value: string) => void;
  participants: string[];
  participantInput?: string;
  onParticipantInputChange?: (value: string) => void;
  onAddParticipant: (name?: string) => void;
  onRemoveParticipant: (index: number) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  calendarEvent?: CalendarEvent | null;
  onOpenMeeting?: (id: string) => void;
  people?: IdentityPerson[];
  disabled?: boolean;
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
      onOpenMeeting,
      people: propPeople,
      disabled = false,
    },
    ref,
  ) => {
    const [notesTab, setNotesTab] = useState<'meeting' | 'prep'>('meeting');
    const [saveState, setSaveState] = useState<'saved' | 'dirty'>('saved');
    const [localQuery, setLocalQuery] = useState('');
    const [loadedPeople, setLoadedPeople] = useState<IdentityPerson[]>([]);

    const searchQuery =
      participantInput !== undefined ? participantInput : localQuery;
    const setSearchQuery = (val: string) => {
      setLocalQuery(val);
      onParticipantInputChange?.(val);
    };

    useEffect(() => {
      if (propPeople) {
        setLoadedPeople(propPeople);
        return;
      }
      let active = true;
      const load = async () => {
        try {
          const identity = await getIdentityState();
          if (active && identity?.people?.length) {
            setLoadedPeople(identity.people);
            return;
          }
        } catch {
          // ignore
        }
        try {
          const entities = await getEntitiesByType('person');
          if (active && entities?.length) {
            setLoadedPeople(entities.map((e) => ({ id: e.id, name: e.name })));
          }
        } catch {
          // ignore
        }
      };
      void load();
      return () => {
        active = false;
      };
    }, [propPeople]);

    useEffect(() => {
      setSaveState('dirty');
      const timer = window.setTimeout(() => {
        if (notes) {
          window.localStorage.setItem(
            calendarEvent
              ? `pluto.meeting-notes:${calendarEvent.occurrenceKey}`
              : RECORDING_SCRATCHPAD_STORAGE_KEY,
            notes,
          );
        } else {
          window.localStorage.removeItem(
            calendarEvent
              ? `pluto.meeting-notes:${calendarEvent.occurrenceKey}`
              : RECORDING_SCRATCHPAD_STORAGE_KEY,
          );
        }
        setSaveState('saved');
      }, 400);
      return () => window.clearTimeout(timer);
    }, [notes, calendarEvent?.occurrenceKey]);

    const eligiblePeople = useMemo(() => {
      return loadedPeople.filter((p) => {
        const name = p.name?.trim();
        if (!name || isGenericSpeakerLabel(name)) return false;
        const lower = name.toLowerCase();
        if (
          participants.some(
            (existing) => existing.trim().toLowerCase() === lower,
          )
        ) {
          return false;
        }
        return true;
      });
    }, [loadedPeople, participants]);

    const selectOptions: readonly SearchSelectOption[] = useMemo(() => {
      return eligiblePeople.map((person) => ({
        value: person.id,
        label: identityPersonLabel(person, loadedPeople),
        keywords: person.aliases,
      }));
    }, [eligiblePeople, loadedPeople]);

    const handleSelectPerson = (personId: string) => {
      if (!personId) return;
      const person = loadedPeople.find(
        (candidate) => candidate.id === personId,
      );
      const name = person?.name?.trim();
      if (name) {
        if (
          !participants.some(
            (p) => p.trim().toLowerCase() === name.toLowerCase(),
          )
        ) {
          onAddParticipant(name);
        }
      }
      setSearchQuery('');
    };

    const handleCreatePerson = async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || isGenericSpeakerLabel(trimmed)) return;
      if (
        !participants.some(
          (p) => p.trim().toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        onAddParticipant(trimmed);
      }
      setSearchQuery('');

      try {
        const created = await upsertEntity({
          type: 'person',
          name: trimmed,
          status: 'active',
        });
        if (created) {
          setLoadedPeople((prev) => {
            if (
              prev.some(
                (p) =>
                  p.id === created.id ||
                  p.name.trim().toLowerCase() === trimmed.toLowerCase(),
              )
            ) {
              return prev;
            }
            return [...prev, { id: created.id, name: created.name }];
          });
        }
      } catch (error) {
        console.error('Failed to create person entity:', error);
      }
    };

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
              <p className="workspace-eyebrow">Notes</p>
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
            <div
              role="tablist"
              aria-label="Notes sections"
              className="mb-3 flex gap-2"
            >
              <button
                type="button"
                role="tab"
                aria-selected={notesTab === 'meeting'}
                onClick={() => setNotesTab('meeting')}
                className="rounded px-3 py-1.5 text-xs text-pro-text-main hover:bg-pro-surface"
              >
                Meeting
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={notesTab === 'prep'}
                onClick={() => setNotesTab('prep')}
                className="rounded px-3 py-1.5 text-xs text-pro-text-main hover:bg-pro-surface"
              >
                Prep
              </button>
            </div>
            <div
              role="tabpanel"
              aria-label="Meeting notes"
              className={
                notesTab === 'meeting'
                  ? 'flex min-h-0 flex-1 flex-col'
                  : 'hidden'
              }
              hidden={notesTab !== 'meeting'}
            >
              <textarea
                id="recording-notes"
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Start typing. Pluto will preserve your words and enrich them after the meeting."
              />
            </div>
            {notesTab === 'prep' && (
              <div
                role="tabpanel"
                aria-label="Meeting preparation"
                className="min-h-0 overflow-y-auto"
              >
                <SavedMeetingPrep event={calendarEvent} onOpenMeeting={onOpenMeeting} />
              </div>
            )}
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
            <div className="participant-select-wrapper">
              <SearchSelect
                id="recording-participant"
                ariaLabel="Add participant"
                placeholder="Add a person"
                searchPlaceholder="Search people or type a new name…"
                emptyMessage="No matching people found."
                value=""
                inputValue={searchQuery}
                onInputValueChange={setSearchQuery}
                onValueChange={handleSelectPerson}
                onCreateOption={handleCreatePerson}
                clearOnSelect
                disabled={disabled}
                canCreateOption={(name) => {
                  const trimmed = name.trim();
                  return (
                    Boolean(trimmed) &&
                    !isGenericSpeakerLabel(trimmed) &&
                    !participants.some(
                      (p) => p.trim().toLowerCase() === trimmed.toLowerCase(),
                    )
                  );
                }}
                createOptionLabel={(name) => (
                  <span className="flex w-full items-center justify-between gap-3">
                    <span>
                      Create{' '}
                      <strong className="text-pro-text-main">“{name}”</strong>
                    </span>
                    <span className="rounded-full bg-pro-accent/10 px-2 py-0.5 text-[10px] font-normal text-pro-accent">
                      New person
                    </span>
                  </span>
                )}
                options={selectOptions}
                clearable
                clearLabel="Clear participant input"
              />
            </div>
          </section>
        </div>
      </aside>
    );
  },
);

RecordingMeetingRail.displayName = 'RecordingMeetingRail';

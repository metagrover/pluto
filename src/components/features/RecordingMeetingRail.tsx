import { CheckCircle2, UserRound, X } from 'lucide-react';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent } from '../../../electron/calendar/types';
import {
  type IdentityPerson,
  getIdentityState,
  identityPersonLabel,
} from '../../api/identity';
import { getEntitiesByType, upsertEntity } from '../../api/knowledgeGraph';
import { isGenericSpeakerLabel } from '../../utils/speakerReview';
import { SearchSelect, type SearchSelectOption } from '../ui/SearchSelect';
import { SavedMeetingPrep } from './MeetingPrepEditor';

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
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(title);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const titleEditCancelledRef = useRef(false);
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
      if (editingTitle) {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }
    }, [editingTitle]);

    const commitTitle = () => {
      onTitleChange(titleDraft.trim() || 'Meeting');
      setEditingTitle(false);
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
        if (calendarEvent) {
          // An empty value records that the user deliberately cleared the
          // prefilled notes; reopening this occurrence must not seed them again.
          window.localStorage.setItem(
            `pluto.meeting-notes:${calendarEvent.occurrenceKey}`,
            notes,
          );
        } else if (notes) {
          window.localStorage.setItem(RECORDING_SCRATCHPAD_STORAGE_KEY, notes);
        } else {
          window.localStorage.removeItem(RECORDING_SCRATCHPAD_STORAGE_KEY);
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
              <h2
                id="notes-heading"
                aria-label={title.trim() || 'Meeting'}
                className="min-w-0 flex-1"
              >
                {editingTitle ? (
                  <input
                    ref={titleInputRef}
                    id="recording-title"
                    aria-label="Meeting title"
                    className="rail-meeting-title"
                    value={titleDraft}
                    maxLength={MEETING_TITLE_MAX_LENGTH}
                    onChange={(event) =>
                      setTitleDraft(
                        event.target.value.slice(0, MEETING_TITLE_MAX_LENGTH),
                      )
                    }
                    onBlur={() => {
                      if (titleEditCancelledRef.current) {
                        titleEditCancelledRef.current = false;
                        return;
                      }
                      commitTitle();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        titleEditCancelledRef.current = true;
                        setEditingTitle(false);
                      }
                    }}
                    placeholder="Meeting"
                  />
                ) : (
                  <button
                    type="button"
                    className="rail-meeting-title rail-meeting-title--display"
                    aria-label={`Edit meeting title: ${title.trim() || 'Meeting'}`}
                    onClick={() => {
                      titleEditCancelledRef.current = false;
                      setTitleDraft(title.trim() || 'Meeting');
                      setEditingTitle(true);
                    }}
                  >
                    {title.trim() || 'Meeting'}
                  </button>
                )}
              </h2>
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
          </header>
          <section className="rail-notes" aria-label="Meeting notes and prep">
            <label className="sr-only" htmlFor="recording-notes">
              Meeting notes
            </label>
            <div
              role="tablist"
              aria-label="Notes sections"
              className="mb-5 inline-flex max-w-full gap-2"
            >
              <button
                type="button"
                role="tab"
                aria-selected={notesTab === 'meeting'}
                onClick={() => setNotesTab('meeting')}
                className={`min-h-9 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent ${notesTab === 'meeting' ? 'bg-pro-hover text-pro-text-main' : 'text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main'}`}
              >
                Meeting
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={notesTab === 'prep'}
                onClick={() => setNotesTab('prep')}
                className={`min-h-9 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent ${notesTab === 'prep' ? 'bg-pro-hover text-pro-text-main' : 'text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main'}`}
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
                <SavedMeetingPrep
                  event={calendarEvent}
                  onOpenMeeting={onOpenMeeting}
                />
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

import { UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  addMeetingEntity,
  getEntitiesByType,
  upsertEntity,
} from '../../api/knowledgeGraph';
import { isGenericSpeakerLabel } from '../../utils/speakerReview';
import { SearchSelect, type SearchSelectOption } from '../ui/SearchSelect';

/**
 * "Who was this with?" on a meeting that has no calendar event and no known
 * person yet. Adding someone records that they took part, as adding a
 * participant during recording does; it does not decide who said what.
 */
export const MeetingWhoWasThere = ({
  meetingId,
  onAdded,
}: {
  meetingId: string;
  onAdded: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<SearchSelectOption[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void getEntitiesByType('person')
      .then((list) => {
        if (current)
          setPeople(
            (list || []).map((person) => ({
              value: person.id,
              label: person.name,
            })),
          );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [open]);

  const add = async (personId: string) => {
    setBusy(true);
    setError(null);
    try {
      await addMeetingEntity({
        meeting_id: meetingId,
        entity_id: personId,
        mention_count: 1,
        context: 'Manual participant',
      });
      setOpen(false);
      setQuery('');
      onAdded();
    } catch {
      setError('Could not add them. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="meeting-who-trigger inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
        onClick={() => setOpen(true)}
      >
        <UserPlus size={12} aria-hidden="true" />
        Who was this with?
      </button>
    );
  }

  return (
    <div className="inline-flex min-w-64 flex-col gap-1">
      <SearchSelect
        id={`meeting-who-${meetingId}`}
        ariaLabel="Who was this meeting with"
        placeholder="Add a person"
        searchPlaceholder="Search people or type a new name…"
        emptyMessage="No matching people found."
        value=""
        inputValue={query}
        onInputValueChange={setQuery}
        onValueChange={(personId) => void add(personId)}
        onCreateOption={(name) => {
          void (async () => {
            setBusy(true);
            try {
              const person = await upsertEntity({
                type: 'person',
                name: name.trim(),
                status: 'active',
              });
              await add(person.id);
            } catch {
              setError('Could not add them. Try again.');
              setBusy(false);
            }
          })();
        }}
        canCreateOption={(name) =>
          Boolean(name.trim()) && !isGenericSpeakerLabel(name.trim())
        }
        clearOnSelect
        disabled={busy}
        options={people}
      />
      {error ? (
        <p role="alert" className="text-xs text-pro-warning">
          {error}
        </p>
      ) : null}
    </div>
  );
};

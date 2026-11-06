import type { PersistedMeeting } from '../db';

interface AskPlutoMeetingReader {
  getAskPlutoMeetingHeaders(): PersistedMeeting[];
  getAskPlutoMeetings(): PersistedMeeting[];
  getAskPlutoMeetingsByIds(
    ids: readonly (string | number)[],
  ): PersistedMeeting[];
}

/**
 * Meetings for one Ask Pluto question. Headers (id, title, dates, processing
 * state) come from a covering index and are enough to choose meetings by
 * title, person, day or period; notes and analysis load only for the meetings
 * a step actually reads. Every step sees the same meetings in the same order
 * as a full read taken when the source was created.
 */
export interface AskPlutoMeetingSource {
  /** Every meeting, newest first, without notes or analysis. */
  readonly headers: readonly PersistedMeeting[];
  /** Every meeting with notes and analysis, read once on first use. */
  all(): PersistedMeeting[];
  /** Full rows for the given meetings, in the given order. */
  hydrate(
    meetings: readonly Pick<PersistedMeeting, 'id'>[],
  ): PersistedMeeting[];
}

export const createAskPlutoMeetingSource = (
  reader: AskPlutoMeetingReader,
): AskPlutoMeetingSource => {
  const headers = reader.getAskPlutoMeetingHeaders();
  let everything: PersistedMeeting[] | null = null;
  const loaded = new Map<string, PersistedMeeting>();

  const all = () => {
    if (!everything) {
      const rows = new Map(
        reader
          .getAskPlutoMeetings()
          .map((meeting) => [String(meeting.id), meeting]),
      );
      // Keep the header snapshot: a meeting saved mid-question is not part of
      // this answer, and one deleted mid-question drops out.
      everything = headers.flatMap((header) => {
        const row = rows.get(String(header.id));
        return row ? [row] : [];
      });
      for (const meeting of everything) loaded.set(String(meeting.id), meeting);
    }
    return everything;
  };

  const hydrate = (meetings: readonly Pick<PersistedMeeting, 'id'>[]) => {
    const ids = [...new Set(meetings.map((meeting) => String(meeting.id)))];
    const missing = ids.filter((id) => !loaded.has(id));
    if (missing.length)
      for (const row of reader.getAskPlutoMeetingsByIds(missing))
        loaded.set(String(row.id), row);
    return meetings.flatMap((meeting) => {
      const row = loaded.get(String(meeting.id));
      return row ? [row] : [];
    });
  };

  return { headers, all, hydrate };
};

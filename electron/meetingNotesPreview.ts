import type { MeetingNotesPreview } from '../src/types';
import type { NotesDraft } from './llm/meetingNotesTypes';

/** Memory only: no database, logs, exports, actions, or background consumers. */
export function createMeetingNotesPreviewStore() {
  const entries = new Map<
    string,
    { preview: MeetingNotesPreview; isCurrent: () => boolean }
  >();
  return {
    set(
      meetingId: string,
      runId: string,
      draft: NotesDraft,
      isCurrent: () => boolean,
    ) {
      // Revision checks run when a preview is read, not for every streamed update.
      const preview: MeetingNotesPreview = {
        runId,
        sections: draft.sections.map((section) => ({
          title: section.title.text,
          items: section.items.map((item) => item.text),
        })),
      };
      if (Buffer.byteLength(JSON.stringify(preview), 'utf8') > 64_000) {
        entries.delete(meetingId);
        return;
      }
      entries.set(meetingId, { preview, isCurrent });
    },
    get(meetingId: string): MeetingNotesPreview | null {
      const entry = entries.get(meetingId);
      if (!entry) return null;
      if (!entry.isCurrent()) {
        entries.delete(meetingId);
        return null;
      }
      return structuredClone(entry.preview);
    },
    clear(meetingId: string, runId: string) {
      if (entries.get(meetingId)?.preview.runId === runId)
        entries.delete(meetingId);
    },
  };
}

import type {
  Note,
  NoteAgendaItem,
  NoteAskPlutoDelta,
  NoteAskPlutoRequest,
  NoteAskPlutoResponse,
  SaveNoteInput,
  SetNoteChecklistItemInput,
} from '../types/notes';

const mutate = async <T>(channel: string, payload: unknown): Promise<T> => {
  if (typeof window === 'undefined' || !window.ipcRenderer?.invoke) {
    return {} as T;
  }
  const result = await window.ipcRenderer.invoke(channel, payload);
  window.dispatchEvent(new Event('pluto:notes-changed'));
  return result as T;
};

export const listNotes = (): Promise<Note[]> => {
  if (typeof window === 'undefined' || !window.ipcRenderer?.invoke) {
    return Promise.resolve([]);
  }
  return window.ipcRenderer.invoke('NOTES_LIST');
};

export const getNote = (id: string): Promise<Note | null> => {
  if (typeof window === 'undefined' || !window.ipcRenderer?.invoke) {
    return Promise.resolve(null);
  }
  return window.ipcRenderer.invoke('NOTES_GET', id);
};

export const saveNote = (input: SaveNoteInput): Promise<Note> =>
  mutate('NOTES_SAVE', input);

export const deleteNote = (id: string): Promise<boolean> =>
  mutate('NOTES_DELETE', id);

export const getNotesForAttendees = (
  emails: string[],
  names: string[],
): Promise<NoteAgendaItem[]> => {
  if (typeof window === 'undefined' || !window.ipcRenderer?.invoke) {
    return Promise.resolve([]);
  }
  // Always a list, even when the bridge answers with nothing.
  return Promise.resolve(
    window.ipcRenderer.invoke('NOTES_FOR_ATTENDEES', { emails, names }),
  ).then((items) => (Array.isArray(items) ? items : []));
};

export const setNoteChecklistItem = (
  input: SetNoteChecklistItemInput,
): Promise<NoteAgendaItem> => mutate('NOTES_SET_CHECKLIST_ITEM', input);

export const getNotesForEntity = (entityId: string): Promise<Note[]> => {
  if (typeof window === 'undefined' || !window.ipcRenderer?.invoke) {
    return Promise.resolve([]);
  }
  return window.ipcRenderer.invoke('NOTES_FOR_ENTITY', entityId);
};

/** Checklist lines like "Priya: send deck" in notes not linked to the person. */
export const getOwnedNoteItems = (
  personId: string,
): Promise<NoteAgendaItem[]> => {
  if (typeof window === 'undefined' || !window.ipcRenderer?.invoke) {
    return Promise.resolve([]);
  }
  return Promise.resolve(
    window.ipcRenderer.invoke('NOTES_OWNED_ITEMS', personId),
  ).then((items) => (Array.isArray(items) ? items : []));
};

export const subscribeNotesChanged = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('pluto:notes-changed', listener);
  const unsubscribe = window.ipcRenderer?.on?.('NOTES_CHANGED', listener);
  return () => {
    window.removeEventListener('pluto:notes-changed', listener);
    unsubscribe?.();
  };
};

export const askPlutoAboutNote = async (
  request: NoteAskPlutoRequest,
): Promise<NoteAskPlutoResponse> => {
  if (typeof window === 'undefined' || !window.ipcRenderer?.invoke) {
    return {
      status: 'unavailable',
      answer: '',
      error: 'Ask Pluto is available in the Pluto desktop app.',
    };
  }
  const result = await window.ipcRenderer.invoke<NoteAskPlutoResponse | null>(
    'intelligence:note-chat',
    request,
  );
  return (
    result ?? {
      status: 'unavailable',
      answer: '',
      error: 'Ask Pluto is unavailable right now.',
    }
  );
};

export const cancelNoteAskPluto = (requestId: string): void => {
  void window.ipcRenderer?.invoke?.('intelligence:note-chat:cancel', requestId);
};

export const subscribeNoteAskPlutoDelta = (
  listener: (packet: NoteAskPlutoDelta) => void,
): (() => void) => {
  const unsubscribe = window.ipcRenderer?.on?.(
    'intelligence:note-chat:delta',
    (_event: unknown, packet: NoteAskPlutoDelta) => listener(packet),
  );
  return () => unsubscribe?.();
};

/** Asks the app to show a note in Notes, from wherever the user is. */
export const OPEN_NOTE_EVENT = 'pluto:open-note';
export const openNoteInApp = (noteId: string): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_NOTE_EVENT, { detail: noteId }));
};

export interface NextTimeDiscussedMark {
  key: string;
  meetingId: string;
  meetingTitle: string;
  startedAt: string;
  atSeconds: number | null;
}

/** Items on "Next time with …" that came up in the latest meeting with them. */
export const getNextTimeDiscussed = async (
  personId: string,
  items: Array<{ key: string; noteId: string; text: string }>,
): Promise<NextTimeDiscussedMark[]> => {
  if (typeof window === 'undefined' || !window.ipcRenderer?.invoke) return [];
  const marks = await window.ipcRenderer.invoke('NEXT_TIME_DISCUSSED', {
    personId,
    items,
  });
  return Array.isArray(marks) ? marks : [];
};

import type {
  Note,
  NoteAgendaItem,
  NoteAskPlutoDelta,
  NoteAskPlutoRequest,
  NoteAskPlutoResponse,
  SaveNoteInput,
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
  return window.ipcRenderer.invoke('NOTES_FOR_ATTENDEES', { emails, names });
};

export const getNotesForEntity = (entityId: string): Promise<Note[]> => {
  if (typeof window === 'undefined' || !window.ipcRenderer?.invoke) {
    return Promise.resolve([]);
  }
  return window.ipcRenderer.invoke('NOTES_FOR_ENTITY', entityId);
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

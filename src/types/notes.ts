export type NoteType = 'scratchpad' | 'person' | 'project' | 'general';

export interface Note {
  id: string;
  title: string;
  content: string;
  noteType: NoteType;
  targetId?: string | null;
  targetName?: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveNoteInput {
  id?: string;
  title?: string;
  content: string;
  noteType?: NoteType;
  targetId?: string | null;
  pinned?: boolean;
}

export interface NotesSnapshot {
  notes: Note[];
}

export interface NoteAgendaItem {
  id: string;
  noteId: string;
  noteTitle: string;
  targetName?: string | null;
  text: string;
  checked: boolean;
}

/** Quick actions offered by Ask Pluto inside a note. */
export type NoteAskPlutoIntent =
  | 'ask'
  | 'summarize'
  | 'tasks'
  | 'open_items'
  | 'follow_up';

export interface NoteAskPlutoTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface NoteAskPlutoRequest {
  requestId: string;
  noteId: string;
  intent: NoteAskPlutoIntent;
  query: string;
  /** Text the user selected in the note, when the question is about a part. */
  selection?: string;
  turns?: NoteAskPlutoTurn[];
}

export interface NoteAskPlutoResponse {
  status: 'answered' | 'unavailable';
  answer: string;
  /** Present for the "tasks" intent: task titles the user can approve. */
  suggestedTasks?: string[];
  error?: string;
  /** Short technical reason, shown under "Details" for troubleshooting. */
  detail?: string;
  /** Set when low memory meant a smaller local model answered instead. */
  fallbackModel?: string;
}

export interface NoteAskPlutoDelta {
  requestId: string;
  delta: string;
}

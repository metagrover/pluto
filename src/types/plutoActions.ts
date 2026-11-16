export interface PlutoActionContext {
  noteId?: string;
  meetingId?: string;
  personId?: string;
  projectId?: string;
  selection?: string;
}
export type PlutoAction =
  | { kind: 'create_note'; title: string; content: string; targetId?: string }
  | { kind: 'append_note'; noteId: string; content: string }
  | { kind: 'append_meeting'; meetingId: string; content: string }
  | {
      kind: 'person_agenda';
      personId: string;
      content: string;
      noteId?: string;
    }
  | {
      kind: 'create_task';
      title: string;
      dueDate?: string | null;
      sourceNoteId?: string;
      sourceMeetingId?: string;
    }
  | {
      kind: 'edit_task';
      taskId: string;
      title?: string;
      description?: string;
      dueDate?: string | null;
    }
  | { kind: 'task_status'; taskId: string; status: 'active' | 'completed' };
export interface PlutoActionItem {
  id: string;
  action: PlutoAction;
  destination: string;
  preview: string;
  revision: string;
}
export interface PlutoActionBatch {
  id: string;
  state: 'pending' | 'applied' | 'undone';
  items: PlutoActionItem[];
  selectedIds?: string[];
  results?: Array<{
    kind: 'note' | 'meeting' | 'task';
    id: string;
    title: string;
  }>;
}

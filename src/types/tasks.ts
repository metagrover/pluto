import type { Entity } from '../api/knowledgeGraph';

export interface TaskTag {
  id: string;
  name: string;
}
export interface PersonalTask {
  entity: Entity;
  revision?: string;
  projectId: string | null;
  tagIds: string[];
  description: string;
  sourceMeetingId: string | null;
  sourceMeetingTitle: string | null;
  needsReview: boolean;
  focused: boolean;
}
export interface TasksSnapshot {
  tasks: PersonalTask[];
  tags: TaskTag[];
  projects: Array<{ id: string; name: string }>;
}
export interface SaveTaskInput {
  id?: string;
  title: string;
  dueDate?: string | null;
  projectId?: string | null;
  tagIds?: string[];
  description?: string;
  requestId?: string;
  expectedRevision?: string;
}
export type TaskChatProposal =
  | {
      kind: 'create_task';
      text: string;
      label: string;
      dueDate?: string | null;
    }
  | {
      kind: 'set_task_status';
      taskId: string;
      text: string;
      status: 'active' | 'completed';
      label: string;
    };

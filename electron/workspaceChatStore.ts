import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  WorkspaceChatMemory,
  WorkspaceChatMessage,
  WorkspaceChatMessagePayload,
  WorkspaceChatThread,
} from '../src/types/workspaceChat';

type ThreadRow = {
  id: string;
  title: string;
  memory_json: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  payload_json: string;
  created_at: string;
};

const emptyMemory = (): WorkspaceChatMemory => ({
  corrections: [],
  unresolvedQuestions: [],
});

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapThread = (row: ThreadRow): WorkspaceChatThread => ({
  id: row.id,
  title: row.title,
  memory: parseJson(row.memory_json, emptyMemory()),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const mapMessage = (row: MessageRow): WorkspaceChatMessage => ({
  id: row.id,
  threadId: row.thread_id,
  role: row.role,
  content: row.content,
  payload: parseJson(row.payload_json, {}),
  createdAt: row.created_at,
});

const makeTitle = (message: string): string => {
  const compact = message.replace(/\s+/g, ' ').trim();
  if (!compact) return 'New conversation';
  return compact.length <= 60 ? compact : `${compact.slice(0, 57).trimEnd()}…`;
};

export const createWorkspaceChatStore = (sqlite: Database.Database) => {
  const requireThread = (threadId: string): ThreadRow => {
    const row = sqlite
      .prepare('SELECT * FROM workspace_chat_threads WHERE id = ?')
      .get(threadId) as ThreadRow | undefined;
    if (!row) throw new Error('Workspace chat thread not found');
    return row;
  };

  return {
    listThreads(includeArchived = false): WorkspaceChatThread[] {
      return (
        sqlite
          .prepare(
            `SELECT * FROM workspace_chat_threads
             ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
             ORDER BY datetime(updated_at) DESC, rowid DESC`,
          )
          .all() as ThreadRow[]
      ).map(mapThread);
    },

    createThread(): WorkspaceChatThread {
      const id = randomUUID();
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `INSERT INTO workspace_chat_threads
             (id, title, memory_json, created_at, updated_at)
           VALUES (?, 'New conversation', ?, ?, ?)`,
        )
        .run(id, JSON.stringify(emptyMemory()), now, now);
      return mapThread(requireThread(id));
    },

    archiveThread(threadId: string): WorkspaceChatThread {
      requireThread(threadId);
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `UPDATE workspace_chat_threads
           SET archived_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, threadId);
      return mapThread(requireThread(threadId));
    },

    resumeThread(threadId: string): WorkspaceChatThread {
      requireThread(threadId);
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `UPDATE workspace_chat_threads
           SET archived_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(now, threadId);
      return mapThread(requireThread(threadId));
    },

    deleteThread(threadId: string): void {
      requireThread(threadId);
      sqlite
        .prepare('DELETE FROM workspace_chat_threads WHERE id = ?')
        .run(threadId);
    },

    listMessages(threadId: string): WorkspaceChatMessage[] {
      requireThread(threadId);
      return (
        sqlite
          .prepare(
            `SELECT * FROM workspace_chat_messages
             WHERE thread_id = ? ORDER BY datetime(created_at), rowid`,
          )
          .all(threadId) as MessageRow[]
      ).map(mapMessage);
    },

    appendMessage(input: {
      id?: string;
      threadId: string;
      role: 'user' | 'assistant';
      content: string;
      payload?: WorkspaceChatMessagePayload;
    }): WorkspaceChatMessage {
      const thread = requireThread(input.threadId);
      if (thread.archived_at)
        throw new Error('Workspace chat thread is archived');
      const id = input.id || randomUUID();
      const now = new Date().toISOString();
      sqlite.transaction(() => {
        sqlite
          .prepare(
            `INSERT INTO workspace_chat_messages
               (id, thread_id, role, content, payload_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.threadId,
            input.role,
            input.content,
            JSON.stringify(input.payload ?? {}),
            now,
          );
        sqlite
          .prepare(
            `UPDATE workspace_chat_threads
             SET title = CASE
                   WHEN title = 'New conversation' AND ? = 'user' THEN ?
                   ELSE title
                 END,
                 updated_at = ?
             WHERE id = ?`,
          )
          .run(input.role, makeTitle(input.content), now, input.threadId);
      })();
      return mapMessage(
        sqlite
          .prepare('SELECT * FROM workspace_chat_messages WHERE id = ?')
          .get(id) as MessageRow,
      );
    },

    updateMessagePayload(input: {
      threadId: string;
      messageId: string;
      payload: WorkspaceChatMessagePayload;
    }): WorkspaceChatMessage {
      requireThread(input.threadId);
      const result = sqlite
        .prepare(
          `UPDATE workspace_chat_messages
           SET payload_json = ? WHERE id = ? AND thread_id = ?`,
        )
        .run(JSON.stringify(input.payload), input.messageId, input.threadId);
      if (result.changes !== 1) {
        throw new Error('Workspace chat message not found');
      }
      return mapMessage(
        sqlite
          .prepare('SELECT * FROM workspace_chat_messages WHERE id = ?')
          .get(input.messageId) as MessageRow,
      );
    },

    updateMemory(
      threadId: string,
      memory: WorkspaceChatMemory,
    ): WorkspaceChatThread {
      requireThread(threadId);
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `UPDATE workspace_chat_threads
           SET memory_json = ?, updated_at = ? WHERE id = ?`,
        )
        .run(JSON.stringify(memory), now, threadId);
      return mapThread(requireThread(threadId));
    },
  };
};

export type WorkspaceChatStore = ReturnType<typeof createWorkspaceChatStore>;

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  PersonChatCitation,
  PersonChatMessage,
  PersonChatMessageStatus,
  PersonChatThread,
} from '../src/types/personChat';

type ThreadRow = {
  id: string;
  person_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  status: PersonChatMessageStatus;
  citations_json: string;
  created_at: string;
};

const parseCitations = (value: string): PersonChatCitation[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as PersonChatCitation[]) : [];
  } catch {
    return [];
  }
};

const mapThread = (row: ThreadRow): PersonChatThread => ({
  id: row.id,
  personId: row.person_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const mapMessage = (row: MessageRow): PersonChatMessage => ({
  id: row.id,
  threadId: row.thread_id,
  role: row.role,
  content: row.content,
  status: row.status,
  citations: parseCitations(row.citations_json),
  createdAt: row.created_at,
});

const makeTitle = (message: string) => {
  const compact = message.replace(/\s+/g, ' ').trim();
  if (!compact) return 'New conversation';
  return compact.length <= 60 ? compact : `${compact.slice(0, 57).trimEnd()}…`;
};

export const createPersonChatStore = (sqlite: Database.Database) => {
  const canonicalPersonId = (personId: string): string | null => {
    const row = sqlite
      .prepare(`
        SELECT COALESCE(alias.canonical_id, person.id) AS id
        FROM entities person
        LEFT JOIN person_aliases alias
          ON alias.person_id = person.id AND alias.active = 1
        WHERE person.id = ? AND person.type = 'person'
      `)
      .get(personId) as { id: string } | undefined;
    return row?.id ?? null;
  };

  const familyIds = (personId: string): string[] => {
    const canonicalId = canonicalPersonId(personId);
    if (!canonicalId) return [];
    return (
      sqlite
        .prepare(`
          SELECT ? AS id
          UNION
          SELECT person_id AS id FROM person_aliases
          WHERE canonical_id = ? AND active = 1
        `)
        .all(canonicalId, canonicalId) as Array<{ id: string }>
    ).map((row) => row.id);
  };

  const requireThread = (threadId: string, personId: string): ThreadRow => {
    const ids = familyIds(personId);
    if (ids.length === 0) throw new Error('Person not found');
    const placeholders = ids.map(() => '?').join(', ');
    const row = sqlite
      .prepare(
        `SELECT * FROM person_chat_threads
         WHERE id = ? AND person_id IN (${placeholders})`,
      )
      .get(threadId, ...ids) as ThreadRow | undefined;
    if (!row) throw new Error('Person chat thread not found');
    return row;
  };

  return {
    listThreads(personId: string, includeArchived = false): PersonChatThread[] {
      const ids = familyIds(personId);
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(', ');
      const rows = sqlite
        .prepare(
          `SELECT * FROM person_chat_threads
           WHERE person_id IN (${placeholders})
             ${includeArchived ? '' : 'AND archived_at IS NULL'}
           ORDER BY datetime(updated_at) DESC, id DESC`,
        )
        .all(...ids) as ThreadRow[];
      return rows.map(mapThread);
    },

    createThread(personId: string): PersonChatThread {
      const canonicalId = canonicalPersonId(personId);
      if (!canonicalId) throw new Error('Person not found');
      const id = randomUUID();
      const now = new Date().toISOString();
      sqlite
        .prepare(`
          INSERT INTO person_chat_threads
            (id, person_id, title, created_at, updated_at)
          VALUES (?, ?, 'New conversation', ?, ?)
        `)
        .run(id, canonicalId, now, now);
      return mapThread(
        sqlite
          .prepare('SELECT * FROM person_chat_threads WHERE id = ?')
          .get(id) as ThreadRow,
      );
    },

    archiveThread(threadId: string, personId: string): PersonChatThread {
      requireThread(threadId, personId);
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `UPDATE person_chat_threads
           SET archived_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, threadId);
      return mapThread(
        sqlite
          .prepare('SELECT * FROM person_chat_threads WHERE id = ?')
          .get(threadId) as ThreadRow,
      );
    },

    resumeThread(threadId: string, personId: string): PersonChatThread {
      requireThread(threadId, personId);
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `UPDATE person_chat_threads
           SET archived_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(now, threadId);
      return mapThread(
        sqlite
          .prepare('SELECT * FROM person_chat_threads WHERE id = ?')
          .get(threadId) as ThreadRow,
      );
    },

    listMessages(threadId: string, personId: string): PersonChatMessage[] {
      requireThread(threadId, personId);
      return (
        sqlite
          .prepare(
            `SELECT * FROM person_chat_messages
             WHERE thread_id = ? ORDER BY datetime(created_at), rowid`,
          )
          .all(threadId) as MessageRow[]
      ).map(mapMessage);
    },

    appendMessage(input: {
      threadId: string;
      personId: string;
      role: 'user' | 'assistant';
      content: string;
      status?: PersonChatMessageStatus;
      citations?: PersonChatCitation[];
    }): PersonChatMessage {
      requireThread(input.threadId, input.personId);
      const id = randomUUID();
      const now = new Date().toISOString();
      const transaction = sqlite.transaction(() => {
        sqlite
          .prepare(`
            INSERT INTO person_chat_messages
              (id, thread_id, role, content, status, citations_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            input.threadId,
            input.role,
            input.content,
            input.status ?? 'complete',
            JSON.stringify(input.citations ?? []),
            now,
          );
        const firstUser = sqlite
          .prepare(`
            SELECT content FROM person_chat_messages
            WHERE thread_id = ? AND role = 'user'
            ORDER BY datetime(created_at), rowid LIMIT 1
          `)
          .get(input.threadId) as { content: string } | undefined;
        sqlite
          .prepare(`
            UPDATE person_chat_threads
            SET title = CASE WHEN title = 'New conversation' AND ? IS NOT NULL
                THEN ? ELSE title END,
                updated_at = ?, archived_at = NULL
            WHERE id = ?
          `)
          .run(
            firstUser?.content ?? null,
            firstUser ? makeTitle(firstUser.content) : null,
            now,
            input.threadId,
          );
      });
      transaction();
      return mapMessage(
        sqlite
          .prepare('SELECT * FROM person_chat_messages WHERE id = ?')
          .get(id) as MessageRow,
      );
    },
  };
};

export type PersonChatStore = ReturnType<typeof createPersonChatStore>;

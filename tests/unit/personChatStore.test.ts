import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPersonChatStore } from '../../electron/personChatStore';

describe('person chat store', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE entities (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE person_aliases (
        person_id TEXT PRIMARY KEY,
        canonical_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE person_chat_threads (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE person_chat_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES person_chat_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'complete',
        citations_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      INSERT INTO entities VALUES ('maya', 'person', 'Maya');
      INSERT INTO entities VALUES ('maya-old', 'person', 'M. Patel');
    `);
  });

  afterEach(() => sqlite.close());

  it('persists messages and titles a thread from its first user message', () => {
    const store = createPersonChatStore(sqlite);
    const thread = store.createThread('maya');
    store.appendMessage({
      threadId: thread.id,
      personId: 'maya',
      role: 'user',
      content:
        'Help me prepare for a difficult feedback conversation with Maya',
    });
    store.appendMessage({
      threadId: thread.id,
      personId: 'maya',
      role: 'assistant',
      content: 'Start with the shared goal.',
    });

    expect(store.listThreads('maya')[0]?.title).toBe(
      'Help me prepare for a difficult feedback conversation wit…',
    );
    expect(
      store.listMessages(thread.id, 'maya').map((item) => item.role),
    ).toEqual(['user', 'assistant']);
  });

  it('shows origin threads through an active canonical merge and separates on restore', () => {
    const store = createPersonChatStore(sqlite);
    const origin = store.createThread('maya-old');
    sqlite
      .prepare('INSERT INTO person_aliases VALUES (?, ?, 1)')
      .run('maya-old', 'maya');

    expect(store.listThreads('maya').map((item) => item.id)).toContain(
      origin.id,
    );
    sqlite.prepare('UPDATE person_aliases SET active = 0').run();
    expect(store.listThreads('maya')).toEqual([]);
    expect(store.listThreads('maya-old').map((item) => item.id)).toContain(
      origin.id,
    );
  });

  it('archives a thread without deleting its messages', () => {
    const store = createPersonChatStore(sqlite);
    const thread = store.createThread('maya');
    store.appendMessage({
      threadId: thread.id,
      personId: 'maya',
      role: 'user',
      content: 'Catch me up',
    });
    store.archiveThread(thread.id, 'maya');

    expect(store.listThreads('maya')).toEqual([]);
    expect(store.listThreads('maya', true)).toHaveLength(1);
    expect(store.listMessages(thread.id, 'maya')).toHaveLength(1);
    expect(store.resumeThread(thread.id, 'maya').archivedAt).toBeNull();
    expect(store.listThreads('maya')).toHaveLength(1);
  });
});

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceChatStore } from '../../electron/workspaceChatStore';

describe('workspace chat store', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE workspace_chat_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        memory_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE workspace_chat_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES workspace_chat_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);
  });

  afterEach(() => sqlite.close());

  it('persists a complete conversation and structured memory', () => {
    const store = createWorkspaceChatStore(sqlite);
    const thread = store.createThread();
    store.appendMessage({
      threadId: thread.id,
      role: 'user',
      content: 'What should I focus on this week?',
    });
    store.appendMessage({
      threadId: thread.id,
      role: 'assistant',
      content: 'Start with the release handoff.',
      payload: { outcome: 'answered' },
    });
    store.updateMemory(thread.id, {
      currentGoal: 'Prioritize this week',
      lastAnswerSummary: 'Start with the release handoff.',
      corrections: [],
      unresolvedQuestions: [],
    });

    expect(store.listThreads()[0]).toMatchObject({
      title: 'What should I focus on this week?',
      memory: { currentGoal: 'Prioritize this week' },
    });
    expect(store.listMessages(thread.id)).toMatchObject([
      { role: 'user' },
      { role: 'assistant', payload: { outcome: 'answered' } },
    ]);
  });

  it('archives without deleting and deletes with cascading messages', () => {
    const store = createWorkspaceChatStore(sqlite);
    const thread = store.createThread();
    store.appendMessage({
      threadId: thread.id,
      role: 'user',
      content: 'Keep this private',
    });

    store.archiveThread(thread.id);
    expect(store.listThreads()).toEqual([]);
    expect(store.listThreads(true)).toHaveLength(1);
    expect(() =>
      store.appendMessage({
        threadId: thread.id,
        role: 'user',
        content: 'Do not append while archived',
      }),
    ).toThrow('Workspace chat thread is archived');

    store.resumeThread(thread.id);
    store.deleteThread(thread.id);
    expect(store.listThreads(true)).toEqual([]);
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS count FROM workspace_chat_messages')
        .get(),
    ).toEqual({ count: 0 });
  });
});

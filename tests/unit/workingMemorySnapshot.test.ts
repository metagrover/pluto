import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  snapshots: [] as Array<Record<string, unknown>>,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
}));

vi.mock('better-sqlite3', () => {
  class FakeStatement {
    constructor(private sql: string) {}

    run(...args: unknown[]) {
      if (this.sql.includes('INSERT INTO working_memory_snapshots')) {
        const [
          id,
          scope_type,
          scope_key,
          title,
          source_doc_id,
          source_doc_last_synthesized_at,
          freshness,
          trust_status,
          source_count,
          cited_meeting_count,
          payload_json,
          generated_at,
          updated_at,
        ] = args;
        storeState.snapshots.push({
          id,
          scope_type,
          scope_key,
          title,
          source_doc_id,
          source_doc_last_synthesized_at,
          freshness,
          trust_status,
          source_count,
          cited_meeting_count,
          payload_json,
          generated_at,
          updated_at,
        });
      }

      if (this.sql.includes('UPDATE working_memory_snapshots')) {
        const [
          title,
          source_doc_id,
          source_doc_last_synthesized_at,
          freshness,
          trust_status,
          source_count,
          cited_meeting_count,
          payload_json,
          generated_at,
          updated_at,
          scope_type,
          scope_key,
        ] = args;
        const existing = storeState.snapshots.find(
          (snapshot) =>
            snapshot.scope_type === scope_type &&
            snapshot.scope_key === scope_key,
        );
        if (existing) {
          Object.assign(existing, {
            title,
            source_doc_id,
            source_doc_last_synthesized_at,
            freshness,
            trust_status,
            source_count,
            cited_meeting_count,
            payload_json,
            generated_at,
            updated_at,
          });
        }
      }

      return { changes: 1 };
    }

    get(...args: unknown[]) {
      if (this.sql.includes('PRAGMA table_info')) return undefined;
      if (
        this.sql.includes(
          'SELECT * FROM working_memory_snapshots WHERE scope_type = ? AND scope_key = ?',
        )
      ) {
        const [scopeType, scopeKey] = args;
        return (
          storeState.snapshots.find(
            (snapshot) =>
              snapshot.scope_type === scopeType &&
              snapshot.scope_key === scopeKey,
          ) ?? null
        );
      }
      return undefined;
    }

    all() {
      if (this.sql.includes('PRAGMA table_info')) return [];
      if (this.sql.includes('SELECT * FROM working_memory_snapshots')) {
        return [...storeState.snapshots];
      }
      return [];
    }
  }

  class FakeDatabase {
    prepare(sql: string) {
      return new FakeStatement(sql);
    }

    exec() {}

    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return fn;
    }
  }

  return {
    default: FakeDatabase,
  };
});

import {
  getWorkingMemorySnapshot,
  listWorkingMemorySnapshots,
  upsertWorkingMemorySnapshot,
} from '../../electron/db';
import type { KnowledgeDoc } from '../../electron/db';
import type { KnowledgeV2Document } from '../../electron/knowledgeV2';
import {
  buildGlobalWorkingMemorySnapshot,
  buildPersonContextWorkingMemorySnapshot,
  buildProjectWorkingMemorySnapshot,
  buildTeamTrackerWorkingMemorySnapshot,
  persistGlobalWorkingMemorySnapshot,
  persistPersonContextWorkingMemorySnapshot,
  persistProjectWorkingMemorySnapshot,
  persistTeamTrackerWorkingMemorySnapshot,
} from '../../electron/workingMemory';

const makeKnowledgeDoc = (
  overrides: Partial<KnowledgeDoc> = {},
): KnowledgeDoc => ({
  id: 'doc-global',
  scope_type: 'global',
  scope_key: 'global',
  title: 'Workspace Memory',
  rendered_content: null,
  structured_json: null,
  config: null,
  status: 'up_to_date',
  last_synthesized_at: '2026-05-26T15:00:00.000Z',
  last_source_cursor: null,
  updated_at: '2026-05-26T15:00:00.000Z',
  ...overrides,
});

const makeKnowledgeSnapshotDoc = (
  overrides: Partial<KnowledgeV2Document> = {},
): KnowledgeV2Document => ({
  schema_version: 2,
  scope: {
    type: 'global',
    title: 'Workspace Memory',
  },
  current_read: {
    headline: 'Launch work is blocked on the approval path.',
    supporting_bullets: [
      'The API migration is still active.',
      'The launch brief needs an owner.',
    ],
    freshness: 'fresh',
    source_count: 3,
    cited_item_count: 4,
    cited_meeting_count: 2,
    trust_message: 'Backed by direct evidence.',
    evidence_quality: {
      mode: 'direct',
      confidence: 0.86,
      cited_meeting_count: 2,
      source_count: 3,
      last_reinforced_at: '2026-05-26T14:00:00.000Z',
      freshness: 'fresh',
    },
  },
  active_streams: [
    {
      id: 'stream-launch',
      title: 'Launch',
      domain: 'work',
      status: 'active',
      current_read: 'Launch coordination is still active.',
      last_touched_at: '2026-05-26T14:00:00.000Z',
      source_count: 2,
      open_follow_up_count: 1,
      decision_count: 1,
      unresolved_question_count: 1,
      pinned: true,
      evidence_quality: {
        mode: 'direct',
        confidence: 0.82,
        cited_meeting_count: 2,
        source_count: 2,
        last_reinforced_at: '2026-05-26T14:00:00.000Z',
        freshness: 'fresh',
      },
    },
  ],
  needs_attention: [
    {
      id: 'item-follow-up',
      title: 'Assign launch brief owner',
      summary: 'Assign launch brief owner.',
      kind: 'follow_up',
      severity: 'watch',
      why_now: 'This is still unresolved.',
      stream_ids: ['stream-launch'],
      citations: [
        {
          meeting_id: 'meeting-1',
          quote: 'We still need an owner for the launch brief.',
        },
      ],
      evidence_quality: {
        mode: 'direct',
        confidence: 0.79,
        cited_meeting_count: 1,
        source_count: 1,
        last_reinforced_at: '2026-05-26T14:00:00.000Z',
        freshness: 'fresh',
      },
    },
  ],
  patterns: [
    {
      id: 'pattern-1',
      title: 'Approvals keep delaying launch work',
      summary: 'Approvals keep delaying launch work.',
      kind: 'pattern',
      severity: 'steady',
      why_now: 'This has shown up repeatedly.',
      stream_ids: ['stream-launch'],
      citations: [
        {
          meeting_id: 'meeting-2',
          quote: 'Approvals have delayed this for the third time.',
        },
      ],
      evidence_quality: {
        mode: 'inferred',
        confidence: 0.72,
        cited_meeting_count: 2,
        source_count: 2,
        last_reinforced_at: '2026-05-26T14:00:00.000Z',
        freshness: 'fresh',
      },
    },
  ],
  risks_and_unknowns: [
    {
      id: 'risk-1',
      title: 'Launch date may slip',
      summary: 'Launch date may slip.',
      kind: 'risk',
      severity: 'needs_attention',
      why_now: 'Critical dependency remains open.',
      stream_ids: ['stream-launch'],
      citations: [
        {
          meeting_id: 'meeting-2',
          quote: 'The launch date may slip if approval is late.',
        },
      ],
      evidence_quality: {
        mode: 'inferred',
        confidence: 0.84,
        cited_meeting_count: 2,
        source_count: 2,
        last_reinforced_at: '2026-05-26T14:00:00.000Z',
        freshness: 'fresh',
      },
    },
  ],
  evidence_index: [
    {
      id: 'evidence-1',
      meeting_id: 'meeting-1',
      meeting_title: 'Launch Sync',
      captured_at: '2026-05-26T14:00:00.000Z',
      quote: 'We still need an owner for the launch brief.',
      stream_ids: ['stream-launch'],
      item_ids: ['item-follow-up'],
      mode: 'direct',
      confidence: 0.91,
    },
  ],
  source_quality_summary: {
    included_count: 3,
    excluded_count: 0,
    weak_count: 0,
    records: [],
  },
  change_summary: {
    generated_at: '2026-05-26T15:00:00.000Z',
    added_count: 1,
    removed_count: 0,
    updated_count: 1,
    notable_changes: [],
  },
  ...overrides,
});

describe('working memory snapshots', () => {
  beforeEach(() => {
    storeState.snapshots = [];
  });

  it('builds a global snapshot that preserves trust, freshness, and evidence', () => {
    const snapshot = buildGlobalWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc(),
      structured: makeKnowledgeSnapshotDoc(),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    expect(snapshot.freshness).toBe('fresh');
    expect(snapshot.trust_status).toBe('grounded');
    expect(snapshot.payload.open_loops).toEqual(
      makeKnowledgeSnapshotDoc().needs_attention,
    );
    expect(snapshot.payload.current_read.cited_item_count).toBe(4);
    expect(snapshot.payload.evidence_index[0]).toMatchObject({
      id: 'evidence-1',
      meeting_id: 'meeting-1',
      item_ids: ['item-follow-up'],
    });
    expect(snapshot.payload.current_read.evidence_quality).toMatchObject({
      mode: 'direct',
      confidence: 0.86,
      cited_meeting_count: 2,
      source_count: 3,
      last_reinforced_at: '2026-05-26T14:00:00.000Z',
      freshness: 'fresh',
    });
    expect(snapshot.payload.change_summary).toEqual(
      makeKnowledgeSnapshotDoc().change_summary,
    );
    expect(snapshot.payload.source_quality_summary).toEqual(
      makeKnowledgeSnapshotDoc().source_quality_summary,
    );
  });

  it('persists a global snapshot and reads it back by scope', () => {
    const saved = persistGlobalWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc(),
      structured: makeKnowledgeSnapshotDoc(),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    const stored = getWorkingMemorySnapshot('global', 'global');

    expect(saved.id).toBeTruthy();
    expect(stored).toMatchObject({
      scope_type: 'global',
      scope_key: 'global',
      title: 'Workspace Memory',
      freshness: 'fresh',
      trust_status: 'grounded',
      source_count: 3,
      cited_meeting_count: 2,
    });
    expect(stored?.payload.current_read.headline).toBe(
      'Launch work is blocked on the approval path.',
    );
    expect(stored?.payload.change_summary).toEqual(
      makeKnowledgeSnapshotDoc().change_summary,
    );
    expect(stored?.payload.source).toEqual({
      knowledge_doc_id: 'doc-global',
      knowledge_doc_last_synthesized_at: '2026-05-26T15:00:00.000Z',
      knowledge_doc_last_source_cursor: null,
    });
  });

  it('preserves knowledge doc source cursor metadata in snapshot payload source fields', () => {
    const saved = persistProjectWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc({
        id: 'doc-project',
        scope_type: 'project',
        scope_key: 'project-1',
        title: 'Project Atlas',
        last_source_cursor: 'meeting:2026-05-26T14:30:00.000Z',
      }),
      structured: makeKnowledgeSnapshotDoc({
        scope: {
          type: 'project',
          title: 'Project Atlas',
        },
      }),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    expect(saved.payload.source).toEqual({
      knowledge_doc_id: 'doc-project',
      knowledge_doc_last_synthesized_at: '2026-05-26T15:00:00.000Z',
      knowledge_doc_last_source_cursor: 'meeting:2026-05-26T14:30:00.000Z',
    });
    expect(
      getWorkingMemorySnapshot('project', 'project-1')?.payload.source,
    ).toEqual({
      knowledge_doc_id: 'doc-project',
      knowledge_doc_last_synthesized_at: '2026-05-26T15:00:00.000Z',
      knowledge_doc_last_source_cursor: 'meeting:2026-05-26T14:30:00.000Z',
    });
  });

  it('builds and persists a project-scoped snapshot for a project knowledge doc', () => {
    const snapshot = buildProjectWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc({
        id: 'doc-project',
        scope_type: 'project',
        scope_key: 'project-1',
        title: 'Project Atlas',
      }),
      structured: makeKnowledgeSnapshotDoc({
        scope: {
          type: 'project',
          title: 'Project Atlas',
        },
      }),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    expect(snapshot.scope_type).toBe('project');
    expect(snapshot.scope_key).toBe('project-1');
    expect(snapshot.payload.scope.type).toBe('project');

    const saved = persistProjectWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc({
        id: 'doc-project',
        scope_type: 'project',
        scope_key: 'project-1',
        title: 'Project Atlas',
      }),
      structured: makeKnowledgeSnapshotDoc({
        scope: {
          type: 'project',
          title: 'Project Atlas',
        },
      }),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    const stored = getWorkingMemorySnapshot('project', 'project-1');

    expect(saved.id).toBeTruthy();
    expect(stored).toMatchObject({
      scope_type: 'project',
      scope_key: 'project-1',
      title: 'Project Atlas',
      source_doc_id: 'doc-project',
    });
    expect(stored?.payload.scope).toMatchObject({
      type: 'project',
      key: 'project-1',
      title: 'Project Atlas',
    });
  });

  it('builds and persists a team-tracker snapshot for a tracker knowledge doc', () => {
    const snapshot = buildTeamTrackerWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc({
        id: 'doc-team',
        scope_type: 'team_tracker',
        scope_key: 'team-1',
        title: 'Leadership Team',
        config: JSON.stringify({ member_entity_ids: ['person-1', 'person-2'] }),
      }),
      structured: makeKnowledgeSnapshotDoc({
        scope: {
          type: 'team_tracker',
          title: 'Leadership Team',
        },
      }),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    expect(snapshot.scope_type).toBe('team_tracker');
    expect(snapshot.scope_key).toBe('team-1');
    expect(snapshot.payload.scope.type).toBe('team_tracker');

    const saved = persistTeamTrackerWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc({
        id: 'doc-team',
        scope_type: 'team_tracker',
        scope_key: 'team-1',
        title: 'Leadership Team',
        config: JSON.stringify({ member_entity_ids: ['person-1', 'person-2'] }),
      }),
      structured: makeKnowledgeSnapshotDoc({
        scope: {
          type: 'team_tracker',
          title: 'Leadership Team',
        },
      }),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    const stored = getWorkingMemorySnapshot('team_tracker', 'team-1');

    expect(saved.id).toBeTruthy();
    expect(stored).toMatchObject({
      scope_type: 'team_tracker',
      scope_key: 'team-1',
      title: 'Leadership Team',
      source_doc_id: 'doc-team',
    });
    expect(stored?.payload.scope).toMatchObject({
      type: 'team_tracker',
      key: 'team-1',
      title: 'Leadership Team',
    });
  });

  it('builds and persists a person-context snapshot for a people knowledge doc', () => {
    const snapshot = buildPersonContextWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc({
        id: 'doc-person',
        scope_type: 'person_context',
        scope_key: 'person-1',
        title: 'Conversations with Alex Rivera',
      }),
      structured: makeKnowledgeSnapshotDoc({
        scope: {
          type: 'person_context',
          title: 'Conversations with Alex Rivera',
        },
      }),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    expect(snapshot.scope_type).toBe('person_context');
    expect(snapshot.scope_key).toBe('person-1');
    expect(snapshot.payload.scope.type).toBe('person_context');

    const saved = persistPersonContextWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc({
        id: 'doc-person',
        scope_type: 'person_context',
        scope_key: 'person-1',
        title: 'Conversations with Alex Rivera',
      }),
      structured: makeKnowledgeSnapshotDoc({
        scope: {
          type: 'person_context',
          title: 'Conversations with Alex Rivera',
        },
      }),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    const stored = getWorkingMemorySnapshot('person_context', 'person-1');

    expect(saved.id).toBeTruthy();
    expect(stored).toMatchObject({
      scope_type: 'person_context',
      scope_key: 'person-1',
      title: 'Conversations with Alex Rivera',
      source_doc_id: 'doc-person',
    });
    expect(stored?.payload.scope).toMatchObject({
      type: 'person_context',
      key: 'person-1',
      title: 'Conversations with Alex Rivera',
    });
  });

  it('does not churn the stored snapshot when regeneration is unchanged', () => {
    const first = persistGlobalWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc(),
      structured: makeKnowledgeSnapshotDoc(),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    const second = persistGlobalWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc(),
      structured: makeKnowledgeSnapshotDoc(),
      generatedAt: '2026-05-26T17:00:00.000Z',
    });

    expect(listWorkingMemorySnapshots()).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.generated_at).toBe(first.generated_at);
    expect(second.updated_at).toBe(first.updated_at);
  });

  it('updates the existing snapshot in place when the global state changes', () => {
    persistGlobalWorkingMemorySnapshot({
      knowledgeDoc: makeKnowledgeDoc(),
      structured: makeKnowledgeSnapshotDoc(),
      generatedAt: '2026-05-26T16:00:00.000Z',
    });

    const updatedStructured = makeKnowledgeSnapshotDoc();
    updatedStructured.current_read.headline = 'Launch is back on track.';
    updatedStructured.current_read.evidence_quality.freshness = 'aging';
    updatedStructured.current_read.freshness = 'aging';
    updatedStructured.evidence_index.push({
      id: 'evidence-2',
      meeting_id: 'meeting-3',
      meeting_title: 'Decision Review',
      captured_at: '2026-05-25T16:00:00.000Z',
      quote: 'Approval has now cleared.',
      stream_ids: ['stream-launch'],
      item_ids: [],
      mode: 'direct',
      confidence: 0.88,
    });

    const saved = persistGlobalWorkingMemorySnapshot({
      knowledgeDoc: {
        ...makeKnowledgeDoc(),
        last_synthesized_at: '2026-05-26T17:00:00.000Z',
        updated_at: '2026-05-26T17:00:00.000Z',
      },
      structured: updatedStructured,
      generatedAt: '2026-05-26T17:00:00.000Z',
    });

    expect(listWorkingMemorySnapshots()).toHaveLength(1);
    expect(saved.generated_at).toBe('2026-05-26T17:00:00.000Z');
    expect(saved.freshness).toBe('aging');
    expect(saved.payload.current_read.headline).toBe(
      'Launch is back on track.',
    );
    expect(saved.payload.evidence_index).toHaveLength(2);
  });

  it('round-trips a snapshot through the low-level upsert API', () => {
    const saved = upsertWorkingMemorySnapshot({
      scope_type: 'global',
      scope_key: 'global',
      title: 'Workspace Memory',
      source_doc_id: 'doc-global',
      source_doc_last_synthesized_at: '2026-05-26T15:00:00.000Z',
      freshness: 'fresh',
      trust_status: 'grounded',
      source_count: 3,
      cited_meeting_count: 2,
      generated_at: '2026-05-26T16:00:00.000Z',
      payload: {
        schema_version: 1,
        scope: {
          type: 'global',
          key: 'global',
          title: 'Workspace Memory',
        },
        source: {
          knowledge_doc_id: 'doc-global',
          knowledge_doc_last_synthesized_at: '2026-05-26T15:00:00.000Z',
        },
        current_read: {
          headline: 'Current read',
          supporting_bullets: [],
          freshness: 'fresh',
          trust_status: 'grounded',
          trust_message: 'Backed by direct evidence.',
          source_count: 3,
          cited_item_count: 4,
          cited_meeting_count: 2,
        },
        active_streams: [],
        open_loops: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
      },
    });

    expect(saved.payload.current_read.trust_status).toBe('grounded');
    expect(saved.payload.current_read.cited_item_count).toBe(4);
    expect(
      getWorkingMemorySnapshot('global', 'global')?.payload.source,
    ).toEqual({
      knowledge_doc_id: 'doc-global',
      knowledge_doc_last_synthesized_at: '2026-05-26T15:00:00.000Z',
    });
  });

  it('keeps reading snapshots whose payload source predates cursor metadata', () => {
    upsertWorkingMemorySnapshot({
      scope_type: 'global',
      scope_key: 'global',
      title: 'Workspace Memory',
      source_doc_id: 'doc-global',
      source_doc_last_synthesized_at: '2026-05-26T15:00:00.000Z',
      freshness: 'fresh',
      trust_status: 'grounded',
      source_count: 3,
      cited_meeting_count: 2,
      generated_at: '2026-05-26T16:00:00.000Z',
      payload: {
        schema_version: 1,
        scope: {
          type: 'global',
          key: 'global',
          title: 'Workspace Memory',
        },
        source: {
          knowledge_doc_id: 'doc-global',
          knowledge_doc_last_synthesized_at: '2026-05-26T15:00:00.000Z',
        },
        current_read: {
          headline: 'Current read',
          supporting_bullets: [],
          freshness: 'fresh',
          trust_status: 'grounded',
          trust_message: 'Backed by direct evidence.',
          source_count: 3,
          cited_item_count: 4,
          cited_meeting_count: 2,
        },
        active_streams: [],
        open_loops: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
      },
    });

    expect(
      getWorkingMemorySnapshot('global', 'global')?.payload.source
        .knowledge_doc_last_source_cursor,
    ).toBeUndefined();
  });
});

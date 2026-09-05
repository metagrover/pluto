import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MeetingContextEventInput,
  MeetingContextRollingStateV1,
} from '../../src/types/meetingContext';

const storeState = vi.hoisted(() => ({
  schemaSql: [] as string[],
  events: [] as Array<Record<string, unknown>>,
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
      if (this.sql.includes('INSERT OR IGNORE INTO meeting_context_events')) {
        const [
          id,
          meeting_id,
          event_key,
          kind,
          summary,
          evidence_json,
          attributes_json,
          supersedes_event_id,
          observed_at_ms,
          created_at,
        ] = args;
        const exists = storeState.events.some(
          (event) =>
            event.meeting_id === meeting_id && event.event_key === event_key,
        );
        if (!exists) {
          storeState.events.push({
            id,
            meeting_id,
            event_key,
            kind,
            summary,
            evidence_json,
            attributes_json,
            supersedes_event_id,
            observed_at_ms,
            created_at,
          });
        }
        return { changes: exists ? 0 : 1 };
      }

      if (this.sql.includes('INSERT INTO meeting_context_snapshots')) {
        const [
          id,
          meeting_id,
          revision,
          state_json,
          last_segment_id,
          last_segment_timestamp_ms,
          generated_at,
          created_at,
        ] = args;
        storeState.snapshots.push({
          id,
          meeting_id,
          revision,
          state_json,
          last_segment_id,
          last_segment_timestamp_ms,
          generated_at,
          created_at,
        });
        return { changes: 1 };
      }

      return { changes: 1 };
    }

    get(...args: unknown[]) {
      if (this.sql.includes('PRAGMA table_info')) return undefined;
      if (this.sql.includes('FROM meetings_fts')) {
        return { row_count: 0, distinct_meeting_count: 0 };
      }
      if (this.sql.includes('COUNT(*) AS count FROM meetings')) {
        return { count: 0 };
      }
      if (
        this.sql.includes('FROM meeting_context_events') &&
        this.sql.includes('WHERE meeting_id = ? AND event_key = ?')
      ) {
        const [meetingId, eventKey] = args;
        return storeState.events.find(
          (event) =>
            event.meeting_id === meetingId && event.event_key === eventKey,
        );
      }
      if (
        this.sql.includes('FROM meeting_context_snapshots') &&
        this.sql.includes('ORDER BY revision DESC')
      ) {
        const [meetingId] = args;
        return storeState.snapshots
          .filter((snapshot) => snapshot.meeting_id === meetingId)
          .sort(
            (left, right) =>
              Number(right.revision || 0) - Number(left.revision || 0),
          )[0];
      }
      return undefined;
    }

    all(...args: unknown[]) {
      if (this.sql.includes('PRAGMA table_info')) return [];
      if (this.sql.includes('FROM meeting_context_events')) {
        const [meetingId] = args;
        return storeState.events
          .filter((event) => event.meeting_id === meetingId)
          .sort(
            (left, right) =>
              Number(left.observed_at_ms || 0) -
                Number(right.observed_at_ms || 0) ||
              String(left.created_at).localeCompare(String(right.created_at)),
          );
      }
      if (this.sql.includes('FROM meeting_context_snapshots')) {
        const [meetingId, limit] = args;
        return storeState.snapshots
          .filter((snapshot) => snapshot.meeting_id === meetingId)
          .sort(
            (left, right) =>
              Number(right.revision || 0) - Number(left.revision || 0),
          )
          .slice(0, Number(limit));
      }
      return [];
    }
  }

  class FakeDatabase {
    prepare(sql: string) {
      return new FakeStatement(sql);
    }

    exec(sql: string) {
      storeState.schemaSql.push(sql);
    }

    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return fn;
    }
  }

  return {
    default: FakeDatabase,
  };
});

vi.mock('../../electron/database/applicationDatabase', async () => {
  const { default: Database } = await import('better-sqlite3');
  const connection = new Database(':memory:');
  return { getApplicationDatabase: () => connection };
});

import {
  appendMeetingContextEvent,
  getLatestMeetingContextSnapshot,
  getMeetingContextEventByKey,
  listMeetingContextEvents,
  listMeetingContextSnapshots,
  saveMeetingContextSnapshot,
} from '../../electron/db';

const makeEvent = (
  overrides: Partial<MeetingContextEventInput> = {},
): MeetingContextEventInput => ({
  meetingId: 'meeting-1',
  eventKey: 'decision:segment-4:launch-day',
  kind: 'decision',
  summary: 'The launch will remain on Monday.',
  evidence: [
    {
      segmentId: 'segment-4',
      timestampMs: 42_000,
      quote: 'Let us keep the launch on Monday.',
    },
  ],
  attributes: {
    topic: 'Launch date',
    confidence: 0.94,
  },
  observedAtMs: 42_000,
  ...overrides,
});

const makeState = (
  overrides: Partial<MeetingContextRollingStateV1> = {},
): MeetingContextRollingStateV1 => ({
  schemaVersion: 1,
  meetingId: 'meeting-1',
  updatedThrough: {
    segmentId: 'segment-4',
    timestampMs: 42_000,
  },
  summary: 'The team kept the Monday launch and assigned the checklist.',
  currentTopics: [
    {
      id: 'topic-launch',
      text: 'Launch timing',
      sourceEventIds: ['event-topic'],
      sourceSegmentIds: ['segment-1'],
    },
  ],
  proposals: [],
  decisions: [
    {
      id: 'decision-launch',
      text: 'Keep the launch on Monday.',
      sourceEventIds: ['event-decision'],
      sourceSegmentIds: ['segment-4'],
    },
  ],
  actions: [
    {
      id: 'action-checklist',
      text: 'Finish the migration checklist.',
      owner: 'Riley',
      deadline: null,
      sourceEventIds: ['event-action'],
      sourceSegmentIds: ['segment-5'],
    },
  ],
  openQuestions: [],
  importantFacts: [],
  ...overrides,
});

describe('embedded meeting context persistence', () => {
  beforeEach(() => {
    storeState.events = [];
    storeState.snapshots = [];
  });

  it('leaves schema initialization to the database lifecycle', () => {
    expect(storeState.schemaSql).toEqual([]);
  });

  it('appends a source-linked event and returns the original event on retry', () => {
    const first = appendMeetingContextEvent(makeEvent());
    const retry = appendMeetingContextEvent(
      makeEvent({ summary: 'A retry must not rewrite the original event.' }),
    );

    expect(first).toMatchObject({
      meetingId: 'meeting-1',
      eventKey: 'decision:segment-4:launch-day',
      kind: 'decision',
      summary: 'The launch will remain on Monday.',
      observedAtMs: 42_000,
      evidence: [
        {
          segmentId: 'segment-4',
          timestampMs: 42_000,
          quote: 'Let us keep the launch on Monday.',
        },
      ],
      attributes: {
        topic: 'Launch date',
        confidence: 0.94,
      },
    });
    expect(retry).toEqual(first);
    expect(listMeetingContextEvents('meeting-1')).toHaveLength(1);
    expect(
      getMeetingContextEventByKey('meeting-1', 'decision:segment-4:launch-day'),
    ).toEqual(first);
  });

  it('orders events by meeting time without leaking another meeting', () => {
    appendMeetingContextEvent(
      makeEvent({
        eventKey: 'action:segment-8:checklist',
        kind: 'action',
        summary: 'Riley owns the checklist.',
        observedAtMs: 80_000,
      }),
    );
    appendMeetingContextEvent(
      makeEvent({
        eventKey: 'proposal:segment-2:friday',
        kind: 'proposal',
        summary: 'Friday was proposed.',
        observedAtMs: 20_000,
      }),
    );
    appendMeetingContextEvent(
      makeEvent({
        meetingId: 'meeting-2',
        eventKey: 'fact:segment-1:private',
        kind: 'fact',
        summary: 'A different meeting fact.',
      }),
    );

    expect(
      listMeetingContextEvents('meeting-1').map((event) => event.eventKey),
    ).toEqual(['proposal:segment-2:friday', 'action:segment-8:checklist']);
  });

  it('appends immutable snapshot revisions and avoids unchanged churn', () => {
    const first = saveMeetingContextSnapshot(makeState(), {
      generatedAt: '2026-08-27T08:00:00.000Z',
    });
    const unchanged = saveMeetingContextSnapshot(makeState(), {
      generatedAt: '2026-08-27T08:01:00.000Z',
    });
    const changed = saveMeetingContextSnapshot(
      makeState({
        updatedThrough: {
          segmentId: 'segment-6',
          timestampMs: 60_000,
        },
        summary: 'The Monday launch is confirmed and Riley owns the checklist.',
      }),
      { generatedAt: '2026-08-27T08:02:00.000Z' },
    );

    expect(first.revision).toBe(1);
    expect(unchanged).toEqual(first);
    expect(changed.revision).toBe(2);
    expect(getLatestMeetingContextSnapshot('meeting-1')).toEqual(changed);
    expect(
      listMeetingContextSnapshots('meeting-1').map(
        (snapshot) => snapshot.revision,
      ),
    ).toEqual([2, 1]);
    expect(getLatestMeetingContextSnapshot('meeting-2')).toBeUndefined();
  });
});

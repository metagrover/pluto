import { describe, expect, it } from 'vitest';

import {
  applyMeetingContextEvents,
  reduceMeetingContextEvents,
} from '../../electron/intelligence/meetingContextReducer';
import type { MeetingContextEvent } from '../../src/types/meetingContext';

const event = (
  id: string,
  kind: MeetingContextEvent['kind'],
  summary: string,
  timestampMs: number,
  overrides: Partial<MeetingContextEvent> = {},
): MeetingContextEvent => ({
  id,
  meetingId: 'meeting-1',
  eventKey: `${kind}:${id}`,
  kind,
  summary,
  evidence: [{ segmentId: `segment-${id}`, timestampMs }],
  attributes: {},
  supersedesEventId: null,
  observedAtMs: timestampMs,
  createdAt: new Date(timestampMs).toISOString(),
  ...overrides,
});

describe('meeting context reducer', () => {
  it('maps ordered events into version-one rolling state', () => {
    const state = reduceMeetingContextEvents('meeting-1', [
      event('1', 'topic', 'Launch plan', 1_000),
      event('2', 'decision', 'Launch Monday', 2_000),
      event('3', 'action', 'Send checklist', 3_000, {
        attributes: { owner: 'Riley', deadline: null },
      }),
      event('4', 'open_question', 'What remains blocked?', 4_000),
      event('5', 'fact', '4 PM cutoff', 5_000),
    ]);

    expect(state).toMatchObject({
      schemaVersion: 1,
      meetingId: 'meeting-1',
      updatedThrough: { segmentId: 'segment-5', timestampMs: 5_000 },
      currentTopics: [{ text: 'Launch plan' }],
      decisions: [{ text: 'Launch Monday' }],
      actions: [{ text: 'Send checklist', owner: 'Riley', deadline: null }],
      openQuestions: [{ text: 'What remains blocked?' }],
      importantFacts: [{ text: '4 PM cutoff' }],
    });
    expect(state.summary).toBe(
      'Decisions: Launch Monday\nActions: Send checklist\nTopics: Launch plan\nQuestions: What remains blocked?\nFacts: 4 PM cutoff',
    );
  });

  it('merges normalized duplicates and their provenance', () => {
    const state = reduceMeetingContextEvents('meeting-1', [
      event('1', 'decision', 'Launch Monday', 1_000),
      event('2', 'decision', '  launch   monday  ', 2_000),
    ]);

    expect(state.decisions).toEqual([
      {
        id: '1',
        text: 'Launch Monday',
        sourceEventIds: ['1', '2'],
        sourceSegmentIds: ['segment-1', 'segment-2'],
      },
    ]);
  });

  it('keeps the latest bounded items and rejects cross-meeting events', () => {
    const events = Array.from({ length: 14 }, (_, index) =>
      event(String(index), 'decision', `Decision ${index}`, index),
    );
    events.push(
      event('foreign', 'decision', 'Private', 99, {
        meetingId: 'meeting-2',
      }),
    );

    const state = reduceMeetingContextEvents('meeting-1', events);

    expect(state.decisions).toHaveLength(12);
    expect(state.decisions[0].text).toBe('Decision 2');
    expect(state.decisions.at(-1)?.text).toBe('Decision 13');
    expect(state.decisions.some((item) => item.text === 'Private')).toBe(false);
  });

  it('returns an empty state with a null cursor when no events exist', () => {
    expect(reduceMeetingContextEvents('meeting-1', [])).toMatchObject({
      updatedThrough: { segmentId: null, timestampMs: null },
      summary: '',
      currentTopics: [],
      proposals: [],
      decisions: [],
      actions: [],
      openQuestions: [],
      importantFacts: [],
    });
  });

  it('incrementally applies new events with the same bounded result', () => {
    const initial = [
      event('1', 'topic', 'Launch plan', 1_000),
      event('2', 'decision', 'Launch Monday', 2_000),
    ];
    const next = [
      event('3', 'decision', '  launch monday ', 3_000),
      event('4', 'action', 'Send checklist', 4_000, {
        attributes: { owner: 'Riley', deadline: null },
      }),
    ];

    expect(
      applyMeetingContextEvents(
        reduceMeetingContextEvents('meeting-1', initial),
        next,
      ),
    ).toEqual(reduceMeetingContextEvents('meeting-1', [...initial, ...next]));
  });
});

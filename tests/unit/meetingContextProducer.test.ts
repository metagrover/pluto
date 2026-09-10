import { describe, expect, it } from 'vitest';

import { createMeetingContextProducer } from '../../electron/intelligence/meetingContextProducer';
import type {
  MeetingContextEvent,
  MeetingContextEventInput,
  MeetingContextIngestionSegment,
  MeetingContextRollingStateV1,
  MeetingContextSnapshot,
} from '../../src/types/meetingContext';

const confirmed = (
  text = "Let's discuss launch timing.",
  overrides: Partial<MeetingContextIngestionSegment> = {},
): MeetingContextIngestionSegment => ({
  id: overrides.id ?? `segment-${text.length}`,
  speaker: 'Speaker',
  text,
  timestampMs: 42_000,
  confirmed: true,
  ...overrides,
});

const requestFor = (meetingId: string, text: string) => ({
  meetingId,
  segments: [
    confirmed(text, {
      id: `segment-${text.length}-${text.codePointAt(0) ?? 0}`,
    }),
  ],
});

const repositoryDependencies = (
  options: { onAppend?: (eventKey: string) => Promise<void> } = {},
) => {
  const events: MeetingContextEvent[] = [];
  const snapshots = new Map<string, MeetingContextSnapshot>();
  return {
    getEventByKey: (meetingId: string, eventKey: string) =>
      events.find(
        (event) => event.meetingId === meetingId && event.eventKey === eventKey,
      ),
    appendEvent: async (input: MeetingContextEventInput) => {
      await options.onAppend?.(input.eventKey);
      const existing = events.find(
        (event) =>
          event.meetingId === input.meetingId &&
          event.eventKey === input.eventKey,
      );
      if (existing) return existing;
      const saved: MeetingContextEvent = {
        ...input,
        id: `event-${events.length + 1}`,
        attributes: input.attributes ?? {},
        supersedesEventId: input.supersedesEventId ?? null,
        createdAt: new Date(events.length).toISOString(),
      };
      events.push(saved);
      return saved;
    },
    listEvents: (meetingId: string) =>
      events.filter((event) => event.meetingId === meetingId),
    listEventsSince: (meetingId: string, observedAtMs: number) =>
      events.filter(
        (event) =>
          event.meetingId === meetingId && event.observedAtMs >= observedAtMs,
      ),
    getLatestSnapshot: (meetingId: string) => snapshots.get(meetingId),
    saveSnapshot: (state: MeetingContextRollingStateV1) => {
      const latest = snapshots.get(state.meetingId);
      if (latest && JSON.stringify(latest.state) === JSON.stringify(state)) {
        return latest;
      }
      const createdAt = new Date().toISOString();
      const saved: MeetingContextSnapshot = {
        id: `snapshot-${state.meetingId}-${(latest?.revision ?? 0) + 1}`,
        meetingId: state.meetingId,
        revision: (latest?.revision ?? 0) + 1,
        state,
        lastSegmentId: state.updatedThrough.segmentId,
        lastSegmentTimestampMs: state.updatedThrough.timestampMs,
        generatedAt: createdAt,
        createdAt,
      };
      snapshots.set(state.meetingId, saved);
      return saved;
    },
  };
};

describe('meeting context producer', () => {
  it('appends extracted events and saves the reduced snapshot', async () => {
    const producer = createMeetingContextProducer(repositoryDependencies());

    const result = await producer.ingest({
      meetingId: 'meeting-1',
      segments: [confirmed("Let's discuss launch timing.")],
    });

    expect(result).toMatchObject({
      acceptedSegmentCount: 1,
      extractedEventCount: 1,
      createdEventCount: 1,
      reusedEventCount: 0,
      snapshotRevision: 1,
      snapshotChanged: true,
    });
  });

  it('reuses replayed events and unchanged snapshots', async () => {
    const producer = createMeetingContextProducer(repositoryDependencies());
    const request = {
      meetingId: 'meeting-1',
      segments: [confirmed('We decided to launch Monday.')],
    };

    await producer.ingest(request);
    const replay = await producer.ingest(request);

    expect(replay).toMatchObject({
      createdEventCount: 0,
      reusedEventCount: 1,
      snapshotRevision: 1,
      snapshotChanged: false,
    });
  });

  it('does not create a snapshot for a cue-free batch', async () => {
    const producer = createMeetingContextProducer(repositoryDependencies());

    const result = await producer.ingest({
      meetingId: 'meeting-1',
      segments: [confirmed('The weather is pleasant.')],
    });

    expect(result.extractedEventCount).toBe(0);
    expect(result.snapshotRevision).toBeNull();
    expect(result.snapshotChanged).toBe(false);
  });

  it.each([
    { meetingId: '', segments: [] },
    {
      meetingId: 'meeting-1',
      segments: Array.from({ length: 25 }, (_, index) =>
        confirmed('Valid text.', { id: `segment-${index}` }),
      ),
    },
    {
      meetingId: 'meeting-1',
      segments: [confirmed('x'.repeat(12_001))],
    },
    {
      meetingId: 'meeting-1',
      segments: [confirmed('valid', { confirmed: false })],
    },
  ])('rejects invalid or oversized input %#', async (request) => {
    const producer = createMeetingContextProducer(repositoryDependencies());

    await expect(producer.ingest(request)).rejects.toThrow(
      'meeting_context_request_invalid',
    );
  });

  it('serializes concurrent work for one meeting', async () => {
    const order: string[] = [];
    const producer = createMeetingContextProducer(
      repositoryDependencies({
        onAppend: async (key) => {
          order.push(`start:${key}`);
          await Promise.resolve();
          order.push(`end:${key}`);
        },
      }),
    );

    await Promise.all([
      producer.ingest(requestFor('meeting-1', 'We decided to launch Monday.')),
      producer.ingest(requestFor('meeting-1', "I'll send the checklist.")),
    ]);

    expect(order).toEqual([
      expect.stringMatching(/^start:/),
      expect.stringMatching(/^end:/),
      expect.stringMatching(/^start:/),
      expect.stringMatching(/^end:/),
    ]);
  });

  it('drains and tombstones queued work before meeting deletion', async () => {
    let releaseAppend: () => void = () => {};
    let appendStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      appendStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    const dependencies = repositoryDependencies({
      onAppend: async () => {
        appendStarted();
        await blocked;
      },
    });
    const producer = createMeetingContextProducer(dependencies);
    const ingestion = producer.ingest(
      requestFor('meeting-delete', 'We decided to launch Monday.'),
    );
    await started;

    const cancellation = producer.cancel('meeting-delete');
    releaseAppend();

    await cancellation;
    await expect(ingestion).rejects.toThrow('meeting_context_cancelled');
    expect(dependencies.getLatestSnapshot('meeting-delete')).toBeUndefined();
    await expect(
      producer.ingest(
        requestFor('meeting-delete', "I'll send another checklist."),
      ),
    ).rejects.toThrow('meeting_context_cancelled');
  });
});

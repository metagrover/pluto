import type {
  MeetingContextEvent,
  MeetingContextEventInput,
  MeetingContextIngestionRequest,
  MeetingContextIngestionResult,
  MeetingContextIngestionSegment,
  MeetingContextRollingStateV1,
  MeetingContextSnapshot,
} from '../../src/types/meetingContext';
import { resolveMeetingSpeakerLabel } from '../../src/utils/meetingSpeakerProvenance';
import { extractDeterministicMeetingContextEvents } from './deterministicMeetingContextExtractor';
import {
  applyMeetingContextEvents,
  reduceMeetingContextEvents,
} from './meetingContextReducer';

export type MeetingContextProducerDependencies = {
  getEventByKey(
    meetingId: string,
    eventKey: string,
  ): MeetingContextEvent | undefined;
  appendEvent(
    input: MeetingContextEventInput,
  ): MeetingContextEvent | Promise<MeetingContextEvent>;
  listEvents(meetingId: string): MeetingContextEvent[];
  listEventsSince(
    meetingId: string,
    observedAtMs: number,
  ): MeetingContextEvent[];
  getLatestSnapshot(meetingId: string): MeetingContextSnapshot | undefined;
  saveSnapshot(state: MeetingContextRollingStateV1): MeetingContextSnapshot;
};

const ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const MAX_SEGMENTS = 24;
const MAX_TEXT_CHARACTERS = 12_000;

const invalidRequest = (): never => {
  throw new Error('meeting_context_request_invalid');
};

const normalize = (value: string): string => value.trim().replace(/\s+/gu, ' ');

const isSafeId = (value: string): boolean =>
  ID_PATTERN.test(value) && !value.includes('..');

const parseSegment = (value: unknown): MeetingContextIngestionSegment => {
  if (!value || typeof value !== 'object') return invalidRequest();
  const segment = value as Record<string, unknown>;
  if (
    typeof segment.id !== 'string' ||
    !isSafeId(segment.id) ||
    typeof segment.speaker !== 'string' ||
    !segment.speaker.trim() ||
    (segment.source !== undefined &&
      segment.source !== 'mic' &&
      segment.source !== 'system') ||
    typeof segment.text !== 'string' ||
    !normalize(segment.text) ||
    typeof segment.timestampMs !== 'number' ||
    !Number.isFinite(segment.timestampMs) ||
    segment.timestampMs < 0 ||
    segment.confirmed !== true
  ) {
    return invalidRequest();
  }

  return {
    id: segment.id,
    speaker: resolveMeetingSpeakerLabel(segment),
    ...(segment.source === 'mic' || segment.source === 'system'
      ? { source: segment.source }
      : {}),
    text: normalize(segment.text),
    timestampMs: segment.timestampMs,
    confirmed: true,
  };
};

const parseRequest = (value: unknown): MeetingContextIngestionRequest => {
  if (!value || typeof value !== 'object') return invalidRequest();
  const request = value as Record<string, unknown>;
  if (
    typeof request.meetingId !== 'string' ||
    !isSafeId(request.meetingId) ||
    !Array.isArray(request.segments) ||
    request.segments.length > MAX_SEGMENTS
  ) {
    return invalidRequest();
  }
  const segments = request.segments.map(parseSegment);
  if (
    segments.reduce((total, segment) => total + segment.text.length, 0) >
    MAX_TEXT_CHARACTERS
  ) {
    return invalidRequest();
  }
  return { meetingId: request.meetingId, segments };
};

const emptyResult = (
  acceptedSegmentCount: number,
): MeetingContextIngestionResult => ({
  acceptedSegmentCount,
  extractedEventCount: 0,
  createdEventCount: 0,
  reusedEventCount: 0,
  snapshotRevision: null,
  snapshotChanged: false,
});

export const createMeetingContextProducer = (
  dependencies: MeetingContextProducerDependencies,
): {
  ingest(request: unknown): Promise<MeetingContextIngestionResult>;
  cancel(meetingId: string): Promise<void>;
} => {
  const tails = new Map<string, Promise<void>>();
  const cancelledMeetingIds = new Set<string>();
  const assertActive = (meetingId: string) => {
    if (cancelledMeetingIds.has(meetingId)) {
      throw new Error('meeting_context_cancelled');
    }
  };

  const process = async (
    request: MeetingContextIngestionRequest,
  ): Promise<MeetingContextIngestionResult> => {
    assertActive(request.meetingId);
    const eventInputs = request.segments.flatMap((segment) =>
      extractDeterministicMeetingContextEvents(request.meetingId, segment),
    );
    if (eventInputs.length === 0) {
      return emptyResult(request.segments.length);
    }

    let createdEventCount = 0;
    let reusedEventCount = 0;
    for (const input of eventInputs) {
      assertActive(request.meetingId);
      if (dependencies.getEventByKey(input.meetingId, input.eventKey)) {
        reusedEventCount += 1;
      } else {
        createdEventCount += 1;
      }
      await dependencies.appendEvent(input);
      assertActive(request.meetingId);
    }

    assertActive(request.meetingId);
    const latest = dependencies.getLatestSnapshot(request.meetingId);
    const state = latest
      ? applyMeetingContextEvents(
          latest.state,
          dependencies.listEventsSince(
            request.meetingId,
            latest.lastSegmentTimestampMs ?? 0,
          ),
        )
      : reduceMeetingContextEvents(
          request.meetingId,
          dependencies.listEvents(request.meetingId),
        );
    const saved = dependencies.saveSnapshot(state);
    return {
      acceptedSegmentCount: request.segments.length,
      extractedEventCount: eventInputs.length,
      createdEventCount,
      reusedEventCount,
      snapshotRevision: saved.revision,
      snapshotChanged: latest?.revision !== saved.revision,
    };
  };

  return {
    async ingest(value) {
      const request = parseRequest(value);
      assertActive(request.meetingId);
      const previous = tails.get(request.meetingId) ?? Promise.resolve();
      const operation = previous
        .catch(() => undefined)
        .then(() => process(request));
      const tail = operation.then(
        () => undefined,
        () => undefined,
      );
      tails.set(request.meetingId, tail);
      void tail.finally(() => {
        if (tails.get(request.meetingId) === tail) {
          tails.delete(request.meetingId);
        }
      });
      return await operation;
    },
    async cancel(meetingId) {
      const normalizedMeetingId = meetingId.trim();
      if (!normalizedMeetingId) return;
      cancelledMeetingIds.add(normalizedMeetingId);
      await (tails.get(normalizedMeetingId) ?? Promise.resolve());
    },
  };
};

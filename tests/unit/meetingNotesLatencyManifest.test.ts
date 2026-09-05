import { describe, expect, it } from 'vitest';
import { MeetingNotesError } from '../../electron/llm/meetingNotesTypes';
import {
  aggregateMeetingNotesLatencySamples,
  aggregateOrganicMeetingNotesLatencySamples,
  assertContentFreeMeetingNotesLatencyReport,
  classifyMeetingNotesLatencyError,
  parsePrivateMeetingNotesLatencyManifest,
  summarizeMeetingNotesLatencyStages,
  summarizePrivateMeetingNotesLatencyManifest,
} from '../../scripts/lib/meeting_notes_latency_benchmark';

const validManifest = {
  schemaVersion: 1,
  databasePath: '/private/pluto.db',
  cases: [
    { caseKey: 'm15-a', meetingId: 'private-15', durationBucket: '15m' },
    { caseKey: 'm30-a', meetingId: 'private-30', durationBucket: '30m' },
    { caseKey: 'm45-a', meetingId: 'private-45', durationBucket: '45m' },
  ],
};

describe('private meeting-notes latency manifest', () => {
  it('accepts absolute private input while returning a content-free summary', () => {
    const manifest = parsePrivateMeetingNotesLatencyManifest(validManifest);

    expect(manifest.cases).toHaveLength(3);
    expect(summarizePrivateMeetingNotesLatencyManifest(manifest)).toEqual({
      schemaVersion: 1,
      caseCount: 3,
      durationBuckets: { '15m': 1, '30m': 1, '45m': 1 },
    });
    expect(
      JSON.stringify(summarizePrivateMeetingNotesLatencyManifest(manifest)),
    ).not.toContain('private-');
  });

  it.each([
    { ...validManifest, databasePath: 'relative.db' },
    {
      ...validManifest,
      cases: [...validManifest.cases, validManifest.cases[0]],
    },
    {
      ...validManifest,
      cases: [
        validManifest.cases[0],
        { ...validManifest.cases[1], meetingId: 'private-15' },
      ],
    },
    {
      ...validManifest,
      cases: [{ ...validManifest.cases[0], durationBucket: '60m' }],
    },
    { ...validManifest, cases: [] },
  ])('rejects an unsafe or ambiguous manifest: %j', (value) => {
    expect(() => parsePrivateMeetingNotesLatencyManifest(value)).toThrow(
      'invalid_private_meeting_notes_latency_manifest',
    );
  });

  it('rejects forbidden keys and private sentinel values anywhere in a report', () => {
    expect(() =>
      assertContentFreeMeetingNotesLatencyReport(
        { samples: [{ caseKey: 'm30-a', prompt: 'hidden' }] },
        ['PRIVATE_SENTINEL'],
      ),
    ).toThrow('unsafe_meeting_notes_latency_report');
    expect(() =>
      assertContentFreeMeetingNotesLatencyReport(
        { samples: [{ caseKey: 'm30-a', status: 'PRIVATE_SENTINEL' }] },
        ['PRIVATE_SENTINEL'],
      ),
    ).toThrow('unsafe_meeting_notes_latency_report');
  });

  it('aggregates completed samples without folding failures into latency', () => {
    expect(
      aggregateMeetingNotesLatencySamples([
        {
          caseKey: 'm30-a',
          durationBucket: '30m',
          status: 'published',
          totalMs: 100,
          queueMs: 20,
          modelMs: 70,
          modelCallCount: 2,
        },
        {
          caseKey: 'm30-b',
          durationBucket: '30m',
          status: 'published',
          totalMs: 300,
          queueMs: 40,
          modelMs: 240,
          modelCallCount: 4,
        },
        {
          caseKey: 'm30-c',
          durationBucket: '30m',
          status: 'failed',
          totalMs: 500,
          queueMs: 10,
          modelMs: 480,
          modelCallCount: 6,
          errorCode: 'notes_output_truncated',
        },
      ]),
    ).toEqual({
      sampleCount: 3,
      publishedCount: 2,
      failedCount: 1,
      publishRate: 2 / 3,
      meanTotalMs: 200,
      medianTotalMs: 200,
      p90TotalMs: 300,
      meanQueueMs: 30,
      meanModelMs: 155,
      meanModelCallCount: 3,
    });
  });

  it('summarizes stage tasks and outcomes without retaining stage payloads', () => {
    expect(
      summarizeMeetingNotesLatencyStages([
        {
          task: 'notesWriter',
          outcome: 'complete',
          inputTokens: 800,
          outputTokens: 400,
        },
        {
          task: 'notesAudit',
          outcome: 'truncated',
          inputTokens: 900,
          outputTokens: 500,
        },
        {
          task: 'notesAudit',
          outcome: 'complete',
          inputTokens: null,
          outputTokens: null,
        },
        { task: 'notesMerge', outcome: 'failed' },
      ]),
    ).toEqual({
      tasks: { notesWriter: 1, notesAudit: 2, notesMerge: 1 },
      outcomes: {
        complete: 2,
        preempted: 0,
        truncated: 1,
        cancelled: 0,
        failed: 1,
      },
      inputTokens: 1700,
      outputTokens: 900,
    });
  });

  it('separates organic attempts from distinct meetings and reports failure patterns', () => {
    expect(
      aggregateOrganicMeetingNotesLatencySamples([
        {
          meetingKey: 'private-meeting-a',
          status: 'failed',
          totalMs: 500,
          queueMs: 10,
          modelMs: 480,
          modelCallCount: 2,
          truncatedStageCount: 1,
          errorCode: 'notes_context_exhausted',
        },
        {
          meetingKey: 'private-meeting-a',
          status: 'failed',
          totalMs: 600,
          queueMs: 10,
          modelMs: 580,
          modelCallCount: 2,
          truncatedStageCount: 1,
          errorCode: 'notes_context_exhausted',
        },
        {
          meetingKey: 'private-meeting-a',
          status: 'published',
          totalMs: 300,
          queueMs: 40,
          modelMs: 240,
          modelCallCount: 3,
          truncatedStageCount: 0,
        },
        {
          meetingKey: 'private-meeting-b',
          status: 'published',
          totalMs: 100,
          queueMs: 20,
          modelMs: 70,
          modelCallCount: 1,
          truncatedStageCount: 0,
        },
      ]),
    ).toEqual({
      attemptCount: 4,
      distinctMeetingCount: 2,
      maxAttemptsPerMeeting: 3,
      publishedCount: 2,
      failedCount: 2,
      cancelledCount: 0,
      publishRate: 0.5,
      truncatedStageCount: 2,
      failureCodes: { notes_context_exhausted: 2 },
      meanTotalMs: 200,
      medianTotalMs: 200,
      p90TotalMs: 300,
      meanQueueMs: 30,
      meanModelMs: 155,
      meanModelCallCount: 2,
    });
  });

  it.each([
    [new MeetingNotesError('notes_provider_error'), 'notes_provider_error'],
    [
      new SyntaxError('private malformed stream'),
      'notes_provider_response_invalid',
    ],
    [
      new DOMException('private timeout', 'TimeoutError'),
      'notes_provider_timeout',
    ],
    [new TypeError('private fetch failure'), 'notes_provider_transport_failed'],
    [new Error('private unknown failure'), 'meeting_notes_latency_run_failed'],
  ])(
    'classifies failures without retaining their messages',
    (error, expected) => {
      const classification = classifyMeetingNotesLatencyError(error);
      expect(classification).toBe(expected);
      expect(classification).not.toContain('private');
    },
  );
});

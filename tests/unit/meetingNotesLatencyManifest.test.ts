import { describe, expect, it } from 'vitest';
import {
  aggregateMeetingNotesLatencySamples,
  assertContentFreeMeetingNotesLatencyReport,
  parsePrivateMeetingNotesLatencyManifest,
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
});

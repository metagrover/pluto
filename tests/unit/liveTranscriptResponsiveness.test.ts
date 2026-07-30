import { describe, expect, it } from 'vitest';
import {
  createLiveTranscriptResponsivenessAccumulator,
  parseLiveTranscriptResponsivenessSummary,
} from '../../src/utils/liveTranscriptResponsiveness';

describe('live transcript responsiveness accumulator', () => {
  it('measures first text and accepted publication cadence', () => {
    const accumulator = createLiveTranscriptResponsivenessAccumulator();

    accumulator.start(100);
    accumulator.publish(350, 2);
    accumulator.publish(800, 1);

    expect(accumulator.stop(1_000)).toEqual({
      schemaVersion: 1,
      status: 'available',
      firstTextLatencyMs: 250,
      acceptedPublicationCount: 2,
      cadenceSampleCount: 1,
      maximumUpdateGapMs: 450,
    });
  });

  it('ignores empty publications and leaves one publication without a gap', () => {
    const accumulator = createLiveTranscriptResponsivenessAccumulator();

    accumulator.start(100);
    accumulator.publish(200, 0);
    accumulator.publish(300, 1);

    expect(accumulator.stop(400)).toEqual({
      schemaVersion: 1,
      status: 'available',
      firstTextLatencyMs: 200,
      acceptedPublicationCount: 1,
      cadenceSampleCount: 0,
      maximumUpdateGapMs: null,
    });
  });

  it('reports unavailable evidence instead of zero when no live text arrives', () => {
    const accumulator = createLiveTranscriptResponsivenessAccumulator();

    accumulator.start(100);

    expect(accumulator.stop(400)).toEqual({
      schemaVersion: 1,
      status: 'unavailable',
      reason: 'no_accepted_live_text',
      acceptedPublicationCount: 0,
      cadenceSampleCount: 0,
      maximumUpdateGapMs: null,
    });
  });

  it('discards an aborted session without producing evidence', () => {
    const accumulator = createLiveTranscriptResponsivenessAccumulator();

    accumulator.start(100);
    accumulator.publish(200, 1);
    accumulator.discard();

    expect(accumulator.snapshot()).toBeNull();
  });

  it.each([
    {
      label: 'non-finite input before lifecycle validation',
      act: (
        accumulator: ReturnType<
          typeof createLiveTranscriptResponsivenessAccumulator
        >,
      ) => accumulator.publish(Number.NaN, 1),
      reason: 'non_monotonic_time',
    },
    {
      label: 'publication before start',
      act: (
        accumulator: ReturnType<
          typeof createLiveTranscriptResponsivenessAccumulator
        >,
      ) => accumulator.publish(100, 1),
      reason: 'event_before_start',
    },
    {
      label: 'decreasing time after start',
      act: (
        accumulator: ReturnType<
          typeof createLiveTranscriptResponsivenessAccumulator
        >,
      ) => {
        accumulator.start(100);
        accumulator.publish(200, 1);
        accumulator.publish(150, 1);
      },
      reason: 'non_monotonic_time',
    },
    {
      label: 'publication after stop',
      act: (
        accumulator: ReturnType<
          typeof createLiveTranscriptResponsivenessAccumulator
        >,
      ) => {
        accumulator.start(100);
        accumulator.stop(200);
        accumulator.publish(300, 1);
      },
      reason: 'publication_after_stop',
    },
    {
      label: 'duplicate stop',
      act: (
        accumulator: ReturnType<
          typeof createLiveTranscriptResponsivenessAccumulator
        >,
      ) => {
        accumulator.start(100);
        accumulator.stop(200);
        accumulator.stop(300);
      },
      reason: 'duplicate_stop',
    },
  ])('fails closed for $label', ({ act, reason }) => {
    const accumulator = createLiveTranscriptResponsivenessAccumulator();

    act(accumulator);

    expect(accumulator.snapshot()).toMatchObject({
      schemaVersion: 1,
      status: 'invalid',
      reason,
    });
    accumulator.publish(Number.NaN, 1);
    expect(accumulator.snapshot()).toMatchObject({ reason });
  });

  it('parses only the finite content-free summary schema', () => {
    expect(
      parseLiveTranscriptResponsivenessSummary({
        schemaVersion: 1,
        status: 'available',
        firstTextLatencyMs: 250,
        acceptedPublicationCount: 3,
        cadenceSampleCount: 2,
        maximumUpdateGapMs: 450,
        transcript: 'must not survive',
      }),
    ).toEqual({
      schemaVersion: 1,
      status: 'available',
      firstTextLatencyMs: 250,
      acceptedPublicationCount: 3,
      cadenceSampleCount: 2,
      maximumUpdateGapMs: 450,
    });
    expect(
      parseLiveTranscriptResponsivenessSummary({
        schemaVersion: 1,
        status: 'available',
        firstTextLatencyMs: Number.NaN,
        acceptedPublicationCount: 3,
        cadenceSampleCount: 2,
        maximumUpdateGapMs: 450,
      }),
    ).toBeNull();
  });

  it.each([
    {
      label: 'available evidence without a publication',
      value: {
        schemaVersion: 1,
        status: 'available',
        firstTextLatencyMs: 250,
        acceptedPublicationCount: 0,
        cadenceSampleCount: 0,
        maximumUpdateGapMs: null,
      },
    },
    {
      label: 'cadence count unrelated to publication count',
      value: {
        schemaVersion: 1,
        status: 'available',
        firstTextLatencyMs: 250,
        acceptedPublicationCount: 3,
        cadenceSampleCount: 1,
        maximumUpdateGapMs: 450,
      },
    },
    {
      label: 'a maximum gap without a cadence sample',
      value: {
        schemaVersion: 1,
        status: 'available',
        firstTextLatencyMs: 250,
        acceptedPublicationCount: 1,
        cadenceSampleCount: 0,
        maximumUpdateGapMs: 450,
      },
    },
    {
      label: 'unavailable evidence with accepted publications',
      value: {
        schemaVersion: 1,
        status: 'unavailable',
        reason: 'no_accepted_live_text',
        acceptedPublicationCount: 1,
        cadenceSampleCount: 0,
        maximumUpdateGapMs: null,
      },
    },
  ])('rejects contradictory persisted $label', ({ value }) => {
    expect(parseLiveTranscriptResponsivenessSummary(value)).toBeNull();
  });

  it('rejects a fractional accepted segment count', () => {
    const accumulator = createLiveTranscriptResponsivenessAccumulator();

    accumulator.start(100);
    accumulator.publish(200, 1.5);

    expect(accumulator.snapshot()).toMatchObject({
      status: 'invalid',
      reason: 'non_monotonic_time',
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  createStopToValidatedLatencyAccumulator,
  parseStopToValidatedLatencySummary,
} from '../../src/utils/stopToValidatedLatency';

describe('stop-to-validated latency', () => {
  it('measures from accepted stop through durable validated save', () => {
    const accumulator = createStopToValidatedLatencyAccumulator();

    expect(accumulator.acceptStop(100)).toEqual({
      outcome: 'recorded',
      summary: null,
    });
    expect(accumulator.completeValidatedSave(145)).toEqual({
      outcome: 'recorded',
      summary: { schemaVersion: 1, status: 'available', durationMs: 45 },
    });
    expect(accumulator.snapshot()).toEqual({
      schemaVersion: 1,
      status: 'available',
      durationMs: 45,
    });
  });

  it('preserves the first terminal summary', () => {
    const accumulator = createStopToValidatedLatencyAccumulator();
    accumulator.acceptStop(100);
    const terminal = accumulator.markUnavailable('not_validated');

    expect(accumulator.completeValidatedSave(200)).toEqual({
      outcome: 'already_terminal',
      summary: terminal.summary,
    });
    expect(accumulator.markUnavailable('recovery_required')).toEqual({
      outcome: 'already_terminal',
      summary: terminal.summary,
    });
  });

  it.each([
    {
      label: 'completion before start',
      act: () =>
        createStopToValidatedLatencyAccumulator().completeValidatedSave(100),
      reason: 'not_started',
    },
    {
      label: 'invalid stop timestamp',
      act: () =>
        createStopToValidatedLatencyAccumulator().acceptStop(Number.NaN),
      reason: 'invalid_timestamp',
    },
    {
      label: 'decreasing completion timestamp',
      act: () => {
        const accumulator = createStopToValidatedLatencyAccumulator();
        accumulator.acceptStop(100);
        return accumulator.completeValidatedSave(99);
      },
      reason: 'timestamp_regression',
    },
  ])('fails closed for $label', ({ act, reason }) => {
    expect(act()).toEqual({
      outcome: 'invalid',
      summary: { schemaVersion: 1, status: 'unavailable', reason },
    });
  });

  it('returns cloned snapshots', () => {
    const accumulator = createStopToValidatedLatencyAccumulator();
    accumulator.acceptStop(10);
    accumulator.completeValidatedSave(20);

    const snapshot = accumulator.snapshot();
    if (snapshot?.status === 'available') snapshot.durationMs = 999;

    expect(accumulator.snapshot()).toMatchObject({ durationMs: 10 });
  });

  it('strictly parses the content-free summary schema', () => {
    expect(
      parseStopToValidatedLatencySummary({
        schemaVersion: 1,
        status: 'available',
        durationMs: 45,
      }),
    ).toEqual({
      schemaVersion: 1,
      status: 'available',
      durationMs: 45,
    });
    expect(
      parseStopToValidatedLatencySummary({
        schemaVersion: 1,
        status: 'unavailable',
        reason: 'validated_save_failed',
      }),
    ).toEqual({
      schemaVersion: 1,
      status: 'unavailable',
      reason: 'validated_save_failed',
    });
  });

  it.each([
    {
      schemaVersion: 1,
      status: 'available',
      durationMs: 1,
      transcript: 'private',
    },
    { schemaVersion: 2, status: 'available', durationMs: 1 },
    { schemaVersion: 1, status: 'available', durationMs: 1.5 },
    { schemaVersion: 1, status: 'available', durationMs: -1 },
    {
      schemaVersion: 1,
      status: 'unavailable',
      reason: 'not_validated',
      durationMs: 0,
    },
    { schemaVersion: 1, status: 'unavailable', reason: 'other' },
  ])('rejects malformed or expanded summaries: %#', (value) => {
    expect(parseStopToValidatedLatencySummary(value)).toBeNull();
  });
});

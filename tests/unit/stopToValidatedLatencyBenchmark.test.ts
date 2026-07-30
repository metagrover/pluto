import { describe, expect, it } from 'vitest';
import {
  type StopToValidatedLatencyFixture,
  runStopToValidatedLatencyBenchmarkCase,
} from '../../src/services/recordingQualityBenchmark';

describe('stop-to-validated latency benchmark', () => {
  it('gates deterministic lifecycle traces against exact summaries', () => {
    const fixture: StopToValidatedLatencyFixture = {
      type: 'stop_to_validated_latency',
      scenarios: [
        {
          id: 'healthy',
          events: [
            { type: 'accept_stop', atMs: 100 },
            { type: 'complete_validated_save', atMs: 145 },
          ],
          expected: {
            schemaVersion: 1,
            status: 'available',
            durationMs: 45,
          },
        },
        {
          id: 'not-validated',
          events: [
            { type: 'accept_stop', atMs: 100 },
            { type: 'mark_unavailable', reason: 'not_validated' },
          ],
          expected: {
            schemaVersion: 1,
            status: 'unavailable',
            reason: 'not_validated',
          },
        },
        {
          id: 'decreasing',
          events: [
            { type: 'accept_stop', atMs: 100 },
            { type: 'complete_validated_save', atMs: 99 },
          ],
          expected: {
            schemaVersion: 1,
            status: 'unavailable',
            reason: 'timestamp_regression',
          },
        },
      ],
      expected: {
        status: 'validated',
        primaryMetric: { name: 'durationMs', value: 45 },
      },
    };

    expect(
      runStopToValidatedLatencyBenchmarkCase(
        {
          id: 'issue-551-stop-to-validated-latency',
          issue: 551,
          title: 'Synthetic stop-to-validated latency',
          kind: 'stop_to_validated_latency',
          fixture: 'fixture.json',
          tier: 'pr',
        },
        fixture,
      ),
    ).toMatchObject({
      passed: true,
      actual: {
        status: 'validated',
        primaryMetric: { name: 'durationMs', value: 45 },
      },
    });
  });
});

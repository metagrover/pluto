import { describe, expect, it } from 'vitest';
import { createLiveTranscriptResponsivenessRuntime } from '../../src/utils/liveTranscriptResponsiveness';

describe('live transcript responsiveness runtime wiring', () => {
  it('uses the injected monotonic clock at accepted runtime boundaries', () => {
    const times = [100, 350, 800, 1_000];
    const runtime = createLiveTranscriptResponsivenessRuntime({
      now: () => times.shift() ?? Number.NaN,
    });

    runtime.acceptStart();
    runtime.publishAcceptedSegments(
      [{ text: 'first' }, { text: 'second' }],
      () => {},
    );
    runtime.publishAcceptedSegments([{ text: 'third' }], () => {});

    expect(runtime.freezeBeforeFinalization()).toEqual({
      schemaVersion: 1,
      status: 'available',
      firstTextLatencyMs: 250,
      acceptedPublicationCount: 2,
      cadenceSampleCount: 1,
      maximumUpdateGapMs: 450,
    });
  });

  it('ignores empty accepted sets and discards aborted starts', () => {
    const times = [100, 200];
    const runtime = createLiveTranscriptResponsivenessRuntime({
      now: () => times.shift() ?? Number.NaN,
    });

    runtime.acceptStart();
    runtime.publishAcceptedSegments([{ text: '   ' }], () => {});
    runtime.abortStart();

    expect(runtime.snapshot()).toBeNull();
  });

  it('records newly accepted non-empty segments before forwarding the unchanged payload', () => {
    const times = [100, 350, 500];
    const runtime = createLiveTranscriptResponsivenessRuntime({
      now: () => times.shift() ?? Number.NaN,
    });
    const aggregate = [{ text: 'existing' }, { text: 'new' }];
    let forwarded: typeof aggregate | null = null;

    runtime.acceptStart();
    runtime.publishAcceptedSegments([{ text: '' }, { text: 'new' }], () => {
      forwarded = aggregate;
    });
    const summary = runtime.freezeBeforeFinalization();

    expect(forwarded).toBe(aggregate);
    expect(summary).toMatchObject({
      status: 'available',
      acceptedPublicationCount: 1,
      firstTextLatencyMs: 250,
    });
  });
});

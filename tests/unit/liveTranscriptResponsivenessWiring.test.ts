import { describe, expect, it } from 'vitest';
import { createLiveTranscriptResponsivenessRuntime } from '../../src/utils/liveTranscriptResponsiveness';

describe('live transcript responsiveness runtime wiring', () => {
  it('uses the injected monotonic clock at accepted runtime boundaries', () => {
    const times = [100, 350, 800, 1_000];
    const runtime = createLiveTranscriptResponsivenessRuntime({
      now: () => times.shift() ?? Number.NaN,
    });

    runtime.start();
    runtime.publish(2);
    runtime.publish(1);

    expect(runtime.stop()).toEqual({
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

    runtime.start();
    runtime.publish(0);
    runtime.discard();

    expect(runtime.snapshot()).toBeNull();
  });
});

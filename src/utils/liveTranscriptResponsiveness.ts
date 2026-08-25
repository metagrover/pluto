export type LiveTranscriptResponsivenessInvalidReason =
  | 'event_before_start'
  | 'non_monotonic_time'
  | 'duplicate_stop'
  | 'speech_after_stop'
  | 'publication_after_stop';

type LiveTranscriptResponsivenessBase = {
  schemaVersion: 1;
  acceptedPublicationCount: number;
  cadenceSampleCount: number;
  maximumUpdateGapMs: number | null;
};

export type LiveTranscriptResponsivenessSummary =
  | (LiveTranscriptResponsivenessBase & {
      status: 'available';
      firstTextLatencyMs: number;
      firstSpeechToTextLatencyMs?: number;
    })
  | (LiveTranscriptResponsivenessBase & {
      status: 'unavailable';
      reason: 'no_accepted_live_text';
    })
  | (LiveTranscriptResponsivenessBase & {
      status: 'invalid';
      reason: LiveTranscriptResponsivenessInvalidReason;
    });

export type LiveTranscriptResponsivenessAccumulator = {
  start(atMs: number): void;
  detectSpeech(atMs: number): void;
  publish(atMs: number, acceptedSegmentCount: number): void;
  stop(atMs: number): LiveTranscriptResponsivenessSummary;
  discard(): void;
  snapshot(): LiveTranscriptResponsivenessSummary | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value >= 0;

const isNonNegativeFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const parseLiveTranscriptResponsivenessSummary = (
  value: unknown,
): LiveTranscriptResponsivenessSummary | null => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isNonNegativeInteger(value.acceptedPublicationCount) ||
    !isNonNegativeInteger(value.cadenceSampleCount) ||
    !(
      value.maximumUpdateGapMs === null ||
      isNonNegativeFinite(value.maximumUpdateGapMs)
    )
  ) {
    return null;
  }

  const base = {
    schemaVersion: 1 as const,
    acceptedPublicationCount: value.acceptedPublicationCount,
    cadenceSampleCount: value.cadenceSampleCount,
    maximumUpdateGapMs: value.maximumUpdateGapMs,
  };
  const expectedCadenceSampleCount = Math.max(
    value.acceptedPublicationCount - 1,
    0,
  );
  const cadenceIsConsistent =
    value.cadenceSampleCount === expectedCadenceSampleCount &&
    (value.cadenceSampleCount === 0
      ? value.maximumUpdateGapMs === null
      : value.maximumUpdateGapMs !== null);
  if (!cadenceIsConsistent) return null;

  if (
    value.status === 'available' &&
    value.acceptedPublicationCount > 0 &&
    isNonNegativeFinite(value.firstTextLatencyMs) &&
    (value.firstSpeechToTextLatencyMs === undefined ||
      isNonNegativeFinite(value.firstSpeechToTextLatencyMs))
  ) {
    return {
      ...base,
      status: 'available',
      firstTextLatencyMs: value.firstTextLatencyMs,
      ...(value.firstSpeechToTextLatencyMs === undefined
        ? {}
        : { firstSpeechToTextLatencyMs: value.firstSpeechToTextLatencyMs }),
    };
  }
  if (
    value.status === 'unavailable' &&
    value.reason === 'no_accepted_live_text' &&
    value.acceptedPublicationCount === 0
  ) {
    return { ...base, status: 'unavailable', reason: value.reason };
  }
  const invalidReasons: LiveTranscriptResponsivenessInvalidReason[] = [
    'event_before_start',
    'non_monotonic_time',
    'duplicate_stop',
    'speech_after_stop',
    'publication_after_stop',
  ];
  if (
    value.status === 'invalid' &&
    invalidReasons.includes(
      value.reason as LiveTranscriptResponsivenessInvalidReason,
    )
  ) {
    return {
      ...base,
      status: 'invalid',
      reason: value.reason as LiveTranscriptResponsivenessInvalidReason,
    };
  }
  return null;
};

export const createLiveTranscriptResponsivenessAccumulator =
  (): LiveTranscriptResponsivenessAccumulator => {
    let startedAtMs: number | null = null;
    let publicationTimesMs: number[] = [];
    let firstSpeechAtMs: number | null = null;
    let lastEventAtMs: number | null = null;
    let stopped = false;
    let summary: LiveTranscriptResponsivenessSummary | null = null;

    const cadence = () => {
      const gaps = publicationTimesMs
        .slice(1)
        .map((time, index) => time - publicationTimesMs[index]);
      return {
        acceptedPublicationCount: publicationTimesMs.length,
        cadenceSampleCount: gaps.length,
        maximumUpdateGapMs: gaps.length === 0 ? null : Math.max(...gaps),
      };
    };

    const invalidate = (reason: LiveTranscriptResponsivenessInvalidReason) => {
      if (summary?.status === 'invalid') return;
      summary = {
        schemaVersion: 1,
        status: 'invalid',
        reason,
        ...cadence(),
      };
    };

    const invalidTime = (atMs: number) => !Number.isFinite(atMs) || atMs < 0;

    const start = (atMs: number) => {
      if (invalidTime(atMs)) {
        invalidate('non_monotonic_time');
        return;
      }
      startedAtMs = atMs;
      publicationTimesMs = [];
      firstSpeechAtMs = null;
      lastEventAtMs = atMs;
      stopped = false;
      summary = null;
    };

    const detectSpeech = (atMs: number) => {
      if (
        summary?.status === 'invalid' ||
        firstSpeechAtMs !== null ||
        publicationTimesMs.length > 0
      ) {
        return;
      }
      if (invalidTime(atMs)) {
        invalidate('non_monotonic_time');
        return;
      }
      if (startedAtMs === null) {
        invalidate('event_before_start');
        return;
      }
      if (stopped) {
        invalidate('speech_after_stop');
        return;
      }
      if (lastEventAtMs !== null && atMs < lastEventAtMs) {
        invalidate('non_monotonic_time');
        return;
      }
      firstSpeechAtMs = atMs;
      lastEventAtMs = atMs;
    };

    const publish = (atMs: number, acceptedSegmentCount: number) => {
      if (summary?.status === 'invalid') return;
      if (
        invalidTime(atMs) ||
        !Number.isFinite(acceptedSegmentCount) ||
        !Number.isInteger(acceptedSegmentCount) ||
        acceptedSegmentCount < 0
      ) {
        invalidate('non_monotonic_time');
        return;
      }
      if (startedAtMs === null) {
        invalidate('event_before_start');
        return;
      }
      if (stopped) {
        invalidate('publication_after_stop');
        return;
      }
      if (lastEventAtMs !== null && atMs < lastEventAtMs) {
        invalidate('non_monotonic_time');
        return;
      }
      lastEventAtMs = atMs;
      if (acceptedSegmentCount > 0) publicationTimesMs.push(atMs);
    };

    const stop = (atMs: number): LiveTranscriptResponsivenessSummary => {
      if (summary?.status === 'invalid') return summary;
      if (invalidTime(atMs)) {
        invalidate('non_monotonic_time');
        return summary as LiveTranscriptResponsivenessSummary;
      }
      if (startedAtMs === null) {
        invalidate('event_before_start');
        return summary as LiveTranscriptResponsivenessSummary;
      }
      if (stopped) {
        invalidate('duplicate_stop');
        return summary as LiveTranscriptResponsivenessSummary;
      }
      if (lastEventAtMs !== null && atMs < lastEventAtMs) {
        invalidate('non_monotonic_time');
        return summary as LiveTranscriptResponsivenessSummary;
      }
      stopped = true;
      lastEventAtMs = atMs;

      if (publicationTimesMs.length === 0) {
        summary = {
          schemaVersion: 1,
          status: 'unavailable',
          reason: 'no_accepted_live_text',
          acceptedPublicationCount: 0,
          cadenceSampleCount: 0,
          maximumUpdateGapMs: null,
        };
        return summary;
      }

      summary = {
        schemaVersion: 1,
        status: 'available',
        firstTextLatencyMs: publicationTimesMs[0] - startedAtMs,
        ...(firstSpeechAtMs === null
          ? {}
          : {
              firstSpeechToTextLatencyMs:
                publicationTimesMs[0] - firstSpeechAtMs,
            }),
        ...cadence(),
      };
      return summary;
    };

    return {
      start,
      detectSpeech,
      publish,
      stop,
      discard: () => {
        startedAtMs = null;
        publicationTimesMs = [];
        firstSpeechAtMs = null;
        lastEventAtMs = null;
        stopped = false;
        summary = null;
      },
      snapshot: () => summary,
    };
  };

export const createLiveTranscriptResponsivenessRuntime = ({
  now,
}: {
  now: () => number;
}) => {
  const accumulator = createLiveTranscriptResponsivenessAccumulator();

  return {
    acceptStart: () => accumulator.start(now()),
    detectSpeech: () => accumulator.detectSpeech(now()),
    publishAcceptedSegments: <T extends { text: string }>(
      acceptedSegments: T[],
      publish: () => void,
    ) => {
      const acceptedSegmentCount = acceptedSegments.filter(
        (segment) => segment.text.trim().length > 0,
      ).length;
      accumulator.publish(now(), acceptedSegmentCount);
      publish();
    },
    freezeBeforeFinalization: () => accumulator.stop(now()),
    abortStart: () => accumulator.discard(),
    snapshot: () => accumulator.snapshot(),
  };
};

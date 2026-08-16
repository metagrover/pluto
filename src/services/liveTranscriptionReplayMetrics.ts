export const LIVE_REPLAY_THRESHOLDS = Object.freeze({
  firstTextP50Seconds: 5,
  firstTextP95Seconds: 8,
  firstTextP95RegressionSeconds: 1,
  firstTextMaximumSeconds: 12,
  publicationCadenceP50Seconds: 3,
  publicationCadenceP95Seconds: 5,
  publicationCadenceMaximumSeconds: 8,
  processingLatencyP95Seconds: 2,
  processingLatencyMaximumSeconds: 5,
  runtimeFactor: 0.5,
  runtimeFactorRegressionRatio: 1.2,
  captureHandoffP99Milliseconds: 10,
  peakRssGiB: 2.5,
  rssAboveIdleGiB: 1.5,
  rssGrowthMiBPerHour: 64,
  fairThermalFraction: 0.1,
  fairThermalContinuousSeconds: 300,
  volatileOperationsPerNewToken: 0.15,
  rollbackP95Tokens: 3,
  revisionMaximumAgeSeconds: 6,
  seamErrorRate: 0.005,
  batchEditRate: 0.1,
  batchPrecisionAt2Seconds: 0.9,
  batchRecallAt2Seconds: 0.9,
  batchPrecisionAt5Seconds: 0.95,
  batchRecallAt5Seconds: 0.95,
  proxyDisagreementRegression: 0.02,
  proxyRecallRegression: 0.02,
  repairContextSeconds: 2,
  repairTokenF1: 0.98,
});

export interface LiveReplayPublication {
  availableAtSeconds: number;
  lookaheadReadyAtSeconds: number;
  completedAtSeconds: number;
  audioEndSeconds: number;
  changed: boolean;
  activeSpeech: boolean;
  newTokenCount: number;
  rollbackTokens: number;
  volatileOperationCount: number;
  revisionAgeSeconds: number;
}

export interface LiveReplayCoverageReceipt {
  receipt: number;
  startSeconds: number;
  endSeconds: number;
}

export interface LiveReplayRepetition {
  firstSealedActivitySeconds: number;
  publications: LiveReplayPublication[];
  committedSnapshots: string[];
  acceptedSequences: number[];
  processedSequences: number[];
  acceptedCoverage: LiveReplayCoverageReceipt[];
  processedCoverage: LiveReplayCoverageReceipt[];
  expectedSourceSeconds: number;
  processedSourceSeconds: number;
  inferenceSeconds: number;
  seamDuplicateTokens: number;
  seamOmittedTokens: number;
  seamReferenceTokens: number;
  committedSyntheticSeamDuplicateTokens: number;
  committedSyntheticSeamOmittedTokens: number;
  overlappingCommittedTokenProvenance?: number;
  batchDiagnostic: {
    editRate: number;
    precisionAt2Seconds: number;
    recallAt2Seconds: number;
    precisionAt5Seconds: number;
    recallAt5Seconds: number;
  };
  proxy: {
    disagreementRate: number;
    alignedRecall: number;
    mlxDisagreementRate: number;
    mlxAlignedRecall: number;
  };
  repair: {
    exactGapDetected: boolean;
    contextBeforeSeconds: number;
    contextAfterSeconds: number;
    outsideContextTokenChanges: number;
    repairedTokenF1: number;
  };
  captureHandoffMilliseconds: number[];
  rendererInferenceCallbacks: number;
  wholeSessionAsrCalls: number;
  analysisBeforeCanonicalCommit: number;
}

export interface LiveReplayResourceSoak {
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  sourceDurationSeconds: number;
  soakStartSeconds: number;
  soakEndSeconds: number;
  warmupEndSeconds: number;
  sampleIntervalSeconds: 1;
  realTime: true;
  longestSource: true;
  preparedIdleRssGiB: number;
  peakRssGiB: number;
  rssSamples: Array<{ atSeconds: number; rssGiB: number }>;
  thermalSamples: Array<{
    atSeconds: number;
    state: 'nominal' | 'fair' | 'serious' | 'critical';
  }>;
}

export interface LiveReplayEvidence {
  corpusEligible?: boolean;
  aecEvidenceAvailable?: boolean;
  resourceEvidenceAvailable?: boolean;
  engineOrderAlternated?: boolean;
  mlxProductionQueueVerified?: boolean;
  resourceSoak?: LiveReplayResourceSoak;
  mlxBaseline?: {
    firstTextP95Seconds: number;
    runtimeFactor: number;
  };
}

export type LiveReplayStatus = 'pass' | 'fail' | 'unavailable';

export interface LiveReplayVerdict {
  status: LiveReplayStatus;
  metrics: Record<string, number | boolean | string>;
  invariants: Record<string, number>;
  failures: string[];
}

export type PrivateLiveReplayReport = {
  schemaVersion: 1;
  benchmark: 'parakeet_live_causal_replay';
  referencePolicy: {
    batchParakeet: 'consistency_diagnostic_not_ground_truth';
    persistedCanonical: 'existing_local_transcript_proxy_not_human_ground_truth';
  };
  corpus: {
    meetingCount: number;
    sourceCount: number;
    audioMinutesRoundedTo5: number;
  };
  runtime: {
    fluidAudioVersion: string;
    fluidAudioRevision: string;
    modelId: string;
    configId: string;
  };
  engines: Record<
    'mlxProduction' | 'parakeetSliding',
    {
      status: LiveReplayStatus;
      metrics: Record<string, number | boolean | string>;
    }
  >;
  invariants: Record<string, number>;
  failures: string[];
};

const requireFinite = (values: readonly number[]): void => {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('live_replay_invalid_number');
  }
};

export const percentile = (
  values: readonly number[],
  quantile: number,
): number => {
  if (values.length === 0) throw new Error('live_replay_empty_values');
  requireFinite(values);
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new Error('live_replay_invalid_percentile');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
};

export const bootstrapConfidenceInterval = (
  values: readonly number[],
  options: {
    seed?: number;
    samples?: number;
    statistic?: (sample: readonly number[]) => number;
  } = {},
): { estimate: number; lower: number; upper: number } => {
  if (values.length === 0) throw new Error('live_replay_empty_values');
  requireFinite(values);
  const samples = options.samples ?? 1_000;
  const seed = options.seed ?? 630;
  if (
    !Number.isSafeInteger(samples) ||
    samples <= 0 ||
    !Number.isSafeInteger(seed)
  ) {
    throw new Error('live_replay_invalid_bootstrap');
  }
  const statistic =
    options.statistic ??
    ((sample: readonly number[]) =>
      sample.reduce((total, value) => total + value, 0) / sample.length);
  const estimate = statistic(values);
  if (!Number.isFinite(estimate)) throw new Error('live_replay_invalid_number');

  let state = seed >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const estimates: number[] = [];
  for (let iteration = 0; iteration < samples; iteration += 1) {
    const sample = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)],
    );
    const value = statistic(sample);
    if (!Number.isFinite(value)) throw new Error('live_replay_invalid_number');
    estimates.push(value);
  }
  return {
    estimate,
    lower: percentile(estimates, 0.025),
    upper: percentile(estimates, 0.975),
  };
};

const finiteMetric = (value: number): number => {
  if (!Number.isFinite(value)) throw new Error('live_replay_invalid_number');
  return value;
};

const bootstrapUpper = (values: readonly number[], quantile: number): number =>
  bootstrapConfidenceInterval(values, {
    samples: 1_000,
    seed: 630,
    statistic: (sample) => percentile(sample, quantile),
  }).upper;

const requireNonNegative = (values: readonly number[]): void => {
  requireFinite(values);
  if (values.some((value) => value < 0)) {
    throw new Error('live_replay_invalid_observation');
  }
};

const requireUnitInterval = (values: readonly number[]): void => {
  requireFinite(values);
  if (values.some((value) => value < 0 || value > 1)) {
    throw new Error('live_replay_invalid_observation');
  }
};

const requireCounts = (values: readonly number[]): void => {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('live_replay_invalid_observation');
  }
};

const countCommittedPrefixViolations = (snapshots: readonly string[]): number =>
  snapshots
    .slice(1)
    .reduce(
      (count, snapshot, index) =>
        count + Number(!snapshot.startsWith(snapshots[index])),
      0,
    );

const rssGrowthMiBPerHour = (
  samples: readonly { atSeconds: number; rssGiB: number }[],
): number => {
  if (samples.length < 2) return Number.NaN;
  const sorted = [...samples].sort(
    (left, right) => left.atSeconds - right.atSeconds,
  );
  requireFinite(sorted.flatMap((sample) => [sample.atSeconds, sample.rssGiB]));
  const meanTime =
    sorted.reduce((total, sample) => total + sample.atSeconds, 0) /
    sorted.length;
  const meanRss =
    sorted.reduce((total, sample) => total + sample.rssGiB, 0) / sorted.length;
  const covariance = sorted.reduce(
    (total, sample) =>
      total + (sample.atSeconds - meanTime) * (sample.rssGiB - meanRss),
    0,
  );
  const timeVariance = sorted.reduce(
    (total, sample) => total + (sample.atSeconds - meanTime) ** 2,
    0,
  );
  if (timeVariance <= 0) return Number.NaN;
  return (covariance / timeVariance) * 1024 * 3600;
};

const longestFairRunSeconds = (
  samples: readonly LiveReplayResourceSoak['thermalSamples'][number][],
): number => {
  const sorted = [...samples].sort(
    (left, right) => left.atSeconds - right.atSeconds,
  );
  let runStart: number | undefined;
  let maximum = 0;
  for (const sample of sorted) {
    if (sample.state === 'fair') {
      runStart ??= sample.atSeconds;
      maximum = Math.max(maximum, sample.atSeconds - runStart);
    } else {
      runStart = undefined;
    }
  }
  return maximum;
};

const addFailure = (
  failures: Set<string>,
  condition: boolean,
  code: string,
): void => {
  if (condition) failures.add(code);
};

const maximum = (values: readonly number[]): number =>
  values.length === 0 ? 0 : Math.max(...values);

const minimum = (values: readonly number[]): number =>
  values.length === 0 ? 0 : Math.min(...values);

const samplesHaveCadence = (
  samples: readonly { atSeconds: number }[],
  interval: number,
): boolean =>
  samples.length >= 2 &&
  samples.every(
    (sample, index) =>
      index === 0 ||
      Math.abs(sample.atSeconds - samples[index - 1].atSeconds - interval) <
        1e-9,
  );

export const evaluateLiveReplay = (
  repetitions: readonly LiveReplayRepetition[],
  evidence: LiveReplayEvidence = {},
): LiveReplayVerdict => {
  if (repetitions.length === 0) {
    return {
      status: 'unavailable',
      metrics: {},
      invariants: {},
      failures: ['insufficient_corpus'],
    };
  }

  const failures = new Set<string>();
  const firstText: number[] = [];
  const cadence: number[] = [];
  const processingLatency: number[] = [];
  const runtimeFactors: number[] = [];
  const rollbacks: number[] = [];
  const handoffs: number[] = [];
  const rssGrowth: number[] = [];
  const peaks: number[] = [];
  const peakDeltas: number[] = [];
  const fairFractions: number[] = [];
  const fairRuns: number[] = [];
  const revisionAges: number[] = [];
  const seamRates: number[] = [];
  const batchEditRates: number[] = [];
  const batchPrecision2: number[] = [];
  const batchRecall2: number[] = [];
  const batchPrecision5: number[] = [];
  const batchRecall5: number[] = [];
  const proxyDisagreementRegression: number[] = [];
  const proxyRecallRegression: number[] = [];
  const repairContexts: number[] = [];
  const repairF1: number[] = [];
  let committedPrefixViolations = 0;
  let missingAcceptedSequences = 0;
  let overlappingDuplicateTokenProvenance = 0;
  let incompleteSourceCoverage = 0;
  let unexpectedProcessedSequences = 0;
  let committedSyntheticSeamErrors = 0;
  let rendererInferenceCallbacks = 0;
  let wholeSessionAsrCallsWhenComplete = 0;
  let analysisBeforeCanonicalCommit = 0;
  let processedSeconds = 0;
  let expectedSeconds = 0;
  let newTokens = 0;
  let volatileOperations = 0;

  for (const repetition of repetitions) {
    const nonNegativeInputs = [
      repetition.firstSealedActivitySeconds,
      repetition.expectedSourceSeconds,
      repetition.processedSourceSeconds,
      repetition.inferenceSeconds,
      repetition.seamDuplicateTokens,
      repetition.seamOmittedTokens,
      repetition.seamReferenceTokens,
      ...repetition.captureHandoffMilliseconds,
      repetition.repair.contextBeforeSeconds,
      repetition.repair.contextAfterSeconds,
    ];
    requireNonNegative(nonNegativeInputs);
    requireUnitInterval([
      ...Object.values(repetition.batchDiagnostic),
      ...Object.values(repetition.proxy),
      repetition.repair.repairedTokenF1,
    ]);
    requireCounts([
      repetition.seamDuplicateTokens,
      repetition.seamOmittedTokens,
      repetition.seamReferenceTokens,
      repetition.repair.outsideContextTokenChanges,
      repetition.wholeSessionAsrCalls,
      repetition.analysisBeforeCanonicalCommit,
      repetition.overlappingCommittedTokenProvenance ?? 0,
      repetition.committedSyntheticSeamDuplicateTokens,
      repetition.committedSyntheticSeamOmittedTokens,
      repetition.rendererInferenceCallbacks,
      ...repetition.acceptedSequences,
      ...repetition.processedSequences,
    ]);
    if (
      repetition.expectedSourceSeconds <= 0 ||
      repetition.processedSourceSeconds > repetition.expectedSourceSeconds ||
      repetition.seamReferenceTokens <= 0 ||
      new Set(repetition.acceptedSequences).size !==
        repetition.acceptedSequences.length ||
      new Set(repetition.processedSequences).size !==
        repetition.processedSequences.length
    ) {
      throw new Error('live_replay_invalid_observation');
    }
    const changed = repetition.publications.filter(
      (publication) => publication.changed,
    );
    const activeChanged = changed.filter(
      (publication) => publication.activeSpeech,
    );
    requireFinite(
      repetition.publications.flatMap((publication) => [
        publication.availableAtSeconds,
        publication.lookaheadReadyAtSeconds,
        publication.completedAtSeconds,
        publication.audioEndSeconds,
        publication.newTokenCount,
        publication.rollbackTokens,
        publication.volatileOperationCount,
        publication.revisionAgeSeconds,
      ]),
    );
    for (const publication of repetition.publications) {
      requireCounts([
        publication.newTokenCount,
        publication.rollbackTokens,
        publication.volatileOperationCount,
      ]);
      if (
        publication.availableAtSeconds < 0 ||
        publication.lookaheadReadyAtSeconds < publication.availableAtSeconds ||
        publication.completedAtSeconds < publication.lookaheadReadyAtSeconds ||
        publication.audioEndSeconds < 0 ||
        publication.revisionAgeSeconds < 0
      ) {
        throw new Error('live_replay_invalid_observation');
      }
    }
    if (changed.length === 0) {
      failures.add('first_text_missing');
    } else {
      const firstTextLatency =
        changed[0].completedAtSeconds - repetition.firstSealedActivitySeconds;
      if (firstTextLatency < 0) {
        throw new Error('live_replay_invalid_observation');
      }
      firstText.push(firstTextLatency);
      for (let index = 1; index < activeChanged.length; index += 1) {
        const interval =
          activeChanged[index].completedAtSeconds -
          activeChanged[index - 1].completedAtSeconds;
        if (interval < 0) throw new Error('live_replay_invalid_observation');
        cadence.push(interval);
      }
    }
    for (const publication of repetition.publications) {
      if (publication.activeSpeech) {
        processingLatency.push(
          publication.completedAtSeconds - publication.lookaheadReadyAtSeconds,
        );
      }
      newTokens += publication.newTokenCount;
      volatileOperations += publication.volatileOperationCount;
      rollbacks.push(publication.rollbackTokens);
      revisionAges.push(publication.revisionAgeSeconds);
      addFailure(
        failures,
        publication.revisionAgeSeconds >
          LIVE_REPLAY_THRESHOLDS.revisionMaximumAgeSeconds,
        'volatile_revision_age',
      );
    }
    committedPrefixViolations += countCommittedPrefixViolations(
      repetition.committedSnapshots,
    );
    const processed = new Set(repetition.processedSequences);
    const accepted = new Set(repetition.acceptedSequences);
    missingAcceptedSequences += repetition.acceptedSequences.filter(
      (sequence) => !processed.has(sequence),
    ).length;
    unexpectedProcessedSequences += repetition.processedSequences.filter(
      (sequence) => !accepted.has(sequence),
    ).length;
    requireCounts([
      ...repetition.acceptedCoverage.map(({ receipt }) => receipt),
      ...repetition.processedCoverage.map(({ receipt }) => receipt),
    ]);
    requireNonNegative(
      [...repetition.acceptedCoverage, ...repetition.processedCoverage].flatMap(
        ({ startSeconds, endSeconds }) => [startSeconds, endSeconds],
      ),
    );
    const acceptedRanges = new Map(
      repetition.acceptedCoverage.map((range) => [range.receipt, range]),
    );
    const processedRanges = new Map(
      repetition.processedCoverage.map((range) => [range.receipt, range]),
    );
    if (
      acceptedRanges.size !== repetition.acceptedCoverage.length ||
      processedRanges.size !== repetition.processedCoverage.length ||
      [...acceptedRanges.values(), ...processedRanges.values()].some(
        ({ startSeconds, endSeconds }) =>
          endSeconds <= startSeconds ||
          endSeconds > repetition.expectedSourceSeconds,
      )
    ) {
      throw new Error('live_replay_invalid_observation');
    }
    let coverageErrors = 0;
    if (
      repetition.acceptedCoverage.some(
        ({ receipt }) => !accepted.has(receipt),
      ) ||
      repetition.processedCoverage.some(
        ({ receipt }) => !processed.has(receipt),
      ) ||
      repetition.acceptedSequences.some(
        (receipt) => !acceptedRanges.has(receipt),
      ) ||
      repetition.processedSequences.some(
        (receipt) => !processedRanges.has(receipt),
      )
    ) {
      coverageErrors += 1;
    }
    for (const [receipt, range] of acceptedRanges) {
      const observed = processedRanges.get(receipt);
      if (
        (observed && observed.startSeconds !== range.startSeconds) ||
        (observed && observed.endSeconds !== range.endSeconds)
      )
        coverageErrors += 1;
    }
    unexpectedProcessedSequences += [...processedRanges.keys()].filter(
      (receipt) => !acceptedRanges.has(receipt),
    ).length;
    const sortedCoverage = [...processedRanges.values()].sort(
      (left, right) => left.startSeconds - right.startSeconds,
    );
    let coverageCursor = 0;
    let coveredSeconds = 0;
    for (const range of sortedCoverage) {
      if (range.startSeconds !== coverageCursor) coverageErrors += 1;
      coveredSeconds += range.endSeconds - range.startSeconds;
      coverageCursor = range.endSeconds;
    }
    if (
      coverageCursor !== repetition.expectedSourceSeconds ||
      coveredSeconds !== repetition.processedSourceSeconds
    )
      coverageErrors += 1;
    overlappingDuplicateTokenProvenance +=
      repetition.overlappingCommittedTokenProvenance ?? 0;
    const complete =
      coverageErrors === 0 &&
      acceptedRanges.size === processedRanges.size &&
      repetition.processedSourceSeconds === repetition.expectedSourceSeconds;
    incompleteSourceCoverage += Number(!complete) + coverageErrors;
    wholeSessionAsrCallsWhenComplete += complete
      ? repetition.wholeSessionAsrCalls
      : 0;
    analysisBeforeCanonicalCommit += repetition.analysisBeforeCanonicalCommit;
    processedSeconds += repetition.processedSourceSeconds;
    expectedSeconds += repetition.expectedSourceSeconds;
    runtimeFactors.push(
      repetition.inferenceSeconds / repetition.expectedSourceSeconds,
    );
    handoffs.push(...repetition.captureHandoffMilliseconds);
    committedSyntheticSeamErrors +=
      repetition.committedSyntheticSeamDuplicateTokens +
      repetition.committedSyntheticSeamOmittedTokens;
    rendererInferenceCallbacks += repetition.rendererInferenceCallbacks;
    if (repetition.captureHandoffMilliseconds.length === 0) {
      failures.add('resource_evidence_unavailable');
    }

    const seamErrorRate =
      (repetition.seamDuplicateTokens + repetition.seamOmittedTokens) /
      Math.max(1, repetition.seamReferenceTokens);
    seamRates.push(seamErrorRate);
    addFailure(
      failures,
      seamErrorRate > LIVE_REPLAY_THRESHOLDS.seamErrorRate,
      'seam_error_rate',
    );
    const batch = repetition.batchDiagnostic;
    batchEditRates.push(batch.editRate);
    batchPrecision2.push(batch.precisionAt2Seconds);
    batchRecall2.push(batch.recallAt2Seconds);
    batchPrecision5.push(batch.precisionAt5Seconds);
    batchRecall5.push(batch.recallAt5Seconds);
    addFailure(
      failures,
      batch.editRate > LIVE_REPLAY_THRESHOLDS.batchEditRate ||
        batch.precisionAt2Seconds <
          LIVE_REPLAY_THRESHOLDS.batchPrecisionAt2Seconds ||
        batch.recallAt2Seconds < LIVE_REPLAY_THRESHOLDS.batchRecallAt2Seconds ||
        batch.precisionAt5Seconds <
          LIVE_REPLAY_THRESHOLDS.batchPrecisionAt5Seconds ||
        batch.recallAt5Seconds < LIVE_REPLAY_THRESHOLDS.batchRecallAt5Seconds,
      'batch_agreement',
    );
    const proxy = repetition.proxy;
    proxyDisagreementRegression.push(
      proxy.disagreementRate - proxy.mlxDisagreementRate,
    );
    proxyRecallRegression.push(proxy.mlxAlignedRecall - proxy.alignedRecall);
    addFailure(
      failures,
      proxy.disagreementRate >
        proxy.mlxDisagreementRate +
          LIVE_REPLAY_THRESHOLDS.proxyDisagreementRegression ||
        proxy.alignedRecall <
          proxy.mlxAlignedRecall - LIVE_REPLAY_THRESHOLDS.proxyRecallRegression,
      'proxy_non_regression',
    );
    const repair = repetition.repair;
    repairContexts.push(
      repair.contextBeforeSeconds,
      repair.contextAfterSeconds,
    );
    repairF1.push(repair.repairedTokenF1);
    addFailure(
      failures,
      !repair.exactGapDetected ||
        repair.contextBeforeSeconds >
          LIVE_REPLAY_THRESHOLDS.repairContextSeconds ||
        repair.contextAfterSeconds >
          LIVE_REPLAY_THRESHOLDS.repairContextSeconds ||
        repair.outsideContextTokenChanges !== 0 ||
        repair.repairedTokenF1 < LIVE_REPLAY_THRESHOLDS.repairTokenF1,
      'repair_bounds',
    );
  }

  const soak = evidence.resourceSoak;
  if (soak) {
    requireNonNegative([
      soak.sourceStartSeconds,
      soak.sourceEndSeconds,
      soak.sourceDurationSeconds,
      soak.soakStartSeconds,
      soak.soakEndSeconds,
      soak.warmupEndSeconds,
      soak.sampleIntervalSeconds,
      soak.preparedIdleRssGiB,
      soak.peakRssGiB,
      ...soak.rssSamples.flatMap((sample) => [sample.atSeconds, sample.rssGiB]),
      ...soak.thermalSamples.map((sample) => sample.atSeconds),
    ]);
    const longestSourceSeconds = maximum(
      repetitions.map(({ expectedSourceSeconds }) => expectedSourceSeconds),
    );
    const postWarmRss = soak.rssSamples.filter(
      (sample) => sample.atSeconds >= soak.warmupEndSeconds,
    );
    const postWarmThermal = soak.thermalSamples.filter(
      (sample) => sample.atSeconds >= soak.warmupEndSeconds,
    );
    const expectedPostWarmSamples =
      (soak.sourceEndSeconds - soak.warmupEndSeconds) /
        soak.sampleIntervalSeconds +
      1;
    const fullyBound =
      soak.realTime === true &&
      soak.longestSource === true &&
      soak.sampleIntervalSeconds === 1 &&
      soak.sourceEndSeconds > soak.sourceStartSeconds &&
      soak.sourceDurationSeconds ===
        soak.sourceEndSeconds - soak.sourceStartSeconds &&
      soak.sourceDurationSeconds === longestSourceSeconds &&
      soak.soakStartSeconds <= soak.warmupEndSeconds &&
      soak.soakEndSeconds === soak.sourceEndSeconds &&
      soak.warmupEndSeconds === soak.sourceStartSeconds &&
      Number.isSafeInteger(expectedPostWarmSamples) &&
      postWarmRss.length === expectedPostWarmSamples &&
      postWarmThermal.length === expectedPostWarmSamples &&
      postWarmRss[0]?.atSeconds === soak.warmupEndSeconds &&
      postWarmThermal[0]?.atSeconds === soak.warmupEndSeconds &&
      postWarmRss.at(-1)?.atSeconds === soak.sourceEndSeconds &&
      postWarmThermal.at(-1)?.atSeconds === soak.sourceEndSeconds &&
      samplesHaveCadence(postWarmRss, soak.sampleIntervalSeconds) &&
      samplesHaveCadence(postWarmThermal, soak.sampleIntervalSeconds);
    if (!fullyBound) failures.add('resource_evidence_unavailable');

    const derivedPeak = maximum(soak.rssSamples.map(({ rssGiB }) => rssGiB));
    if (soak.rssSamples.length > 0 && derivedPeak !== soak.peakRssGiB) {
      throw new Error('live_replay_invalid_observation');
    }
    peaks.push(derivedPeak);
    peakDeltas.push(derivedPeak - soak.preparedIdleRssGiB);
    addFailure(
      failures,
      derivedPeak > LIVE_REPLAY_THRESHOLDS.peakRssGiB ||
        derivedPeak - soak.preparedIdleRssGiB >
          LIVE_REPLAY_THRESHOLDS.rssAboveIdleGiB,
      'peak_rss',
    );
    const growth = rssGrowthMiBPerHour(postWarmRss);
    if (Number.isFinite(growth)) rssGrowth.push(growth);
    else failures.add('resource_evidence_unavailable');
    addFailure(
      failures,
      Number.isFinite(growth) &&
        growth > LIVE_REPLAY_THRESHOLDS.rssGrowthMiBPerHour + 1e-9,
      'rss_growth',
    );
    const serious = postWarmThermal.some(
      (sample) => sample.state === 'serious' || sample.state === 'critical',
    );
    const fairFraction =
      postWarmThermal.filter((sample) => sample.state === 'fair').length /
      Math.max(1, postWarmThermal.length);
    const fairRun = longestFairRunSeconds(postWarmThermal);
    fairFractions.push(fairFraction);
    fairRuns.push(fairRun);
    addFailure(
      failures,
      serious ||
        fairFraction > LIVE_REPLAY_THRESHOLDS.fairThermalFraction ||
        fairRun > LIVE_REPLAY_THRESHOLDS.fairThermalContinuousSeconds,
      'thermal_state',
    );
  }

  addFailure(failures, committedPrefixViolations !== 0, 'committed_prefix');
  addFailure(failures, missingAcceptedSequences !== 0, 'missing_sequence');
  addFailure(
    failures,
    unexpectedProcessedSequences !== 0,
    'unexpected_processed_sequence',
  );
  addFailure(
    failures,
    overlappingDuplicateTokenProvenance !== 0,
    'duplicate_token_provenance',
  );
  addFailure(failures, incompleteSourceCoverage !== 0, 'source_coverage');
  addFailure(
    failures,
    committedSyntheticSeamErrors !== 0,
    'committed_synthetic_seam',
  );
  addFailure(failures, rendererInferenceCallbacks !== 0, 'renderer_inference');
  addFailure(
    failures,
    wholeSessionAsrCallsWhenComplete !== 0,
    'unexpected_whole_session_asr',
  );
  addFailure(
    failures,
    analysisBeforeCanonicalCommit !== 0,
    'analysis_before_canonical_commit',
  );

  const firstTextP50 = firstText.length > 0 ? percentile(firstText, 0.5) : 0;
  const firstTextP95 = firstText.length > 0 ? percentile(firstText, 0.95) : 0;
  const firstTextP50Upper95 =
    firstText.length > 0 ? bootstrapUpper(firstText, 0.5) : 0;
  const firstTextP95Upper95 =
    firstText.length > 0 ? bootstrapUpper(firstText, 0.95) : 0;
  const firstTextMaximum = firstText.length > 0 ? Math.max(...firstText) : 0;
  const cadenceP50 = cadence.length > 0 ? percentile(cadence, 0.5) : 0;
  const cadenceP95 = cadence.length > 0 ? percentile(cadence, 0.95) : 0;
  const cadenceP50Upper95 =
    cadence.length > 0 ? bootstrapUpper(cadence, 0.5) : 0;
  const cadenceP95Upper95 =
    cadence.length > 0 ? bootstrapUpper(cadence, 0.95) : 0;
  const cadenceMaximum = cadence.length > 0 ? Math.max(...cadence) : 0;
  const processingP95 =
    processingLatency.length > 0 ? percentile(processingLatency, 0.95) : 0;
  const processingP95Upper95 =
    processingLatency.length > 0 ? bootstrapUpper(processingLatency, 0.95) : 0;
  const processingMaximum =
    processingLatency.length > 0 ? Math.max(...processingLatency) : 0;
  const rtfMaximum = Math.max(...runtimeFactors);
  const rollbackP95 = rollbacks.length > 0 ? percentile(rollbacks, 0.95) : 0;
  const handoffP99 = handoffs.length > 0 ? percentile(handoffs, 0.99) : 0;
  const volatileRate = volatileOperations / Math.max(1, newTokens);

  if (evidence.mlxBaseline) {
    requireNonNegative([
      evidence.mlxBaseline.firstTextP95Seconds,
      evidence.mlxBaseline.runtimeFactor,
    ]);
    addFailure(
      failures,
      firstTextP95Upper95 >
        evidence.mlxBaseline.firstTextP95Seconds +
          LIVE_REPLAY_THRESHOLDS.firstTextP95RegressionSeconds,
      'first_text_regression',
    );
    addFailure(
      failures,
      rtfMaximum >
        evidence.mlxBaseline.runtimeFactor *
          LIVE_REPLAY_THRESHOLDS.runtimeFactorRegressionRatio,
      'runtime_factor_regression',
    );
  }

  addFailure(
    failures,
    firstTextP50Upper95 > LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds,
    'first_text_p50',
  );
  addFailure(
    failures,
    firstTextP95Upper95 > LIVE_REPLAY_THRESHOLDS.firstTextP95Seconds,
    'first_text_p95',
  );
  addFailure(
    failures,
    firstTextMaximum > LIVE_REPLAY_THRESHOLDS.firstTextMaximumSeconds,
    'first_text_max',
  );
  addFailure(
    failures,
    cadenceP50Upper95 > LIVE_REPLAY_THRESHOLDS.publicationCadenceP50Seconds,
    'publication_cadence_p50',
  );
  addFailure(
    failures,
    cadenceP95Upper95 > LIVE_REPLAY_THRESHOLDS.publicationCadenceP95Seconds,
    'publication_cadence_p95',
  );
  addFailure(
    failures,
    cadenceMaximum > LIVE_REPLAY_THRESHOLDS.publicationCadenceMaximumSeconds,
    'publication_cadence_max',
  );
  addFailure(
    failures,
    processingP95Upper95 > LIVE_REPLAY_THRESHOLDS.processingLatencyP95Seconds,
    'processing_latency_p95',
  );
  addFailure(
    failures,
    processingMaximum > LIVE_REPLAY_THRESHOLDS.processingLatencyMaximumSeconds,
    'processing_latency_max',
  );
  addFailure(
    failures,
    rtfMaximum > LIVE_REPLAY_THRESHOLDS.runtimeFactor,
    'runtime_factor',
  );
  addFailure(
    failures,
    handoffP99 > LIVE_REPLAY_THRESHOLDS.captureHandoffP99Milliseconds,
    'capture_handoff',
  );
  addFailure(
    failures,
    volatileRate > LIVE_REPLAY_THRESHOLDS.volatileOperationsPerNewToken,
    'volatile_revision_rate',
  );
  addFailure(
    failures,
    rollbackP95 > LIVE_REPLAY_THRESHOLDS.rollbackP95Tokens,
    'volatile_rollback',
  );

  const unavailableFailures: string[] = [];
  if (repetitions.length < 3)
    unavailableFailures.push('insufficient_repetitions');
  if (evidence.corpusEligible !== true)
    unavailableFailures.push('insufficient_corpus');
  if (evidence.aecEvidenceAvailable !== true)
    unavailableFailures.push('dependency_unavailable');
  if (evidence.resourceEvidenceAvailable !== true || !evidence.resourceSoak)
    unavailableFailures.push('resource_evidence_unavailable');
  if (evidence.engineOrderAlternated !== true)
    unavailableFailures.push('engine_order_unverified');
  if (evidence.mlxProductionQueueVerified !== true)
    unavailableFailures.push('mlx_queue_unverified');
  if (!evidence.mlxBaseline)
    unavailableFailures.push('mlx_baseline_unavailable');
  if (
    failures.has('resource_evidence_unavailable') &&
    !unavailableFailures.includes('resource_evidence_unavailable')
  ) {
    unavailableFailures.push('resource_evidence_unavailable');
  }
  for (const failure of unavailableFailures) failures.add(failure);

  const sourceCoverage = processedSeconds / expectedSeconds;
  const metrics: Record<string, number | boolean | string> = {
    firstTextP50Seconds: finiteMetric(firstTextP50),
    firstTextP50Upper95Seconds: finiteMetric(firstTextP50Upper95),
    firstTextP95Seconds: finiteMetric(firstTextP95),
    firstTextP95Upper95Seconds: finiteMetric(firstTextP95Upper95),
    firstTextMaximumSeconds: finiteMetric(firstTextMaximum),
    publicationCadenceP50Seconds: finiteMetric(cadenceP50),
    publicationCadenceP50Upper95Seconds: finiteMetric(cadenceP50Upper95),
    publicationCadenceP95Seconds: finiteMetric(cadenceP95),
    publicationCadenceP95Upper95Seconds: finiteMetric(cadenceP95Upper95),
    publicationCadenceMaximumSeconds: finiteMetric(cadenceMaximum),
    processingLatencyP95Seconds: finiteMetric(processingP95),
    processingLatencyP95Upper95Seconds: finiteMetric(processingP95Upper95),
    processingLatencyMaximumSeconds: finiteMetric(processingMaximum),
    runtimeFactorMaximum: finiteMetric(rtfMaximum),
    sourceCoverage: finiteMetric(sourceCoverage),
    volatileOperationsPerNewToken: finiteMetric(volatileRate),
    rollbackP95Tokens: finiteMetric(rollbackP95),
    captureHandoffP99Milliseconds: finiteMetric(handoffP99),
    rssGrowthMiBPerHourMaximum: finiteMetric(
      rssGrowth.length > 0 ? Math.max(...rssGrowth) : 0,
    ),
    peakRssGiBMaximum: finiteMetric(maximum(peaks)),
    peakRssAboveIdleGiBMaximum: finiteMetric(maximum(peakDeltas)),
    fairThermalFractionMaximum: finiteMetric(maximum(fairFractions)),
    fairThermalContinuousSecondsMaximum: finiteMetric(maximum(fairRuns)),
    revisionMaximumAgeSeconds: finiteMetric(maximum(revisionAges)),
    seamErrorRateMaximum: finiteMetric(maximum(seamRates)),
    batchEditRateMaximum: finiteMetric(maximum(batchEditRates)),
    batchPrecisionAt2SecondsMinimum: finiteMetric(minimum(batchPrecision2)),
    batchRecallAt2SecondsMinimum: finiteMetric(minimum(batchRecall2)),
    batchPrecisionAt5SecondsMinimum: finiteMetric(minimum(batchPrecision5)),
    batchRecallAt5SecondsMinimum: finiteMetric(minimum(batchRecall5)),
    proxyDisagreementRegressionMaximum: finiteMetric(
      maximum(proxyDisagreementRegression),
    ),
    proxyRecallRegressionMaximum: finiteMetric(maximum(proxyRecallRegression)),
    repairContextSecondsMaximum: finiteMetric(maximum(repairContexts)),
    repairTokenF1Minimum: finiteMetric(minimum(repairF1)),
  };
  const invariants = {
    committedPrefixViolations,
    missingAcceptedSequences,
    unexpectedProcessedSequences,
    overlappingDuplicateTokenProvenance,
    incompleteSourceCoverage,
    wholeSessionAsrCallsWhenComplete,
    analysisBeforeCanonicalCommit,
    committedSyntheticSeamErrors,
    rendererInferenceCallbacks,
    unexpectedPrivateReportFields: 0,
  };
  return {
    status:
      unavailableFailures.length > 0
        ? 'unavailable'
        : failures.size > 0
          ? 'fail'
          : 'pass',
    metrics,
    invariants,
    failures: [...failures],
  };
};

const failureCodes = new Set([
  'insufficient_repetitions',
  'insufficient_corpus',
  'dependency_unavailable',
  'resource_evidence_unavailable',
  'engine_order_unverified',
  'mlx_queue_unverified',
  'mlx_baseline_unavailable',
  'first_text_missing',
  'first_text_p50',
  'first_text_p95',
  'first_text_max',
  'first_text_regression',
  'publication_cadence_p50',
  'publication_cadence_p95',
  'publication_cadence_max',
  'processing_latency_p95',
  'processing_latency_max',
  'runtime_factor',
  'runtime_factor_regression',
  'capture_handoff',
  'volatile_revision_rate',
  'volatile_rollback',
  'volatile_revision_age',
  'seam_error_rate',
  'batch_agreement',
  'proxy_non_regression',
  'repair_bounds',
  'peak_rss',
  'rss_growth',
  'thermal_state',
  'committed_prefix',
  'missing_sequence',
  'unexpected_processed_sequence',
  'duplicate_token_provenance',
  'source_coverage',
  'unexpected_whole_session_asr',
  'analysis_before_canonical_commit',
  'committed_synthetic_seam',
  'renderer_inference',
]);

const metricKeys = new Set([
  'firstTextP50Seconds',
  'firstTextP50Upper95Seconds',
  'firstTextP95Seconds',
  'firstTextP95Upper95Seconds',
  'firstTextMaximumSeconds',
  'publicationCadenceP50Seconds',
  'publicationCadenceP50Upper95Seconds',
  'publicationCadenceP95Seconds',
  'publicationCadenceP95Upper95Seconds',
  'publicationCadenceMaximumSeconds',
  'processingLatencyP95Seconds',
  'processingLatencyP95Upper95Seconds',
  'processingLatencyMaximumSeconds',
  'runtimeFactorMaximum',
  'sourceCoverage',
  'volatileOperationsPerNewToken',
  'rollbackP95Tokens',
  'captureHandoffP99Milliseconds',
  'rssGrowthMiBPerHourMaximum',
  'peakRssGiBMaximum',
  'peakRssAboveIdleGiBMaximum',
  'fairThermalFractionMaximum',
  'fairThermalContinuousSecondsMaximum',
  'revisionMaximumAgeSeconds',
  'seamErrorRateMaximum',
  'batchEditRateMaximum',
  'batchPrecisionAt2SecondsMinimum',
  'batchRecallAt2SecondsMinimum',
  'batchPrecisionAt5SecondsMinimum',
  'batchRecallAt5SecondsMinimum',
  'proxyDisagreementRegressionMaximum',
  'proxyRecallRegressionMaximum',
  'repairContextSecondsMaximum',
  'repairTokenF1Minimum',
]);

const invariantKeys = new Set([
  'committedPrefixViolations',
  'missingAcceptedSequences',
  'unexpectedProcessedSequences',
  'overlappingDuplicateTokenProvenance',
  'incompleteSourceCoverage',
  'wholeSessionAsrCallsWhenComplete',
  'analysisBeforeCanonicalCommit',
  'committedSyntheticSeamErrors',
  'rendererInferenceCallbacks',
  'unexpectedPrivateReportFields',
]);

const isForbiddenKey = (key: string): boolean =>
  !metricKeys.has(key) &&
  !invariantKeys.has(key) &&
  /(transcript|text|token|path|stderr|identity|timestamp|hash|meetings)/i.test(
    key,
  );

const rejectPrivateFieldsRecursively = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(rejectPrivateFieldsRecursively);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    if (isForbiddenKey(key)) throw new Error('private_report_field');
    rejectPrivateFieldsRecursively(nested);
  }
};

const expectObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('private_report_value');
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): void => {
  const allowed = new Set(keys);
  if (
    Object.keys(value).length !== allowed.size ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error('private_report_field');
  }
};

const safeNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('private_report_value');
  }
  return value;
};

const sanitizeMetrics = (
  value: unknown,
): Record<string, number | boolean | string> => {
  const raw = expectObject(value);
  exactKeys(raw, [...metricKeys]);
  const safe: Record<string, number | boolean | string> = {};
  for (const [key, metric] of Object.entries(raw)) {
    if (!metricKeys.has(key)) throw new Error('private_report_field');
    if (typeof metric === 'boolean') safe[key] = metric;
    else safe[key] = safeNumber(metric);
  }
  return safe;
};

const sanitizeInvariants = (value: unknown): Record<string, number> => {
  const raw = expectObject(value);
  exactKeys(raw, [...invariantKeys]);
  const safe: Record<string, number> = {};
  for (const [key, invariant] of Object.entries(raw)) {
    if (!invariantKeys.has(key)) throw new Error('private_report_field');
    const number = safeNumber(invariant);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new Error('private_report_value');
    }
    safe[key] = number;
  }
  return safe;
};

const sanitizeFailures = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new Error('private_report_value');
  return value.map((failure) => {
    if (typeof failure !== 'string' || !failureCodes.has(failure)) {
      throw new Error('private_report_value');
    }
    return failure;
  });
};

const sanitizeEngine = (
  value: unknown,
): PrivateLiveReplayReport['engines']['mlxProduction'] => {
  const raw = expectObject(value);
  exactKeys(raw, ['status', 'metrics']);
  if (
    raw.status !== 'pass' &&
    raw.status !== 'fail' &&
    raw.status !== 'unavailable'
  ) {
    throw new Error('private_report_value');
  }
  if (raw.status === 'unavailable') {
    const metrics = expectObject(raw.metrics);
    const sanitized: Record<string, number | boolean | string> = {};
    for (const [key, metric] of Object.entries(metrics)) {
      if (!metricKeys.has(key)) throw new Error('private_report_field');
      sanitized[key] =
        typeof metric === 'boolean' ? metric : safeNumber(metric);
    }
    return { status: raw.status, metrics: sanitized };
  }
  return { status: raw.status, metrics: sanitizeMetrics(raw.metrics) };
};

export const sanitizeLiveReplayReport = (
  input: unknown,
): PrivateLiveReplayReport => {
  rejectPrivateFieldsRecursively(input);
  const raw = expectObject(input);
  exactKeys(raw, [
    'schemaVersion',
    'benchmark',
    'referencePolicy',
    'corpus',
    'runtime',
    'engines',
    'invariants',
    'failures',
  ]);
  if (
    raw.schemaVersion !== 1 ||
    raw.benchmark !== 'parakeet_live_causal_replay'
  ) {
    throw new Error('private_report_value');
  }
  const policy = expectObject(raw.referencePolicy);
  exactKeys(policy, ['batchParakeet', 'persistedCanonical']);
  if (
    policy.batchParakeet !== 'consistency_diagnostic_not_ground_truth' ||
    policy.persistedCanonical !==
      'existing_local_transcript_proxy_not_human_ground_truth'
  ) {
    throw new Error('private_report_value');
  }
  const corpus = expectObject(raw.corpus);
  exactKeys(corpus, ['meetingCount', 'sourceCount', 'audioMinutesRoundedTo5']);
  const meetingCount = safeNumber(corpus.meetingCount);
  const sourceCount = safeNumber(corpus.sourceCount);
  const audioMinutesRoundedTo5 = safeNumber(corpus.audioMinutesRoundedTo5);
  if (
    !Number.isSafeInteger(meetingCount) ||
    !Number.isSafeInteger(sourceCount) ||
    !Number.isSafeInteger(audioMinutesRoundedTo5) ||
    meetingCount < 0 ||
    sourceCount < 0 ||
    audioMinutesRoundedTo5 < 0 ||
    audioMinutesRoundedTo5 % 5 !== 0
  ) {
    throw new Error('private_report_value');
  }
  const runtime = expectObject(raw.runtime);
  exactKeys(runtime, [
    'fluidAudioVersion',
    'fluidAudioRevision',
    'modelId',
    'configId',
  ]);
  const engines = expectObject(raw.engines);
  exactKeys(engines, ['mlxProduction', 'parakeetSliding']);

  if (
    runtime.fluidAudioVersion !== '0.15.5' ||
    runtime.fluidAudioRevision !== '19600a485baa4998812e4654b70d2bab8f2c9949' ||
    runtime.modelId !== 'parakeet-tdt-0.6b-v3' ||
    (runtime.configId !== 'pinned-default-v1' &&
      runtime.configId !== 'low-latency-v1')
  ) {
    throw new Error('private_report_value');
  }
  const sanitizedEngines = {
    mlxProduction: sanitizeEngine(engines.mlxProduction),
    parakeetSliding: sanitizeEngine(engines.parakeetSliding),
  };
  const invariants = sanitizeInvariants(raw.invariants);
  const failures = sanitizeFailures(raw.failures);
  const bothPass = Object.values(sanitizedEngines).every(
    ({ status }) => status === 'pass',
  );
  const anyUnavailable = Object.values(sanitizedEngines).some(
    ({ status }) => status === 'unavailable',
  );
  const allUnavailable = Object.values(sanitizedEngines).every(
    ({ status }) => status === 'unavailable',
  );
  const anyPass = Object.values(sanitizedEngines).some(
    ({ status }) => status === 'pass',
  );
  const hasUnavailableReason = failures.some((failure) =>
    [
      'insufficient_repetitions',
      'insufficient_corpus',
      'dependency_unavailable',
      'resource_evidence_unavailable',
      'engine_order_unverified',
      'mlx_queue_unverified',
      'mlx_baseline_unavailable',
    ].includes(failure),
  );
  const hasInsufficientCorpusReason = failures.includes('insufficient_corpus');
  const hasExactInsufficientCorpusReason =
    failures.length === 1 && failures[0] === 'insufficient_corpus';
  const eligibleCorpus =
    meetingCount >= 3 &&
    sourceCount >= 6 &&
    audioMinutesRoundedTo5 >= 90 &&
    sourceCount === meetingCount * 2;
  if (
    (bothPass &&
      (failures.length !== 0 ||
        Object.values(invariants).some((value) => value !== 0) ||
        !eligibleCorpus)) ||
    (!bothPass && failures.length === 0) ||
    anyUnavailable !== hasUnavailableReason ||
    (anyPass && !eligibleCorpus) ||
    (!eligibleCorpus &&
      (!allUnavailable || !hasExactInsufficientCorpusReason)) ||
    (eligibleCorpus && hasInsufficientCorpusReason)
  ) {
    throw new Error('private_report_consistency');
  }

  return {
    schemaVersion: 1,
    benchmark: 'parakeet_live_causal_replay',
    referencePolicy: {
      batchParakeet: 'consistency_diagnostic_not_ground_truth',
      persistedCanonical:
        'existing_local_transcript_proxy_not_human_ground_truth',
    },
    corpus: { meetingCount, sourceCount, audioMinutesRoundedTo5 },
    runtime: {
      fluidAudioVersion: runtime.fluidAudioVersion,
      fluidAudioRevision: runtime.fluidAudioRevision,
      modelId: runtime.modelId,
      configId: runtime.configId,
    },
    engines: {
      mlxProduction: sanitizedEngines.mlxProduction,
      parakeetSliding: sanitizedEngines.parakeetSliding,
    },
    invariants,
    failures,
  };
};

export const buildPrivateLiveReplayReport = (input: {
  corpus: { meetingCount: number; sourceCount: number; audioMinutes: number };
  runtime: PrivateLiveReplayReport['runtime'];
  mlxProduction: LiveReplayVerdict;
  parakeetSliding: LiveReplayVerdict;
}): PrivateLiveReplayReport => {
  requireFinite([
    input.corpus.meetingCount,
    input.corpus.sourceCount,
    input.corpus.audioMinutes,
  ]);
  const rawCorpusEligible =
    input.corpus.meetingCount >= 3 &&
    input.corpus.sourceCount >= 6 &&
    input.corpus.audioMinutes >= 90 &&
    input.corpus.sourceCount === input.corpus.meetingCount * 2;
  const statuses = [input.mlxProduction.status, input.parakeetSliding.status];
  const anyPass = statuses.includes('pass');
  const allUnavailable = statuses.every((status) => status === 'unavailable');
  const inputFailures = [
    ...new Set([
      ...input.mlxProduction.failures,
      ...input.parakeetSliding.failures,
    ]),
  ];
  const hasInsufficientCorpusReason = inputFailures.includes(
    'insufficient_corpus',
  );
  const hasExactInsufficientCorpusReason =
    inputFailures.length === 1 && inputFailures[0] === 'insufficient_corpus';
  if (
    (anyPass && !rawCorpusEligible) ||
    (!rawCorpusEligible &&
      (!allUnavailable || !hasExactInsufficientCorpusReason)) ||
    (rawCorpusEligible && hasInsufficientCorpusReason)
  ) {
    throw new Error('private_report_consistency');
  }
  const failures = inputFailures;
  const invariantNames = new Set([
    ...Object.keys(input.mlxProduction.invariants),
    ...Object.keys(input.parakeetSliding.invariants),
  ]);
  const invariants = Object.fromEntries(
    [...invariantNames].map((name) => [
      name,
      (input.mlxProduction.invariants[name] ?? 0) +
        (input.parakeetSliding.invariants[name] ?? 0),
    ]),
  );
  return sanitizeLiveReplayReport({
    schemaVersion: 1,
    benchmark: 'parakeet_live_causal_replay',
    referencePolicy: {
      batchParakeet: 'consistency_diagnostic_not_ground_truth',
      persistedCanonical:
        'existing_local_transcript_proxy_not_human_ground_truth',
    },
    corpus: {
      meetingCount: input.corpus.meetingCount,
      sourceCount: input.corpus.sourceCount,
      audioMinutesRoundedTo5: Math.round(input.corpus.audioMinutes / 5) * 5,
    },
    runtime: input.runtime,
    engines: {
      mlxProduction: {
        status: input.mlxProduction.status,
        metrics: input.mlxProduction.metrics,
      },
      parakeetSliding: {
        status: input.parakeetSliding.status,
        metrics: input.parakeetSliding.metrics,
      },
    },
    invariants,
    failures,
  });
};
